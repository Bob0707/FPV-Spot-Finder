import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// ── Error Boundary ────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(error){return{hasError:true,error};}
  componentDidCatch(error,info){console.error("FPV App Error:",error,info);}
  render(){
    if(this.state.hasError){
      return(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a0e17",color:"#e2e8f0",fontFamily:"system-ui",gap:16,padding:24,textAlign:"center"}}>
          <span style={{fontSize:48}}>🚁</span>
          <h2 style={{margin:0,fontSize:20}}>Etwas ist schiefgelaufen</h2>
          <p style={{color:"#94a3b8",fontSize:14,maxWidth:400,lineHeight:1.6}}>{this.state.error?.message||"Ein unerwarteter Fehler ist aufgetreten."}</p>
          <button onClick={()=>{this.setState({hasError:false,error:null});window.location.reload();}} style={{background:"#22d3a7",color:"#0a0e17",border:"none",borderRadius:8,padding:"10px 24px",fontSize:14,fontWeight:600,cursor:"pointer"}}>App neu laden</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DACH_CENTER  = [10.5, 47.5];
const DACH_ZOOM    = 5.5;
const NOMINATIM    = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = ["/api/overpass-lz4","/api/overpass-z","/api/overpass-fr","/api/overpass-pc"];
const spotCache = new Map();

const BASE_LAYERS = [
  { id:"osm",       name:"OpenStreetMap", description:"Standard-Karte",           tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],                                                                                                                                                                                                                                                          attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom:19, color:"#22d3a7" },
  { id:"satellite", name:"Satellit",      description:"Esri World Imagery",        tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],                                                                                                                                                                                                          attribution:"Esri, Maxar, Earthstar Geographics",                                    maxZoom:19, color:"#60a5fa" },
  { id:"topo",      name:"Topografie",    description:"OpenTopoMap Höhenlinien",   tiles:["https://tile.opentopomap.org/{z}/{x}/{y}.png"],                                                                                                                                                                                                                                                          attribution:'© <a href="https://opentopomap.org">OpenTopoMap</a>',                   maxZoom:17, color:"#f59e0b" },
];

// Phase 7: airspace removed from OVERLAY_LAYERS (now in dedicated Luftraum section)
const OVERLAY_LAYERS = [
  { id:"nightlight", name:"Nachtlicht (VIIRS)",    description:"NASA Black Marble 2012",  tiles:["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg"], attribution:"NASA GIBS / VIIRS City Lights", maxZoom:8,  opacity:0.85, color:"#f59e0b", badge:"NASA" },
  { id:"corine",     name:"Landnutzung CORINE",    description:"Copernicus CLC 2018",     tiles:["https://image.discomap.eea.europa.eu/arcgis/services/Corine/CLC2018_WM/MapServer/WmsServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&BBOX={bbox-epsg-3857}&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&LAYERS=12&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE"], attribution:"© EEA Copernicus Land Service", maxZoom:18, opacity:0.6, color:"#10b981", badge:"EU" },
  { id:"fpvscore",   name:"FPV Score Heatmap",     description:"Gewichtetes Potenzial pro Spot", tiles:null, opacity:0.75, color:"#a78bfa", badge:"FPV" },
];

// ── Phase 7: Airspace Types ────────────────────────────────────────────────
const AIRSPACE_TYPES = [
  { type:0,  shortCode:"OTHER", name:"Sonstiges",       color:"#94a3b8" },
  { type:1,  shortCode:"R",     name:"Restricted",      color:"#ef4444" },
  { type:2,  shortCode:"D",     name:"Danger",          color:"#f59e0b" },
  { type:3,  shortCode:"P",     name:"Prohibited",      color:"#dc2626" },
  { type:4,  shortCode:"CTR",   name:"CTR",             color:"#3b82f6" },
  { type:5,  shortCode:"TMZ",   name:"TMZ",             color:"#8b5cf6" },
  { type:6,  shortCode:"RMZ",   name:"RMZ",             color:"#06b6d4" },
  { type:7,  shortCode:"TMA",   name:"TMA",             color:"#f97316" },
  { type:8,  shortCode:"TIZ",   name:"TIZ",             color:"#84cc16" },
  { type:10, shortCode:"GLDR",  name:"Segelfluggebiet", color:"#10b981" },
  { type:11, shortCode:"W",     name:"Warning Area",    color:"#fbbf24" },
  { type:12, shortCode:"ATZ",   name:"ATZ",             color:"#60a5fa" },
];
const AIRSPACE_LEGEND_TYPES = ["CTR","TMA","R","P","D","TMZ","RMZ","ATZ","W"];
const ICAO_CLASS_NAMES = { 0:"A",1:"B",2:"C",3:"D",4:"E",5:"F",6:"G" };
const NATURSCHUTZ_COLOR = "#22c55e";

function getAirspaceTypeInfo(code) {
  if (typeof code === "number") return AIRSPACE_TYPES.find(t => t.type === code) || AIRSPACE_TYPES[0];
  return AIRSPACE_TYPES.find(t => t.shortCode === code) || AIRSPACE_TYPES[0];
}

function formatAltLimit(limit) {
  if (!limit) return "?";
  let { value, unit, referenceDatum } = limit;
  if (typeof unit === "number")           unit           = ["FT","FL","M"][unit]          ?? "FT";
  if (typeof referenceDatum === "number") referenceDatum = ["GND","MSL","STD"][referenceDatum] ?? "GND";
  if (unit === "FL") return `FL${String(Math.round(value)).padStart(3,"0")}`;
  return `${value} ${unit==="FT"?"ft":unit==="M"?"m":unit} ${referenceDatum}`;
}

// MapLibre match expression for zone colors
function zoneColorExpr() {
  const pairs = AIRSPACE_TYPES.flatMap(t => [t.shortCode, t.color]);
  return ["match", ["get","zoneType"], ...pairs, "#94a3b8"];
}

// ── Spot Types ─────────────────────────────────────────────────────────────
const SPOT_TYPES = [
  { id:"bando",      name:"Bandos",          color:"#ef4444", icon:"🏚", shortDesc:"Verlassene Gebäude" },
  { id:"quarry",     name:"Steinbrüche",      color:"#f59e0b", icon:"⛏", shortDesc:"Abbaustätten" },
  { id:"brownfield", name:"Industriebrachen", color:"#8b5cf6", icon:"🏭", shortDesc:"Ehemalige Industriegebiete" },
  { id:"bridge",     name:"Brücken",          color:"#3b82f6", icon:"🌉", shortDesc:"Straßen- und Eisenbahnbrücken" },
  { id:"openspace",  name:"Offene Flächen",   color:"#22d3a7", icon:"🌿", shortDesc:"Parks, Wiesen, Freiflächen" },
  { id:"clearing",   name:"Waldlichtungen",   color:"#10b981", icon:"🌲", shortDesc:"Heiden, Grasland" },
  { id:"water",      name:"Gewässer",          color:"#06b6d4", icon:"💧", shortDesc:"Seen, Flüsse, Kanäle" },
];
const ALL_SPOT_TYPE_IDS = SPOT_TYPES.map(st => st.id);

function classifySpot(tags) {
  if (!tags) return null;
  if (tags.abandoned==="building")                                        return "bando";
  if (tags.building && tags.abandoned==="yes")                            return "bando";
  if (tags.building && tags.disused==="yes")                              return "bando";
  if (tags.building && tags.ruins==="yes")                                return "bando";
  if (tags.landuse==="quarry")                                            return "quarry";
  if (tags.landuse==="brownfield")                                        return "brownfield";
  if (tags.landuse==="industrial"&&(tags.disused==="yes"||tags.abandoned==="yes")) return "brownfield";
  if (tags.bridge==="yes"&&tags.highway)                                  return "bridge";
  if (tags.bridge==="yes"&&tags.railway)                                  return "bridge";
  if (tags.leisure==="park")                                              return "openspace";
  if (tags.landuse==="grass"||tags.landuse==="meadow"||tags.landuse==="recreation_ground") return "openspace";
  if (tags.leisure==="nature_reserve")                                    return "openspace";
  if (tags.natural==="heath"||tags.natural==="grassland"||tags.natural==="scrub") return "clearing";
  if (tags.natural==="water")                                             return "water";
  if (tags.waterway==="river"||tags.waterway==="canal")                   return "water";
  if (tags.water==="lake"||tags.water==="reservoir")                      return "water";
  return null;
}

// ── Scoring ────────────────────────────────────────────────────────────────
function haversineKm(lat1,lng1,lat2,lng2) {
  const R=6371,φ1=lat1*Math.PI/180,φ2=lat2*Math.PI/180,Δφ=(lat2-lat1)*Math.PI/180,Δλ=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function getSinglePlacePenalty(placeNodes,sLat,sLng) {
  let max=0;
  for (const p of placeNodes) {
    if (p.lat==null||p.lon==null) continue;
    const d=haversineKm(sLat,sLng,p.lat,p.lon),t=p.tags?.place,pop=parseInt(p.tags?.population||"0");
    let pen=0;
    if (t==="city")        { if(d<2)pen=62;else if(d<5)pen=48;else if(d<10)pen=34;else if(d<20)pen=20;else if(d<30)pen=10; }
    else if(t==="town")    { if(d<0.5)pen=60;else if(d<2)pen=45;else if(d<5)pen=28;else if(d<10)pen=14; }
    else if(t==="suburb"||t==="quarter") { if(d<0.3)pen=72;else if(d<1)pen=62;else if(d<3)pen=44;else if(d<6)pen=22; }
    else if(t==="neighbourhood") { if(d<0.15)pen=68;else if(d<0.5)pen=55;else if(d<1.5)pen=36;else if(d<3)pen=16; }
    else if(t==="village") { if(d<0.3)pen=24;else if(d<1)pen=14;else if(d<3)pen=6; }
    else if(t==="hamlet")  { if(d<0.3)pen=12;else if(d<1)pen=5; }
    if      (pop>500000&&d<25) pen=Math.min(72,pen+20);
    else if (pop>200000&&d<18) pen=Math.min(72,pen+14);
    else if (pop>50000 &&d<12) pen=Math.min(72,pen+8);
    else if (pop>10000 &&d<7)  pen=Math.min(72,pen+4);
    if (pen>max) max=pen;
  }
  return max;
}
function getSuburbDensityPenalty(placeNodes,sLat,sLng) {
  let count=0;
  for (const p of placeNodes) {
    if (p.lat==null||p.lon==null) continue;
    if (!["suburb","quarter","neighbourhood","city_block"].includes(p.tags?.place)) continue;
    if (haversineKm(sLat,sLng,p.lat,p.lon)<=5) count++;
  }
  return count>=25?38:count>=16?32:count>=10?26:count>=6?18:count>=3?10:count>=1?4:0;
}
function computeRemoteness(tags,spotType,placeNodes,spotCoords) {
  const [sLng,sLat]=spotCoords;
  let score=100;
  const singlePen=getSinglePlacePenalty(placeNodes,sLat,sLng);
  const suburbPen=getSuburbDensityPenalty(placeNodes,sLat,sLng);
  const hi=Math.max(singlePen,suburbPen);
  const lo=Math.min(singlePen,suburbPen);
  score-=Math.min(85,hi+lo*0.55);
  const lvl=parseInt(tags?.["building:levels"]||"0");
  if(lvl>=8)score-=12;else if(lvl>=4)score-=7;else if(lvl>=2)score-=3;
  if(tags?.tourism)score-=12; if(tags?.amenity)score-=8; if(tags?.shop)score-=12;
  if(tags?.opening_hours)score-=8; if(tags?.fee==="yes")score-=6;
  if(tags?.website||tags?.["contact:website"])score-=5;
  if(tags?.abandoned==="yes"||tags?.disused==="yes")score+=3;
  if(tags?.ruins==="yes")score+=2;
  if(tags?.access==="private"||tags?.access==="no")score+=5;
  if(tags?.access==="yes"||tags?.access==="public")score-=6;
  const bias={bando:2,quarry:6,brownfield:2,bridge:-4,openspace:-6,clearing:4,water:0};
  score+=bias[spotType]??0;
  return Math.min(100,Math.max(3,Math.round(score)));
}
function getScoreColor(s){return s>=80?"#ef4444":s>=65?"#f59e0b":s>=45?"#22d3a7":"#60a5fa";}
function getScoreLabel(s){return s>=80?"Sehr abgelegen":s>=65?"Abgelegen":s>=45?"Mittellage":"Urban";}

// ── Phase 9: FPV Potential Score ───────────────────────────────────────────
const FPV_TYPE_APPEAL={bando:92,quarry:88,bridge:85,brownfield:74,water:76,clearing:70,openspace:58};
function computeFpvScore(feature){
  const{score,spotType,tags}=feature.properties;
  // 1. Remoteness (40%)
  const remote=score??50;
  const remoteComp=remote*0.40;
  // 2. Spot Type FPV Appeal (30%)
  const typeAppeal=FPV_TYPE_APPEAL[spotType]??65;
  const typeComp=typeAppeal*0.30;
  // 3. Visual/Structural Interest (20%)
  let visual=55;
  const lvl=parseInt(tags?.["building:levels"]??"0");
  if(lvl>=10)visual+=30;else if(lvl>=5)visual+=20;else if(lvl>=2)visual+=10;
  if(tags?.ruins==="yes")visual+=15;
  if(tags?.abandoned==="yes"||tags?.disused==="yes")visual+=8;
  if(tags?.name)visual+=5;if(tags?.height)visual+=8;
  if(tags?.tourism)visual-=15;
  visual=Math.min(100,Math.max(0,visual));
  const visualComp=visual*0.20;
  // 4. Access Score (10%)
  let access=65;
  if(tags?.access==="private"||tags?.access==="no")access=25;
  else if(tags?.access==="yes"||tags?.access==="public")access=80;
  const accessComp=access*0.10;
  const total=Math.min(100,Math.max(0,Math.round(remoteComp+typeComp+visualComp+accessComp)));
  return{total,remote,typeAppeal,visual:Math.round(visual),access:Math.round(access)};
}
function getFpvColor(s){return s>=75?"#a78bfa":s>=55?"#22d3a7":s>=40?"#f59e0b":"#64748b";}
function getFpvLabel(s){return s>=75?"Hervorragend":s>=55?"Gut":s>=40?"Mittel":"Gering";}

// ── Overpass ───────────────────────────────────────────────────────────────
function radiusToBbox(lat,lng,radiusKm) {
  const dLat=radiusKm/111.32,dLng=radiusKm/(111.32*Math.cos(lat*Math.PI/180));
  return {s:(lat-dLat).toFixed(6),w:(lng-dLng).toFixed(6),n:(lat+dLat).toFixed(6),e:(lng+dLng).toFixed(6)};
}
const QUERY_LINES={
  bando:      {group:"A",lines:['way["building"]["abandoned"="yes"]','way["building"]["disused"="yes"]']},
  quarry:     {group:"A",lines:['way["landuse"="quarry"]']},
  brownfield: {group:"A",lines:['way["landuse"="brownfield"]']},
  bridge:     {group:"A",lines:['way["bridge"="yes"]["highway"]','way["bridge"="yes"]["railway"]']},
  openspace:  {group:"B",lines:['way["leisure"="park"]["name"]','way["leisure"="nature_reserve"]["name"]','way["landuse"="meadow"]["name"]']},
  clearing:   {group:"B",lines:['way["natural"="heath"]','way["natural"="grassland"]["name"]']},
  water:      {group:"B",lines:['way["natural"="water"]["name"]','way["waterway"="river"]["name"]','way["waterway"="canal"]["name"]']},
};
const PLACE_NODE_LINE='node["place"~"^(city|town|suburb|quarter|neighbourhood|village|hamlet)$"]';

function buildQueries(lat,lng,radiusKm,queryTypes) {
  const {s,w,n,e}=radiusToBbox(lat,lng,radiusKm),bbox=`${s},${w},${n},${e}`,active=queryTypes??ALL_SPOT_TYPE_IDS;
  const aLines=active.filter(t=>QUERY_LINES[t]?.group==="A").flatMap(t=>QUERY_LINES[t].lines).map(l=>`  ${l};`).join("\n");
  const A=`[out:json][timeout:25][bbox:${bbox}];\n(\n${aLines?aLines+"\n":""}  ${PLACE_NODE_LINE};\n);\nout center tags;`;
  const bLines=active.filter(t=>QUERY_LINES[t]?.group==="B").flatMap(t=>QUERY_LINES[t].lines).map(l=>`  ${l};`).join("\n");
  const B=bLines?`[out:json][timeout:25][bbox:${bbox}];\n(\n${bLines}\n);\nout center tags;`:null;
  return {A,B,bbox};
}
function buildTurboUrl(lat,lng,radiusKm,queryTypes) {
  const {A}=buildQueries(lat,lng,radiusKm,queryTypes);
  return `https://overpass-turbo.eu/?Q=${encodeURIComponent(A)}&C=${lat};${lng};10&R`;
}

// Polyfill for AbortSignal.any (Safari <17, Firefox <124)
function combineSignals(signals){
  const filtered=signals.filter(Boolean);
  if(filtered.length===0)return new AbortController().signal;
  if(filtered.length===1)return filtered[0];
  if(typeof AbortSignal.any==="function")return AbortSignal.any(filtered);
  // Fallback: manual combination
  const ctrl=new AbortController();
  for(const sig of filtered){
    if(sig.aborted){ctrl.abort(sig.reason);return ctrl.signal;}
    sig.addEventListener("abort",()=>ctrl.abort(sig.reason),{once:true});
  }
  return ctrl.signal;
}

async function tryFetch(url,query,parentSignal) {
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),30000);
  const combined=combineSignals([ctrl.signal,parentSignal]);
  try {
    const res=await fetch(url,{method:"POST",body:`data=${encodeURIComponent(query)}`,headers:{"Content-Type":"application/x-www-form-urlencoded"},signal:combined});
    if(res.status===429)throw new Error("HTTP 429");
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json(),remark=data.remark??"";
    if(remark.includes("Dispatcher_Client")||remark.includes("timeout")||remark.includes("out of memory")){const e=new Error(`server_busy: ${remark.slice(0,60)}`);e.retryable=true;throw e;}
    return data;
  } catch(err) {
    if(err.name==="AbortError"){if(parentSignal?.aborted)throw err;const e=new Error("Timeout (30s)");e.retryable=true;throw e;}
    throw err;
  } finally{clearTimeout(timer);}
}
async function raceEndpoints(query,parentSignal) {
  for(let attempt=1;attempt<=3;attempt++) {
    if(parentSignal?.aborted)throw new DOMException("Aborted","AbortError");
    const ctrls=OVERPASS_ENDPOINTS.map(()=>new AbortController());
    const cancel=i=>ctrls.forEach((c,j)=>{if(j!==i)c.abort();});
    const attempts=OVERPASS_ENDPOINTS.map((ep,i)=>{
      const sig=combineSignals([ctrls[i].signal,parentSignal]);
      return tryFetch(ep,query,sig).then(data=>{cancel(i);return{data,ep};}).catch(err=>Promise.reject({err,ep}));
    });
    const results=await Promise.allSettled(attempts);
    const winner=results.find(r=>r.status==="fulfilled");
    if(winner)return winner.value.data;
    const errors=results.map(r=>`${r.reason?.ep}:${r.reason?.err?.message}`).join("|");
    if(!results.every(r=>r.reason?.err?.retryable)||attempt===3)throw new Error(`Alle Server fehlgeschlagen (${attempt}x): ${errors}`);
    await new Promise(r=>setTimeout(r,attempt*2000));
  }
}

async function fetchSpots(center,radiusMinKm,radiusMaxKm,queryTypes,signal) {
  const [lng,lat]=center,typeKey=[...queryTypes].sort().join(",");
  const cacheKey=`${lat.toFixed(4)},${lng.toFixed(4)},${radiusMinKm},${radiusMaxKm},${typeKey}`;
  if(spotCache.has(cacheKey))return spotCache.get(cacheKey);
  const {A:qA,B:qB}=buildQueries(lat,lng,radiusMaxKm,queryTypes);
  const turboUrl=buildTurboUrl(lat,lng,radiusMaxKm,queryTypes);
  const [resultA,resultB]=await Promise.all([raceEndpoints(qA,signal),qB?raceEndpoints(qB,signal):Promise.resolve({elements:[]})]);
  const all=[...(resultA.elements||[]),...(resultB.elements||[])];
  const placeNodes=all.filter(el=>el.type==="node"&&el.tags?.place);
  const spotEls=all.filter(el=>!(el.type==="node"&&el.tags?.place));
  const rawCount=spotEls.length;
  const features=[],typeCounters={};
  SPOT_TYPES.forEach(st=>(typeCounters[st.id]=0));
  for(const el of spotEls) {
    const spotType=classifySpot(el.tags);
    if(!spotType)continue;
    if((typeCounters[spotType]||0)>=150)continue;
    let coordinates;
    if(el.center?.lat!=null)coordinates=[el.center.lon,el.center.lat];
    else if(el.lat!=null)coordinates=[el.lon,el.lat];
    else continue;
    const distKm=haversineKm(lat,lng,coordinates[1],coordinates[0]);
    if(distKm>radiusMaxKm||distKm<radiusMinKm)continue;
    typeCounters[spotType]++;
    const score=computeRemoteness(el.tags,spotType,placeNodes,coordinates);
    const tmpFeat={properties:{score,spotType,tags:el.tags}};
    const fpvResult=computeFpvScore(tmpFeat);
    features.push({type:"Feature",geometry:{type:"Point",coordinates},properties:{id:el.id,osmType:el.type,spotType,score,fpvScore:fpvResult.total,fpvBreakdown:fpvResult,name:el.tags?.name||el.tags?.["name:de"]||null,tags:el.tags}});
  }
  const result={features,rawCount,remark:null,turboUrl};
  spotCache.set(cacheKey,result);
  return result;
}

// ── Phase 7: OpenAIP fetch (via Vite-Proxy /api/openaip → api.airspace.openaip.net) ──
async function fetchOpenAIPData(center,radiusKm,apiKey) {
  const [lng,lat]=center,{s,w,n,e}=radiusToBbox(lat,lng,radiusKm),bbox=`${w},${s},${e},${n}`;
  const fetchPage=async page=>{
    // Proxy-Pfad: /api/openaip/airspaces → https://api.core.openaip.net/api/airspaces
    // Key als Header UND Query-Parameter (Header können durch Proxys verloren gehen)
    const res=await fetch(`/api/openaip/airspaces?bbox=${bbox}&page=${page}&limit=100`,{headers:{"x-openaip-api-key":apiKey,"Accept":"application/json"}});
    if(res.status===401||res.status===403)throw new Error("Ungültiger API-Key — bitte OpenAIP-Key prüfen");
    if(res.status===429)throw new Error("Rate-Limit erreicht — bitte kurz warten");
    if(!res.ok)throw new Error(`OpenAIP Fehler: HTTP ${res.status}`);
    return res.json();
  };
  const first=await fetchPage(1),items=[...(first.items||[])];
  if((first.total||0)>100){try{const s2=await fetchPage(2);items.push(...(s2.items||[]));}catch{}}
  return items.filter(item=>item.geometry).map(item=>{
    const ti=getAirspaceTypeInfo(item.type);
    return {type:"Feature",geometry:item.geometry,properties:{id:item._id||String(item.id||Math.random()),name:item.name||"(kein Name)",zoneType:ti.shortCode,zoneTypeName:ti.name,zoneColor:ti.color,type:item.type,icaoClass:item.icaoClass,lowerLimit:item.lowerLimit||null,upperLimit:item.upperLimit||null,activity:item.activity,onRequest:item.onRequest||false,byNotam:item.byNotam||false,country:item.country||""}};
  });
}

// ── Phase 7: Naturschutz fetch via Overpass ────────────────────────────────
// Polygon-Centroid (Mittelwert der Ring-Koordinaten)
function polygonCentroid(coords) {
  const ring=coords[0],n=ring.length;
  let sLng=0,sLat=0;
  for(const[x,y]of ring){sLng+=x;sLat+=y;}
  return [sLng/n,sLat/n];
}
async function fetchNaturschutzData(center,radiusKm,signal) {
  const [lng,lat]=center;
  // Engere Bbox (90% des Radius) → weniger Treffer in den Ecken außerhalb des Kreises
  const nsgBboxKm=radiusKm*0.9,{s,w,n,e}=radiusToBbox(lat,lng,nsgBboxKm),bbox=`${s},${w},${n},${e}`;
  const query=`[out:json][timeout:30][bbox:${bbox}];\n(\n  way["boundary"="protected_area"]["name"];\n  way["leisure"="nature_reserve"]["name"];\n  way["boundary"="national_park"]["name"];\n  relation["boundary"="protected_area"]["name"];\n  relation["leisure"="nature_reserve"]["name"];\n  relation["boundary"="national_park"]["name"];\n);\nout geom tags;`;
  const data=await raceEndpoints(query,signal);
  const features=[];
  for(const el of(data.elements||[])){
    const props={id:String(el.id),name:el.tags?.name||"(kein Name)",zoneType:"NATURSCHUTZ",zoneColor:NATURSCHUTZ_COLOR,protectClass:el.tags?.protect_class||"",protect_title:el.tags?.protect_title||"",boundary:el.tags?.boundary||el.tags?.leisure||"",access:el.tags?.access||"",website:el.tags?.website||""};
    if(el.type==="way"&&el.geometry?.length>=3){
      const coords=el.geometry.map(p=>[p.lon,p.lat]);
      const f=coords[0],l=coords[coords.length-1];
      if(f[0]!==l[0]||f[1]!==l[1])coords.push([f[0],f[1]]);
      features.push({type:"Feature",geometry:{type:"Polygon",coordinates:[coords]},properties:props});
    } else if(el.type==="relation"&&el.members){
      // Extract outer rings from relation members
      const outerRings=[];
      for(const m of el.members){
        if(m.role==="outer"&&m.geometry?.length>=3){
          const coords=m.geometry.map(p=>[p.lon,p.lat]);
          const f=coords[0],l=coords[coords.length-1];
          if(f[0]!==l[0]||f[1]!==l[1])coords.push([f[0],f[1]]);
          outerRings.push(coords);
        }
      }
      if(outerRings.length===1){
        features.push({type:"Feature",geometry:{type:"Polygon",coordinates:[outerRings[0]]},properties:props});
      } else if(outerRings.length>1){
        features.push({type:"Feature",geometry:{type:"MultiPolygon",coordinates:outerRings.map(r=>[r])},properties:props});
      }
    }
  }
  return features
    // Haversine-Filter: nur Gebiete deren Centroid im Suchkreis liegt
    .filter(f=>{
      const g=f.geometry;
      let cLng,cLat;
      if(g.type==="Polygon"){[cLng,cLat]=polygonCentroid(g.coordinates);}
      else if(g.type==="MultiPolygon"){[cLng,cLat]=polygonCentroid(g.coordinates[0]);}
      else return false;
      return haversineKm(lat,lng,cLat,cLng)<=radiusKm*0.9;
    });
}

// ── Phase 10: Open-Meteo Weather ─────────────────────────────────────────
async function fetchWeather(lat,lng){
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,weather_code&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,weather_code&forecast_days=1&timezone=auto&wind_speed_unit=kmh`;
  const res=await fetch(url);
  if(!res.ok)throw new Error(`Open-Meteo: HTTP ${res.status}`);
  return res.json();
}
const WMO_CODES={
  0:{label:"Klar",icon:"☀️",severity:0},1:{label:"Überwiegend klar",icon:"🌤️",severity:0},
  2:{label:"Teilbewölkt",icon:"⛅",severity:0},3:{label:"Bedeckt",icon:"☁️",severity:1},
  45:{label:"Neblig",icon:"🌫️",severity:2},48:{label:"Eisnebel",icon:"🌫️",severity:2},
  51:{label:"Leichter Niesel",icon:"🌦️",severity:1},53:{label:"Niesel",icon:"🌦️",severity:2},55:{label:"Starker Niesel",icon:"🌧️",severity:2},
  61:{label:"Leichter Regen",icon:"🌧️",severity:2},63:{label:"Regen",icon:"🌧️",severity:2},65:{label:"Starker Regen",icon:"🌧️",severity:3},
  71:{label:"Leichter Schnee",icon:"❄️",severity:2},73:{label:"Schneefall",icon:"❄️",severity:2},75:{label:"Starker Schnee",icon:"❄️",severity:3},
  77:{label:"Schneekörner",icon:"🌨️",severity:2},80:{label:"Regenschauer",icon:"🌦️",severity:2},81:{label:"Starke Schauer",icon:"🌧️",severity:2},
  82:{label:"Heftige Schauer",icon:"⛈️",severity:3},85:{label:"Schneeböen",icon:"🌨️",severity:2},86:{label:"Starke Schneeböen",icon:"🌨️",severity:3},
  95:{label:"Gewitter",icon:"⛈️",severity:3},96:{label:"Gewitter + Hagel",icon:"⛈️",severity:3},99:{label:"Gewitter + Hagel",icon:"⛈️",severity:3},
};
function getWmo(code){return WMO_CODES[code]||{label:`Code ${code}`,icon:"🌡️",severity:0};}
function windDirLabel(deg){const d=["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];return d[Math.round(deg/22.5)%16];}
function computeWeatherAmpel(c){
  const wind=c.wind_speed_10m??0,rain=c.precipitation??0,cloud=c.cloud_cover??0,wmo=getWmo(c.weather_code??0);
  if(wind>35||rain>2||wmo.severity>=3)return"red";
  if(wind>20||rain>0.2||cloud>80||wmo.severity>=2)return"yellow";
  return"green";
}

// ── Phase 11: SunCalc (inline, kein npm) ──────────────────────────────────
const _SC_RAD=Math.PI/180,_SC_J1970=2440588,_SC_J2000=2451545,_SC_E=23.4397*_SC_RAD;
function _scToJ(d){return d.valueOf()/86400000-.5+_SC_J1970;}
function _scFromJ(j){return new Date((j+.5-_SC_J1970)*86400000);}
function _scToDays(d){return _scToJ(d)-_SC_J2000;}
function _scSMA(d){return _SC_RAD*(357.5291+0.98560028*d);}
function _scELng(M){const C=_SC_RAD*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M));return M+C+_SC_RAD*102.9372+Math.PI;}
function _scDec(L){return Math.asin(Math.sin(L)*Math.sin(_SC_E));}
function _scRA(L){return Math.atan2(Math.sin(L)*Math.cos(_SC_E),Math.cos(L));}
function _scST(d,lw){return _SC_RAD*(280.16+360.9856235*d)-lw;}
function _scCoords(d){const M=_scSMA(d),L=_scELng(M);return{dec:_scDec(L),ra:_scRA(L),M,L};}
function getSunPosition(date,lat,lng){
  const lw=_SC_RAD*-lng,phi=_SC_RAD*lat,d=_scToDays(date),c=_scCoords(d),H=_scST(d,lw)-c.ra;
  return{azimuth:Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(c.dec)*Math.cos(phi)),altitude:Math.asin(Math.sin(phi)*Math.sin(c.dec)+Math.cos(phi)*Math.cos(c.dec)*Math.cos(H))};
}
const _SC_J0=0.0009;
function _scJC(d,lw){return Math.round(d-_SC_J0-lw/(2*Math.PI));}
function _scAT(Ht,lw,n){return _SC_J0+(Ht+lw)/(2*Math.PI)+n;}
function _scSTJ(ds,M,L){return _SC_J2000+ds+0.0053*Math.sin(M)-0.0069*Math.sin(2*L);}
function _scHA(h,phi,dec){const x=(Math.sin(h)-Math.sin(phi)*Math.sin(dec))/(Math.cos(phi)*Math.cos(dec));return Math.abs(x)>1?NaN:Math.acos(x);}
function _scSetJ(h,lw,phi,dec,n,M,L){const w=_scHA(h,phi,dec);if(isNaN(w))return NaN;return _scSTJ(_scAT(w,lw,n),M,L);}
function getSunTimes(date,lat,lng){
  const lw=_SC_RAD*-lng,phi=_SC_RAD*lat,d=_scToDays(date),n=_scJC(d,lw),ds=_scAT(0,lw,n);
  const{M,L,dec}=_scCoords(ds),Jnoon=_scSTJ(ds,M,L);
  const Jset=_scSetJ(-0.8333*_SC_RAD,lw,phi,dec,n,M,L),Jrise=Jnoon-(Jset-Jnoon);
  const Jdusk=_scSetJ(-6*_SC_RAD,lw,phi,dec,n,M,L),Jdawn=Jnoon-(Jdusk-Jnoon);
  const JghPM=_scSetJ(6*_SC_RAD,lw,phi,dec,n,M,L),JghAM=Jnoon-(JghPM-Jnoon);
  return{dawn:_scFromJ(Jdawn),sunrise:_scFromJ(Jrise),goldenMorningEnd:_scFromJ(JghAM),solarNoon:_scFromJ(Jnoon),goldenEveningStart:_scFromJ(JghPM),sunset:_scFromJ(Jset),dusk:_scFromJ(Jdusk)};
}
function formatTime(d){if(!d||isNaN(d.getTime()))return"—";return d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});}
function getSunStatus(t,now){
  if(!t)return{label:"Unbekannt",color:"#64748b",emoji:"❓"};
  const n=now.getTime();
  if(n<t.dawn.getTime())     return{label:"Nacht",             color:"#312e81",emoji:"🌙"};
  if(n<t.sunrise.getTime())  return{label:"Morgendämmerung",   color:"#7c3aed",emoji:"🌄"};
  if(n<t.goldenMorningEnd.getTime()) return{label:"Goldene Stunde",color:"#f59e0b",emoji:"🌅"};
  if(n<t.goldenEveningStart.getTime()) return{label:"Tag",      color:"#fbbf24",emoji:"☀️"};
  if(n<t.sunset.getTime())   return{label:"Goldene Stunde",    color:"#f59e0b",emoji:"🌅"};
  if(n<t.dusk.getTime())     return{label:"Abenddämmerung",    color:"#7c3aed",emoji:"🌆"};
  return{label:"Nacht",color:"#312e81",emoji:"🌙"};
}
// Azimut SunCalc: 0=Süd, π/2=West → in Kompassgrad von Nord: (az*180/π + 180) % 360
function sunAzBearing(azRad){return((azRad*180/Math.PI+180)%360);}

// ── URL helpers ────────────────────────────────────────────────────────────
const clampRadius=(v,fb)=>{const n=parseInt(v,10);return!isNaN(n)?Math.min(50,Math.max(1,n)):fb;};
function readUrlParams(){const p=new URLSearchParams(window.location.search),lat=parseFloat(p.get("lat")),lng=parseFloat(p.get("lng")),zoom=parseFloat(p.get("zoom"));return{center:(!isNaN(lat)&&!isNaN(lng))?[lng,lat]:null,zoom:!isNaN(zoom)?zoom:null,radiusMin:clampRadius(p.get("rMin"),1),radiusMax:clampRadius(p.get("rMax"),15),query:p.get("q")||""};}
function writeUrlParams({center,zoom,radiusMin,radiusMax,query}){const p=new URLSearchParams();if(center){p.set("lat",center[1].toFixed(5));p.set("lng",center[0].toFixed(5));}if(zoom)p.set("zoom",zoom.toFixed(2));if(radiusMin!=null)p.set("rMin",radiusMin);if(radiusMax!=null)p.set("rMax",radiusMax);if(query)p.set("q",query);window.history.replaceState(null,"",`${window.location.pathname}?${p.toString()}`);}

// ── GeoJSON helpers ────────────────────────────────────────────────────────
function circleCoords(center,radiusKm,steps=64){const[lng,lat]=center,coords=[],ad=radiusKm/6371,latR=lat*Math.PI/180,lngR=lng*Math.PI/180;for(let i=0;i<=steps;i++){const b=(2*Math.PI*i)/steps,pLat=Math.asin(Math.sin(latR)*Math.cos(ad)+Math.cos(latR)*Math.sin(ad)*Math.cos(b)),pLng=lngR+Math.atan2(Math.sin(b)*Math.sin(ad)*Math.cos(latR),Math.cos(ad)-Math.sin(latR)*Math.sin(pLat));coords.push([(pLng*180)/Math.PI,(pLat*180)/Math.PI]);}return coords;}
function makeDonutGeoJSON(c,min,max){return{type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[circleCoords(c,max),circleCoords(c,min).reverse()]},properties:{}}]};}
function makeCircleGeoJSON(c,r){return{type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Polygon",coordinates:[circleCoords(c,r)]},properties:{}}]};}
function zoomForRadius(km){return km<=2?13:km<=5?12:km<=10?11:km<=20?10:km<=35?9:8;}

// ── Icons ──────────────────────────────────────────────────────────────────
const IconMenu    =()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
const IconX       =()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconSearch  =()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IconLayers  =()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>;
const IconFilter  =()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
const IconDrone   =()=><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/><line x1="15.5" y1="8.5" x2="8.5" y2="15.5"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.4"/></svg>;
const IconCompass =()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" opacity="0.3"/></svg>;
const IconTarget  =()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
const IconInfo    =()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const IconOpacity =()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20"/></svg>;
const IconPin     =()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IconShare   =()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
const IconClose2  =()=><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconSpinner =()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="spinner-icon"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>;
const IconRefresh =()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
const IconExternal=()=><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
const IconMapPin  =()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IconHeatmap =()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" strokeOpacity="0.5"/><circle cx="12" cy="12" r="11" strokeOpacity="0.2"/></svg>;
const IconShield  =()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IconKey     =()=><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>;
const IconEye     =()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const IconEyeOff  =()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const IconCheck   =()=><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IconWarning =()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IconCloud   =()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>;
const IconSun     =()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const IconWind    =()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>;

// ── Toast ──────────────────────────────────────────────────────────────────
function Toast({message,type,onClose}){useEffect(()=>{const t=setTimeout(onClose,3500);return()=>clearTimeout(t);},[onClose]);return(<div className={`toast toast-${type}`}><span>{message}</span><button onClick={onClose} className="toast-close"><IconX/></button></div>);}

// ── Map View ───────────────────────────────────────────────────────────────
function MapView({mapRef,mapContainerRef,activeBase,activeOverlays,overlayOpacity,onMapReady,searchCircle,spots,activeSpotTypes,onSpotClick,showHeatmap,airspaceFeatures,naturschutzFeatures,showAirspace,showNaturschutz,onZoneClick}){
  const[loaded,setLoaded]=useState(false),initDone=useRef(false);
  useEffect(()=>{
    if(mapRef.current||initDone.current)return;
    initDone.current=true;
    const urlP=readUrlParams(),initCenter=urlP.center||DACH_CENTER,initZoom=urlP.zoom||DACH_ZOOM;
    const sources={},layers=[];
    BASE_LAYERS.forEach(bl=>{
      sources[`base-${bl.id}`]={type:"raster",tiles:bl.tiles,tileSize:256,attribution:bl.attribution,maxzoom:bl.maxZoom};
      layers.push({id:`base-${bl.id}`,type:"raster",source:`base-${bl.id}`,layout:{visibility:bl.id===activeBase?"visible":"none"},paint:{"raster-opacity":1}});
    });
    OVERLAY_LAYERS.forEach(ol=>{
      if(!ol.tiles)return;
      sources[`overlay-${ol.id}`]={type:"raster",tiles:ol.tiles,tileSize:256,attribution:ol.attribution||"",maxzoom:ol.maxZoom||18};
      layers.push({id:`overlay-${ol.id}`,type:"raster",source:`overlay-${ol.id}`,layout:{visibility:"none"},paint:{"raster-opacity":ol.opacity??0.7}});
    });
    layers.push({id:"overlay-fpvscore",type:"heatmap",source:"spots",layout:{visibility:"none"},paint:{
      "heatmap-weight":["interpolate",["linear"],["get","fpvScore"],0,0,100,1],
      "heatmap-intensity":["interpolate",["linear"],["zoom"],0,1,8,2.5,12,3.5],
      "heatmap-color":["interpolate",["linear"],["heatmap-density"],
        0,"rgba(0,0,0,0)",
        0.15,"rgba(124,58,237,0.25)",
        0.35,"rgba(167,139,250,0.55)",
        0.55,"rgba(34,211,167,0.72)",
        0.75,"rgba(52,211,153,0.88)",
        1,"rgba(16,185,129,1)"
      ],
      "heatmap-radius":["interpolate",["linear"],["zoom"],4,22,7,48,10,75],
      "heatmap-opacity":["interpolate",["linear"],["zoom"],7,0.88,12,0.12]
    }});

    // Phase 7: Naturschutzgebiete
    sources["naturschutz-data"]={type:"geojson",data:{type:"FeatureCollection",features:[]}};
    layers.push({id:"naturschutz-fill",type:"fill",source:"naturschutz-data",layout:{visibility:"none"},paint:{"fill-color":NATURSCHUTZ_COLOR,"fill-opacity":0.14}});
    layers.push({id:"naturschutz-outline",type:"line",source:"naturschutz-data",layout:{visibility:"none"},paint:{"line-color":NATURSCHUTZ_COLOR,"line-width":1.8,"line-opacity":0.85}});

    // Phase 7: Luftraumzonen (OpenAIP)
    sources["airspace-data"]={type:"geojson",data:{type:"FeatureCollection",features:[]}};
    const colorExpr=zoneColorExpr();
    layers.push({id:"airspace-fill",type:"fill",source:"airspace-data",layout:{visibility:"none"},paint:{"fill-color":colorExpr,"fill-opacity":0.13}});
    layers.push({id:"airspace-outline",type:"line",source:"airspace-data",layout:{visibility:"none"},paint:{"line-color":colorExpr,"line-width":2.2,"line-opacity":0.95}});

    // Search radius
    ["search-radius-fill","search-radius-outer","search-radius-inner","search-pin"].forEach(id=>{sources[id]={type:"geojson",data:{type:"FeatureCollection",features:[]}};});
    layers.push({id:"search-radius-fill-layer",type:"fill",source:"search-radius-fill",paint:{"fill-color":"#22d3a7","fill-opacity":0.08}});
    layers.push({id:"search-radius-outer-layer",type:"line",source:"search-radius-outer",paint:{"line-color":"#22d3a7","line-width":2,"line-dasharray":[4,3],"line-opacity":0.9}});
    layers.push({id:"search-radius-inner-layer",type:"line",source:"search-radius-inner",paint:{"line-color":"#22d3a7","line-width":1.5,"line-dasharray":[3,4],"line-opacity":0.5}});

    // Spots
    sources["spots"]={type:"geojson",data:{type:"FeatureCollection",features:[]}};
    layers.push({id:"spots-heatmap",type:"heatmap",source:"spots",layout:{visibility:"none"},paint:{"heatmap-weight":["interpolate",["linear"],["get","score"],0,0,100,1],"heatmap-intensity":["interpolate",["linear"],["zoom"],0,1,8,2.5,12,3],"heatmap-color":["interpolate",["linear"],["heatmap-density"],0,"rgba(0,0,0,0)",0.1,"rgba(34,211,167,0.15)",0.3,"rgba(96,165,250,0.50)",0.55,"rgba(139,92,246,0.68)",0.75,"rgba(239,138,98,0.80)",1,"rgba(239,68,68,0.92)"],"heatmap-radius":["interpolate",["linear"],["zoom"],4,18,7,40,10,65],"heatmap-opacity":["interpolate",["linear"],["zoom"],7,0.85,12,0.10]}});
    layers.push({id:"search-pin-layer",type:"circle",source:"search-pin",paint:{"circle-radius":7,"circle-color":"#22d3a7","circle-stroke-width":2.5,"circle-stroke-color":"#0a0e17","circle-opacity":0.95}});
    layers.push({id:"spots-glow",type:"circle",source:"spots",paint:{"circle-radius":["interpolate",["linear"],["zoom"],5,10,8,16,12,22,16,30],"circle-color":["match",["get","spotType"],"bando","#ef4444","quarry","#f59e0b","brownfield","#8b5cf6","bridge","#3b82f6","openspace","#22d3a7","clearing","#10b981","water","#06b6d4","#888"],"circle-opacity":0.25,"circle-blur":1}});
    SPOT_TYPES.forEach(st=>{
      layers.push({id:`spots-${st.id}`,type:"circle",source:"spots",filter:["==",["get","spotType"],st.id],layout:{visibility:"visible"},paint:{"circle-radius":["interpolate",["linear"],["zoom"],5,6,8,9,12,11,16,15],"circle-color":st.color,"circle-stroke-width":["interpolate",["linear"],["zoom"],5,2,10,2.5],"circle-stroke-color":"#ffffff","circle-opacity":1}});
    });

    const map=new maplibregl.Map({container:mapContainerRef.current,style:{version:8,sources,layers},center:initCenter,zoom:initZoom,maxZoom:18});
    map.addControl(new maplibregl.NavigationControl(),"bottom-right");
    map.addControl(new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:false}),"bottom-right");
    map.addControl(new maplibregl.ScaleControl({maxWidth:150}),"bottom-left");
    map.on("load",()=>{
      setLoaded(true);onMapReady?.(map);
      SPOT_TYPES.forEach(st=>{
        map.on("click",`spots-${st.id}`,e=>{if(e.features?.length>0)onSpotClick?.(e.features[0]);});
        map.on("mouseenter",`spots-${st.id}`,()=>{map.getCanvas().style.cursor="pointer";});
        map.on("mouseleave",`spots-${st.id}`,()=>{map.getCanvas().style.cursor="";});
      });
      // Phase 7: Zone click handlers
      ["airspace-fill","naturschutz-fill"].forEach(id=>{
        map.on("click",id,e=>{if(e.features?.length>0)onZoneClick?.(e.features[0]);});
        map.on("mouseenter",id,()=>{map.getCanvas().style.cursor="crosshair";});
        map.on("mouseleave",id,()=>{map.getCanvas().style.cursor="";});
      });
    });
    mapRef.current=map;
    return()=>{if(mapRef.current){mapRef.current.remove();mapRef.current=null;}};
  },[]);

  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;BASE_LAYERS.forEach(bl=>{if(map.getLayer(`base-${bl.id}`))map.setLayoutProperty(`base-${bl.id}`,"visibility",bl.id===activeBase?"visible":"none");});},[activeBase,loaded]);
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;OVERLAY_LAYERS.forEach(ol=>{const id=`overlay-${ol.id}`;if(map.getLayer(id))map.setLayoutProperty(id,"visibility",activeOverlays.includes(ol.id)?"visible":"none");});},[activeOverlays,loaded]);
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;OVERLAY_LAYERS.forEach(ol=>{if(!ol.tiles)return;const id=`overlay-${ol.id}`;if(map.getLayer(id))map.setPaintProperty(id,"raster-opacity",overlayOpacity[ol.id]??ol.opacity??0.7);});},[overlayOpacity,loaded]);
  useEffect(()=>{
    const map=mapRef.current;if(!map||!loaded)return;
    const empty={type:"FeatureCollection",features:[]};
    if(!searchCircle){["search-radius-fill","search-radius-outer","search-radius-inner","search-pin"].forEach(id=>map.getSource(id)?.setData(empty));return;}
    const{center,radiusMinKm,radiusMaxKm}=searchCircle;
    map.getSource("search-radius-fill")?.setData(makeDonutGeoJSON(center,radiusMinKm,radiusMaxKm));
    map.getSource("search-radius-outer")?.setData(makeCircleGeoJSON(center,radiusMaxKm));
    map.getSource("search-radius-inner")?.setData(radiusMinKm>0.5?makeCircleGeoJSON(center,radiusMinKm):empty);
    map.getSource("search-pin")?.setData({type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Point",coordinates:center},properties:{}}]});
    map.flyTo({center,zoom:zoomForRadius(radiusMaxKm),speed:1.4,curve:1.4,essential:true});
  },[searchCircle,loaded]);
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;map.getSource("spots")?.setData({type:"FeatureCollection",features:spots||[]});},[spots,loaded]);
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;SPOT_TYPES.forEach(st=>{const id=`spots-${st.id}`;if(map.getLayer(id))map.setLayoutProperty(id,"visibility",activeSpotTypes.includes(st.id)?"visible":"none");});},[activeSpotTypes,loaded]);
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;if(map.getLayer("spots-heatmap"))map.setLayoutProperty("spots-heatmap","visibility",showHeatmap?"visible":"none");},[showHeatmap,loaded]);
  // Phase 7 effects
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;map.getSource("airspace-data")?.setData({type:"FeatureCollection",features:airspaceFeatures||[]});},[airspaceFeatures,loaded]);
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;["airspace-fill","airspace-outline"].forEach(id=>{if(map.getLayer(id))map.setLayoutProperty(id,"visibility",showAirspace?"visible":"none");});},[showAirspace,loaded]);
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;map.getSource("naturschutz-data")?.setData({type:"FeatureCollection",features:naturschutzFeatures||[]});},[naturschutzFeatures,loaded]);
  useEffect(()=>{const map=mapRef.current;if(!map||!loaded)return;["naturschutz-fill","naturschutz-outline"].forEach(id=>{if(map.getLayer(id))map.setLayoutProperty(id,"visibility",showNaturschutz?"visible":"none");});},[showNaturschutz,loaded]);

  return(<div ref={mapContainerRef} style={{width:"100%",height:"100%",position:"absolute",inset:0}}>{!loaded&&(<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg-primary)",zIndex:10,gap:12}}><div className="pulse-drone"><IconDrone/></div><span style={{color:"var(--text-muted)",fontSize:14,fontFamily:"var(--font-body)"}}>Karte wird geladen…</span></div>)}</div>);
}

// ── Dual Range Slider ──────────────────────────────────────────────────────
function DualRangeSlider({min,max,valueMin,valueMax,onChange}){
  const trackRef=useRef(null),dragging=useRef(null);
  const pct=v=>((v-min)/(max-min))*100;
  const vFromPct=x=>{const r=trackRef.current.getBoundingClientRect();return Math.round(min+Math.max(0,Math.min(1,(x-r.left)/r.width))*(max-min));};
  const onPD=(which,e)=>{e.preventDefault();dragging.current=which;trackRef.current.setPointerCapture(e.pointerId);};
  const onPM=e=>{if(!dragging.current)return;const v=vFromPct(e.clientX);dragging.current==="min"?onChange(Math.min(v,valueMax-1),valueMax):onChange(valueMin,Math.max(v,valueMin+1));};
  const onPU=()=>{dragging.current=null;};
  const onTC=e=>{if(e.target.classList.contains("drs-thumb"))return;const v=vFromPct(e.clientX);Math.abs(v-valueMin)<=Math.abs(v-valueMax)?onChange(Math.min(v,valueMax-1),valueMax):onChange(valueMin,Math.max(v,valueMin+1));};
  const pMin=pct(valueMin),pMax=pct(valueMax);
  return(<div className="drs-track" ref={trackRef} onPointerMove={onPM} onPointerUp={onPU} onPointerLeave={onPU} onClick={onTC}><div className="drs-rail"/><div className="drs-fill" style={{left:`${pMin}%`,width:`${pMax-pMin}%`}}/><div className="drs-thumb drs-thumb-min" style={{left:`${pMin}%`}} onPointerDown={e=>onPD("min",e)} role="slider" aria-valuenow={valueMin} aria-valuemin={min} aria-valuemax={valueMax-1} aria-label="Minimaler Radius"/><div className="drs-thumb drs-thumb-max" style={{left:`${pMax}%`}} onPointerDown={e=>onPD("max",e)} role="slider" aria-valuenow={valueMax} aria-valuemin={valueMin+1} aria-valuemax={max} aria-label="Maximaler Radius"/></div>);
}

// ── Search Panel ───────────────────────────────────────────────────────────
function SearchPanel({onSearch,onClear,hasResult,currentQuery,onToast}){
  const[query,setQuery]=useState(currentQuery||""),[suggestions,setSugs]=useState([]),[loading,setLoading]=useState(false),[open,setOpen]=useState(false);
  const[radiusMin,setRadiusMin]=useState(()=>readUrlParams().radiusMin),[radiusMax,setRadiusMax]=useState(()=>readUrlParams().radiusMax),[activeIdx,setActiveIdx]=useState(-1);
  const debRef=useRef(null),inputRef=useRef(null),radRef=useRef({min:radiusMin,max:radiusMax});
  useEffect(()=>{radRef.current={min:radiusMin,max:radiusMax};},[radiusMin,radiusMax]);
  const fetchSugs=useCallback(async q=>{if(q.trim().length<2){setSugs([]);setOpen(false);return;}setLoading(true);try{const res=await fetch(`${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=de,at,ch&addressdetails=1&accept-language=de`,{headers:{"Accept-Language":"de"}});const data=await res.json();setSugs(data);setOpen(data.length>0);setActiveIdx(-1);}catch{onToast("Geocoding-Fehler","warn");}finally{setLoading(false);}},[]);
  const handleChange=e=>{const v=e.target.value;setQuery(v);clearTimeout(debRef.current);if(v.length<2){setSugs([]);setOpen(false);return;}debRef.current=setTimeout(()=>fetchSugs(v),350);};
  const handleSelect=sug=>{const label=sug.display_name.split(",").slice(0,3).join(", ");setQuery(label);setSugs([]);setOpen(false);const center=[parseFloat(sug.lon),parseFloat(sug.lat)];const{min,max}=radRef.current;onSearch({center,radiusMinKm:min,radiusMaxKm:max,label});writeUrlParams({center,zoom:zoomForRadius(max),radiusMin:min,radiusMax:max,query:label});};
  const handleKD=e=>{if(!open||!suggestions.length)return;if(e.key==="ArrowDown"){e.preventDefault();setActiveIdx(i=>Math.min(i+1,suggestions.length-1));}if(e.key==="ArrowUp"){e.preventDefault();setActiveIdx(i=>Math.max(i-1,-1));}if(e.key==="Enter"&&activeIdx>=0)handleSelect(suggestions[activeIdx]);if(e.key==="Escape")setOpen(false);};
  const handleClear=()=>{setQuery("");setSugs([]);setOpen(false);onClear();writeUrlParams({});inputRef.current?.focus();};
  const handleRangeChange=(newMin,newMax)=>{setRadiusMin(newMin);setRadiusMax(newMax);if(hasResult)onSearch(prev=>prev?{...prev,radiusMinKm:newMin,radiusMaxKm:newMax}:prev);};
  const handleShare=()=>{navigator.clipboard?.writeText(window.location.href);onToast("Link in Zwischenablage kopiert!","info");};
  const sugLabel=sug=>{const p=sug.display_name.split(",");return{main:p.slice(0,2).join(",").trim(),rest:p.slice(2,4).join(",").trim()};};
  const typeIcon=t=>({"city":"🏙️","town":"🏘️","village":"🏡","hamlet":"🏡","administrative":"🗺️","suburb":"🏙️","county":"🗺️","industrial":"🏭","park":"🌲","natural":"🌿","water":"💧","aerodrome":"✈️"}[t]||"📍");
  return(
    <div className="search-panel">
      <div className={`search-box ${open?"focused":""}`}>
        <span className="search-icon">{loading?<IconSpinner/>:<IconSearch/>}</span>
        <input ref={inputRef} className="search-input" placeholder="Adresse, Ort oder Region…" value={query} onChange={handleChange} onKeyDown={handleKD} onFocus={()=>suggestions.length>0&&setOpen(true)} autoComplete="off" spellCheck={false} role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-controls="search-suggestions" aria-activedescendant={activeIdx>=0?`sug-${activeIdx}`:undefined}/>
        {query&&<button className="search-clear" onClick={handleClear} aria-label="Suche löschen"><IconClose2/></button>}
      </div>
      {open&&suggestions.length>0&&(
        <div className="suggestions-list" id="search-suggestions" role="listbox" aria-label="Ortsvorschläge">
          {suggestions.map((sug,i)=>{const{main,rest}=sugLabel(sug);return(<button key={sug.place_id} id={`sug-${i}`} role="option" aria-selected={i===activeIdx} className={`suggestion-item ${i===activeIdx?"active":""}`} onClick={()=>handleSelect(sug)} onMouseEnter={()=>setActiveIdx(i)}><span className="sug-icon">{typeIcon(sug.type||sug.class)}</span><span className="sug-text"><span className="sug-main">{main}</span>{rest&&<span className="sug-rest">{rest}</span>}</span><span className="sug-type">{sug.type||sug.class}</span></button>);})}
          <div className="suggestions-footer"><span>© OpenStreetMap Nominatim · DACH</span></div>
        </div>
      )}
      <div className="radius-control">
        <div className="radius-label"><span>Suchring</span><span className="radius-value">{radiusMin>1?<><span className="rv-dim">{radiusMin} km</span><span className="rv-sep"> – </span></>:null}{radiusMax} km</span></div>
        <DualRangeSlider min={1} max={50} valueMin={radiusMin} valueMax={radiusMax} onChange={handleRangeChange}/>
        <div className="radius-range-labels"><span>1 km</span><span>50 km</span></div>
        <div className="radius-presets">
          {[{label:"1–5",min:1,max:5},{label:"5–15",min:5,max:15},{label:"10–25",min:10,max:25},{label:"0–50",min:1,max:50}].map(p=>(<button key={p.label} className={`radius-tick ${radiusMin===p.min&&radiusMax===p.max?"active":""}`} onClick={()=>handleRangeChange(p.min,p.max)}>{p.label}</button>))}
        </div>
      </div>
      {hasResult&&(<div className="search-result-bar"><span className="result-icon"><IconPin/></span><span className="result-label">{query}</span><span className="result-radius-badge">{radiusMin}–{radiusMax} km</span><button className="result-share" onClick={handleShare}><IconShare/></button><button className="result-clear" onClick={handleClear}><IconClose2/></button></div>)}
    </div>
  );
}

// ── Layer Panel ────────────────────────────────────────────────────────────
function LayerThumb({color}){return(<div style={{width:32,height:22,borderRadius:4,flexShrink:0,background:`linear-gradient(135deg,${color}33,${color}66)`,border:`1px solid ${color}55`,position:"relative",overflow:"hidden"}}><div style={{position:"absolute",inset:0,backgroundImage:`repeating-linear-gradient(45deg,${color}18 0px,${color}18 2px,transparent 2px,transparent 8px)`}}/></div>);}
function OpacityRow({layerId,value,onChange}){return(<div className="opacity-row"><span className="opacity-label"><IconOpacity/> Deckkraft</span><input type="range" min="0" max="1" step="0.05" value={value} onChange={e=>onChange(layerId,parseFloat(e.target.value))} className="opacity-slider"/><span className="opacity-value">{Math.round(value*100)}%</span></div>);}
function SidebarSection({icon,title,children,defaultOpen=false,badge}){
  const storageKey=`fpv-section-${title}`;
  const[open,setOpen]=useState(()=>{try{const v=localStorage.getItem(storageKey);return v!==null?v==="true":defaultOpen;}catch{return defaultOpen;}});
  const toggle=()=>setOpen(prev=>{const next=!prev;try{localStorage.setItem(storageKey,String(next));}catch{}return next;});
  return(<div className="sidebar-section"><button className="section-header" onClick={toggle}><span className="section-icon">{icon}</span><span className="section-title">{title}</span>{badge&&<span className="section-badge">{badge}</span>}<span className={`section-chevron ${open?"open":""}`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg></span></button>{open&&<div className="section-content">{children}</div>}</div>);
}
function LayerPanel({activeBase,setActiveBase,activeOverlays,setActiveOverlays,overlayOpacity,setOverlayOpacity,onToast}){
  const toggle=(id)=>{setActiveOverlays(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);};
  const handleOp=(id,val)=>setOverlayOpacity(prev=>({...prev,[id]:val}));
  return(
    <div className="layer-panel">
      <div className="layer-group">
        <div className="layer-group-label"><span>Basiskarte</span><span className="layer-group-count">{BASE_LAYERS.length} verfügbar</span></div>
        <div className="base-layer-list">
          {BASE_LAYERS.map(bl=>{const active=activeBase===bl.id;return(<button key={bl.id} className={`base-layer-card ${active?"active":""}`} onClick={()=>setActiveBase(bl.id)} style={{"--layer-color":bl.color}}><LayerThumb color={bl.color}/><div className="base-layer-info"><span className="base-layer-name">{bl.name}</span><span className="base-layer-desc">{bl.description}</span></div><div className={`base-layer-radio ${active?"active":""}`}>{active&&<div className="radio-dot"/>}</div></button>);})}
        </div>
      </div>
      <div className="layer-group" style={{marginTop:14}}>
        <div className="layer-group-label"><span>Overlays</span><span className="layer-group-count">{activeOverlays.length} aktiv</span></div>
        <div className="overlay-list">
          {OVERLAY_LAYERS.map(ol=>{const active=activeOverlays.includes(ol.id);return(<div key={ol.id} className={`overlay-item ${active?"active":""}`}><div className="overlay-header-row"><LayerThumb color={ol.color}/><div className="overlay-info"><span className="overlay-name">{ol.name}</span><span className="overlay-desc">{ol.description}</span></div><div className="overlay-right"><span className="overlay-badge" style={{"--badge-color":ol.color}}>{ol.badge}</span><button className={`overlay-toggle ${active?"active":""}`} onClick={()=>toggle(ol.id)} style={{"--toggle-color":ol.color}}/></div></div>{active&&ol.tiles&&<OpacityRow layerId={ol.id} value={overlayOpacity[ol.id]??ol.opacity??0.7} onChange={handleOp}/>}</div>);})}
        </div>
      </div>
      {activeOverlays.length>0&&(<div className="layer-legend"><div className="legend-title">Aktive Overlays</div><div className="legend-items">{activeOverlays.map(id=>{const ol=OVERLAY_LAYERS.find(o=>o.id===id);if(!ol)return null;return<div key={id} className="legend-item"><span className="legend-dot" style={{background:ol.color}}/><span>{ol.name}</span></div>;})}</div></div>)}
    </div>
  );
}

// ── Score Mini-Bar ─────────────────────────────────────────────────────────
function ScoreMiniBar({score,color}){return(<div className="score-mini-bar-track"><div className="score-mini-bar-fill" style={{width:`${score}%`,background:color}}/></div>);}

// ── Spot Filter Panel ──────────────────────────────────────────────────────
function SpotFilterPanel({spots,activeSpotTypes,onToggle,onRefetch,loading,hasSearch,debugInfo,scoreMin,onScoreMinChange,showHeatmap,onHeatmapToggle,queryTypes,onQueryTypesChange,lastFetchedTypes,onRefetchWithTypes}){
  const[showDebug,setShowDebug]=useState(false);
  const queryDirty=useMemo(()=>{if(!lastFetchedTypes)return false;return[...queryTypes].sort().join(",")!==[...lastFetchedTypes].sort().join(",");},[queryTypes,lastFetchedTypes]);
  const toggleQT=id=>onQueryTypesChange(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const typeStats=useMemo(()=>{const s={};SPOT_TYPES.forEach(st=>(s[st.id]={total:0,filtered:0,avgScore:0,scoreSum:0}));spots.forEach(f=>{const t=f.properties?.spotType,sc=f.properties?.score??0;if(!t||!s[t])return;s[t].total++;s[t].scoreSum+=sc;if(sc>=scoreMin)s[t].filtered++;});SPOT_TYPES.forEach(st=>{const x=s[st.id];x.avgScore=x.total>0?Math.round(x.scoreSum/x.total):0;});return s;},[spots,scoreMin]);
  const total=spots.length,visible=useMemo(()=>spots.filter(f=>(f.properties?.score??0)>=scoreMin).length,[spots,scoreMin]);
  const avgScore=useMemo(()=>!spots.length?0:Math.round(spots.reduce((a,f)=>a+(f.properties?.score??0),0)/spots.length),[spots]);
  const PRESETS=[{label:"Alle",min:0},{label:"45+",min:45},{label:"65+",min:65},{label:"80+",min:80}];
  if(!hasSearch)return(<div className="filter-hint"><span className="filter-hint-icon">🔍</span><span>Starte zuerst eine Ortssuche, um FPV-Spots zu laden.</span></div>);
  return(
    <div className="spot-filter-panel">
      <div className="query-types-block">
        <div className="query-types-header"><span className="query-types-title"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> API-Abfrage</span><span className="query-types-hint">{queryTypes.length===ALL_SPOT_TYPE_IDS.length?"Alle Kategorien":`${queryTypes.length} von ${ALL_SPOT_TYPE_IDS.length}`}</span></div>
        <div className="query-type-chips">{SPOT_TYPES.map(st=>{const active=queryTypes.includes(st.id);return(<button key={st.id} className={`qt-chip ${active?"active":""}`} style={{"--qt-color":st.color}} onClick={()=>toggleQT(st.id)} disabled={loading} title={st.shortDesc}><span className="qt-icon">{st.icon}</span><span className="qt-label">{st.name}</span>{!active&&<span className="qt-off">–</span>}</button>);})}</div>
        {queryDirty&&!loading&&(<button className="query-reload-banner" onClick={()=>onRefetchWithTypes(queryTypes)}><IconRefresh/><span>Kategorien geändert — neu laden</span></button>)}
        {!lastFetchedTypes&&!loading&&hasSearch&&<div className="query-types-note">Wird beim nächsten Fetch berücksichtigt</div>}
      </div>
      <div className="spots-summary">
        {loading?(<div className="spots-loading-skeleton"><div className="skel-row"><div className="skel-block skel-num"/><div className="skel-block skel-text"/></div><div className="skel-row">{[1,2,3].map(i=><div key={i} className="skel-block skel-chip"/>)}</div></div>):(
          <><div className="spots-count-row"><span className="spots-total-num">{visible}</span><span className="spots-total-label">{total===0?"Keine Spots gefunden":`von ${total} Spots`}</span>{total>0&&<span className="spots-avg-score" style={{color:getScoreColor(avgScore)}}>Ø {avgScore}</span>}</div><button className="spots-refresh-btn" onClick={onRefetch}><IconRefresh/></button></>
        )}
      </div>
      {!loading&&total===0&&hasSearch&&(
        <div className="spots-empty-state">
          <span className="spots-empty-icon">🔎</span>
          <span className="spots-empty-title">Keine Spots im Suchbereich</span>
          <div className="spots-empty-hints">
            <span>💡 Suchradius vergrößern (aktuell max. {queryTypes.length<ALL_SPOT_TYPE_IDS.length?"oder mehr Kategorien aktivieren":"alle Kategorien aktiv"})</span>
            <span>💡 Anderen Standort suchen</span>
            <span>💡 Ländliche Gebiete haben oft mehr Spots</span>
          </div>
          <button className="spots-empty-retry" onClick={onRefetch}><IconRefresh/> Erneut suchen</button>
        </div>
      )}
      {!loading&&total>0&&(<div className="score-filter-block">
        <div className="score-filter-header"><span className="score-filter-title"><IconHeatmap/>Min. Remoteness Score</span><span className="score-filter-value" style={{color:getScoreColor(scoreMin||1)}}>{scoreMin===0?"Alle":`${scoreMin}+`}</span></div>
        <div className="score-ramp"><div className="score-ramp-bar"/><input type="range" min="0" max="90" step="5" value={scoreMin} onChange={e=>onScoreMinChange(parseInt(e.target.value))} className="score-slider"/></div>
        <div className="score-preset-row">{PRESETS.map(p=>(<button key={p.label} className={`score-preset-btn ${scoreMin===p.min?"active":""}`} onClick={()=>onScoreMinChange(p.min)}>{p.label}</button>))}</div>
        <div className="score-legend">{[{color:"#60a5fa",label:"Urban"},{color:"#22d3a7",label:"Mittel"},{color:"#f59e0b",label:"Abgelegen"},{color:"#ef4444",label:"Sehr abgelegen"}].map(({color,label})=>(<div key={label} className="score-legend-item"><span className="score-legend-dot" style={{background:color}}/><span>{label}</span></div>))}</div>
      </div>)}
      {!loading&&total>0&&(<div className="heatmap-toggle-row"><div className="heatmap-toggle-info"><span className="heatmap-toggle-icon">🔥</span><span className="heatmap-toggle-label">Heatmap</span><span className="heatmap-toggle-desc">Score-Dichte auf Karte</span></div><button className={`overlay-toggle ${showHeatmap?"active":""}`} onClick={onHeatmapToggle} style={{"--toggle-color":"#a78bfa"}}/></div>)}
      <div className="filter-grid">
        {SPOT_TYPES.map(st=>{const active=activeSpotTypes.includes(st.id),stats=typeStats[st.id],count=stats.filtered,isEmpty=count===0&&!loading;return(<button key={st.id} className={`filter-chip ${active?"active":""} ${isEmpty?"empty":""}`} style={{"--chip-color":st.color}} onClick={()=>onToggle(st.id)} disabled={loading}><span className="chip-icon">{st.icon}</span><span className="chip-body"><span className="chip-name">{st.name}</span>{!loading&&stats.total>0&&<ScoreMiniBar score={stats.avgScore} color={active?st.color:"var(--text-muted)"}/>}</span>{!loading&&(<span className="chip-count-wrap"><span className="chip-count" style={{background:active?st.color+"33":undefined,color:active?st.color:undefined}}>{count}</span>{stats.total>0&&<span className="chip-avg" style={{color:getScoreColor(stats.avgScore)}}>{stats.avgScore}</span>}</span>)}</button>);})}
      </div>
      {!loading&&total>0&&(<div className="filter-actions"><button className="filter-action-btn" onClick={()=>SPOT_TYPES.forEach(st=>!activeSpotTypes.includes(st.id)&&onToggle(st.id))}>Alle ein</button><button className="filter-action-btn" onClick={()=>SPOT_TYPES.forEach(st=>activeSpotTypes.includes(st.id)&&onToggle(st.id))}>Alle aus</button></div>)}
      {!loading&&debugInfo&&(<div className="debug-panel"><button className="debug-toggle-btn" onClick={()=>setShowDebug(v=>!v)}><span>🔧 Debug</span><span style={{fontSize:10,transform:showDebug?"rotate(180deg)":"none",transition:"transform .2s"}}>▾</span></button>{showDebug&&(<><div className="debug-row"><span className="debug-label">OSM-Rohwerte</span><span className={`debug-value ${debugInfo.rawCount===0?"debug-zero":"debug-ok"}`}>{debugInfo.rawCount}</span></div><div className="debug-row"><span className="debug-label">Klassifiziert</span><span className={`debug-value ${debugInfo.classified===0?"debug-zero":"debug-ok"}`}>{debugInfo.classified}</span></div>{debugInfo.remark&&<div className="debug-remark">{debugInfo.remark}</div>}{debugInfo.turboUrl&&<a href={debugInfo.turboUrl} target="_blank" rel="noreferrer" className="debug-turbo-btn"><IconExternal/> In Overpass Turbo testen →</a>}{debugInfo.rawCount===0&&<div className="debug-hint">→ Browser-Konsole (F12) öffnen</div>}</>)}</div>)}
    </div>
  );
}

// ── Phase 12: Spot Detail Panel — Scores, Navigation, Share ───────────────
function SpotDetailPanel({spot,onClose,flyCheckResult,onToast}){
  const[copied,setCopied]=useState(null);
  if(!spot)return null;
  const{spotType,name,tags,id,osmType,score,fpvScore,fpvBreakdown}=spot.properties,[lng,lat]=spot.geometry.coordinates;
  const type=SPOT_TYPES.find(st=>st.id===spotType);
  const osmUrl=`https://www.openstreetmap.org/${osmType}/${id}`;
  const googleUrl=`https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  const appleUrl=`https://maps.apple.com/?ll=${lat.toFixed(6)},${lng.toFixed(6)}&q=${encodeURIComponent(name||"FPV Spot")}`;
  const scoreColor=getScoreColor(score??50),scoreLabel=getScoreLabel(score??50);
  const fpvColor=getFpvColor(fpvScore??0),fpvLabel=getFpvLabel(fpvScore??0);
  const tagH=[];
  if(tags?.bridge==="yes"&&tags?.highway)tagH.push({label:"Straßentyp",value:tags.highway});
  if(tags?.["maxheight"])tagH.push({label:"Maximalhöhe",value:tags.maxheight+" m"});
  if(tags?.access)tagH.push({label:"Zugang",value:tags.access});
  if(tags?.["operator"])tagH.push({label:"Betreiber",value:tags.operator});
  if(tags?.["landuse"])tagH.push({label:"Landnutzung",value:tags.landuse});
  if(tags?.["natural"])tagH.push({label:"Naturtyp",value:tags.natural});
  if(tags?.["waterway"])tagH.push({label:"Gewässertyp",value:tags.waterway});
  if(tags?.["leisure"])tagH.push({label:"Freizeitanlage",value:tags.leisure});
  const breakdown=[
    {label:"Abgelegen",value:fpvBreakdown?.remote??score??50,icon:"📍",desc:"Remoteness"},
    {label:"Spot-Typ",value:fpvBreakdown?.typeAppeal??65,icon:type?.icon??"🗺",desc:"FPV-Eignung"},
    {label:"Interesse",value:fpvBreakdown?.visual??55,icon:"🏗",desc:"Visuell"},
    {label:"Zugang",value:fpvBreakdown?.access??65,icon:"🔓",desc:"Erreichbarkeit"},
  ];
  const handleCopyCoords=()=>{
    const text=`${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    navigator.clipboard?.writeText(text).then(()=>{setCopied("coords");onToast?.({message:`Koordinaten kopiert: ${text}`,type:"success"});setTimeout(()=>setCopied(null),2200);});
  };
  const handleCopyUrl=()=>{
    const base=window.location.origin+window.location.pathname;
    const url=`${base}?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&zoom=15${name?`&q=${encodeURIComponent(name)}`:""}`;
    navigator.clipboard?.writeText(url).then(()=>{setCopied("url");onToast?.({message:"Link kopiert!",type:"success"});setTimeout(()=>setCopied(null),2200);});
  };
  const handleNativeShare=()=>{
    const base=window.location.origin+window.location.pathname;
    const url=`${base}?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&zoom=15`;
    navigator.share?.({title:"FPV Spot Finder",text:`${name||"FPV Spot"} · ${type?.name||""} · FPV Score: ${fpvScore??"—"}`,url}).catch(()=>{});
  };
  const hasNativeShare=typeof navigator!=="undefined"&&!!navigator.share;
  const flyV=flyCheckResult?.verdict;
  const flyBadge=flyV==="green"?{emoji:"✅",label:"OK",color:"#22c55e"}:flyV==="yellow"?{emoji:"⚠️",label:"Prüfen",color:"#f59e0b"}:flyV==="red"?{emoji:"🚫",label:"Stop",color:"#ef4444"}:null;
  return(
    <div className="spot-detail-panel" style={{"--type-color":type?.color||"#888"}}>
      <div className="sdp-header"><span className="sdp-type-badge"><span className="sdp-type-icon">{type?.icon}</span>{type?.name}</span><button className="sdp-close" onClick={onClose}><IconX/></button></div>
      <div className="sdp-scroll">
        <div className="sdp-name">{name||"(kein Name)"}</div>
        <div className="sdp-coords"><IconMapPin/><span>{lat.toFixed(5)}°N · {lng.toFixed(5)}°E</span></div>
        {fpvScore!=null&&(<div className="sdp-fpv-block" style={{"--fpv-color":fpvColor}}><div className="sdp-fpv-header"><span className="sdp-fpv-title">🚁 FPV Potenzial</span><div className="sdp-fpv-score-wrap"><span className="sdp-fpv-score" style={{color:fpvColor}}>{fpvScore}</span><span className="sdp-fpv-label" style={{color:fpvColor}}>{fpvLabel}</span></div></div><div className="sdp-fpv-bar-track"><div className="sdp-fpv-bar-fill" style={{width:`${fpvScore}%`,background:`linear-gradient(90deg,${fpvColor}88,${fpvColor})`}}/><div className="sdp-fpv-tick" style={{left:"40%"}}/><div className="sdp-fpv-tick" style={{left:"55%"}}/><div className="sdp-fpv-tick" style={{left:"75%"}}/></div><div className="sdp-fpv-breakdown">{breakdown.map(({label,value,icon})=>(<div key={label} className="sdp-fpv-sub"><span className="sdp-fpv-sub-icon">{icon}</span><span className="sdp-fpv-sub-label">{label}</span><div className="sdp-fpv-sub-track"><div className="sdp-fpv-sub-fill" style={{width:`${value}%`,background:fpvColor}}/></div><span className="sdp-fpv-sub-val">{value}</span></div>))}</div></div>)}
        {score!=null&&(<div className="sdp-score-block" style={{"--score-color":scoreColor}}><div className="sdp-score-top"><span className="sdp-score-label">Remoteness Score</span><span className="sdp-score-num" style={{color:scoreColor}}>{score}</span></div><div className="sdp-score-track"><div className="sdp-score-fill" style={{width:`${score}%`,background:`linear-gradient(90deg,${scoreColor}88,${scoreColor})`}}/><div className="sdp-score-tick" style={{left:"45%"}}/><div className="sdp-score-tick" style={{left:"65%"}}/><div className="sdp-score-tick" style={{left:"80%"}}/></div><span className="sdp-score-sublabel" style={{color:scoreColor}}>{scoreLabel}</span></div>)}
        {tagH.length>0&&(<div className="sdp-tags">{tagH.slice(0,4).map(({label,value})=>(<div key={label} className="sdp-tag-row"><span className="sdp-tag-label">{label}</span><span className="sdp-tag-value">{value}</span></div>))}</div>)}
        {/* Navigation */}
        <div className="sdp-nav-section">
          <div className="sdp-section-label">Navigation</div>
          <div className="sdp-nav-btns">
            <a href={googleUrl} target="_blank" rel="noreferrer" className="sdp-nav-btn"><span>🗺</span><span>Google</span></a>
            <a href={appleUrl} target="_blank" rel="noreferrer" className="sdp-nav-btn"><span>🍎</span><span>Apple</span></a>
            <a href={osmUrl} target="_blank" rel="noreferrer" className="sdp-nav-btn"><span>🌍</span><span>OSM</span></a>
          </div>
        </div>
        {/* Share */}
        <div className="sdp-share-section">
          <div className="sdp-section-label">Teilen</div>
          <div className="sdp-share-btns">
            <button className={`sdp-share-btn${copied==="coords"?" copied":""}`} onClick={handleCopyCoords}>{copied==="coords"?<><IconCheck/>Kopiert!</>:<><IconPin/>Koordinaten</>}</button>
            <button className={`sdp-share-btn${copied==="url"?" copied":""}`} onClick={handleCopyUrl}>{copied==="url"?<><IconCheck/>Kopiert!</>:<><IconShare/>Link</>}</button>
            {hasNativeShare&&<button className="sdp-share-btn sdp-share-native" onClick={handleNativeShare}><span style={{fontSize:12}}>↗</span><span>Teilen</span></button>}
          </div>
        </div>
        {/* Fly-Check mini */}
        {flyBadge&&(<div className="sdp-flycheck-row"><span className="sdp-flycheck-label">Fly-Check</span><span className="sdp-flycheck-badge" style={{color:flyBadge.color,background:flyBadge.color+"18",borderColor:flyBadge.color+"44"}}>{flyBadge.emoji} {flyBadge.label}</span><span className="sdp-flycheck-hint">↑ Details in Sidebar</span></div>)}
      </div>
    </div>
  );
}

// ── Phase 7: Airspace Panel ────────────────────────────────────────────────
function AirspacePanel({apiKey,onSaveKey,showAirspace,onShowAirspaceToggle,showNaturschutz,onShowNaturschutzToggle,airspaceFeatures,naturschutzFeatures,loadingAirspace,loadingNaturschutz,airspaceError,naturschutzError,hasSearch,onFetchAirspace,onFetchNaturschutz}){
  const[keyInput,setKeyInput]=useState(apiKey||""),[keyVisible,setKeyVisible]=useState(false),[keySaved,setKeySaved]=useState(false);
  useEffect(()=>setKeyInput(apiKey||""),[apiKey]);
  const handleSaveKey=()=>{onSaveKey(keyInput.trim());setKeySaved(true);setTimeout(()=>setKeySaved(false),2500);};
  const zoneCounts=useMemo(()=>{const c={};airspaceFeatures.forEach(f=>{const t=f.properties?.zoneType||"OTHER";c[t]=(c[t]||0)+1;});return c;},[airspaceFeatures]);
  const SHOW_CODES=["CTR","TMA","R","P","D","TMZ","RMZ","ATZ","W","GLDR","TIZ"];
  return(
    <div className="airspace-panel">
      {/* API Key */}
      <div className="airspace-key-block">
        <div className="airspace-key-title"><IconKey/>OpenAIP API-Key<a href="https://www.openaip.net" target="_blank" rel="noreferrer" className="airspace-key-link">Kostenlos registrieren →</a></div>
        <div className="airspace-key-input-row">
          <input className="airspace-key-input" type={keyVisible?"text":"password"} value={keyInput} onChange={e=>setKeyInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSaveKey()} placeholder="API-Key eingeben…" spellCheck={false}/>
          <button className="airspace-key-eye" onClick={()=>setKeyVisible(!keyVisible)}>{keyVisible?<IconEyeOff/>:<IconEye/>}</button>
          <button className="airspace-key-btn" onClick={handleSaveKey}>{keySaved?<><IconCheck/> OK</>:"Speichern"}</button>
        </div>
        {apiKey&&!keySaved&&<div className="airspace-key-status"><IconCheck/>Key gespeichert — bereit</div>}
        {!apiKey&&<div className="airspace-key-note">Kostenloser Account auf openaip.net. Key wird lokal gespeichert.</div>}
      </div>

      {/* Luftraumzonen Toggle */}
      <div className="airspace-toggle-row">
        <div className="airspace-toggle-left">
          <span className="airspace-toggle-icon">✈️</span>
          <div className="airspace-toggle-info"><span className="airspace-toggle-name">Luftraumzonen</span><span className="airspace-toggle-desc">CTR · TMA · R · P · D (OpenAIP)</span></div>
          {airspaceFeatures.length>0&&!loadingAirspace&&<span className="az-count-badge" style={{background:"#ef444418",color:"#ef4444",borderColor:"#ef444440"}}>{airspaceFeatures.length}</span>}
        </div>
        <button className={`overlay-toggle ${showAirspace?"active":""}`} style={{"--toggle-color":"#ef4444"}} onClick={onShowAirspaceToggle}/>
      </div>
      {showAirspace&&(<div className="airspace-status-block">
        {!hasSearch&&<div className="az-hint">🔍 Starte zuerst eine Ortssuche</div>}
        {hasSearch&&!apiKey&&<div className="az-hint az-hint-key">🔑 API-Key oben eingeben</div>}
        {hasSearch&&apiKey&&loadingAirspace&&<div className="az-loading"><IconSpinner/> Luftraumzonen werden geladen…</div>}
        {hasSearch&&apiKey&&airspaceError&&<div className="az-error"><IconWarning/> {airspaceError}</div>}
        {hasSearch&&apiKey&&!loadingAirspace&&!airspaceError&&airspaceFeatures.length>0&&(
          <div className="az-stats-row">
            {SHOW_CODES.map(code=>{const count=zoneCounts[code]||0;if(!count)return null;const ti=AIRSPACE_TYPES.find(t=>t.shortCode===code);return(<div key={code} className="az-stat-chip" style={{color:ti?.color||"#888",borderColor:(ti?.color||"#888")+"55",background:(ti?.color||"#888")+"18"}}><span>{code}</span><span>{count}</span></div>);})}
            <button className="az-reload-btn" onClick={onFetchAirspace}><IconRefresh/></button>
          </div>
        )}
        {hasSearch&&apiKey&&!loadingAirspace&&!airspaceError&&airspaceFeatures.length===0&&<div className="az-hint">Keine Zonen im Suchbereich</div>}
      </div>)}

      {/* Naturschutz Toggle */}
      <div className="airspace-toggle-row">
        <div className="airspace-toggle-left">
          <span className="airspace-toggle-icon">🌿</span>
          <div className="airspace-toggle-info"><span className="airspace-toggle-name">Naturschutzgebiete</span><span className="airspace-toggle-desc">OSM protected_area (kein Key nötig)</span></div>
          {naturschutzFeatures.length>0&&!loadingNaturschutz&&<span className="az-count-badge" style={{background:NATURSCHUTZ_COLOR+"18",color:NATURSCHUTZ_COLOR,borderColor:NATURSCHUTZ_COLOR+"40"}}>{naturschutzFeatures.length}</span>}
        </div>
        <button className={`overlay-toggle ${showNaturschutz?"active":""}`} style={{"--toggle-color":NATURSCHUTZ_COLOR}} onClick={onShowNaturschutzToggle}/>
      </div>
      {showNaturschutz&&(<div className="airspace-status-block">
        {!hasSearch&&<div className="az-hint">🔍 Starte zuerst eine Ortssuche</div>}
        {hasSearch&&loadingNaturschutz&&<div className="az-loading"><IconSpinner/> Naturschutzgebiete werden geladen…</div>}
        {hasSearch&&naturschutzError&&<div className="az-error"><IconWarning/> {naturschutzError}</div>}
        {hasSearch&&!loadingNaturschutz&&naturschutzFeatures.length>0&&(
          <div className="az-nsg-note">⚠ Drohnenflug im Naturschutzgebiet häufig verboten oder genehmigungspflichtig.<button className="az-reload-btn" onClick={onFetchNaturschutz} style={{marginLeft:"auto"}}><IconRefresh/></button></div>
        )}
        {hasSearch&&!loadingNaturschutz&&!naturschutzError&&naturschutzFeatures.length===0&&<div className="az-hint">Keine Schutzgebiete im Suchbereich</div>}
      </div>)}

      {/* Legende */}
      {(showAirspace||showNaturschutz)&&(<div className="airspace-legend">
        <div className="airspace-legend-title">Legende</div>
        <div className="airspace-legend-grid">
          {showAirspace&&AIRSPACE_TYPES.filter(t=>["CTR","TMA","R","P","D","TMZ","RMZ","ATZ","W"].includes(t.shortCode)).map(t=>(<div key={t.shortCode} className="airspace-legend-item"><div className="airspace-legend-dot" style={{background:t.color}}/><span><b>{t.shortCode}</b> — {t.name}</span></div>))}
          {showNaturschutz&&<div className="airspace-legend-item"><div className="airspace-legend-dot" style={{background:NATURSCHUTZ_COLOR}}/><span><b>NSG</b> — Naturschutzgebiet</span></div>}
        </div>
      </div>)}

      <div className="airspace-legal-note"><IconInfo/>Daten zur Orientierung. Vor jedem Flug aktuelle Luftraumstruktur prüfen (DFS, AustroControl, BAZL).</div>
    </div>
  );
}

// ── Phase 7: Zone Detail Panel ─────────────────────────────────────────────
function ZoneDetailPanel({zone,onClose}){
  if(!zone)return null;
  const{name,zoneType,zoneTypeName,zoneColor,lowerLimit,upperLimit,icaoClass,onRequest,byNotam,protectClass,protect_title,access}=zone.properties;
  const color=zoneColor||"#94a3b8",isNSG=zoneType==="NATURSCHUTZ",icaoName=ICAO_CLASS_NAMES[icaoClass];
  return(
    <div className="zone-detail-panel" style={{"--zone-color":color}}>
      <div className="zdp-header"><span className="zdp-type-badge">{isNSG?"🌿":"✈️"} {zoneType}</span><button className="zdp-close" onClick={onClose}><IconX/></button></div>
      <div className="zdp-name">{name}</div>
      {!isNSG&&zoneTypeName&&<div className="zdp-typename">{zoneTypeName}</div>}
      {!isNSG&&(lowerLimit||upperLimit)&&(
        <div className="zdp-alt-block">
          <div className="zdp-alt-item"><span className="zdp-alt-label">Untergrenze</span><span className="zdp-alt-value">{formatAltLimit(lowerLimit)}</span></div>
          <div className="zdp-alt-divider"/>
          <div className="zdp-alt-item"><span className="zdp-alt-label">Obergrenze</span><span className="zdp-alt-value">{formatAltLimit(upperLimit)}</span></div>
        </div>
      )}
      <div className="zdp-meta">
        {!isNSG&&icaoName&&<div className="zdp-meta-row"><span className="zdp-meta-label">ICAO-Klasse</span><span className="zdp-meta-badge" style={{background:color+"22",color}}>Klasse {icaoName}</span></div>}
        {!isNSG&&onRequest&&<div className="zdp-meta-row"><span className="zdp-meta-label">Freigabe</span><span className="zdp-meta-value">Auf Anfrage</span></div>}
        {!isNSG&&byNotam&&<div className="zdp-meta-row"><span className="zdp-meta-label">Aktivierung</span><span className="zdp-meta-value">Per NOTAM</span></div>}
        {isNSG&&protectClass&&<div className="zdp-meta-row"><span className="zdp-meta-label">Schutzklasse (IUCN)</span><span className="zdp-meta-value">{protectClass}</span></div>}
        {isNSG&&protect_title&&<div className="zdp-meta-row"><span className="zdp-meta-label">Bezeichnung</span><span className="zdp-meta-value">{protect_title}</span></div>}
        {isNSG&&access&&<div className="zdp-meta-row"><span className="zdp-meta-label">Zugang</span><span className="zdp-meta-value">{access}</span></div>}
      </div>
      <div className="zdp-footer-warn"><IconWarning/><span>{isNSG?"Drohnenflug im NSG meist verboten oder genehmigungspflichtig.":"Aktuelle NOTAMs und Einschränkungen vor dem Flug prüfen!"}</span></div>
    </div>
  );
}


// ── Phase 8: Fly-or-No-Fly Utilities ──────────────────────────────────────
function pointInPolygon([px,py], ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const[xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>py)!==(yj>py)&&px<((xj-xi)*(py-yi))/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
function featureContainsPoint(feature,[px,py]){
  const g=feature.geometry;if(!g)return false;
  if(g.type==="Polygon")return pointInPolygon([px,py],g.coordinates[0]);
  if(g.type==="MultiPolygon")return g.coordinates.some(poly=>pointInPolygon([px,py],poly[0]));
  return false;
}
const ZONE_RULES={
  P:    {level:"red",    label:"Prohibited Area",           msg:"Überflug verboten — keine Ausnahme ohne behördliche Genehmigung (§21h Abs.1)"},
  R:    {level:"red",    label:"Restricted Area",           msg:"Eingeschränkter Luftraum — Genehmigung der zuständigen Behörde erforderlich"},
  CTR:  {level:"red",    label:"Kontrollzone (CTR)",        msg:"Kontrollierter Luftraum — ATC-Freigabe zwingend nötig (Tower kontaktieren)"},
  D:    {level:"yellow", label:"Danger Area",               msg:"Gefährdungszone — militärische oder gefährliche Aktivitäten möglich"},
  TMA:  {level:"yellow", label:"TMA (Terminalbereich)",     msg:"Kontrollierter Luftraum — Höhenlimits und etwaige Genehmigungen prüfen"},
  TMZ:  {level:"yellow", label:"Transponder-Pflichtzone",   msg:"Luftfahrzeuge ohne Transponder dürfen diese Zone nicht durchfliegen"},
  RMZ:  {level:"yellow", label:"Funk-Pflichtzone (RMZ)",    msg:"Funkkontakt mit zuständiger ATC-Stelle erforderlich"},
  ATZ:  {level:"yellow", label:"Flugplatznähe (ATZ)",       msg:"Flugplatzbetreiber kontaktieren — Sicherheitsabstand 1,5 km zu Flugplätzen"},
  W:    {level:"yellow", label:"Warning Area",              msg:"Warngebiet — Besondere Vorsicht geboten (u.a. militärische Übungen)"},
  TIZ:  {level:"yellow", label:"Traffic Info Zone (TIZ)",   msg:"Verkehrsinformationszone — erhöhtes Verkehrsaufkommen"},
  GLDR: {level:"yellow", label:"Segelfluggebiet",           msg:"Segelflug-/Thermiaktivität möglich — Kollisionsgefahr beachten"},
  NATURSCHUTZ:{level:"yellow",label:"Naturschutzgebiet",    msg:"Drohnenflug meist verboten oder genehmigungspflichtig (§21h Abs.1 Nr.6)"},
};
const GENERAL_RULES=[
  {icon:"📏",title:"Max. 120m AGL",        detail:"Ohne Sondergenehmigung gilt eine Höhenbeschränkung von 120m über Grund (§21h LuftVO)"},
  {icon:"👁", title:"Sichtflug (VLOS)",    detail:"Drohne muss jederzeit in direkter Sichtweite des Piloten bleiben"},
  {icon:"📋",title:"Registrierungspflicht",detail:"Drohnen >250g oder mit Kamera müssen registriert sein (DrohnenFV / EU-Verordnung)"},
  {icon:"🛡", title:"Haftpflicht",         detail:"Haftpflichtversicherung für alle unbemannten Luftfahrzeuge gesetzlich vorgeschrieben"},
  {icon:"👥",title:"Menschenansammlungen",detail:"Überflug von Menschenansammlungen verboten (§21h Abs.1 Nr.7 LuftVO)"},
  {icon:"🏥",title:"Sicherheitsabstände",  detail:"Keine Überflüge von Einsatzorten, Krankenhäusern, Kraftwerken, Gefängnissen"},
  {icon:"🌙",title:"Nacht-/Sichtflug",    detail:"Nachtflug und Flug in Wolken ohne Ausnahmegenehmigung nicht erlaubt"},
];
function computeFlyCheck(spot,airspaceFeatures,naturschutzFeatures){
  const pt=spot.geometry.coordinates;
  const hits=[];
  for(const f of airspaceFeatures){
    if(!featureContainsPoint(f,pt))continue;
    const code=f.properties.zoneType,rule=ZONE_RULES[code];
    if(!rule)continue;
    hits.push({level:rule.level,code,label:rule.label,name:f.properties.name,msg:rule.msg,lowerLimit:f.properties.lowerLimit,upperLimit:f.properties.upperLimit});
  }
  for(const f of naturschutzFeatures){
    if(!featureContainsPoint(f,pt))continue;
    const rule=ZONE_RULES.NATURSCHUTZ;
    hits.push({level:rule.level,code:"NSG",label:rule.label,name:f.properties.name,msg:rule.msg});
  }
  hits.sort((a,b)=>a.level==="red"?-1:b.level==="red"?1:0);
  const verdict=hits.some(h=>h.level==="red")?"red":hits.some(h=>h.level==="yellow")?"yellow":"green";
  return{verdict,hits};
}

// ── Phase 8: Fly-or-No-Fly Panel ───────────────────────────────────────────
const VERDICT_CONFIG={
  green: {bg:"#22c55e",dim:"rgba(34,197,94,.12)",border:"rgba(34,197,94,.35)",label:"Kein Hindernis gefunden",sub:"Keine bekannten Einschränkungen im Spot-Bereich. Allgemeine Regeln beachten.",emoji:"✅"},
  yellow:{bg:"#f59e0b",dim:"rgba(245,158,11,.12)",border:"rgba(245,158,11,.35)",label:"Einschränkungen vorhanden",sub:"Genehmigungen einholen oder besondere Vorsicht walten lassen.",emoji:"⚠️"},
  red:   {bg:"#ef4444",dim:"rgba(239,68,68,.12)",  border:"rgba(239,68,68,.35)",  label:"Flug nicht gestattet",sub:"Mindestens eine harte Restriktion. Ohne Ausnahmegenehmigung kein Flug.",emoji:"🚫"},
};
function AmpelLight({color,active}){
  const cols={red:"#ef4444",yellow:"#f59e0b",green:"#22c55e"};
  const c=cols[color];
  return(<div style={{width:18,height:18,borderRadius:"50%",background:active?c:"transparent",border:`2px solid ${active?c:c+"44"}`,boxShadow:active?`0 0 10px ${c}88,0 0 20px ${c}44`:"none",transition:"all .3s"}}/>);
}
function FlyCheckPanel({selectedSpot,flyCheckResult,airspaceLoaded,naturschutzLoaded}){
  const[showRules,setShowRules]=useState(false);
  const dataLoaded=airspaceLoaded||naturschutzLoaded;
  if(!selectedSpot){
    return(<div className="flychk-empty"><span className="flychk-empty-icon">🎯</span><span className="flychk-empty-title">Kein Spot ausgewählt</span><span className="flychk-empty-sub">Klicke einen Spot auf der Karte an, um den Fly-Check zu starten.</span></div>);
  }
  const spotName=selectedSpot.properties?.name||SPOT_TYPES.find(s=>s.id===selectedSpot.properties?.spotType)?.name||"Unbekannter Spot";
  const result=flyCheckResult;
  const vc=result?VERDICT_CONFIG[result.verdict]:null;
  return(
    <div className="flychk-panel">
      {/* Spot Badge */}
      <div className="flychk-spot-badge">
        <span style={{fontSize:14}}>{SPOT_TYPES.find(s=>s.id===selectedSpot.properties?.spotType)?.icon||"📍"}</span>
        <span className="flychk-spot-name">{spotName}</span>
        <span className="flychk-spot-score" style={{color:getScoreColor(selectedSpot.properties?.score??0)}}>Score {selectedSpot.properties?.score??"?"}</span>
      </div>

      {/* Data coverage warning */}
      {!dataLoaded&&(
        <div className="flychk-warn-banner">
          <IconWarning/>
          <span>Luftraum- oder Naturschutzdaten noch nicht geladen — Prüfung unvollständig. Im Luftraum-Panel laden.</span>
        </div>
      )}

      {/* Ampel + Verdict */}
      {result&&(<>
        <div className="flychk-ampel-row">
          <div className="flychk-ampel-housing">
            <AmpelLight color="red"    active={result.verdict==="red"}/>
            <AmpelLight color="yellow" active={result.verdict==="yellow"}/>
            <AmpelLight color="green"  active={result.verdict==="green"}/>
          </div>
          <div className="flychk-verdict-block" style={{"--vc-bg":vc.dim,"--vc-border":vc.border,"--vc-color":vc.bg}}>
            <span className="flychk-verdict-emoji">{vc.emoji}</span>
            <div className="flychk-verdict-texts">
              <span className="flychk-verdict-label" style={{color:vc.bg}}>{vc.label}</span>
              <span className="flychk-verdict-sub">{vc.sub}</span>
            </div>
          </div>
        </div>

        {/* Zone hits */}
        {result.hits.length>0&&(
          <div className="flychk-hits">
            <div className="flychk-hits-title">Betroffene Zonen ({result.hits.length})</div>
            {result.hits.map((h,i)=>{
              const borderColor=h.level==="red"?"#ef4444":"#f59e0b";
              const bgColor=h.level==="red"?"rgba(239,68,68,.08)":"rgba(245,158,11,.08)";
              return(
                <div key={i} className="flychk-hit" style={{borderLeftColor:borderColor,background:bgColor}}>
                  <div className="flychk-hit-top">
                    <span className="flychk-hit-code" style={{background:borderColor+"22",color:borderColor,borderColor:borderColor+"55"}}>{h.code}</span>
                    <span className="flychk-hit-name">{h.name}</span>
                    <span className={`flychk-hit-level ${h.level}`}>{h.level==="red"?"🔴":"🟡"}</span>
                  </div>
                  <div className="flychk-hit-msg">{h.msg}</div>
                  {(h.lowerLimit||h.upperLimit)&&(
                    <div className="flychk-hit-alt">{formatAltLimit(h.lowerLimit)} – {formatAltLimit(h.upperLimit)}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {result.hits.length===0&&result.verdict==="green"&&(
          <div className="flychk-clear"><span>✓</span><span>Keine Einschränkungen durch geladene Luftraumzonen oder Naturschutzgebiete gefunden.</span></div>
        )}
      </>)}

      {/* General §21h rules (collapsible) */}
      <div className="flychk-rules-block">
        <button className="flychk-rules-toggle" onClick={()=>setShowRules(v=>!v)}>
          <span>§21h LuftVO — Allgemeine Regeln</span>
          <span className="flychk-rules-chevron" style={{transform:showRules?"rotate(180deg)":"none"}}>▾</span>
        </button>
        {showRules&&(
          <div className="flychk-rules-list">
            {GENERAL_RULES.map((r,i)=>(
              <div key={i} className="flychk-rule-item">
                <span className="flychk-rule-icon">{r.icon}</span>
                <div className="flychk-rule-texts">
                  <span className="flychk-rule-title">{r.title}</span>
                  <span className="flychk-rule-detail">{r.detail}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="flychk-disclaimer"><IconInfo/>Nur zur Orientierung. Vor jedem Flug aktuelle Rechtslage prüfen: DFS AIS, LBA, AustroControl, BAZL.</div>
    </div>
  );
}

// ── Phase 10: WindRose ─────────────────────────────────────────────────────
function WindRose({direction,speed,size=100}){
  const cx=size/2,cy=size/2,r=size/2-10;
  const rad=(direction-90)*Math.PI/180;
  const arrowLen=r*0.72,ax=cx+Math.cos(rad)*arrowLen,ay=cy+Math.sin(rad)*arrowLen;
  const tr=r*0.22,tx=cx-Math.cos(rad)*tr,ty=cy-Math.sin(rad)*tr;
  const sc=speed>35?"#ef4444":speed>20?"#f59e0b":"#22d3a7";
  const ds=[["N",cx,10],["O",size-4,cy+4],["S",cx,size-2],["W",5,cy+4]];
  return(
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display:"block"}}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.03)" stroke="var(--border)" strokeWidth="1"/>
      <circle cx={cx} cy={cy} r={r*0.55} fill="none" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,3"/>
      {ds.map(([d,x,y])=><text key={d} x={x} y={y} fill="var(--text-muted)" fontSize="8" textAnchor="middle" fontFamily="var(--font-mono)">{d}</text>)}
      {[0,45,90,135,180,225,270,315].map(a=>{const ar=(a-90)*Math.PI/180,r1=r-1,r2=a%90===0?r-5:r-3;return<line key={a} x1={cx+Math.cos(ar)*r1} y1={cy+Math.sin(ar)*r1} x2={cx+Math.cos(ar)*r2} y2={cy+Math.sin(ar)*r2} stroke="var(--border)" strokeWidth={a%90===0?1.5:0.8}/>;} )}
      <line x1={tx} y1={ty} x2={ax} y2={ay} stroke={sc} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx={ax} cy={ay} r="4" fill={sc}/>
      <circle cx={cx} cy={cy} r="2.5" fill="var(--bg-card)" stroke={sc} strokeWidth="1.5"/>
    </svg>
  );
}

// ── Phase 10: Weather Panel ────────────────────────────────────────────────
const WX_AMPEL={
  green: {label:"Gut zum Fliegen",sub:"Wind, Regen und Bewölkung im grünen Bereich",emoji:"✅",color:"#22c55e"},
  yellow:{label:"Eingeschränkt",  sub:"Vorsicht: Wind, Regen oder starke Bewölkung",emoji:"⚠️",color:"#f59e0b"},
  red:   {label:"Nicht empfohlen",sub:"Zu windig, Niederschlag oder Unwetter",emoji:"🚫",color:"#ef4444"},
};
function WeatherPanel({selectedSpot,weatherData,loading,error,onRefetch}){
  if(!selectedSpot)return(<div className="wx-empty"><span className="wx-empty-icon">🌤️</span><span>Spot auswählen für Wetterdaten</span></div>);
  if(loading)return(<div className="wx-loading"><IconSpinner/><span>Wetterdaten werden geladen…</span></div>);
  if(error)return(<div className="wx-error"><IconWarning/><span>{error}</span><button className="wx-retry-btn" onClick={onRefetch}><IconRefresh/> Erneut versuchen</button></div>);
  if(!weatherData)return null;
  const c=weatherData.current;
  const wind=Math.round(c.wind_speed_10m??0),dir=Math.round(c.wind_direction_10m??0),rain=+(c.precipitation??0).toFixed(1);
  const cloud=Math.round(c.cloud_cover??0),temp=Math.round(c.temperature_2m??0),humid=Math.round(c.relative_humidity_2m??0);
  const wmo=getWmo(c.weather_code??0),ampel=computeWeatherAmpel(c),ac=WX_AMPEL[ampel];
  const windColor=wind>35?"#ef4444":wind>20?"#f59e0b":"#22d3a7";
  const now=new Date(),hourlyTimes=weatherData.hourly?.time||[];
  const nextHours=hourlyTimes.map((t,i)=>({time:t,temp:Math.round(weatherData.hourly.temperature_2m?.[i]??0),wind:Math.round(weatherData.hourly.wind_speed_10m?.[i]??0),precProb:weatherData.hourly.precipitation_probability?.[i]??0,code:weatherData.hourly.weather_code?.[i]??0})).filter(h=>{const d=new Date(h.time);return d>=now&&d<=new Date(now.getTime()+6*3600000);}).slice(0,6);
  return(
    <div className="wx-panel">
      <div className="wx-ampel-row">
        <div className="flychk-ampel-housing">
          <AmpelLight color="red"    active={ampel==="red"}/>
          <AmpelLight color="yellow" active={ampel==="yellow"}/>
          <AmpelLight color="green"  active={ampel==="green"}/>
        </div>
        <div className="flychk-verdict-block" style={{"--vc-bg":`${ac.color}18`,"--vc-border":`${ac.color}44`,"--vc-color":ac.color}}>
          <span className="flychk-verdict-emoji">{ac.emoji}</span>
          <div className="flychk-verdict-texts">
            <span className="flychk-verdict-label" style={{color:ac.color}}>{ac.label}</span>
            <span className="flychk-verdict-sub">{ac.sub}</span>
          </div>
        </div>
      </div>
      <div className="wx-cond-card">
        <div className="wx-cond-left">
          <WindRose direction={dir} speed={wind} size={96}/>
          <div className="wx-wind-info">
            <span className="wx-wind-speed" style={{color:windColor}}>{wind} km/h</span>
            <span className="wx-wind-dir">{windDirLabel(dir)} · {dir}°</span>
          </div>
        </div>
        <div className="wx-cond-stats">
          <div className="wx-stat"><span className="wx-stat-icon">{wmo.icon}</span><div><span className="wx-stat-val">{wmo.label}</span><span className="wx-stat-lbl">Wetterlage</span></div></div>
          <div className="wx-stat"><span className="wx-stat-icon">🌡️</span><div><span className="wx-stat-val">{temp}°C</span><span className="wx-stat-lbl">Temperatur</span></div></div>
          <div className="wx-stat"><span className="wx-stat-icon">🌧️</span><div><span className="wx-stat-val" style={{color:rain>0?"#60a5fa":"var(--text-secondary)"}}>{rain} mm</span><span className="wx-stat-lbl">Niederschlag</span></div></div>
          <div className="wx-stat"><span className="wx-stat-icon">☁️</span><div><span className="wx-stat-val" style={{color:cloud>80?"#f59e0b":"var(--text-secondary)"}}>{cloud}%</span><span className="wx-stat-lbl">Bewölkung</span></div></div>
          <div className="wx-stat"><span className="wx-stat-icon">💧</span><div><span className="wx-stat-val">{humid}%</span><span className="wx-stat-lbl">Luftfeuchte</span></div></div>
        </div>
      </div>
      {nextHours.length>0&&(
        <div className="wx-forecast">
          <div className="wx-forecast-title">Stunden-Vorschau</div>
          <div className="wx-forecast-row">
            {nextHours.map(h=>{const hw=getWmo(h.code),wc=h.wind>35?"#ef4444":h.wind>20?"#f59e0b":"#22d3a7";const hr=new Date(h.time).getHours();return(
              <div key={h.time} className="wx-fc-cell">
                <span className="wx-fc-time">{String(hr).padStart(2,"0")}:00</span>
                <span className="wx-fc-icon">{hw.icon}</span>
                <span className="wx-fc-temp">{h.temp}°</span>
                <span className="wx-fc-wind" style={{color:wc}}>{h.wind}</span>
                {h.precProb>20&&<span className="wx-fc-prec">{h.precProb}%</span>}
              </div>
            );})}
          </div>
        </div>
      )}
      <div className="wx-footer">
        <button className="wx-refresh-btn" onClick={onRefetch}><IconRefresh/> Aktualisieren</button>
        <span>Open-Meteo · {weatherData.timezone_abbreviation||""}</span>
      </div>
    </div>
  );
}

// ── Phase 11: SunCompass ───────────────────────────────────────────────────
function SunCompass({azBearing,altDeg,size=100}){
  const cx=size/2,cy=size/2,r=size/2-10;
  const rad=(azBearing-90)*Math.PI/180;
  const arrowLen=r*0.72,ax=cx+Math.cos(rad)*arrowLen,ay=cy+Math.sin(rad)*arrowLen;
  const tr=r*0.22,tx=cx-Math.cos(rad)*tr,ty=cy-Math.sin(rad)*tr;
  const sc=altDeg<0?"#312e81":altDeg<6?"#f59e0b":"#fbbf24";
  const ds=[["N",cx,10],["O",size-4,cy+4],["S",cx,size-2],["W",5,cy+4]];
  return(
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display:"block"}}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.03)" stroke="var(--border)" strokeWidth="1"/>
      <circle cx={cx} cy={cy} r={r*0.55} fill="none" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,3"/>
      {ds.map(([d,x,y])=><text key={d} x={x} y={y} fill="var(--text-muted)" fontSize="8" textAnchor="middle" fontFamily="var(--font-mono)">{d}</text>)}
      {[0,45,90,135,180,225,270,315].map(a=>{const ar=(a-90)*Math.PI/180,r1=r-1,r2=a%90===0?r-5:r-3;return<line key={a} x1={cx+Math.cos(ar)*r1} y1={cy+Math.sin(ar)*r1} x2={cx+Math.cos(ar)*r2} y2={cy+Math.sin(ar)*r2} stroke="var(--border)" strokeWidth={a%90===0?1.5:0.8}/>;} )}
      <line x1={tx} y1={ty} x2={ax} y2={ay} stroke={sc} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx={ax} cy={ay} r="4" fill={sc}/>
      <circle cx={cx} cy={cy} r="2.5" fill="var(--bg-card)" stroke={sc} strokeWidth="1.5"/>
      <text x={cx} y={cy+1.5} fill={sc} fontSize="5" textAnchor="middle" fontFamily="var(--font-mono)" dominantBaseline="middle">☀</text>
    </svg>
  );
}

// ── Phase 11: Sun Timeline ─────────────────────────────────────────────────
function SunTimeline({times,now}){
  if(!times)return null;
  const dayStart=new Date(now);dayStart.setHours(0,0,0,0);
  const dayMs=86400000;
  const pct=d=>`${Math.max(0,Math.min(100,(d.getTime()-dayStart.getTime())/dayMs*100)).toFixed(1)}%`;
  const w=d=>d&&!isNaN(d.getTime());
  const nowPct=pct(now);
  return(
    <div className="sun-timeline">
      <span className="sun-timeline-label">Tageslicht-Übersicht</span>
      <div className="sun-tl-bar">
        {w(times.dawn)&&w(times.dusk)&&<div className="sun-tl-day" style={{left:pct(times.dawn),width:`calc(${pct(times.dusk)} - ${pct(times.dawn)})`}}/>}
        {w(times.sunrise)&&w(times.goldenMorningEnd)&&<div className="sun-tl-golden" style={{left:pct(times.sunrise),width:`calc(${pct(times.goldenMorningEnd)} - ${pct(times.sunrise)})`}}/>}
        {w(times.goldenEveningStart)&&w(times.sunset)&&<div className="sun-tl-golden" style={{left:pct(times.goldenEveningStart),width:`calc(${pct(times.sunset)} - ${pct(times.goldenEveningStart)})`}}/>}
        <div className="sun-tl-now" style={{left:nowPct}}/>
      </div>
      <div className="sun-tl-ticks">
        {["0:00","6:00","12:00","18:00","24:00"].map(t=><span key={t}>{t}</span>)}
      </div>
    </div>
  );
}

// ── Phase 11: Sun Panel ────────────────────────────────────────────────────
function SunPanel({selectedSpot,searchCircle}){
  const[now,setNow]=useState(()=>new Date());
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(t);},[]);
  let lat=null,lng=null;
  if(selectedSpot){[lng,lat]=selectedSpot.geometry.coordinates;}
  else if(searchCircle){[lng,lat]=searchCircle.center;}
  if(lat==null)return(<div className="sun-empty"><span className="sun-empty-icon">🌤️</span><span>Spot auswählen oder Suche starten für Sonnenstandsdaten</span></div>);
  let times,pos,status,altDeg=0,azBearing=0;
  try{
    times=getSunTimes(now,lat,lng);
    pos=getSunPosition(now,lat,lng);
    status=getSunStatus(times,now);
    altDeg=Math.round(pos.altitude*180/Math.PI);
    azBearing=Math.round(sunAzBearing(pos.azimuth));
  }catch(e){return(<div className="sun-empty"><span className="sun-empty-icon">⚠️</span><span>Fehler bei Sonnenberechnung</span></div>);}
  const isGoldenNow=status.label==="Goldene Stunde";
  const nextGolden=isGoldenNow?null:(now<times.sunrise?times.sunrise:now<times.goldenEveningStart?times.goldenEveningStart:null);
  return(
    <div className="sun-panel">
      {/* Status & Position */}
      <div className="sun-status-row">
        <div className="sun-status-badge" style={{background:`${status.color}18`,border:`1px solid ${status.color}44`,color:status.color}}>
          <span>{status.emoji}</span><span>{status.label}</span>
        </div>
        <div className="sun-pos-meta">
          <span className="sun-alt" title="Höhenwinkel der Sonne">{altDeg>=0?"↑":"↓"}{Math.abs(altDeg)}°</span>
          {nextGolden&&<span className="sun-next">🌅 {formatTime(nextGolden)}</span>}
        </div>
      </div>

      {/* Sun Compass + Altitude Bar */}
      <div className="sun-compass-card">
        <div className="sun-compass-left">
          <SunCompass azBearing={azBearing} altDeg={altDeg} size={96}/>
          <div className="sun-compass-info">
            <span className="sun-az-val">{azBearing}°</span>
            <span className="sun-az-lbl">{["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(azBearing/22.5)%16]}</span>
          </div>
        </div>
        <div className="sun-compass-right">
          <div className="sun-times-col">
            <div className="sun-time-item"><span className="sun-ti-icon">🌄</span><div><span className="sun-ti-label">Aufgang</span><span className="sun-ti-val">{formatTime(times.sunrise)}</span></div></div>
            <div className={`sun-time-item ${isGoldenNow&&now<times.goldenMorningEnd?"golden":""}`}><span className="sun-ti-icon">🌅</span><div><span className="sun-ti-label">Gold. morgens</span><span className="sun-ti-val golden-val">{formatTime(times.sunrise)} – {formatTime(times.goldenMorningEnd)}</span></div></div>
            <div className="sun-time-item"><span className="sun-ti-icon">☀️</span><div><span className="sun-ti-label">Mittag</span><span className="sun-ti-val">{formatTime(times.solarNoon)}</span></div></div>
            <div className={`sun-time-item ${isGoldenNow&&now>=times.goldenEveningStart?"golden":""}`}><span className="sun-ti-icon">🌅</span><div><span className="sun-ti-label">Gold. abends</span><span className="sun-ti-val golden-val">{formatTime(times.goldenEveningStart)} – {formatTime(times.sunset)}</span></div></div>
            <div className="sun-time-item"><span className="sun-ti-icon">🌆</span><div><span className="sun-ti-label">Untergang</span><span className="sun-ti-val">{formatTime(times.sunset)}</span></div></div>
          </div>
        </div>
      </div>

      {/* Altitude Horizon Bar */}
      <div className="sun-alt-card">
        <span className="sun-alt-label">Sonnen-Höhenwinkel</span>
        <div className="sun-alt-track">
          <div className="sun-alt-zero"/>
          <div className="sun-alt-fill" style={{left:altDeg>=0?"50%":`${50+altDeg/90*50}%`,width:`${Math.abs(altDeg)/90*50}%`,background:altDeg<0?"#312e81":altDeg<6?"#f59e0b":"#fbbf24"}}/>
          <div className="sun-alt-needle" style={{left:`${50+Math.max(-90,Math.min(90,altDeg))/90*50}%`}}/>
        </div>
        <div className="sun-alt-labels"><span>−90°</span><span>Horizon</span><span>+90°</span></div>
        <div className="sun-alt-deg" style={{color:altDeg<0?"#5b21b6":altDeg<6?"#f59e0b":"#fbbf24"}}>{altDeg>=0?"+":""}{altDeg}° · {altDeg<0?"Unter Horizont":altDeg<6?"Goldene Zone (0–6°)":altDeg<20?"Niedriger Stand":"Hoher Stand"}</div>
      </div>

      {/* Timeline */}
      <SunTimeline times={times} now={now}/>

      <div className="sun-footer"><IconInfo/> Sonnenzeiten für {lat.toFixed(3)}°N, {lng.toFixed(3)}°E · SunCalc</div>
    </div>
  );
}

// ── CSS Styles ─────────────────────────────────────────────────────────────
const CSS_STYLES = `
  :root {
    --bg-primary:#0a0e17;--bg-secondary:#111827;--bg-card:#1a2235;--bg-hover:#232d42;
    --border:#2a3450;--border-light:#354060;--accent:#22d3a7;--accent-dim:rgba(34,211,167,.12);
    --accent-glow:rgba(34,211,167,.25);--danger:#ef4444;--warn:#f59e0b;--info:#60a5fa;
    --text-primary:#e8ecf4;--text-secondary:#94a3b8;--text-muted:#5a6a85;
    --font-display:'Outfit',sans-serif;--font-body:'Outfit',sans-serif;--font-mono:'JetBrains Mono',monospace;
    --sidebar-width:340px;--header-height:54px;--radius:10px;--radius-sm:6px;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  .app-root{width:100vw;height:100vh;overflow:hidden;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font-body);display:flex;flex-direction:column}
  .app-header{height:var(--header-height);flex-shrink:0;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:12px;z-index:100}
  .header-toggle{background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:6px;border-radius:var(--radius-sm);transition:all .2s;display:flex;align-items:center;justify-content:center}
  .header-toggle:hover{color:var(--accent);background:var(--accent-dim)}
  .header-brand{display:flex;align-items:center;gap:10px;user-select:none}
  .brand-icon{color:var(--accent);display:flex}
  .brand-text{font-family:var(--font-display);font-weight:700;font-size:18px;letter-spacing:-.3px;background:linear-gradient(135deg,var(--accent),#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .brand-tag{font-size:10px;font-weight:500;color:var(--bg-primary);background:var(--accent);padding:2px 6px;border-radius:4px;letter-spacing:.5px;text-transform:uppercase}
  .header-layer-status{display:flex;align-items:center;gap:6px;font-size:11px;font-family:var(--font-mono);color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border);padding:4px 10px;border-radius:20px}
  .status-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0}
  .status-overlay-count{background:var(--accent-dim);color:var(--accent);font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px}
  .header-coords{margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;min-width:200px;justify-content:flex-end}
  .coords-live{color:var(--accent)}
  .app-body{display:flex;flex:1;min-height:0;position:relative}
  .app-sidebar{width:var(--sidebar-width);flex-shrink:0;background:var(--bg-secondary);border-right:1px solid var(--border);display:flex;flex-direction:column;transition:margin-left .3s cubic-bezier(.4,0,.2,1),opacity .3s;overflow:hidden;z-index:50}
  .app-sidebar.closed{margin-left:calc(var(--sidebar-width)*-1);opacity:0;pointer-events:none}
  .sidebar-scroll{flex:1;overflow-y:auto;padding:12px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
  .sidebar-scroll::-webkit-scrollbar{width:5px}.sidebar-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
  .sidebar-section{margin-bottom:4px;border-radius:var(--radius)}
  .section-header{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border:none;background:transparent;color:var(--text-primary);font-family:var(--font-display);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;border-radius:var(--radius-sm);text-align:left}
  .section-header:hover{background:var(--bg-hover)}
  .section-icon{color:var(--accent);display:flex;flex-shrink:0}.section-title{flex:1}
  .section-badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;background:var(--accent-dim);color:var(--accent);text-transform:uppercase;letter-spacing:.4px}
  .section-chevron{color:var(--text-muted);display:flex;transition:transform .2s}.section-chevron.open{transform:rotate(180deg)}
  .section-content{padding:4px 12px 14px 12px;animation:slideDown .2s ease}
  .search-panel{display:flex;flex-direction:column;gap:10px;position:relative}
  .search-box{display:flex;align-items:center;gap:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 10px;transition:border-color .2s,box-shadow .2s;position:relative}
  .search-box.focused,.search-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-dim)}
  .search-icon{color:var(--text-muted);flex-shrink:0;display:flex;align-items:center}
  .search-input{flex:1;background:none;border:none;outline:none;color:var(--text-primary);font-family:var(--font-body);font-size:13px;padding:9px 0}
  .search-input::placeholder{color:var(--text-muted)}
  .search-clear{background:none;border:none;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;padding:3px;border-radius:3px;transition:color .15s;flex-shrink:0}
  .search-clear:hover{color:var(--text-primary)}
  .suggestions-list{position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;z-index:9000;box-shadow:0 12px 32px rgba(0,0,0,.7);animation:slideDown .15s ease}
  .suggestion-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:none;background:none;cursor:pointer;transition:background .1s;text-align:left;border-bottom:1px solid var(--border)}
  .suggestion-item:last-child{border-bottom:none}.suggestion-item:hover,.suggestion-item.active{background:var(--bg-hover)}
  .sug-icon{font-size:14px;flex-shrink:0;line-height:1}.sug-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
  .sug-main{font-size:12px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sug-rest{font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sug-type{font-size:9px;font-family:var(--font-mono);color:var(--text-muted);background:var(--bg-secondary);border:1px solid var(--border);padding:2px 5px;border-radius:3px;flex-shrink:0;text-transform:lowercase}
  .suggestions-footer{padding:5px 10px;font-size:9px;color:var(--text-muted);background:var(--bg-secondary);border-top:1px solid var(--border)}
  .radius-control{display:flex;flex-direction:column;gap:8px}
  .radius-label{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-secondary)}
  .radius-value{font-family:var(--font-mono);font-size:12px;color:var(--accent);font-weight:500;display:flex;align-items:center}
  .rv-dim{color:var(--text-muted)}.rv-sep{color:var(--text-muted);margin:0 1px}
  .drs-track{position:relative;height:20px;display:flex;align-items:center;cursor:pointer;user-select:none;touch-action:none}
  .drs-rail{position:absolute;left:0;right:0;height:4px;background:var(--border);border-radius:2px}
  .drs-fill{position:absolute;height:4px;background:var(--accent);border-radius:2px;pointer-events:none}
  .drs-thumb{position:absolute;width:18px;height:18px;border-radius:50%;background:var(--accent);cursor:grab;transform:translateX(-50%);box-shadow:0 0 0 3px var(--bg-card),0 0 0 5px var(--accent),0 2px 6px rgba(0,0,0,.4);transition:box-shadow .15s,transform .1s;z-index:2;touch-action:none}
  .drs-thumb:hover,.drs-thumb:active{transform:translateX(-50%) scale(1.15);cursor:grabbing}
  .drs-thumb-min{background:color-mix(in srgb,var(--accent) 70%,white)}
  .radius-range-labels{display:flex;justify-content:space-between;font-size:10px;font-family:var(--font-mono);color:var(--text-muted);margin-top:-4px}
  .radius-presets{display:flex;justify-content:space-between;gap:4px}
  .radius-tick{font-size:10px;font-family:var(--font-mono);color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:3px 6px;cursor:pointer;transition:all .15s;flex:1;text-align:center}
  .radius-tick:hover{border-color:var(--accent);color:var(--accent)}.radius-tick.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
  .search-result-bar{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--accent-dim);border:1px solid rgba(34,211,167,.3);border-radius:var(--radius-sm);animation:slideDown .2s ease}
  .result-icon{color:var(--accent);display:flex;align-items:center;flex-shrink:0}.result-label{flex:1;font-size:11px;font-weight:600;color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .result-radius-badge{font-size:10px;font-family:var(--font-mono);color:var(--accent);background:rgba(34,211,167,.15);border:1px solid rgba(34,211,167,.3);padding:2px 6px;border-radius:4px;flex-shrink:0}
  .result-share,.result-clear{background:none;border:none;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;padding:3px;border-radius:3px;transition:color .15s}
  .result-share:hover{color:var(--info)}.result-clear:hover{color:var(--danger)}
  .layer-panel{display:flex;flex-direction:column;gap:0}
  .layer-group-label{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--text-muted);margin-bottom:8px}
  .layer-group-count{font-family:var(--font-mono);font-size:10px;color:var(--accent)}
  .base-layer-list{display:flex;flex-direction:column;gap:4px}
  .base-layer-card{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius-sm);background:var(--bg-card);border:1px solid var(--border);cursor:pointer;transition:all .15s;text-align:left;width:100%}
  .base-layer-card:hover{border-color:var(--layer-color,var(--accent));background:var(--bg-hover)}
  .base-layer-card.active{border-color:var(--layer-color,var(--accent));background:color-mix(in srgb,var(--layer-color,var(--accent)) 8%,var(--bg-card));box-shadow:0 0 0 1px color-mix(in srgb,var(--layer-color,var(--accent)) 30%,transparent)}
  .base-layer-info{flex:1;display:flex;flex-direction:column;gap:1px}.base-layer-name{font-size:12px;font-weight:600;color:var(--text-primary)}.base-layer-desc{font-size:10px;color:var(--text-muted)}
  .base-layer-radio{width:16px;height:16px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:border-color .15s}
  .base-layer-radio.active{border-color:var(--layer-color,var(--accent))}.radio-dot{width:7px;height:7px;border-radius:50%;background:var(--layer-color,var(--accent))}
  .overlay-list{display:flex;flex-direction:column;gap:6px}
  .overlay-item{border-radius:var(--radius-sm);background:var(--bg-card);border:1px solid var(--border);padding:8px 10px;transition:border-color .15s}
  .overlay-item.active{border-color:rgba(var(--badge-color,34,211,167),.35)}.overlay-item.disabled{opacity:.6}
  .overlay-header-row{display:flex;align-items:center;gap:8px}
  .overlay-info{flex:1;display:flex;flex-direction:column;gap:1px}.overlay-name{font-size:12px;font-weight:600;color:var(--text-primary)}.overlay-desc{font-size:10px;color:var(--text-muted)}
  .overlay-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
  .overlay-badge{font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:color-mix(in srgb,var(--badge-color,#22d3a7) 15%,transparent);color:var(--badge-color,#22d3a7);letter-spacing:.3px;text-transform:uppercase}
  .overlay-toggle{width:36px;height:20px;border-radius:10px;flex-shrink:0;background:var(--border);cursor:pointer;position:relative;transition:background .2s;border:none}
  .overlay-toggle:hover{background:var(--border-light)}.overlay-toggle.active{background:var(--toggle-color,var(--accent))}
  .overlay-toggle::after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:white;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
  .overlay-toggle.active::after{transform:translateX(16px)}
  .opacity-row{display:flex;align-items:center;gap:8px;margin-top:7px;padding-top:7px;border-top:1px solid var(--border)}
  .opacity-label{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted);flex-shrink:0;white-space:nowrap}
  .opacity-slider{flex:1;appearance:none;height:3px;background:var(--border);border-radius:2px;outline:none;cursor:pointer}
  .opacity-slider::-webkit-slider-thumb{appearance:none;width:12px;height:12px;background:var(--accent);border-radius:50%;cursor:pointer;transition:transform .15s}
  .opacity-slider::-webkit-slider-thumb:hover{transform:scale(1.3)}
  .opacity-value{font-size:10px;font-family:var(--font-mono);color:var(--accent);flex-shrink:0;width:28px;text-align:right}
  .overlay-locked{display:flex;align-items:center;gap:5px;margin-top:6px;font-size:10px;color:var(--text-muted);padding:4px 6px;background:rgba(255,255,255,.03);border-radius:4px}
  .layer-legend{margin-top:10px;padding:8px 10px;border-radius:var(--radius-sm);background:var(--accent-dim);border:1px solid rgba(34,211,167,.2)}
  .legend-title{font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .legend-items{display:flex;flex-direction:column;gap:4px}.legend-item{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary)}.legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .query-types-block{padding:8px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:8px}
  .query-types-header{display:flex;align-items:center;justify-content:space-between}
  .query-types-title{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px}
  .query-types-title svg{color:var(--accent);flex-shrink:0}.query-types-hint{font-size:10px;font-family:var(--font-mono);color:var(--text-muted)}
  .query-type-chips{display:flex;flex-wrap:wrap;gap:4px}
  .qt-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 5px;border-radius:20px;border:1px solid var(--border);background:var(--bg-secondary);cursor:pointer;transition:all .15s;font-size:11px;color:var(--text-muted);user-select:none}
  .qt-chip:hover:not(:disabled){border-color:var(--qt-color);color:var(--text-primary)}
  .qt-chip.active{background:color-mix(in srgb,var(--qt-color) 12%,var(--bg-secondary));border-color:color-mix(in srgb,var(--qt-color) 50%,transparent);color:var(--text-primary)}
  .qt-chip:disabled{opacity:.45;cursor:default}.qt-icon{font-size:12px;line-height:1}.qt-label{font-size:10px;font-weight:600;white-space:nowrap}.qt-off{font-size:9px;color:var(--danger);font-weight:700;margin-left:1px}
  .query-reload-banner{display:flex;align-items:center;gap:6px;width:100%;padding:6px 10px;border-radius:var(--radius-sm);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 40%,transparent);color:var(--warn);font-size:11px;font-weight:600;cursor:pointer;transition:opacity .15s;animation:slideDown .2s ease}
  .query-reload-banner:hover{opacity:.8}.query-reload-banner svg{flex-shrink:0}.query-types-note{font-size:10px;color:var(--text-muted);font-style:italic}
  .filter-hint{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;text-align:center}
  .filter-hint-icon{font-size:28px;line-height:1}.filter-hint span:last-child{font-size:12px;color:var(--text-muted);line-height:1.5}
  .spot-filter-panel{display:flex;flex-direction:column;gap:10px}
  .spots-summary{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .spots-loading-row{display:flex;align-items:center;gap:7px;color:var(--text-muted);font-size:12px}
  .spots-count-row{display:flex;align-items:baseline;gap:5px;flex:1}
  .spots-total-num{font-size:20px;font-weight:700;font-family:var(--font-mono);color:var(--accent);line-height:1}
  .spots-total-label{font-size:11px;color:var(--text-secondary)}
  .spots-avg-score{font-size:10px;font-family:var(--font-mono);font-weight:700;margin-left:auto;padding:2px 6px;background:rgba(255,255,255,.06);border-radius:3px}
  .spots-refresh-btn{background:none;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-muted);cursor:pointer;display:flex;align-items:center;padding:5px;transition:all .15s;flex-shrink:0}
  .spots-refresh-btn:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-dim)}
  .spots-empty-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center}
  .spots-empty-icon{font-size:32px;line-height:1;opacity:.7}
  .spots-empty-title{font-size:13px;font-weight:700;color:var(--text-secondary)}
  .spots-empty-hints{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text-muted);line-height:1.5;text-align:left;width:100%;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:var(--radius-sm)}
  .spots-empty-retry{display:flex;align-items:center;gap:5px;background:var(--accent-dim);border:1px solid rgba(34,211,167,.3);border-radius:var(--radius-sm);color:var(--accent);font-size:11px;font-weight:600;padding:7px 14px;cursor:pointer;transition:opacity .15s}
  .spots-empty-retry:hover{opacity:.8}
  .spots-loading-skeleton{display:flex;flex-direction:column;gap:8px;width:100%;padding:2px 0}
  .skel-row{display:flex;gap:6px;align-items:center}
  .skel-block{border-radius:4px;background:linear-gradient(90deg,var(--border) 25%,var(--border-light) 50%,var(--border) 75%);background-size:200% 100%;animation:shimmer 1.5s ease-in-out infinite}
  .skel-num{width:36px;height:22px;border-radius:4px}
  .skel-text{flex:1;height:14px;border-radius:3px}
  .skel-chip{width:52px;height:18px;border-radius:10px}
  @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
  .score-filter-block{padding:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:8px}
  .score-filter-header{display:flex;align-items:center;justify-content:space-between}
  .score-filter-title{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:var(--text-secondary)}
  .score-filter-title svg{color:var(--accent)}.score-filter-value{font-family:var(--font-mono);font-size:13px;font-weight:700}
  .score-ramp{position:relative;height:20px;display:flex;align-items:center}
  .score-ramp-bar{position:absolute;left:0;right:0;height:6px;border-radius:3px;background:linear-gradient(90deg,#60a5fa,#22d3a7 45%,#f59e0b 65%,#ef4444);pointer-events:none}
  .score-slider{position:relative;width:100%;appearance:none;height:20px;background:transparent;outline:none;cursor:pointer;margin:0;z-index:1}
  .score-slider::-webkit-slider-thumb{appearance:none;width:16px;height:16px;border-radius:50%;background:white;cursor:pointer;box-shadow:0 0 0 2px rgba(0,0,0,.35),0 1px 4px rgba(0,0,0,.4);transition:transform .15s}
  .score-slider::-webkit-slider-runnable-track{height:6px;background:transparent;border-radius:3px}
  .score-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:white;cursor:pointer;border:none;box-shadow:0 0 0 2px rgba(0,0,0,.35),0 1px 4px rgba(0,0,0,.4)}
  .score-slider::-moz-range-track{height:6px;background:transparent;border-radius:3px}
  .score-slider::-webkit-slider-thumb:hover{transform:scale(1.15)}
  .score-preset-row{display:flex;gap:4px}
  .score-preset-btn{flex:1;font-size:10px;font-family:var(--font-mono);color:var(--text-muted);background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;padding:3px 4px;cursor:pointer;transition:all .15s;text-align:center}
  .score-preset-btn:hover{border-color:var(--accent);color:var(--accent)}.score-preset-btn.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
  .score-legend{display:flex;gap:8px;flex-wrap:wrap}.score-legend-item{display:flex;align-items:center;gap:4px;font-size:9px;color:var(--text-muted);white-space:nowrap}.score-legend-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .heatmap-toggle-row{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .heatmap-toggle-info{display:flex;align-items:center;gap:6px;flex:1}
  .heatmap-toggle-icon{font-size:14px;line-height:1}.heatmap-toggle-label{font-size:12px;font-weight:600;color:var(--text-primary)}.heatmap-toggle-desc{font-size:10px;color:var(--text-muted)}
  .filter-grid{display:flex;flex-direction:column;gap:4px}
  .filter-chip{display:flex;align-items:center;gap:7px;padding:7px 10px;font-size:12px;font-weight:500;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;color:var(--text-secondary);transition:all .15s;user-select:none;width:100%;text-align:left}
  .filter-chip:hover:not(:disabled){border-color:var(--chip-color,var(--accent));color:var(--text-primary)}
  .filter-chip.active{background:color-mix(in srgb,var(--chip-color,var(--accent)) 10%,var(--bg-card));border-color:color-mix(in srgb,var(--chip-color,var(--accent)) 50%,transparent);color:var(--text-primary)}
  .filter-chip.empty{opacity:.5}.filter-chip:disabled{cursor:default;opacity:.5}
  .chip-icon{font-size:15px;line-height:1;flex-shrink:0}.chip-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}.chip-name{font-size:12px;line-height:1}
  .score-mini-bar-track{height:3px;background:var(--border);border-radius:2px;overflow:hidden}
  .score-mini-bar-fill{height:100%;border-radius:2px;transition:width .4s ease}
  .chip-count-wrap{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0}
  .chip-count{font-size:10px;font-family:var(--font-mono);font-weight:700;padding:2px 6px;border-radius:3px;background:rgba(255,255,255,.06);color:var(--text-muted);min-width:22px;text-align:center;transition:all .15s}
  .chip-avg{font-size:9px;font-family:var(--font-mono);font-weight:700;color:var(--text-muted)}
  .filter-actions{display:flex;gap:6px}
  .filter-action-btn{flex:1;font-size:11px;font-family:var(--font-mono);color:var(--text-muted);background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 8px;cursor:pointer;transition:all .15s}
  .filter-action-btn:hover{color:var(--accent);border-color:var(--accent)}
  .debug-panel{margin-top:4px;padding:8px 10px;background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:5px}
  .debug-toggle-btn{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;color:var(--text-muted);font-size:10px;font-family:var(--font-mono);cursor:pointer;padding:0;transition:color .15s}
  .debug-toggle-btn:hover{color:var(--text-secondary)}
  .debug-row{display:flex;justify-content:space-between;align-items:center;font-size:11px}.debug-label{color:var(--text-muted);font-family:var(--font-mono)}.debug-value{font-family:var(--font-mono);font-weight:700;font-size:13px}.debug-ok{color:var(--accent)}.debug-zero{color:var(--danger)}
  .debug-remark{font-size:10px;color:var(--warn);background:rgba(245,158,11,.08);padding:4px 6px;border-radius:3px;word-break:break-word}
  .debug-turbo-btn{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--info);text-decoration:none;padding:5px 8px;border-radius:var(--radius-sm);border:1px solid rgba(96,165,250,.3);background:rgba(96,165,250,.08);transition:opacity .15s;margin-top:2px}
  .debug-turbo-btn:hover{opacity:.75}.debug-hint{font-size:10px;color:var(--text-muted);font-family:var(--font-mono)}
  .spot-detail-panel{position:absolute;bottom:24px;right:16px;width:290px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 16px 48px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04);animation:slideUpIn .25s cubic-bezier(.34,1.56,.64,1);z-index:200;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - var(--header-height) - 48px)}
  .sdp-scroll{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:var(--border) transparent;flex:1;min-height:0}
  .sdp-scroll::-webkit-scrollbar{width:4px}.sdp-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
  .sdp-section-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:6px}
  .sdp-nav-section{padding:8px 12px 10px;border-top:1px solid var(--border)}
  .sdp-nav-btns{display:flex;gap:5px}
  .sdp-nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;border-radius:var(--radius-sm);font-size:10px;font-weight:600;color:var(--text-secondary);text-decoration:none;background:var(--bg-card);border:1px solid var(--border);transition:all .15s;cursor:pointer;line-height:1}
  .sdp-nav-btn span:first-child{font-size:16px}
  .sdp-nav-btn:hover{color:var(--text-primary);border-color:var(--accent);background:var(--accent-dim)}
  .sdp-share-section{padding:0 12px 10px}
  .sdp-share-btns{display:flex;gap:5px}
  .sdp-share-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 5px;border-radius:var(--radius-sm);font-size:10px;font-weight:600;color:var(--text-secondary);background:var(--bg-card);border:1px solid var(--border);cursor:pointer;transition:all .15s;white-space:nowrap;line-height:1}
  .sdp-share-btn:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-dim)}
  .sdp-share-btn.copied{color:#22c55e;border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.08)}
  .sdp-share-native{color:var(--info)}
  .sdp-flycheck-row{display:flex;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid var(--border);background:var(--bg-card)}
  .sdp-flycheck-label{font-size:10px;color:var(--text-muted);flex-shrink:0}
  .sdp-flycheck-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;border:1px solid;flex-shrink:0}
  .sdp-flycheck-hint{font-size:9px;color:var(--text-muted);margin-left:auto}
  .sdp-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border)}
  .sdp-type-badge{display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;background:color-mix(in srgb,var(--type-color) 15%,transparent);color:var(--type-color);border:1px solid color-mix(in srgb,var(--type-color) 35%,transparent)}
  .sdp-type-icon{font-size:14px;line-height:1}
  .sdp-close{background:none;border:none;cursor:pointer;color:var(--text-muted);display:flex;padding:4px;border-radius:4px;transition:color .15s}.sdp-close:hover{color:var(--text-primary)}
  .sdp-name{padding:10px 12px 4px;font-size:15px;font-weight:700;color:var(--text-primary);line-height:1.3}
  .sdp-coords{display:flex;align-items:center;gap:5px;padding:0 12px 10px;font-size:11px;font-family:var(--font-mono);color:var(--text-muted)}
  .sdp-score-block{padding:8px 12px 10px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:5px}
  .sdp-score-top{display:flex;justify-content:space-between;align-items:center}
  .sdp-score-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)}
  .sdp-score-num{font-family:var(--font-mono);font-size:22px;font-weight:700;line-height:1}
  .sdp-score-track{height:8px;background:var(--bg-primary);border-radius:4px;overflow:hidden;position:relative}
  .sdp-score-fill{height:100%;border-radius:4px;transition:width .5s cubic-bezier(.34,1.56,.64,1)}
  .sdp-score-tick{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.15);pointer-events:none}
  .sdp-score-sublabel{font-size:10px;color:var(--score-color,var(--accent));font-weight:600}
  .sdp-tags{border-top:1px solid var(--border);padding:8px 12px;display:flex;flex-direction:column;gap:4px}
  .sdp-tag-row{display:flex;justify-content:space-between;gap:8px;font-size:11px}
  .sdp-tag-label{color:var(--text-muted)}.sdp-tag-value{color:var(--text-secondary);font-weight:500;text-transform:capitalize}
  .sdp-footer{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-top:1px solid var(--border)}
  .sdp-osm-link{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--info);text-decoration:none;transition:opacity .15s}.sdp-osm-link:hover{opacity:.75}
  .sdp-fly-stub{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-muted)}
  .sdp-score-badge{font-size:9px;font-family:var(--font-mono);background:var(--accent-dim);color:var(--accent);padding:2px 5px;border-radius:3px}

  /* ── Phase 7: Airspace Panel ── */
  .airspace-panel{display:flex;flex-direction:column;gap:8px}
  .airspace-key-block{padding:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:7px}
  .airspace-key-title{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px}
  .airspace-key-link{font-size:10px;color:var(--info);text-decoration:none;margin-left:auto;white-space:nowrap}
  .airspace-key-link:hover{text-decoration:underline}
  .airspace-key-input-row{display:flex;gap:5px}
  .airspace-key-input{flex:1;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 8px;color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;min-width:0}
  .airspace-key-input:focus{border-color:var(--accent)}.airspace-key-input::placeholder{color:var(--text-muted)}
  .airspace-key-eye{background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-muted);padding:6px 8px;cursor:pointer;display:flex;align-items:center;flex-shrink:0}
  .airspace-key-eye:hover{color:var(--text-primary)}
  .airspace-key-btn{background:var(--accent-dim);border:1px solid rgba(34,211,167,.3);border-radius:var(--radius-sm);color:var(--accent);font-size:11px;font-weight:600;padding:6px 10px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:3px;flex-shrink:0;transition:opacity .15s}
  .airspace-key-btn:hover{opacity:.8}
  .airspace-key-status{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--accent)}
  .airspace-key-note{font-size:10px;color:var(--text-muted);line-height:1.4;font-style:italic}
  .airspace-toggle-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .airspace-toggle-left{display:flex;align-items:center;gap:7px;flex:1;min-width:0}
  .airspace-toggle-icon{font-size:14px;line-height:1;flex-shrink:0}
  .airspace-toggle-info{display:flex;flex-direction:column;gap:1px;min-width:0}
  .airspace-toggle-name{font-size:12px;font-weight:600;color:var(--text-primary)}
  .airspace-toggle-desc{font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .az-count-badge{font-size:10px;font-family:var(--font-mono);font-weight:700;padding:2px 7px;border-radius:10px;border:1px solid;flex-shrink:0}
  .airspace-status-block{display:flex;flex-direction:column;gap:6px;padding:0 2px}
  .az-hint{font-size:11px;color:var(--text-muted);padding:5px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .az-hint-key{border-color:rgba(96,165,250,.3);color:var(--info)}
  .az-loading{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--text-muted);padding:4px 0}
  .az-error{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--danger);padding:5px 8px;background:color-mix(in srgb,var(--danger) 10%,transparent);border:1px solid color-mix(in srgb,var(--danger) 25%,transparent);border-radius:var(--radius-sm)}
  .az-stats-row{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .az-stat-chip{display:flex;align-items:center;gap:4px;padding:2px 7px;border-radius:10px;font-size:10px;font-family:var(--font-mono);font-weight:700;border:1px solid}
  .asc-code{}.asc-count{opacity:.8}
  .az-reload-btn{background:none;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-muted);cursor:pointer;display:flex;align-items:center;padding:4px 6px;transition:all .15s;flex-shrink:0}
  .az-reload-btn:hover{color:var(--accent);border-color:var(--accent)}
  .az-nsg-note{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--warn);padding:5px 8px;background:color-mix(in srgb,var(--warn) 8%,transparent);border:1px solid color-mix(in srgb,var(--warn) 25%,transparent);border-radius:var(--radius-sm);flex-wrap:wrap}
  .airspace-legend{padding:8px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .airspace-legend-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:6px}
  .airspace-legend-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}
  .airspace-legend-item{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-secondary)}
  .airspace-legend-dot{width:10px;height:10px;border-radius:2px;flex-shrink:0}
  .airspace-legal-note{display:flex;align-items:flex-start;gap:6px;font-size:10px;color:var(--text-muted);line-height:1.45;padding:6px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .airspace-legal-note svg{flex-shrink:0;margin-top:1px}

  /* ── Phase 7: Zone Detail Panel ── */
  .zone-detail-panel{position:absolute;top:16px;right:16px;width:278px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 16px 48px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04);animation:slideDown .2s cubic-bezier(.34,1.56,.64,1);z-index:201;overflow:hidden}
  .zdp-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border)}
  .zdp-type-badge{display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;background:color-mix(in srgb,var(--zone-color) 15%,transparent);color:var(--zone-color);border:1px solid color-mix(in srgb,var(--zone-color) 35%,transparent)}
  .zdp-close{background:none;border:none;cursor:pointer;color:var(--text-muted);display:flex;padding:4px;border-radius:4px;transition:color .15s}.zdp-close:hover{color:var(--text-primary)}
  .zdp-name{padding:10px 12px 2px;font-size:14px;font-weight:700;color:var(--text-primary);line-height:1.3}
  .zdp-typename{padding:0 12px 8px;font-size:11px;color:var(--text-muted)}
  .zdp-alt-block{display:flex;gap:0;padding:8px 12px;border-top:1px solid var(--border)}
  .zdp-alt-item{flex:1;display:flex;flex-direction:column;gap:3px;padding:6px 8px;background:var(--bg-card);border-radius:var(--radius-sm)}
  .zdp-alt-divider{width:8px}
  .zdp-alt-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)}
  .zdp-alt-value{font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--text-primary)}
  .zdp-meta{padding:8px 12px;display:flex;flex-direction:column;gap:5px;border-top:1px solid var(--border)}
  .zdp-meta-row{display:flex;justify-content:space-between;align-items:center;font-size:11px;gap:8px}
  .zdp-meta-label{color:var(--text-muted);flex-shrink:0}
  .zdp-meta-value{color:var(--text-secondary);font-weight:500;text-align:right}
  .zdp-meta-badge{padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;font-family:var(--font-mono)}
  .zdp-footer-warn{display:flex;align-items:flex-start;gap:7px;padding:8px 12px;border-top:1px solid var(--border);font-size:10px;color:var(--warn);background:color-mix(in srgb,var(--warn) 6%,transparent);line-height:1.4}
  .zdp-footer-warn svg{flex-shrink:0;margin-top:1px}

  /* Toast */
  .toast-container{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;min-width:260px;max-width:90vw}
  .toast{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-radius:var(--radius);font-size:13px;background:var(--bg-card);border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.4);animation:toastIn .25s cubic-bezier(.34,1.56,.64,1)}
  .toast-warn{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 10%,var(--bg-card))}
  .toast-info{border-color:var(--info);background:color-mix(in srgb,var(--info) 10%,var(--bg-card))}
  .toast-success{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--bg-card))}
  .toast-close{background:none;border:none;color:var(--text-muted);cursor:pointer;display:flex;padding:2px;border-radius:3px;flex-shrink:0}.toast-close:hover{color:var(--text-primary)}
  .sidebar-footer{padding:10px 14px;border-top:1px solid var(--border);font-size:10px;color:var(--text-muted);text-align:center;font-family:var(--font-mono)}.sidebar-footer span{color:var(--accent)}
  .map-area{flex:1;position:relative;min-width:0}
  @media(max-width:767px){
    .app-sidebar{position:absolute;top:0;left:0;bottom:0;width:85vw;max-width:340px;box-shadow:4px 0 24px rgba(0,0,0,.5)}
    .app-sidebar.closed{margin-left:-85vw}.header-coords{display:none}.mobile-overlay{position:absolute;inset:0;background:rgba(0,0,0,.5);z-index:40}
    .spot-detail-panel{bottom:0;right:0;left:0;width:auto;border-radius:var(--radius) var(--radius) 0 0;max-height:55vh;border-bottom:none}
    .spot-detail-panel .sdp-header{cursor:grab;padding:12px 12px 10px}
    .spot-detail-panel .sdp-header::before{content:'';display:block;width:32px;height:4px;border-radius:2px;background:var(--border-light);margin:0 auto 8px}
    .zone-detail-panel{top:8px;right:8px;left:8px;width:auto}
  }
  @keyframes slideDown{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideUpIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .pulse-drone{color:var(--accent);animation:pulse 1.5s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.4;transform:scale(.95)}50%{opacity:1;transform:scale(1.05)}}
  .spinner-icon{animation:spin .8s linear infinite}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  .maplibregl-ctrl-group{background:var(--bg-card)!important;border:1px solid var(--border)!important;border-radius:var(--radius-sm)!important;box-shadow:0 2px 8px rgba(0,0,0,.3)!important}
  .maplibregl-ctrl-group button{border-color:var(--border)!important}.maplibregl-ctrl-group button span{filter:invert(.8)!important}
  .maplibregl-ctrl-attrib{font-size:10px!important}
  .maplibregl-ctrl-scale{background:var(--bg-card)!important;color:var(--text-secondary)!important;border-color:var(--text-muted)!important;font-family:var(--font-mono)!important;font-size:10px!important}

  /* ── Phase 8: Fly-or-No-Fly Check ── */
  .flychk-panel{display:flex;flex-direction:column;gap:9px}
  .flychk-empty{display:flex;flex-direction:column;align-items:center;gap:7px;padding:18px 8px;text-align:center}
  .flychk-empty-icon{font-size:32px;line-height:1;opacity:.6}
  .flychk-empty-title{font-size:13px;font-weight:600;color:var(--text-secondary)}
  .flychk-empty-sub{font-size:11px;color:var(--text-muted);line-height:1.5;max-width:220px}
  .flychk-spot-badge{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .flychk-spot-name{flex:1;font-size:12px;font-weight:600;color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .flychk-spot-score{font-size:11px;font-family:var(--font-mono);font-weight:700;flex-shrink:0}
  .flychk-warn-banner{display:flex;align-items:flex-start;gap:6px;padding:7px 9px;border-radius:var(--radius-sm);background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);font-size:10px;color:var(--warn);line-height:1.45}
  .flychk-warn-banner svg{flex-shrink:0;margin-top:1px}
  .flychk-ampel-row{display:flex;align-items:center;gap:10px}
  .flychk-ampel-housing{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 12px;background:#0a0e17;border:2px solid #1e2a3a;border-radius:10px;flex-shrink:0}
  .flychk-verdict-block{flex:1;padding:10px 12px;border-radius:var(--radius-sm);background:var(--vc-bg,var(--accent-dim));border:1px solid var(--vc-border,rgba(34,211,167,.3));display:flex;align-items:flex-start;gap:8px}
  .flychk-verdict-emoji{font-size:20px;line-height:1;flex-shrink:0;margin-top:1px}
  .flychk-verdict-texts{display:flex;flex-direction:column;gap:3px}
  .flychk-verdict-label{font-size:13px;font-weight:700;color:var(--vc-color,var(--accent));line-height:1.2}
  .flychk-verdict-sub{font-size:10px;color:var(--text-muted);line-height:1.45}
  .flychk-hits{display:flex;flex-direction:column;gap:5px}
  .flychk-hits-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:2px}
  .flychk-hit{border-left:3px solid;border-radius:0 var(--radius-sm) var(--radius-sm) 0;padding:7px 9px;display:flex;flex-direction:column;gap:4px}
  .flychk-hit-top{display:flex;align-items:center;gap:5px}
  .flychk-hit-code{font-size:9px;font-family:var(--font-mono);font-weight:700;padding:2px 6px;border-radius:3px;border:1px solid;flex-shrink:0;text-transform:uppercase}
  .flychk-hit-name{flex:1;font-size:11px;font-weight:600;color:var(--text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .flychk-hit-level{font-size:11px;flex-shrink:0}
  .flychk-hit-msg{font-size:10px;color:var(--text-secondary);line-height:1.45}
  .flychk-hit-alt{font-size:9px;font-family:var(--font-mono);color:var(--text-muted);padding:2px 5px;background:rgba(255,255,255,.04);border-radius:3px;width:fit-content}
  .flychk-clear{display:flex;align-items:center;gap:7px;padding:7px 10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:var(--radius-sm);font-size:11px;color:#22c55e}
  .flychk-rules-block{border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden}
  .flychk-rules-toggle{width:100%;display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg-card);border:none;color:var(--text-secondary);font-size:11px;font-weight:600;cursor:pointer;transition:background .15s;text-align:left}
  .flychk-rules-toggle:hover{background:var(--bg-hover)}
  .flychk-rules-chevron{font-size:12px;transition:transform .2s;color:var(--text-muted)}
  .flychk-rules-list{display:flex;flex-direction:column;gap:0;border-top:1px solid var(--border)}
  .flychk-rule-item{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border);background:var(--bg-secondary)}
  .flychk-rule-item:last-child{border-bottom:none}
  .flychk-rule-icon{font-size:13px;line-height:1;flex-shrink:0;margin-top:1px}
  .flychk-rule-texts{display:flex;flex-direction:column;gap:2px}
  .flychk-rule-title{font-size:11px;font-weight:600;color:var(--text-primary)}
  .flychk-rule-detail{font-size:10px;color:var(--text-muted);line-height:1.4}
  .flychk-disclaimer{display:flex;align-items:flex-start;gap:6px;font-size:10px;color:var(--text-muted);line-height:1.45;padding:6px 8px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .flychk-disclaimer svg{flex-shrink:0;margin-top:1px}

  /* ── Phase 10: Weather ──────────────────────────────────────────────────── */
  .wx-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:20px 0;color:var(--text-muted);font-size:12px;text-align:center}
  .wx-empty-icon{font-size:28px}
  .wx-loading{display:flex;align-items:center;gap:8px;padding:14px 0;color:var(--text-muted);font-size:12px}
  .wx-error{display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:var(--radius-sm);font-size:11px;color:#ef4444}
  .wx-retry-btn{display:flex;align-items:center;gap:5px;background:none;border:1px solid #ef444466;border-radius:var(--radius-sm);color:#ef4444;font-size:11px;padding:4px 8px;cursor:pointer;width:fit-content;transition:all .15s}
  .wx-retry-btn:hover{background:rgba(239,68,68,.1)}
  .wx-panel{display:flex;flex-direction:column;gap:10px}
  .wx-ampel-row{display:flex;align-items:center;gap:10px}
  .wx-cond-card{display:grid;grid-template-columns:auto 1fr;gap:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;align-items:center}
  .wx-cond-left{display:flex;flex-direction:column;align-items:center;gap:4px}
  .wx-wind-info{display:flex;flex-direction:column;align-items:center;gap:2px}
  .wx-wind-speed{font-family:var(--font-mono);font-size:12px;font-weight:700}
  .wx-wind-dir{font-size:9px;color:var(--text-muted);font-family:var(--font-mono)}
  .wx-cond-stats{display:flex;flex-direction:column;gap:5px}
  .wx-stat{display:flex;align-items:flex-start;gap:6px}
  .wx-stat-icon{font-size:12px;width:18px;text-align:center;flex-shrink:0;margin-top:1px}
  .wx-stat div{display:flex;flex-direction:column;gap:1px}
  .wx-stat-val{font-size:11px;font-weight:600;color:var(--text-primary);line-height:1.3}
  .wx-stat-lbl{font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px}
  .wx-forecast{display:flex;flex-direction:column;gap:5px}
  .wx-forecast-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)}
  .wx-forecast-row{display:flex;gap:4px;overflow-x:auto;padding-bottom:2px}
  .wx-forecast-row::-webkit-scrollbar{height:3px}.wx-forecast-row::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
  .wx-fc-cell{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:42px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 3px;flex-shrink:0}
  .wx-fc-time{font-size:9px;color:var(--text-muted);font-family:var(--font-mono)}
  .wx-fc-icon{font-size:13px}
  .wx-fc-temp{font-size:10px;color:var(--text-secondary);font-weight:600}
  .wx-fc-wind{font-size:9px;font-family:var(--font-mono);font-weight:700}
  .wx-fc-prec{font-size:8px;color:#60a5fa}
  .wx-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--text-muted)}
  .wx-refresh-btn{display:flex;align-items:center;gap:4px;background:none;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-muted);font-size:10px;padding:3px 7px;cursor:pointer;transition:all .15s}
  .wx-refresh-btn:hover{border-color:var(--accent);color:var(--accent)}

  /* ── Phase 9: FPV Score Block ─────────────────────────────────────────── */
  .sdp-fpv-block{background:color-mix(in srgb,var(--fpv-color,#a78bfa) 8%,var(--bg-card));border:1px solid color-mix(in srgb,var(--fpv-color,#a78bfa) 35%,transparent);border-radius:var(--radius-sm);padding:10px 12px;display:flex;flex-direction:column;gap:8px;margin-bottom:6px}
  .sdp-fpv-header{display:flex;justify-content:space-between;align-items:center}
  .sdp-fpv-title{font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:5px}
  .sdp-fpv-score-wrap{display:flex;align-items:baseline;gap:6px}
  .sdp-fpv-score{font-family:var(--font-mono);font-size:24px;font-weight:700;line-height:1}
  .sdp-fpv-label{font-size:11px;font-weight:600;opacity:.85}
  .sdp-fpv-bar-track{height:6px;background:var(--border);border-radius:3px;position:relative;overflow:hidden}
  .sdp-fpv-bar-fill{height:100%;border-radius:3px;transition:width .4s ease}
  .sdp-fpv-tick{position:absolute;top:0;bottom:0;width:1px;background:var(--bg-secondary);opacity:.6}
  .sdp-fpv-breakdown{display:flex;flex-direction:column;gap:4px;margin-top:2px}
  .sdp-fpv-sub{display:flex;align-items:center;gap:6px}
  .sdp-fpv-sub-icon{font-size:11px;flex-shrink:0;line-height:1;width:14px;text-align:center}
  .sdp-fpv-sub-label{font-size:10px;color:var(--text-muted);width:60px;flex-shrink:0}
  .sdp-fpv-sub-track{flex:1;height:3px;background:var(--border);border-radius:2px;overflow:hidden}
  .sdp-fpv-sub-fill{height:100%;border-radius:2px;opacity:.7;transition:width .3s ease}
  .sdp-fpv-sub-val{font-size:10px;font-family:var(--font-mono);color:var(--text-muted);width:22px;text-align:right;flex-shrink:0}

  /* ── Phase 11: Sun Panel ─────────────────────────────────────────────── */
  .sun-panel{display:flex;flex-direction:column;gap:8px}
  .sun-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:24px 8px;text-align:center;color:var(--text-muted);font-size:12px;line-height:1.5}
  .sun-empty-icon{font-size:28px;line-height:1}
  .sun-status-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .sun-status-badge{display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700}
  .sun-pos-meta{display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:11px}
  .sun-alt{color:var(--text-secondary)}
  .sun-next{color:#f59e0b;font-size:11px}
  .sun-compass-card{display:flex;gap:10px;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)}
  .sun-compass-left{display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0}
  .sun-compass-info{display:flex;flex-direction:column;align-items:center;gap:1px}
  .sun-az-val{font-family:var(--font-mono);font-size:13px;font-weight:700;color:#fbbf24;line-height:1}
  .sun-az-lbl{font-size:10px;color:var(--text-muted)}
  .sun-compass-right{flex:1;min-width:0}
  .sun-times-col{display:flex;flex-direction:column;gap:5px}
  .sun-time-item{display:flex;align-items:flex-start;gap:6px;padding:3px 0}
  .sun-time-item.golden .sun-ti-val{color:#f59e0b}
  .sun-ti-icon{font-size:13px;line-height:1;flex-shrink:0;width:18px;text-align:center;margin-top:1px}
  .sun-ti-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted);display:block;line-height:1.2}
  .sun-ti-val{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--text-primary);display:block;line-height:1.3}
  .golden-val{color:#f59e0b !important;font-size:10px}
  .sun-alt-card{padding:8px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:5px}
  .sun-alt-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)}
  .sun-alt-track{position:relative;height:10px;background:rgba(0,0,0,.3);border-radius:5px;overflow:hidden}
  .sun-alt-zero{position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--border-light)}
  .sun-alt-fill{position:absolute;top:1px;bottom:1px;border-radius:3px;transition:all .5s ease}
  .sun-alt-needle{position:absolute;top:-1px;bottom:-1px;width:2px;background:white;border-radius:1px;transform:translateX(-50%);transition:left .5s ease;box-shadow:0 0 4px rgba(255,255,255,.5)}
  .sun-alt-labels{display:flex;justify-content:space-between;font-size:9px;font-family:var(--font-mono);color:var(--text-muted)}
  .sun-alt-deg{font-size:10px;font-family:var(--font-mono);font-weight:700;text-align:center}
  .sun-timeline{padding:8px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:5px}
  .sun-timeline-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)}
  .sun-tl-bar{position:relative;height:16px;border-radius:3px;background:rgba(15,23,42,0.8);overflow:hidden}
  .sun-tl-day{position:absolute;top:0;bottom:0;background:rgba(250,200,80,0.12)}
  .sun-tl-golden{position:absolute;top:0;bottom:0;background:rgba(245,158,11,0.38);border-radius:2px}
  .sun-tl-now{position:absolute;top:-1px;bottom:-1px;width:2px;background:var(--accent);border-radius:1px;box-shadow:0 0 4px var(--accent-glow);transform:translateX(-50%)}
  .sun-tl-ticks{display:flex;justify-content:space-between;font-size:9px;font-family:var(--font-mono);color:var(--text-muted)}
  .sun-footer{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-muted);padding:2px 0}
  .sun-footer svg{flex-shrink:0;opacity:.6}
`;


// ── Main App ───────────────────────────────────────────────────────────────
function FPVSpotFinder(){
  const[sidebarOpen,setSidebarOpen]=useState(true),[isMobile,setIsMobile]=useState(false);
  const[activeBase,setActiveBase]=useState("osm"),[activeOverlays,setActiveOverlays]=useState([]),[overlayOpacity,setOverlayOpacity]=useState({});
  const[toast,setToast]=useState(null),[searchCircle,setSearchCircle]=useState(null),[coords,setCoords]=useState(null);
  const[spots,setSpots]=useState([]),[activeSpotTypes,setActiveSpotTypes]=useState([...ALL_SPOT_TYPE_IDS]);
  const[loadingSpots,setLoadingSpots]=useState(false),[selectedSpot,setSelectedSpot]=useState(null),[debugInfo,setDebugInfo]=useState(null);
  const[scoreMin,setScoreMin]=useState(0),[showHeatmap,setShowHeatmap]=useState(false);
  const[queryTypes,setQueryTypes]=useState([...ALL_SPOT_TYPE_IDS]),[lastFetchedTypes,setLastFetchedTypes]=useState(null);
  // Phase 7
  const[airspaceKey,setAirspaceKey]=useState(()=>localStorage.getItem("fpv-openaip-key")||"");
  const[airspaceFeatures,setAirspaceFeatures]=useState([]),[naturschutzFeatures,setNaturschutzFeatures]=useState([]);
  const[showAirspace,setShowAirspace]=useState(false),[showNaturschutz,setShowNaturschutz]=useState(false);
  const[loadingAirspace,setLoadingAirspace]=useState(false),[loadingNaturschutz,setLoadingNaturschutz]=useState(false);
  const[airspaceError,setAirspaceError]=useState(null),[naturschutzError,setNaturschutzError]=useState(null);
  const[selectedZone,setSelectedZone]=useState(null);
  // Phase 8
  const[flyCheckResult,setFlyCheckResult]=useState(null);
  // Phase 10
  const[weatherData,setWeatherData]=useState(null),[loadingWeather,setLoadingWeather]=useState(false),[weatherError,setWeatherError]=useState(null);

  const filteredSpots=useMemo(()=>spots.filter(f=>(f.properties?.score??0)>=scoreMin),[spots,scoreMin]);
  const mapRef=useRef(null),mapContainerRef=useRef(null),abortRef=useRef(null),nsgAbortRef=useRef(null);

  useEffect(()=>{const p=readUrlParams();if(p.center)setSearchCircle({center:p.center,radiusMinKm:p.radiusMin,radiusMaxKm:p.radiusMax});},[]);
  useEffect(()=>{const check=()=>{const m=window.innerWidth<768;setIsMobile(m);if(m)setSidebarOpen(false);};check();window.addEventListener("resize",check);return()=>window.removeEventListener("resize",check);},[]);
  useEffect(()=>{setTimeout(()=>mapRef.current?.resize(),320);},[sidebarOpen]);

  // Escape key closes open panels
  useEffect(()=>{
    const handler=e=>{if(e.key==="Escape"){if(selectedSpot)setSelectedSpot(null);else if(selectedZone)setSelectedZone(null);else if(isMobile&&sidebarOpen)setSidebarOpen(false);}};
    window.addEventListener("keydown",handler);
    return()=>window.removeEventListener("keydown",handler);
  },[selectedSpot,selectedZone,isMobile,sidebarOpen]);

  // Load Google Fonts once (instead of in render body)
  useEffect(()=>{
    if(!document.querySelector('link[href*="fonts.googleapis.com/css2"]')){
      const pre=document.createElement("link");pre.rel="preconnect";pre.href="https://fonts.googleapis.com";document.head.appendChild(pre);
      const link=document.createElement("link");link.rel="stylesheet";link.href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";document.head.appendChild(link);
    }
    if(!document.getElementById("fpv-styles")){
      const style=document.createElement("style");style.id="fpv-styles";style.textContent=CSS_STYLES;document.head.appendChild(style);
    }
  },[]);

  const showToast=useCallback((message,type="info")=>setToast({message,type,id:Date.now()}),[]);

  // Phase 8: auto-recompute fly check when spot or zone data changes
  useEffect(()=>{
    if(!selectedSpot){setFlyCheckResult(null);return;}
    setFlyCheckResult(computeFlyCheck(selectedSpot,airspaceFeatures,naturschutzFeatures));
  },[selectedSpot,airspaceFeatures,naturschutzFeatures]);

  // Phase 10: fetch weather when selected spot changes
  const doFetchWeather=useCallback(async(spot)=>{
    if(!spot){setWeatherData(null);setWeatherError(null);return;}
    const[lng,lat]=spot.geometry.coordinates;
    setLoadingWeather(true);setWeatherError(null);
    try{const data=await fetchWeather(lat,lng);setWeatherData(data);}
    catch(err){setWeatherError(err.message);setWeatherData(null);}
    finally{setLoadingWeather(false);}
  },[]);
  useEffect(()=>{doFetchWeather(selectedSpot);},[selectedSpot,doFetchWeather]);

  // ── Phase 7 fetch functions ────────────────────────────────────────────
  const doFetchAirspace=useCallback(async()=>{
    if(!searchCircle||!airspaceKey)return;
    setLoadingAirspace(true);setAirspaceError(null);
    try{const features=await fetchOpenAIPData(searchCircle.center,searchCircle.radiusMaxKm,airspaceKey);setAirspaceFeatures(features);showToast(features.length>0?`${features.length} Luftraumzonen geladen`:"Keine Zonen im Suchbereich",features.length>0?"success":"info");}
    catch(err){setAirspaceError(err.message);showToast(`Luftraum: ${err.message}`,"warn");}
    finally{setLoadingAirspace(false);}
  },[searchCircle,airspaceKey]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only re-run on listed deps

  const doFetchNaturschutz=useCallback(async()=>{
    if(!searchCircle)return;
    nsgAbortRef.current?.abort();const ctrl=new AbortController();nsgAbortRef.current=ctrl;
    setLoadingNaturschutz(true);setNaturschutzError(null);
    try{const features=await fetchNaturschutzData(searchCircle.center,searchCircle.radiusMaxKm,ctrl.signal);setNaturschutzFeatures(features);if(features.length>0)showToast(`${features.length} Naturschutzgebiete geladen`,"info");}
    catch(err){if(err.name!=="AbortError"){setNaturschutzError(err.message);showToast(`Naturschutz: ${err.message}`,"warn");}}
    finally{setLoadingNaturschutz(false);}
  },[searchCircle]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only re-run on listed deps

  // Auto-fetch when toggle turns ON
  useEffect(()=>{if(showAirspace&&searchCircle&&airspaceKey)doFetchAirspace();},[showAirspace]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only re-run on listed deps
  useEffect(()=>{if(showNaturschutz&&searchCircle)doFetchNaturschutz();},[showNaturschutz]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only re-run on listed deps

  // Clear zone data on new search circle, then re-fetch if toggles active
  useEffect(()=>{
    setAirspaceFeatures([]);setNaturschutzFeatures([]);setAirspaceError(null);setNaturschutzError(null);setSelectedZone(null);
    if(searchCircle){
      if(showAirspace&&airspaceKey)setTimeout(()=>doFetchAirspace(),100);
      if(showNaturschutz)setTimeout(()=>doFetchNaturschutz(),100);
    }
  },[searchCircle]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveApiKey=useCallback(key=>{
    setAirspaceKey(key);localStorage.setItem("fpv-openaip-key",key);
    if(key){showToast("API-Key gespeichert","success");if(showAirspace&&searchCircle)setTimeout(()=>doFetchAirspace(),50);}
  },[showAirspace,searchCircle,doFetchAirspace]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only re-run on listed deps

  // ── Spot fetching ──────────────────────────────────────────────────────
  const doFetchSpots=useCallback((circle,types)=>{
    if(!circle)return;const fetchTypes=types??queryTypes;
    if(!fetchTypes.length){showToast("Mindestens eine Kategorie auswählen.","warn");return;}
    abortRef.current?.abort();const ctrl=new AbortController();abortRef.current=ctrl;
    setLoadingSpots(true);setSelectedSpot(null);setDebugInfo(null);
    fetchSpots(circle.center,circle.radiusMinKm,circle.radiusMaxKm,fetchTypes,ctrl.signal)
      .then(({features,rawCount,remark,turboUrl})=>{
        setSpots(features);setLastFetchedTypes([...fetchTypes]);setDebugInfo({rawCount,classified:features.length,remark,turboUrl});
        if(rawCount===0)showToast("Overpass: 0 Elemente – Turbo-Link im Filter-Panel prüfen.","warn");
        else if(features.length===0)showToast(`${rawCount} OSM-Elemente, 0 klassifiziert – Console prüfen.`,"warn");
        else{const avg=Math.round(features.reduce((a,f)=>a+(f.properties.score??0),0)/features.length);showToast(`${features.length} Spots · Ø Score ${avg}`,"success");}
      })
      .catch(err=>{if(err.name!=="AbortError"){showToast(`Fehler: ${err.message}`,"warn");setDebugInfo({rawCount:0,classified:0,remark:err.message,turboUrl:null});}})
      .finally(()=>setLoadingSpots(false));
  },[queryTypes]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only re-run on listed deps

  const lastCenterKey=useRef(null);
  useEffect(()=>{
    if(!searchCircle){setSpots([]);setSelectedSpot(null);setDebugInfo(null);lastCenterKey.current=null;abortRef.current?.abort();return;}
    const k=searchCircle.center.map(v=>v.toFixed(4)).join(",");
    if(k===lastCenterKey.current)return;
    lastCenterKey.current=k;doFetchSpots(searchCircle);
  },[searchCircle,doFetchSpots]);

  const toggleSpotType=useCallback(id=>setActiveSpotTypes(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]),[]);
  const handleSpotClick=useCallback(f=>{
    // MapLibre serializes nested properties to JSON strings — parse them back
    const props={...f.properties};
    if(typeof props.tags==="string")try{props.tags=JSON.parse(props.tags);}catch{}
    if(typeof props.fpvBreakdown==="string")try{props.fpvBreakdown=JSON.parse(props.fpvBreakdown);}catch{}
    const parsed={...f,properties:props};
    setSelectedSpot(parsed);setSelectedZone(null);
    if(mapRef.current){const z=Math.max(14,mapRef.current.getZoom());mapRef.current.flyTo({center:f.geometry.coordinates,zoom:z,speed:1.2,essential:true});}
  },[]);
  const handleZoneClick=useCallback(f=>setSelectedZone(f),[]);
  const handleMapReady=useCallback(map=>{map.on("mousemove",e=>setCoords([e.lngLat.lng,e.lngLat.lat]));map.on("mouseleave",()=>setCoords(null));},[]);
  const handleSearch=useCallback(rOrU=>{setSearchCircle(prev=>{const next=typeof rOrU==="function"?rOrU(prev):rOrU;if(next)writeUrlParams({center:next.center,zoom:zoomForRadius(next.radiusMaxKm),radiusMin:next.radiusMinKm,radiusMax:next.radiusMaxKm,query:next.label||""});return next;});},[]);
  const handleClear=useCallback(()=>{setSearchCircle(null);writeUrlParams({});setDebugInfo(null);setScoreMin(0);},[]);

  const spotBadge=useMemo(()=>{if(loadingSpots)return"lädt…";if(filteredSpots.length>0)return`${filteredSpots.length} Spots`;return undefined;},[filteredSpots.length,loadingSpots]);
  const airspaceBadge=useMemo(()=>{const tot=airspaceFeatures.length+naturschutzFeatures.length;if(loadingAirspace||loadingNaturschutz)return"lädt…";if(tot>0)return`${tot} Zonen`;if(showAirspace||showNaturschutz)return"Aktiv";return undefined;},[airspaceFeatures.length,naturschutzFeatures.length,loadingAirspace,loadingNaturschutz,showAirspace,showNaturschutz]);
  const weatherBadge=useMemo(()=>{if(!selectedSpot)return undefined;if(loadingWeather)return"lädt…";if(weatherData){const a=computeWeatherAmpel(weatherData.current);return a==="green"?"✅ Gut":a==="yellow"?"⚠️ Prüfen":"🚫 Stop";}return undefined;},[selectedSpot,loadingWeather,weatherData]);
  const sunBadge=useMemo(()=>{const loc=selectedSpot||searchCircle;if(!loc)return undefined;try{const now=new Date(),lat=selectedSpot?selectedSpot.geometry.coordinates[1]:searchCircle.center[1],lng=selectedSpot?selectedSpot.geometry.coordinates[0]:searchCircle.center[0];const t=getSunTimes(now,lat,lng),s=getSunStatus(t,now);if(s.label==="Goldene Stunde")return"🌅 Jetzt!";if(s.label==="Tag"){const diff=Math.round((t.goldenEveningStart-now)/60000);return diff>0?`☀️ ${diff>60?Math.floor(diff/60)+"h ":""}${diff%60}min`:"☀️ Tag";}if(now<t.sunrise)return`🌙 Aufg. ${formatTime(t.sunrise)}`;}catch{}return undefined;},[selectedSpot,searchCircle]);

  const baseLabel=BASE_LAYERS.find(l=>l.id===activeBase)?.name??"—";
  const overlayCount=activeOverlays.length;
  const urlParams=useMemo(()=>readUrlParams(),[]);

  return(
    <>
      <div className="app-root">
        <header className="app-header">
          <button className="header-toggle" onClick={()=>setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen?"Sidebar schließen":"Sidebar öffnen"}>{sidebarOpen?<IconX/>:<IconMenu/>}</button>
          <div className="header-brand"><span className="brand-icon"><IconDrone/></span><span className="brand-text">FPV Spot Finder</span><span className="brand-tag">Alpha</span></div>
          <div className="header-layer-status">
            <span className="status-dot"/>
            <span>{baseLabel}</span>
            {overlayCount>0&&<span className="status-overlay-count">+{overlayCount}</span>}
            {filteredSpots.length>0&&<span className="status-overlay-count" style={{background:"rgba(34,211,167,.15)",color:"var(--accent)"}}>📍 {filteredSpots.length}</span>}
            {showHeatmap&&<span className="status-overlay-count" style={{background:"rgba(167,139,250,.15)",color:"#a78bfa"}}>🔥</span>}
            {activeOverlays.includes("fpvscore")&&filteredSpots.length>0&&<span className="status-overlay-count" style={{background:"rgba(167,139,250,.15)",color:"#a78bfa"}}>🚁 FPV</span>}
            {(airspaceFeatures.length>0||naturschutzFeatures.length>0)&&<span className="status-overlay-count" style={{background:"rgba(239,68,68,.15)",color:"#ef4444"}}>✈ {airspaceFeatures.length+naturschutzFeatures.length}</span>}
          </div>
          <div className="header-coords"><IconCompass/>{coords?<span className="coords-live">{coords[1].toFixed(4)}°N · {coords[0].toFixed(4)}°E</span>:<span>DACH · 47.5°N · 10.5°E</span>}</div>
        </header>
        <div className="app-body">
          {isMobile&&sidebarOpen&&<div className="mobile-overlay" onClick={()=>setSidebarOpen(false)}/>}
          <aside className={`app-sidebar ${sidebarOpen?"":"closed"}`}>
            <div className="sidebar-scroll">
              <SidebarSection icon={<IconSearch/>} title="Spot suchen" defaultOpen={true} badge={searchCircle?"Aktiv":undefined}>
                <SearchPanel onSearch={handleSearch} onClear={handleClear} hasResult={!!searchCircle} currentQuery={urlParams.query} onToast={showToast}/>
              </SidebarSection>
              <SidebarSection icon={<IconLayers/>} title="Karten-Layer" defaultOpen={false} badge={overlayCount>0?`${overlayCount} aktiv`:undefined}>
                <LayerPanel activeBase={activeBase} setActiveBase={setActiveBase} activeOverlays={activeOverlays} setActiveOverlays={setActiveOverlays} overlayOpacity={overlayOpacity} setOverlayOpacity={setOverlayOpacity} onToast={showToast}/>
              </SidebarSection>
              <SidebarSection icon={<IconFilter/>} title="Spot-Filter" defaultOpen={true} badge={spotBadge}>
                <SpotFilterPanel spots={spots} activeSpotTypes={activeSpotTypes} onToggle={toggleSpotType} onRefetch={()=>doFetchSpots(searchCircle)} loading={loadingSpots} hasSearch={!!searchCircle} debugInfo={debugInfo} scoreMin={scoreMin} onScoreMinChange={setScoreMin} showHeatmap={showHeatmap} onHeatmapToggle={()=>setShowHeatmap(v=>!v)} queryTypes={queryTypes} onQueryTypesChange={setQueryTypes} lastFetchedTypes={lastFetchedTypes} onRefetchWithTypes={types=>doFetchSpots(searchCircle,types)}/>
              </SidebarSection>
              <SidebarSection icon={<IconShield/>} title="Luftraum" defaultOpen={false} badge={airspaceBadge}>
                <AirspacePanel apiKey={airspaceKey} onSaveKey={handleSaveApiKey} showAirspace={showAirspace} onShowAirspaceToggle={()=>setShowAirspace(v=>!v)} showNaturschutz={showNaturschutz} onShowNaturschutzToggle={()=>setShowNaturschutz(v=>!v)} airspaceFeatures={airspaceFeatures} naturschutzFeatures={naturschutzFeatures} loadingAirspace={loadingAirspace} loadingNaturschutz={loadingNaturschutz} airspaceError={airspaceError} naturschutzError={naturschutzError} hasSearch={!!searchCircle} onFetchAirspace={doFetchAirspace} onFetchNaturschutz={doFetchNaturschutz}/>
              </SidebarSection>
              <SidebarSection icon={<IconTarget/>} title="Fly-or-No-Fly Check" badge={flyCheckResult?(flyCheckResult.verdict==="green"?"✅ OK":flyCheckResult.verdict==="yellow"?"⚠️ Prüfen":"🚫 Stop"):undefined}>
                <FlyCheckPanel selectedSpot={selectedSpot} flyCheckResult={flyCheckResult} airspaceLoaded={airspaceFeatures.length>0} naturschutzLoaded={naturschutzFeatures.length>0}/>
              </SidebarSection>
              <SidebarSection icon={<IconCloud/>} title="Wetter" badge={weatherBadge}>
                <WeatherPanel selectedSpot={selectedSpot} weatherData={weatherData} loading={loadingWeather} error={weatherError} onRefetch={()=>doFetchWeather(selectedSpot)}/>
              </SidebarSection>
              <SidebarSection icon={<IconSun/>} title="Sonnenstand" badge={sunBadge}>
                <SunPanel selectedSpot={selectedSpot} searchCircle={searchCircle}/>
              </SidebarSection>
            </div>
            <div className="sidebar-footer">FPV Spot Finder <span>v1.0</span> · Phase 12 · Spot-Detail & Share</div>
          </aside>
          <div className="map-area">
            <MapView mapRef={mapRef} mapContainerRef={mapContainerRef} activeBase={activeBase} activeOverlays={activeOverlays} overlayOpacity={overlayOpacity} onMapReady={handleMapReady} searchCircle={searchCircle} spots={filteredSpots} activeSpotTypes={activeSpotTypes} onSpotClick={handleSpotClick} showHeatmap={showHeatmap} airspaceFeatures={airspaceFeatures} naturschutzFeatures={naturschutzFeatures} showAirspace={showAirspace} showNaturschutz={showNaturschutz} onZoneClick={handleZoneClick}/>
            {selectedSpot&&<SpotDetailPanel spot={selectedSpot} onClose={()=>setSelectedSpot(null)} flyCheckResult={flyCheckResult} onToast={showToast}/>}
            {selectedZone&&<ZoneDetailPanel zone={selectedZone} onClose={()=>setSelectedZone(null)}/>}
          </div>
        </div>
      </div>
      {toast&&(<div className="toast-container"><Toast key={toast.id} message={toast.message} type={toast.type} onClose={()=>setToast(null)}/></div>)}
    </>
  );
}

// ── Wrapped Export with Error Boundary ─────────────────────────────────────
export default function App(){return(<ErrorBoundary><FPVSpotFinder/></ErrorBoundary>);}

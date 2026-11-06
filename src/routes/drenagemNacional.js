/**
 * Catálogo federado: pontos oficiais onde há serviços documentados e pontos
 * OpenStreetMap no restante do Brasil. Consultas por janela do mapa; não é
 * inventário nacional completo nem representa sensores ativos.
 */
const SERVIDORES_OSM = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const CAMADAS_OFICIAIS = [
  {
    nome:'Prefeitura de Juiz de Fora', id:'jf', bounds:[-43.51,-21.86,-43.25,-21.60],
    url:'https://sisurb.pjf.mg.gov.br/server/rest/services/sma_drenagem_pluvial_boca_lobo/MapServer/1/query',
    campo:'OBJECTID'
  },
  {
    nome:'SEDUH / Distrito Federal', id:'df', bounds:[-48.25,-16.05,-47.45,-15.55],
    url:'https://sisdia.df.gov.br/server/rest/services/02_CARACTERIZACAO/Boca_de_Lobo_CACHE/MapServer/0/query',
    campo:'objectid'
  },
  {
    nome:'Prefeitura de São José dos Pinhais', id:'sjp', bounds:[-49.36,-25.68,-49.11,-25.43],
    url:'https://geo.sjp.pr.gov.br/server/rest/services/Infraestrutura/Infraestrutura/MapServer/73/query',
    campo:'objectid'
  }
];
const cache = new Map();
let consultasOsmAtivas = 0;
const MAX_OSM_SIMULTANEAS = 2;
const emAndamento = new Map();
const validos = (a) => a.length === 4 && a.every(Number.isFinite);
export function validarBbox(raw) {
  const c = String(raw || '').split(',').map(Number);
  if (!validos(c)) return null;
  const [oeste, sul, leste, norte] = c;
  if (oeste >= leste || sul >= norte || leste - oeste > .16 || norte - sul > .16) return null;
  if (sul < -34.2 || norte > 6.5 || oeste < -74.5 || leste > -33.5) return null;
  return c.map(n => Math.round(n * 10000) / 10000);
}
const sobrepoe = (a,b) => a[2]>b[0] && a[0]<b[2] && a[3]>b[1] && a[1]<b[3];
async function consultarCamadaOficial(c, camada) {
  const [w,s,e,n] = c;
  const params = new URLSearchParams({
    f:'json', where:'1=1', outFields:camada.campo, returnGeometry:'true',
    outSR:'4326', inSR:'4326', geometryType:'esriGeometryEnvelope',
    spatialRel:'esriSpatialRelIntersects',
    geometry:JSON.stringify({xmin:w,ymin:s,xmax:e,ymax:n,spatialReference:{wkid:4326}}),
    resultRecordCount:'1500'
  });
  const response = await fetch(camada.url+'?'+params,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('ArcGIS HTTP '+response.status);
  const json = await response.json();
  if(json.error || !Array.isArray(json.features))throw new Error('Camada sem geometrias válidas');
  const elementos=[];
  for(const feature of json.features){
    const g=feature.geometry || {};
    // Algumas prefeituras publicam "Multipoint" em vez de "Point".
    const coords = Array.isArray(g.points) ? g.points : [[g.x,g.y]];
    coords.forEach(([lon,lat],i)=>{
      if(!Number.isFinite(lon)||!Number.isFinite(lat))return;
      elementos.push({
        id:camada.id+'-'+(feature.attributes?.[camada.campo] ?? feature.attributes?.OBJECTID ?? i)+'-'+i,
        lat,lon,origem:camada.nome,fonteTipo:'oficial',tipo:'boca_de_lobo',possuiSensor:false
      });
    });
  }
  return {elementos,parcial:Boolean(json.exceededTransferLimit)};
}
async function consultarOficiais(c) {
  const selecionadas=CAMADAS_OFICIAIS.filter(x=>sobrepoe(c,x.bounds));
  if(!selecionadas.length)return {elementos:[],parcial:false,erros:0};
  const result=await Promise.allSettled(selecionadas.map(x=>consultarCamadaOficial(c,x)));
  const ok=result.filter(x=>x.status==='fulfilled').map(x=>x.value);
  return {elementos:ok.flatMap(x=>x.elementos),parcial:ok.some(x=>x.parcial),
    erros:result.length-ok.length};
}

async function consultarOsm(c) {
  // Overpass é compartilhado: consultas paralelas demais causam timeout e
  // rate limiting, especialmente ao arrastar/centralizar o mapa rapidamente.
  if (consultasOsmAtivas >= MAX_OSM_SIMULTANEAS) {
    throw new Error('Servidor OSM ocupado, aproxime o mapa ou tente novamente');
  }
  consultasOsmAtivas++;
  try {
  const [w,s,e,n] = c;
  const b = [s,w,n,e].join(',');
  const query = '[out:json][timeout:18];(' +
    'node["manhole"="drain"](' + b + ');' +
    'node["manhole"="storm_drain"](' + b + ');' +
    'node["drain"="yes"](' + b + ');' +
    ');out body 1600;';
  let last;
  for (const url of SERVIDORES_OSM) {
    try {
      const response = await fetch(url, {
        method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'},
        body: new URLSearchParams({data:query}), signal:AbortSignal.timeout(11000)
      });
      if (!response.ok) throw new Error('Overpass HTTP ' + response.status);
      const json = await response.json();
      if (!Array.isArray(json.elements)) throw new Error('Sem lista de elementos');
      return { status:'sucesso', parcial:json.elements.length >= 1600,
        elementos:json.elements.filter(x => x.type === 'node' && Number.isFinite(x.lat) && Number.isFinite(x.lon))
          .slice(0,1600).map(x => ({
            id:'osm-' + x.id, lat:x.lat, lon:x.lon,
            tipo:x.tags?.manhole || 'dreno', origem:'OpenStreetMap',
            fonteTipo:'colaborativo', possuiSensor:false
          }))
      };
    } catch (err) { last = err; }
  }
  throw last || new Error('OSM indisponível');
  } finally { consultasOsmAtivas--; }
}

async function buscar(c) {
  const [oficial, osm] = await Promise.allSettled([consultarOficiais(c), consultarOsm(c)]);
  const fonteOficial = oficial.status === 'fulfilled' ? oficial.value : {elementos:[], erros:1};
  const fonteOsm = osm.status === 'fulfilled' ? osm.value : {status:'indisponivel',elementos:[]};
  // Se não há fonte oficial consultável para a área, o Overpass precisa ter
  // respondido de verdade. Falha externa não deve virar "zero bueiros".
  if (osm.status === 'rejected' && fonteOficial.elementos.length === 0) {
    return {status:'indisponivel', elementos:[], contagem:{oficiais:0,colaborativos:0},
      mensagem:'Serviço público OSM indisponível ou sobrecarregado. Não é possível determinar a existência de bueiros nesta área.'};
  }
  const todos = [...fonteOficial.elementos, ...fonteOsm.elementos];
  const unicos = [...new Map(todos.map(x => [x.id,x])).values()];
  return {status:oficial.status === 'rejected' || fonteOficial.erros > 0 || osm.status === 'rejected' ? 'parcial' : 'sucesso',
    elementos: unicos,
    contagem:{oficiais:fonteOficial.elementos.length,colaborativos:fonteOsm.elementos.length},
    cobertura:'parcial', parcial:Boolean(fonteOficial.parcial || fonteOsm.parcial),
    consultadoEm:new Date().toISOString(),
    fontes:['Prefeitura de Juiz de Fora (onde há cobertura)', 'SEDUH / Distrito Federal (onde há cobertura)', 'Prefeitura de São José dos Pinhais (onde há cobertura)', 'OpenStreetMap'],
    mensagem:'Cobertura parcial. A ausência de registros não comprova inexistência de bocas de lobo. Nenhum ponto implica sensor instalado.'};
}

export default async function rotasDrenagemNacional(app) {
  app.get('/brasil/drenagem-area', {
    schema: {
      tags:['Fontes externas'],
      summary:'Bocas de lobo georreferenciadas na área visível de qualquer município brasileiro',
      querystring:{
        type:'object', required:['bbox'], additionalProperties:false,
        properties:{bbox:{type:'string',maxLength:110}}
      }
    }
  }, async (req, reply) => {
    const c = validarBbox(req.query.bbox);
    if (!c) return reply.code(400).send({erro:'Área inválida ou grande demais. Aproxime o mapa para consultar os bueiros.'});
    const chave = c.join(',');
    const anterior = cache.get(chave);
    if (anterior && anterior.expira > Date.now()) return anterior.valor;
    if (emAndamento.has(chave)) return emAndamento.get(chave);
    const promise = buscar(c).then(valor => {
      cache.set(chave, {valor,expira:Date.now()+(valor.status === 'indisponivel' ? 60000 : 30*60000)});
      if(cache.size>150)cache.delete(cache.keys().next().value);
      return valor;
    }).finally(() => emAndamento.delete(chave));
    emAndamento.set(chave,promise);
    return promise;
  });
}

/**
 * Catálogo federado: pontos oficiais onde há serviços documentados e pontos
 * OpenStreetMap no restante do Brasil. Consultas por janela do mapa; não é
 * inventário nacional completo nem representa sensores ativos.
 */
const SERVIDORES_OSM = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const JUIZ_DE_FORA = 'https://sisurb.pjf.mg.gov.br/server/rest/services/sma_drenagem_pluvial_boca_lobo/MapServer/1/query';
const cache = new Map();
const emAndamento = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const validos = (a) => a.length === 4 && a.every(Number.isFinite);
export function validarBbox(raw) {
  const c = String(raw || '').split(',').map(Number);
  if (!validos(c)) return null;
  const [oeste, sul, leste, norte] = c;
  if (oeste >= leste || sul >= norte || leste - oeste > .16 || norte - sul > .16) return null;
  if (sul < -34.2 || norte > 6.5 || oeste < -74.5 || leste > -33.5) return null;
  return c.map(n => Math.round(n * 10000) / 10000);
}
const sobrepoeJF = ([w,s,e,n]) => e > -43.5 && w < -43.25 && n > -21.86 && s < -21.61;

async function consultarArcgis(c) {
  if (!sobrepoeJF(c)) return { elementos: [], ativo: false };
  const [w,s,e,n] = c;
  const params = new URLSearchParams({
    f: 'json', where: '1=1', outFields: 'OBJECTID', returnGeometry: 'true',
    outSR: '4326', inSR: '4326', geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    geometry: JSON.stringify({ xmin:w, ymin:s, xmax:e, ymax:n, spatialReference:{wkid:4326} }),
    resultRecordCount: '1500'
  });
  const response = await fetch(JUIZ_DE_FORA + '?' + params, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('ArcGIS HTTP ' + response.status);
  const json = await response.json();
  if (json.error || !Array.isArray(json.features)) throw new Error('Formato inválido da camada oficial');
  return {
    ativo: true, parcial: Boolean(json.exceededTransferLimit),
    elementos: json.features.filter(x => Number.isFinite(x.geometry?.x) && Number.isFinite(x.geometry?.y))
      .map(x => ({
        id: 'jf-' + (x.attributes?.OBJECTID ?? x.attributes?.objectid ?? x.geometry.x),
        lat: x.geometry.y, lon: x.geometry.x,
        origem: 'Prefeitura de Juiz de Fora', fonteTipo: 'oficial',
        tipo: 'boca_de_lobo', possuiSensor: false
      }))
  };
}

async function consultarOsm(c) {
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
}

async function buscar(c) {
  const [oficial, osm] = await Promise.allSettled([consultarArcgis(c), consultarOsm(c)]);
  const fonteOficial = oficial.status === 'fulfilled' ? oficial.value : {elementos:[], ativo:false};
  const fonteOsm = osm.status === 'fulfilled' ? osm.value : {status:'indisponivel',elementos:[]};
  if (oficial.status === 'rejected' && osm.status === 'rejected') {
    return {status:'indisponivel', elementos:[], contagem:{oficiais:0,colaborativos:0},
      mensagem:'Fontes indisponíveis. Nenhuma conclusão pode ser feita sobre a existência de bueiros.'};
  }
  const todos = [...fonteOficial.elementos, ...fonteOsm.elementos];
  const unicos = [...new Map(todos.map(x => [x.id,x])).values()];
  return {status:oficial.status === 'rejected' || osm.status === 'rejected' ? 'parcial' : 'sucesso',
    elementos: unicos,
    contagem:{oficiais:fonteOficial.elementos.length,colaborativos:fonteOsm.elementos.length},
    cobertura:'parcial', parcial:Boolean(fonteOficial.parcial || fonteOsm.parcial),
    consultadoEm:new Date().toISOString(),
    fontes:['Prefeitura de Juiz de Fora (área de cobertura)', 'OpenStreetMap'],
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

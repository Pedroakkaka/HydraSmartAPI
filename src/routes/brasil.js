import { FONTES_NACIONAIS, obterNivelBlumenau } from '../services/fontesBrasil.js';
import { catalogoMunicipios, sugestoesMunicipios } from '../services/buscaMunicipios.js';

const cacheMeteorologia = new Map();
const numeroDisponivel = v => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

async function consultarTempoLocal(lat, lon) {
  // Reduz precisão para ~100 m, evita registrar posição exata e amplia cache.
  const latitude = Math.round(lat * 1000) / 1000;
  const longitude = Math.round(lon * 1000) / 1000;
  const chave = latitude + ',' + longitude;
  const anterior = cacheMeteorologia.get(chave);
  if (anterior && Date.now() < anterior.expira) return anterior.dados;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('current', 'precipitation,weather_code');
  url.searchParams.set('hourly', 'precipitation,precipitation_probability');
  url.searchParams.set('forecast_hours', '6');
  url.searchParams.set('timezone', 'auto');
  const resposta = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!resposta.ok) throw new Error('Open-Meteo HTTP ' + resposta.status);
  const json = await resposta.json();
  const horas = (json.hourly?.time || []).slice(0, 6).map((horario, i) => ({
    horario,
    precipitacaoMm: numeroDisponivel(json.hourly?.precipitation?.[i]),
    probabilidadeChuvaPct: numeroDisponivel(json.hourly?.precipitation_probability?.[i])
  }));
  const valido = horas.filter(h => h.precipitacaoMm !== null);
  const total6h = valido.length ? Number(valido.reduce((acc, h) => acc + h.precipitacaoMm, 0).toFixed(1)) : null;
  const dados = {
    status: 'sucesso', fonte: 'Open-Meteo Forecast API',
    coordenadasAproximadas: { latitude, longitude },
    precipAtualMm: numeroDisponivel(json.current?.precipitation),
    previsao6hMm: total6h, horas, consultadoEm: new Date().toISOString(),
    interpretacao: total6h === null ? 'Sem previsão disponível' : total6h >= 30 ? 'Volume previsto elevado nas próximas 6 horas' : total6h >= 10 ? 'Chuva prevista nas próximas 6 horas' : 'Acumulado previsto baixo nas próximas 6 horas',
    aviso: 'Condição meteorológica estimada, não é probabilidade de alagamento, aviso oficial nem medição de bueiro.'
  };
  if (cacheMeteorologia.size > 150) cacheMeteorologia.delete(cacheMeteorologia.keys().next().value);
  cacheMeteorologia.set(chave, { dados, expira: Date.now() + 10 * 60_000 });
  return dados;
}


const cidadesCache = new Map();
const drenagemCache = new Map();
async function buscarCidades(nome) {
  const chave = nome.trim().toLowerCase();
  const anterior = cidadesCache.get(chave);
  if (anterior && anterior.expira > Date.now()) return anterior.resposta;
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', nome.trim());
  url.searchParams.set('count', '8');
  url.searchParams.set('language', 'pt');
  url.searchParams.set('countryCode', 'BR');
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Geocoding HTTP ' + res.status);
  const dados = await res.json();
  const cidades = (dados.results || []).filter(r => r.country_code === 'BR' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map(r => ({ id: r.id, nome: r.name, estado: r.admin1 || '', latitude: r.latitude, longitude: r.longitude }));
  const resposta = { status: 'sucesso', fonte: 'Open-Meteo Geocoding', cidades };
  if (cidadesCache.size > 60) cidadesCache.delete(cidadesCache.keys().next().value);
  cidadesCache.set(chave, { resposta, expira: Date.now() + 86400000 });
  return resposta;
}
async function consultarDrenagem(lat, lon) {
  // Consulta limitada ao entorno urbano, sem varredura nacional nem pontos fictícios.
  const latitude = Math.round(lat * 1000) / 1000;
  const longitude = Math.round(lon * 1000) / 1000;
  const chave = latitude + ',' + longitude;
  const anterior = drenagemCache.get(chave);
  if (anterior && anterior.expira > Date.now()) return anterior.resposta;
  const raioMetros = 2400;
  const consulta = '[out:json][timeout:18];(node["manhole"="drain"](around:' + raioMetros + ',' + latitude + ',' + longitude + ');node["manhole"="storm_drain"](around:' + raioMetros + ',' + latitude + ',' + longitude + ');node["drain"="yes"](around:' + raioMetros + ',' + latitude + ',' + longitude + '););out body 600;';
  const servidores = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  let ultimoErro;
  for (const servidor of servidores) {
    try {
      const res = await fetch(servidor, { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'HydraSmart/1.0 OSM drain viewer' },
        body: new URLSearchParams({ data: consulta }), signal: AbortSignal.timeout(12500) });
      if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
      const dados = await res.json();
      if (!Array.isArray(dados.elements)) throw new Error('Elementos OSM ausentes');
      const elementos = dados.elements.filter(e => e.type === 'node' && Number.isFinite(e.lat) && Number.isFinite(e.lon))
        .slice(0, 600).map(e => ({
          id: 'osm-' + e.id, lat: e.lat, lon: e.lon, tipo: e.tags?.manhole || 'dreno',
          origem: 'OpenStreetMap', possuiSensor: false
        }));
      const resposta = { status: 'sucesso', fonte: 'OpenStreetMap / Overpass',
        consultadoEm: new Date().toISOString(), raioMetros,
        parcial: dados.elements.length >= 600, elementos,
        mensagem: 'Dados colaborativos; não equivalem a cadastro completo nem a sensores instalados.' };
      if (drenagemCache.size > 100) drenagemCache.delete(drenagemCache.keys().next().value);
      drenagemCache.set(chave, { resposta, expira: Date.now() + 30 * 60000 });
      return resposta;
    } catch (err) { ultimoErro = err; }
  }
  throw ultimoErro || new Error('OSM indisponível');
}

export default async function rotasBrasil(app) {
  app.get('/brasil/cidades-sugestoes', {
    schema: { tags: ['Fontes externas'], querystring: {
      type: 'object', required: ['busca'], additionalProperties: false,
      properties: { busca: { type: 'string', minLength: 2, maxLength: 80 } }
    }}
  }, async (req, reply) => {
    try {
      const lista = await catalogoMunicipios();
      return { status: 'sucesso', fonte: 'IBGE Localidades',
        cidades: sugestoesMunicipios(lista, req.query.busca) };
    } catch (err) {
      req.log.warn({ mensagem: err.message }, 'Catálogo de municípios indisponível');
      return reply.code(503).send({ erro: 'Sugestões temporariamente indisponíveis.' });
    }
  });

  app.get('/brasil/cidades', {
    schema: { tags: ['Fontes externas'], querystring: {
      type: 'object', required: ['busca'], additionalProperties: false,
      properties: { busca: { type: 'string', minLength: 2, maxLength: 80 } }
    } }
  }, async (req, reply) => {
    try { return await buscarCidades(req.query.busca); }
    catch (err) { req.log.warn({ err }, 'Busca de municípios indisponível'); return reply.code(502).send({ erro: 'Busca de cidades temporariamente indisponível.' }); }
  });
  app.get('/brasil/drenagem', {
    schema: { tags: ['Fontes externas'], querystring: {
      type: 'object', required: ['latitude', 'longitude'], additionalProperties: false,
      properties: { latitude: { type: 'number', minimum: -34, maximum: 6 },
        longitude: { type: 'number', minimum: -74, maximum: -34 } }
    } }
  }, async (req) => {
    try { return await consultarDrenagem(req.query.latitude, req.query.longitude); }
    catch (err) {
      req.log.warn({ erro: err.message }, 'Consulta drenagem municipal indisponível');
      return { status: 'indisponivel', elementos: [], mensagem: 'OpenStreetMap indisponível. Não é possível determinar os bueiros cadastrados nessa cidade.' };
    }
  });

  app.get('/brasil/condicoes-locais', {
    schema: {
      tags: ['Fontes externas'],
      summary: 'Chuva atual e previsão de 6h para coordenadas aproximadas compartilhadas pelo usuário',
      querystring: {
        type: 'object', additionalProperties: false, required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -34, maximum: 6 },
          longitude: { type: 'number', minimum: -74, maximum: -34 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      return await consultarTempoLocal(req.query.latitude, req.query.longitude);
    } catch (erro) {
      req.log.warn({ mensagem: erro.message }, 'Falha em meteorologia local');
      return reply.code(502).send({ erro: 'Dados meteorológicos locais temporariamente indisponíveis.' });
    }
  });

  app.get('/brasil/fontes', {
    schema: { tags: ['Fontes externas'], summary: 'Catálogo de fontes oficiais hidrometeorológicas nacionais' }
  }, async () => ({
    status: 'sucesso',
    inmet: FONTES_NACIONAIS.inmet,
    blumenau: FONTES_NACIONAIS.blumenau,
    observacao: 'Produtos do INMET possuem diferentes periodicidades e nem todos oferecem acesso via API.'
  }));

  app.get('/brasil/blumenau/nivel-rio', {
    schema: { tags: ['Fontes externas'], summary: 'Leituras públicas do rio Itajaí-Açu, com data e indicação de atualização' }
  }, async () => obterNivelBlumenau());
}

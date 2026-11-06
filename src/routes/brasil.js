import { FONTES_NACIONAIS, obterNivelBlumenau } from '../services/fontesBrasil.js';

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

export default async function rotasBrasil(app) {
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

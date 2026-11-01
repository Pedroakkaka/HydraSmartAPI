/**
 * Dados de fontes externas (clima, CEMADEN, OpenStreetMap) e registros históricos oficiais.
 */

import { readFile } from 'node:fs/promises';

const registrosOficiais = JSON.parse(
  await readFile(new URL('../data/registrosOficiais.json', import.meta.url), 'utf8')
);

const queryForcar = {
  type: 'object',
  properties: { forcar: { type: 'boolean', default: false, description: 'Ignora o cache e consulta a fonte agora' } }
};

export default async function rotasExternas(app, { ctx }) {
  app.get('/clima', {
    schema: { tags: ['Fontes externas'], summary: 'Clima atual e previsão (Open-Meteo) para Porto Alegre-RS', querystring: queryForcar }
  }, async (req) => ctx.clima.obter({ forcar: req.query.forcar }));

  // Série meteorológica histórica de reanálise (não equivale a sensor local nem a nível de bueiro).
  // Intervalo limitado a 31 dias por consulta para reduzir consumo e tempo de resposta.
  app.get('/clima/historico', {
    schema: {
      tags: ['Fontes externas'],
      summary: 'Histórico meteorológico Open-Meteo para o município configurado',
      querystring: {
        type: 'object',
        required: ['inicio', 'fim'],
        additionalProperties: false,
        properties: {
          inicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}
    schema: { tags: ['Fontes externas'], summary: 'Dados da integração CEMADEN (estação ainda configurada para Cáceres)', querystring: queryForcar }
  }, async (req) => ctx.cemaden.obter({ forcar: req.query.forcar }));

  app.get('/bocas-de-lobo', {
    schema: { tags: ['Fontes externas'], summary: 'Cadastro oficial de bocas de lobo de Porto Alegre (SMAMUS)', querystring: { type: 'object', properties: { bbox: { type: 'string' }, forcar: { type: 'boolean', default: false } } } }
  }, async (req) => ctx.bocasLobo.obter({ bbox: req.query.bbox, forcar: req.query.forcar }));

  app.get('/osm/drenos', {
    schema: { tags: ['Fontes externas'], summary: 'Bueiros e drenos de Porto Alegre mapeados no OpenStreetMap', querystring: queryForcar }
  }, async (req) => ctx.osm.obterDrenos({ forcar: req.query.forcar }));

  app.get('/historico-oficial', {
    schema: { tags: ['Fontes externas'], summary: 'Registros históricos existentes (ainda referentes a Cáceres; não usar como histórico de Porto Alegre)' }
  }, async () => registrosOficiais);
}
 },
          fim: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}
    schema: { tags: ['Fontes externas'], summary: 'Dados da integração CEMADEN (estação ainda configurada para Cáceres)', querystring: queryForcar }
  }, async (req) => ctx.cemaden.obter({ forcar: req.query.forcar }));

  app.get('/bocas-de-lobo', {
    schema: { tags: ['Fontes externas'], summary: 'Cadastro oficial de bocas de lobo de Porto Alegre (SMAMUS)', querystring: { type: 'object', properties: { bbox: { type: 'string' }, forcar: { type: 'boolean', default: false } } } }
  }, async (req) => ctx.bocasLobo.obter({ bbox: req.query.bbox, forcar: req.query.forcar }));

  app.get('/osm/drenos', {
    schema: { tags: ['Fontes externas'], summary: 'Bueiros e drenos de Porto Alegre mapeados no OpenStreetMap', querystring: queryForcar }
  }, async (req) => ctx.osm.obterDrenos({ forcar: req.query.forcar }));

  app.get('/historico-oficial', {
    schema: { tags: ['Fontes externas'], summary: 'Registros históricos existentes (ainda referentes a Cáceres; não usar como histórico de Porto Alegre)' }
  }, async () => registrosOficiais);
}
 }
        }
      }
    }
  }, async (req, reply) => {
    const { inicio, fim } = req.query;
    const a = Date.parse(inicio + 'T00:00:00Z');
    const b = Date.parse(fim + 'T00:00:00Z');
    const hoje = Date.now() - 7 * 86400000;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || b > hoje || b - a > 30 * 86400000) {
      return reply.code(400).send({ erro: 'Informe datas válidas, com até 31 dias e término há pelo menos 7 dias.' });
    }
    const { latitude, longitude, timezone, nome } = ctx.config.municipio;
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude', latitude);
    url.searchParams.set('longitude', longitude);
    url.searchParams.set('start_date', inicio);
    url.searchParams.set('end_date', fim);
    url.searchParams.set('daily', 'precipitation_sum,temperature_2m_max,temperature_2m_min');
    url.searchParams.set('timezone', timezone);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let resposta;
      try { resposta = await fetch(url, { signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      const dados = await resposta.json();
      return {
        status: 'sucesso',
        fonte: 'Open-Meteo Historical Weather API',
        tipo: 'reanálise meteorológica histórica',
        municipio: nome,
        periodo: { inicio, fim },
        aviso: 'Dados históricos meteorológicos estimados por reanálise; não são medições de bueiros ou prova de alagamento.',
        diario: (dados.daily?.time || []).map((data, i) => ({
          data,
          precipitacaoMm: dados.daily.precipitation_sum?.[i] ?? null,
          temperaturaMaxC: dados.daily.temperature_2m_max?.[i] ?? null,
          temperaturaMinC: dados.daily.temperature_2m_min?.[i] ?? null
        }))
      };
    } catch (erro) {
      req.log.warn({ err: erro }, 'Falha na consulta histórica Open-Meteo');
      return reply.code(502).send({ erro: 'Não foi possível consultar o histórico meteorológico.' });
    }
  });

  app.get('/cemaden', {
    schema: { tags: ['Fontes externas'], summary: 'Dados da integração CEMADEN (estação ainda configurada para Cáceres)', querystring: queryForcar }
  }, async (req) => ctx.cemaden.obter({ forcar: req.query.forcar }));

  app.get('/bocas-de-lobo', {
    schema: { tags: ['Fontes externas'], summary: 'Cadastro oficial de bocas de lobo de Porto Alegre (SMAMUS)', querystring: { type: 'object', properties: { bbox: { type: 'string' }, forcar: { type: 'boolean', default: false } } } }
  }, async (req) => ctx.bocasLobo.obter({ bbox: req.query.bbox, forcar: req.query.forcar }));

  app.get('/osm/drenos', {
    schema: { tags: ['Fontes externas'], summary: 'Bueiros e drenos de Porto Alegre mapeados no OpenStreetMap', querystring: queryForcar }
  }, async (req) => ctx.osm.obterDrenos({ forcar: req.query.forcar }));

  app.get('/historico-oficial', {
    schema: { tags: ['Fontes externas'], summary: 'Registros históricos existentes (ainda referentes a Cáceres; não usar como histórico de Porto Alegre)' }
  }, async () => registrosOficiais);
}

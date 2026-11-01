/**
 * Dados de fontes externas (clima, CEMADEN, OpenStreetMap) e registros históricos oficiais.
 */

import { readFile } from 'node:fs/promises';

const registrosOficiais = JSON.parse(
  await readFile(new URL('../data/registrosOficiais.json', import.meta.url), 'utf8')
);


const DEFESA_CIVIL_URL = 'https://redehidrometeorologica.defesacivil.rs.gov.br/graphql';
const CONSULTA_ESTACOES = "query Tags_data {\n tags_data(clients: [\"casa-militar-defesa-civil-rs\"]) {\n  qualle_meteorologia {\n   codigo\n   name { prefix general local }\n   show\n   timestamp\n   position { bacia latitude longitude regiao altitude filtros { outros { crepdec { nome { value } codigo { value } } } } }\n   data {\n    rio {\n     rio_alarmes { inundacao { ativo { value } status { value } } }\n     rio_nome { value }\n     rio_nivel { value }\n     rio_nivel_tendencia { value }\n     rio_area_drenagem { value }\n     homologacao { relacao { valido { value } } }\n    }\n    chuva {\n     acumulado { min005 { value } h001 { value } h003 { value } h006 { value } h012 { value } h024 { value } h048 { value } h168 { value } }\n     homologacao { relacao { valido { value } } }\n    }\n    pressaoatmos { atual { value } historico { diaanterior { media { value } } diaatual { media { value } } } tendencia { value } homologacao { relacao { valido { value } } } }\n    senstermica { atual { value } historico { diaatual { media { value } } diaanterior { media { value } } } tendencia { value } homologacao { relacao { valido { value } } } }\n    radiacaosolar { atual { value } homologacao { relacao { valido { value } } } }\n    temperatura { atual { value } historico { diaanterior { media { value } } diaatual { media { value } maxima { value } minima { value } } } tendencia { value } homologacao { relacao { valido { value } } } }\n    umidade { atual { value } historico { diaanterior { media { value } } diaatual { media { value } } } tendencia { value } homologacao { relacao { valido { value } } } }\n    vento { direcao { value } velocidade_maxima { value } velocidade_media { value } homologacao { relacao { valido { value } } } }\n   }\n   type\n   filter { relacao { tem_chuva_acumulada tem_nivel_do_rio tem_pressao_atmosferica tem_sensacao_termica tem_umidade tem_vazao_do_rio tem_vento } }\n   resource { estacao { estado { manutencao { value } } } }\n  }\n  proximaAtualizacaoEm\n }\n}";
const CONSULTA_HISTORICO = "query Historic($stationCode: String!, $startDate: String!, $endDate: String!, $interval: QueryInterval) {\n historic(\n  system: Qualle_Hidrometeorologia\n  client: \"casa-militar-defesa-civil-rs\"\n  stationCode: $stationCode\n  startDate: $startDate\n  endDate: $endDate\n  interval: $interval\n  opts: { ordenacao: ASC }\n )\n}";
let cacheEstacoes = null;
let cacheAte = 0;

async function consultarDefesaCivil(query, variables) {
  const resposta = await fetch(DEFESA_CIVIL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
    signal: AbortSignal.timeout(12000)
  });
  if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
  const dados = await resposta.json();
  if (dados.errors?.length) throw new Error(dados.errors.map((e) => e.message).join('; '));
  return dados.data;
}

function numeroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function resumirEstacao(estacao) {
  const rio = estacao.data?.rio;
  const chuva = estacao.data?.chuva;
  const alarme = rio?.rio_alarmes?.inundacao;
  const estado = alarme?.ativo?.value === true ? Number(alarme.status?.value) : null;
  return {
    codigo: estacao.codigo,
    nome: [estacao.name?.prefix, estacao.name?.general, estacao.name?.local].filter(Boolean).join(' '),
    municipio: estacao.position?.filtros?.outros?.crepdec?.nome?.value ?? null,
    bacia: estacao.position?.bacia ?? null,
    latitude: numeroOuNulo(estacao.position?.latitude),
    longitude: numeroOuNulo(estacao.position?.longitude),
    horarioLeitura: estacao.timestamp,
    rio: rio ? {
      nome: rio.rio_nome?.value ?? null,
      nivelMetros: numeroOuNulo(rio.rio_nivel?.value),
      tendenciaMetros: numeroOuNulo(rio.rio_nivel_tendencia?.value),
      homologado: rio.homologacao?.relacao?.valido?.value ?? null,
      situacaoOficial: estado === null || ![0, 1, 2, 3].includes(estado) ? null : ['normalidade', 'atencao', 'alerta', 'inundacao'][estado]
    } : null,
    chuva: chuva ? {
      acumulado1hMm: numeroOuNulo(chuva.acumulado?.h001?.value),
      acumulado24hMm: numeroOuNulo(chuva.acumulado?.h024?.value),
      homologado: chuva.homologacao?.relacao?.valido?.value ?? null
    } : null,
    manutencao: estacao.resource?.estacao?.estado?.manutencao?.value ?? null
  };
}

const queryForcar = {
  type: 'object',
  properties: { forcar: { type: 'boolean', default: false, description: 'Ignora o cache e consulta a fonte agora' } }
};

export default async function rotasExternas(app, { ctx }) {
  app.get('/clima', {
    schema: { tags: ['Fontes externas'], summary: 'Clima atual e previsão (Open-Meteo) para Porto Alegre-RS', querystring: queryForcar }
  }, async (req) => ctx.clima.obter({ forcar: req.query.forcar }));

  app.get('/clima/historico', {
    schema: {
      tags: ['Fontes externas'],
      summary: 'Histórico meteorológico Open-Meteo do município configurado',
      querystring: {
        type: 'object',
        required: ['inicio', 'fim'],
        additionalProperties: false,
        properties: {
          inicio: { type: 'string', format: 'date' },
          fim: { type: 'string', format: 'date' }
        }
      }
    }
  }, async (req, reply) => {
    const { inicio, fim } = req.query;
    const a = Date.parse(inicio + 'T00:00:00Z');
    const b = Date.parse(fim + 'T00:00:00Z');
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || b > Date.now() - 7 * 86400000 || b - a > 30 * 86400000) {
      return reply.code(400).send({ erro: 'Informe período válido de até 31 dias, terminado há pelo menos 7 dias.' });
    }
    const { latitude, longitude, timezone, nome } = ctx.config.municipio;
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
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
        aviso: 'Não são medições de bueiros ou comprovação de alagamento.',
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


  app.get('/hidrologia/estacoes', {
    schema: { tags: ['Fontes externas'], summary: 'Estações oficiais da Defesa Civil RS (todas, sem filtro arbitrário por cidade)' }
  }, async (req, reply) => {
    try {
      if (!cacheEstacoes || Date.now() >= cacheAte) {
        const dados = await consultarDefesaCivil(CONSULTA_ESTACOES);
        if (!Array.isArray(dados?.tags_data?.qualle_meteorologia)) throw new Error('Formato inesperado');
        cacheEstacoes = {
          fonte: 'Defesa Civil do Rio Grande do Sul',
          urlFonte: DEFESA_CIVIL_URL,
          proximaAtualizacaoEm: dados.tags_data.proximaAtualizacaoEm ?? null,
          estacoes: dados.tags_data.qualle_meteorologia.map(resumirEstacao)
        };
        cacheAte = Date.now() + 300000;
      }
      return { status: 'sucesso', ...cacheEstacoes };
    } catch (erro) {
      req.log.warn({ err: erro }, 'Falha Defesa Civil RS');
      return reply.code(502).send({ erro: 'Consulta à Defesa Civil RS indisponível.', detalhe: erro.message });
    }
  });

  app.get('/hidrologia/historico', {
    schema: {
      tags: ['Fontes externas'],
      summary: 'Histórico oficial de uma estação da Defesa Civil RS (últimos 3 meses)',
      querystring: {
        type: 'object', additionalProperties: false, required: ['estacao', 'inicio', 'fim'],
        properties: {
          estacao: { type: 'string', pattern: '^[A-Za-z0-9-]{3,40}$' },
          inicio: { type: 'string' },
          fim: { type: 'string' },
          intervalo: { type: 'string', enum: ['MIN_5', 'MIN_10', 'HOUR_1', 'HOUR_3', 'HOUR_6', 'HOUR_12'], default: 'HOUR_1' }
        }
      }
    }
  }, async (req, reply) => {
    const { estacao, inicio, fim, intervalo } = req.query;
    const formato = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/;
    if (!formato.test(inicio) || !formato.test(fim)) {
      return reply.code(400).send({ erro: 'Use inicio e fim no formato AAAA-MM-DD HH:MM:SS (Brasília).' });
    }
    const a = Date.parse(inicio.replace(' ', 'T') + '-03:00');
    const b = Date.parse(fim.replace(' ', 'T') + '-03:00');
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || b > Date.now() || a < Date.now() - 92 * 86400000 || b - a > 31 * 86400000) {
      return reply.code(400).send({ erro: 'Período inválido: até 31 dias por consulta, dentro dos últimos 3 meses.' });
    }
    try {
      const dados = await consultarDefesaCivil(CONSULTA_HISTORICO, {
        stationCode: estacao, startDate: inicio, endDate: fim, interval: intervalo
      });
      return { status: 'sucesso', fonte: 'Defesa Civil do Rio Grande do Sul', estacao, intervalo, horario: 'Brasília', dados: dados?.historic ?? null };
    } catch (erro) {
      req.log.warn({ err: erro }, 'Falha histórico Defesa Civil RS');
      return reply.code(502).send({ erro: 'Histórico da Defesa Civil RS indisponível.', detalhe: erro.message });
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

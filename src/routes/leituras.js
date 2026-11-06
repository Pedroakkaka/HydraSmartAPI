import { timingSafeEqual } from 'node:crypto';
import { normalizarBueiroId } from '../core/calibration.js';
import { ORIGENS } from '../services/ingestService.js';

const filtrosPeriodo = {
  type: 'object',
  properties: {
    bueiroId: { type: 'string' },
    desde: { type: 'string', format: 'date-time', description: 'ISO 8601, ex.: 2026-10-30T00:00:00-04:00' },
    ate: { type: 'string', format: 'date-time' },
    limite: { type: 'integer', minimum: 1, maximum: 5000, default: 500 }
  }
};

function chaveConfere(recebida, esperada) {
  const a = Buffer.from(String(recebida ?? ''));
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function rotasLeituras(app, { ctx }) {
  app.get('/leituras', {
    schema: {
      tags: ['Leituras'],
      summary: 'Histórico de leituras reais gravadas no banco (mais recentes primeiro)',
      querystring: filtrosPeriodo
    }
  }, async (req) => {
    const { bueiroId, desde, ate, limite } = req.query;
    return ctx.repositorios.leituras.listar({
      bueiroId: bueiroId ? normalizarBueiroId(bueiroId) : undefined,
      desde,
      ate,
      limite
    });
  });

  app.get('/leituras/serie', {
    schema: {
      tags: ['Leituras'],
      summary: 'Série histórica agregada (média e máximo por intervalo) para gráficos',
      querystring: {
        type: 'object',
        required: ['desde'],
        properties: {
          bueiroId: { type: 'string' },
          desde: { type: 'string', format: 'date-time' },
          ate: { type: 'string', format: 'date-time' },
          intervaloSegundos: { type: 'integer', minimum: 10, maximum: 86400, default: 60 }
        }
      }
    }
  }, async (req, reply) => {
    const { bueiroId, desde, ate, intervaloSegundos } = req.query;
    const periodoMs = (ate ? new Date(ate) : new Date()) - new Date(desde);
    if (periodoMs / 1000 / intervaloSegundos > 5000) {
      return reply.code(400).send({ erro: 'Período longo demais para esse intervalo: aumente intervaloSegundos.' });
    }
    return ctx.repositorios.leituras.serie({
      bueiroId: bueiroId ? normalizarBueiroId(bueiroId) : undefined,
      desde,
      ate,
      intervaloSegundos
    });
  });


  // Ponte local Arduino → Render: entrada física experimental isolada.
  // Fail closed sem configuração, autenticação própria e nenhuma escrita na
  // tabela operacional de leituras reais (IngestService trata canal prototipo).
  app.post('/leituras/prototipo', {
    schema: {
      tags: ['Leituras'],
      summary: 'Ponte experimental do Arduino USB local; requer X-Prototype-Key e NÃO é leitura de campo',
      headers: { type: 'object', properties: { 'x-prototype-key': { type: 'string' } } },
      body: {
        type: 'object',
        required: ['bueiroId'],
        additionalProperties: false,
        properties: {
          bueiroId: { type: ['string', 'integer'] },
          distanciaCm: { type: 'number', minimum: 0, maximum: 10000 },
          nivelPct: { type: 'number', minimum: 0, maximum: 100, description: 'Percentual calculado para eletrodos de nível, sem sensor ultrassônico' },
          raw: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const esperada = ctx.config.prototypeIngestApiKey;
    if (!esperada) return reply.code(503).send({ erro: 'Ponte experimental desativada: configure PROTOTYPE_INGEST_API_KEY no servidor.' });
    if (!chaveConfere(req.headers['x-prototype-key'], esperada)) {
      return reply.code(401).send({ erro: 'Credencial da ponte experimental inválida.' });
    }
    if ((req.body.distanciaCm === undefined) === (req.body.nivelPct === undefined)) {
      return reply.code(400).send({ erro: 'Informe apenas um dos campos: distanciaCm ou nivelPct.' });
    }
    const resultado = await ctx.ingest.registrar({ ...req.body, origem: ORIGENS.ARDUINO_USB });
    if (!resultado.aceita) return reply.code(422).send({ erro: resultado.motivo });
    return reply.code(201).send({ aceita: true, canal: 'prototipo', natureza: 'experimental', bueiroId: resultado.leitura.bueiroId });
  });

  app.post('/leituras', {
    schema: {
      tags: ['Leituras'],
      summary: 'Recebe a leitura de um sensor em campo (ESP32, gateway 4G...). Exige o cabeçalho X-API-Key.',
      headers: { type: 'object', properties: { 'x-api-key': { type: 'string' } } },
      body: {
        type: 'object',
        required: ['bueiroId'],
        additionalProperties: false,
        properties: {
          bueiroId: { type: ['string', 'integer'], description: 'bueiro_1, bueiro_2, 1 ou 2' },
          distanciaCm: { type: 'number', description: 'Distância medida pelo sensor ultrassônico' },
          nivelPct: { type: 'number', description: 'Alternativa à distância: nível já em %' },
          raw: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const esperada = ctx.config.ingestApiKey;
    if (!esperada) {
      if (ctx.config.producao) {
        return reply.code(503).send({ erro: 'Recebimento via HTTP desativado: defina INGEST_API_KEY no servidor.' });
      }
    } else if (!chaveConfere(req.headers['x-api-key'], esperada)) {
      return reply.code(401).send({ erro: 'X-API-Key inválida ou ausente' });
    }

    const { distanciaCm, nivelPct } = req.body;
    if (distanciaCm === undefined && nivelPct === undefined) {
      return reply.code(400).send({ erro: 'Informe distanciaCm ou nivelPct' });
    }

    const resultado = await ctx.ingest.registrar({ ...req.body, origem: ORIGENS.HTTP });
    if (!resultado.aceita) return reply.code(422).send({ erro: resultado.motivo });
    return reply.code(201).send(resultado.leitura);
  });
}

import { normalizarBueiroId, coordenadasConfirmadas } from '../core/calibration.js';

const paramId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', description: 'bueiro_1 ou bueiro_2 (aceita também 1, 2, 01, 02)' } }
};

const comConfirmacao = (cfg) => ({ ...cfg, coordenadasConfirmadas: coordenadasConfirmadas(cfg) });

export default async function rotasBueiros(app, { ctx }) {
  const naoEncontrado = (reply) => reply.code(404).send({ erro: 'Bueiro não encontrado' });

  app.get('/bueiros', {
    schema: { tags: ['Bueiros'], summary: 'Lista os bueiros com calibração e última leitura ao vivo' }
  }, async () => {
    const snap = ctx.estado.snapshot();
    return Object.values(snap.bueiros);
  });

  app.get('/bueiros/:id', {
    schema: { tags: ['Bueiros'], summary: 'Detalhe de um bueiro', params: paramId }
  }, async (req, reply) => {
    const id = normalizarBueiroId(req.params.id);
    const b = id && ctx.estado.snapshot().bueiros[id];
    return b ?? naoEncontrado(reply);
  });

  app.put('/bueiros/:id/calibracao', {
    schema: {
      tags: ['Bueiros'],
      summary: 'Atualiza a calibração física do bueiro',
      params: paramId,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          alturaTotalCm: { type: 'number', minimum: 5, maximum: 500 },
          distanciaCegaCm: { type: 'number', minimum: 0, maximum: 100 },
          volumeTotalMl: { type: 'number', minimum: 100 },
          limiteAtencaoPct: { type: 'number', minimum: 10, maximum: 90 },
          limiteCriticoPct: { type: 'number', minimum: 15, maximum: 99 }
        }
      }
    }
  }, async (req, reply) => {
    return reply.code(403).send({ erro: 'Calibração física bloqueada no painel público. Apenas os parâmetros da simulação podem ser editados.' });
  });

  app.post('/bueiros/calibracao/restaurar', {
    schema: { tags: ['Bueiros'], summary: 'Restaura a calibração padrão dos dois bueiros (mantém coordenadas)' }
  }, async (req, reply) => reply.code(403).send({ erro: 'Restauração de calibração física desabilitada no painel público.' }));

  app.put('/bueiros/:id/coordenadas', {
    schema: {
      tags: ['Bueiros'],
      summary: 'Confirma a localização geográfica do bueiro',
      params: paramId,
      body: {
        type: 'object',
        required: ['latitude', 'longitude'],
        additionalProperties: false,
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 }
        }
      }
    }
  }, async (req, reply) => {
    const salvo = await ctx.calibracao.definirCoordenadas(req.params.id, req.body.latitude, req.body.longitude);
    return salvo ? comConfirmacao(salvo) : naoEncontrado(reply);
  });

  app.delete('/bueiros/:id/coordenadas', {
    schema: { tags: ['Bueiros'], summary: 'Remove a localização confirmada do bueiro', params: paramId }
  }, async (req, reply) => {
    const salvo = await ctx.calibracao.removerCoordenadas(req.params.id);
    return salvo ? comConfirmacao(salvo) : naoEncontrado(reply);
  });
}

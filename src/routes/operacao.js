/**
 * Rotas de operação: conexão serial, modo demonstração e alertas.
 */

import { CENARIOS } from '../services/simulator.js';
import { normalizarBueiroId, sanitizarParametros } from '../core/calibration.js';

const corpoCenario = {
  type: 'object',
  additionalProperties: false,
  properties: { cenario: { type: 'string', enum: CENARIOS.map((c) => c.id) } }
};

export default async function rotasOperacao(app, { ctx }) {
  // ---------------- Serial (Arduino USB) ----------------
  app.get('/serial', {
    schema: { tags: ['Serial'], summary: 'Status da conexão com o Arduino' }
  }, async () => ctx.estado.serial);

  app.get('/serial/portas', {
    schema: { tags: ['Serial'], summary: 'Lista as portas seriais do servidor' }
  }, async (req, reply) => {
    if (!ctx.config.serial.habilitada) return [];
    try {
      return await ctx.serial.listarPortas();
    } catch (err) {
      return reply.code(503).send({ erro: err.message });
    }
  });

  app.post('/serial/conectar', {
    schema: {
      tags: ['Serial'],
      summary: 'Conecta na porta informada (ou detecta o Arduino automaticamente)',
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          porta: { type: 'string', default: 'auto', description: 'auto, COM3, /dev/ttyUSB0...' },
          baudRate: { type: 'integer', enum: [9600, 115200], default: 115200 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      return await ctx.serial.conectar(req.body ?? {});
    } catch (err) {
      return reply.code(409).send({ erro: ctx.estado.serial.erroMensagem || err.message, serial: ctx.estado.serial });
    }
  });

  app.post('/serial/desconectar', {
    schema: { tags: ['Serial'], summary: 'Fecha a porta serial' }
  }, async () => {
    await ctx.serial.desconectar({ manual: true });
    return ctx.estado.serial;
  });

  // ---------------- Modo demonstração ----------------
  app.get('/simulacao/cenarios', {
    schema: { tags: ['Simulação'], summary: 'Cenários disponíveis no modo demonstração' }
  }, async () => CENARIOS);

  app.post('/simulacao/iniciar', {
    schema: { tags: ['Simulação'], summary: 'Liga o modo demonstração com o cenário escolhido', body: corpoCenario }
  }, async (req) => {
    await ctx.simulador.iniciar(req.body?.cenario);
    return ctx.snapshotCompleto();
  });

  app.put('/simulacao/cenario', {
    schema: { tags: ['Simulação'], summary: 'Troca o cenário', body: { ...corpoCenario, required: ['cenario'] } }
  }, async (req) => {
    await ctx.simulador.definirCenario(req.body.cenario);
    return ctx.estado.simulacao;
  });

  app.post('/simulacao/pausar', {
    schema: { tags: ['Simulação'], summary: 'Pausa ou retoma a simulação' }
  }, async () => {
    ctx.simulador.alternarPausa();
    return ctx.estado.simulacao;
  });

  app.post('/simulacao/reiniciar', {
    schema: { tags: ['Simulação'], summary: 'Reinicia o cenário atual a partir de níveis mais baixos' }
  }, async () => {
    await ctx.simulador.reiniciar();
    return ctx.estado.simulacao;
  });

  app.post('/simulacao/encerrar', {
    schema: { tags: ['Simulação'], summary: 'Desliga a demonstração e volta ao modo real' }
  }, async () => {
    await ctx.simulador.encerrar();
    return ctx.snapshotCompleto();
  });

  // ---------------- Receptor estritamente interno de testes ----------------
  app.get('/defesa-civil/simulador', {
    schema: { tags: ['Simulação'], summary: 'Recibos internos de alerta; nenhuma transmissão externa' }
  }, async () => ({
    simulacao: true,
    transmissaoExterna: false,
    registros: ctx.simuladorDefesaCivil?.listar() || []
  }));

  // Parâmetros exclusivos da simulação; nunca persistem no banco e jamais
  // alteram a calibração física ou o processamento do Arduino/HTTP.
  app.get('/simulacao/calibracao', async () => ({
    calibracoes: Object.fromEntries(Object.entries(ctx.estado.calibracoes).map(([id, cfg]) =>
      [id, { ...cfg, ...(ctx.ingest.calibracoesDemonstracao[id] || {}) }]
    )),
    natureza: 'somente_simulacao'
  }));

  app.put('/simulacao/calibracao/:id', {
    schema: {
      tags: ['Simulação'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object', additionalProperties: false,
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
    if (ctx.estado.modo !== 'demo' || !ctx.estado.simulacao.ativo) {
      return reply.code(403).send({ erro: 'Ajustes permitidos somente durante uma simulação ativa.' });
    }
    const id = normalizarBueiroId(req.params.id);
    if (!id || !ctx.estado.calibracoes[id]) return reply.code(404).send({ erro: 'Bueiro desconhecido.' });
    const atual = ctx.ingest.calibracoesDemonstracao[id] || ctx.estado.calibracoes[id];
    const cfg = sanitizarParametros(atual, req.body);
    ctx.ingest.calibracoesDemonstracao[id] = cfg;
    ctx.estado.emit('mudanca');
    return { ...cfg, natureza: 'somente_simulacao', persistido: false };
  });

  app.post('/simulacao/calibracao/restaurar', async (req, reply) => {
    if (ctx.estado.modo !== 'demo' || !ctx.estado.simulacao.ativo) {
      return reply.code(403).send({ erro: 'Ajustes permitidos somente durante uma simulação ativa.' });
    }
    ctx.ingest.calibracoesDemonstracao = {};
    ctx.estado.emit('mudanca');
    return { status: 'restaurado', natureza: 'somente_simulacao', persistido: false };
  });

  // ---------------- Alertas ----------------
  app.get('/alertas', {
    schema: {
      tags: ['Alertas'],
      summary: 'Histórico de alertas críticos',
      querystring: {
        type: 'object',
        properties: {
          ativos: { type: 'boolean', default: false },
          incluirSimulados: { type: 'boolean', default: false },
          limite: { type: 'integer', minimum: 1, maximum: 500, default: 100 }
        }
      }
    }
  }, async (req) => {
    const { ativos, incluirSimulados, limite } = req.query;
    return ctx.repositorios.alertas.listar({ apenasAtivos: ativos, incluirSimulados, limite });
  });

  app.post('/alertas/:id/reconhecer', {
    schema: {
      tags: ['Alertas'],
      summary: 'Registra que o operador viu o alerta',
      params: { type: 'object', properties: { id: { type: 'integer' } } }
    }
  }, async (req, reply) => {
    const alerta = await ctx.alertas.reconhecer(req.params.id);
    return alerta ?? reply.code(404).send({ erro: 'Alerta não encontrado' });
  });
}

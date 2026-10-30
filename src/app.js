/**
 * Monta a aplicação Fastify (sem abrir porta), para ser usada pelo servidor e pelos testes.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { registrarWebSocket } from './realtime/websocket.js';
import rotasSistema from './routes/sistema.js';
import rotasBueiros from './routes/bueiros.js';
import rotasLeituras from './routes/leituras.js';
import rotasOperacao from './routes/operacao.js';
import rotasExternas from './routes/externos.js';
import rotasRelatorios from './routes/relatorios.js';

/**
 * @param {object} ctx Contexto criado por criarContexto()
 * @param {{ logger?: import('pino').Logger | false }} [opcoes] Instância pino compartilhada, ou false nos testes
 */
export async function construirApp(ctx, { logger = false } = {}) {
  const app = Fastify({
    ...(logger ? { loggerInstance: logger } : { logger: false }),
    trustProxy: true,
    ajv: { customOptions: { coerceTypes: 'array', removeAdditional: false, allowUnionTypes: true } }
  });

  await app.register(helmet, {
    // A API não serve páginas, exceto o Swagger, que precisa de scripts inline.
    contentSecurityPolicy: false
  });

  await app.register(cors, {
    origin: ctx.config.corsOrigin.includes('*') ? true : ctx.config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'HydraSmart API',
        description: 'Monitoramento de drenagem urbana e prevenção de alagamentos — Cáceres-MT. ' +
          'Atualizações em tempo real pelo WebSocket em /ws.',
        version: '3.0.0'
      },
      components: {
        securitySchemes: { apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' } }
      }
    }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ erro: 'Dados inválidos', detalhes: err.validation.map((v) => `${v.instancePath || v.params?.missingProperty || ''} ${v.message}`.trim()) });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'erro inesperado');
    return reply.code(status).send({ erro: status >= 500 ? 'Erro interno no servidor' : err.message });
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ erro: `Rota não encontrada: ${req.method} ${req.url}` }));

  await registrarWebSocket(app, ctx);

  await app.register(async (api) => {
    for (const rotas of [rotasSistema, rotasBueiros, rotasLeituras, rotasOperacao, rotasExternas, rotasRelatorios]) {
      await api.register(rotas, { ctx });
    }
  }, { prefix: '/api/v1' });

  app.get('/', { schema: { hide: true } }, async () => ({
    plataforma: 'HydraSmart API',
    documentacao: '/docs',
    saude: '/api/v1/health',
    tempoReal: '/ws'
  }));

  return app;
}

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
import rotasIA from './routes/ia.js';

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
        description: 'Monitoramento de drenagem urbana e prevenção de alagamentos — Porto Alegre-RS. ' +
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

  // Proteção das rotas de escrita antes de disponibilizar a API via túnel HTTPS.
  // Chave de operador exclusiva do backend; nunca incluí-la no bundle público do React.
  const operatorKey = ctx.config.operatorApiKey;
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const isIngest = req.method === 'POST' && path === '/api/v1/leituras';
    if (!isMutation || isIngest || !path.startsWith('/api/v1/')) return;
    if (!operatorKey) return reply.code(503).send({ erro: 'Operações administrativas desabilitadas: configure OPERATOR_API_KEY no backend.' });
    const provided = req.headers['x-operator-key'];
    if (typeof provided !== 'string' || provided !== operatorKey) {
      return reply.code(401).send({ erro: 'Chave de operador necessária.' });
    }
  });

  // Limite básico adicional por endereço de origem; a rota também exige
  // autenticação de operador e ativação explícita no backend.
  const aiHits = new Map();
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/api/v1/ia/analisar') return;
    // Fail closed: uso pago exige chave de operador, flag explícita e chave do provedor.
    if (!ctx.config.enablePublicAi || !ctx.config.openAiApiKey) {
      return reply.code(503).send({ erro: 'Análise por IA está desativada ou sem configuração segura no servidor.' });
    }
    const now = Date.now();
    const key = req.ip;
    const prev = aiHits.get(key);
    const entry = prev && now - prev.start < 60000 ? prev : { start: now, count: 0 };
    entry.count++;
    aiHits.set(key, entry);
    if (aiHits.size > 2000) {
      for (const [ip, item] of aiHits) if (now - item.start >= 60000) aiHits.delete(ip);
    }
    if (entry.count > 5) return reply.code(429).send({ erro: 'Limite de análises atingido. Tente novamente em um minuto.' });
  });

  await registrarWebSocket(app, ctx);

  await app.register(async (api) => {
    for (const rotas of [rotasSistema, rotasBueiros, rotasLeituras, rotasOperacao, rotasExternas, rotasRelatorios, rotasIA]) {
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

import { timingSafeEqual } from 'node:crypto';

export default async function rotasSistema(app, { ctx }) {
  // Validação sem efeito colateral: permite selecionar a fonte no painel.
  app.get('/operador/validar', {
    schema: { tags: ['Sistema'], summary: 'Valida credenciais do operador para a seleção de modo' }
  }, async (req, reply) => {
    const esperada = ctx.config.operatorApiKey;
    const recebida = req.headers['x-operator-key'];
    if (!esperada) return reply.code(503).send({ erro: 'Chave de operador não configurada.' });
    const a = Buffer.from(typeof recebida === 'string' ? recebida : '');
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.code(401).send({ erro: 'Chave de operador incorreta.' });
    }
    reply.header('Cache-Control', 'no-store');
    return { autorizado: true };
  });

  app.get('/health', {
    schema: { tags: ['Sistema'], summary: 'Verificação de saúde (usada pelo Docker e pelo painel)' }
  }, async (req, reply) => {
    let bancoOk = false;
    try {
      bancoOk = await ctx.repositorios.verificarSaude();
    } catch {
      bancoOk = false;
    }
    const corpo = {
      status: bancoOk ? 'ok' : 'degradado',
      plataforma: 'HydraSmart API',
      versao: '3.0.0',
      municipio: ctx.config.municipio.nome,
      banco: ctx.repositorios.tipo === 'memoria' ? 'memoria (sem PostgreSQL)' : bancoOk ? 'postgres' : 'postgres indisponível',
      serial: ctx.estado.serial.habilitada ? (ctx.estado.serial.conectado ? 'conectado' : 'desconectado') : 'desativada',
      modo: ctx.estado.modo,
      uptimeSegundos: Math.round(process.uptime())
    };
    return reply.code(bancoOk ? 200 : 503).send(corpo);
  });

  app.get('/estado', {
    schema: { tags: ['Sistema'], summary: 'Estado completo ao vivo (o mesmo enviado pelo WebSocket /ws)' }
  }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    return ctx.snapshotCompleto();
  });
}

export default async function rotasSistema(app, { ctx }) {
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
  }, async () => ctx.snapshotCompleto());
}

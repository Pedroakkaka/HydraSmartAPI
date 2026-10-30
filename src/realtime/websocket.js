/**
 * Canal em tempo real (WebSocket em /ws).
 *
 * Mensagens enviadas ao painel (JSON):
 *   { tipo: 'estado', dados: <snapshot completo> }   — ao conectar e a cada mudança (máx. 4 por segundo)
 *   { tipo: 'alerta', dados: { acao, alerta } }       — imediatamente, para tocar a sirene no painel
 */

import websocket from '@fastify/websocket';

const INTERVALO_MINIMO_MS = 250;

export async function registrarWebSocket(app, ctx) {
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const clientes = new Set();
  let agendado = null;
  let ultimoEnvio = 0;

  const enviarParaTodos = (mensagem) => {
    const texto = JSON.stringify(mensagem);
    for (const socket of clientes) {
      if (socket.readyState === socket.OPEN) socket.send(texto);
    }
  };

  const transmitirEstado = () => {
    agendado = null;
    ultimoEnvio = Date.now();
    if (clientes.size) enviarParaTodos({ tipo: 'estado', dados: ctx.snapshotCompleto() });
  };

  const aoMudar = () => {
    if (agendado) return;
    const espera = Math.max(0, INTERVALO_MINIMO_MS - (Date.now() - ultimoEnvio));
    agendado = setTimeout(transmitirEstado, espera);
  };

  const aoAlertar = (evento) => {
    enviarParaTodos({ tipo: 'alerta', dados: evento });
    aoMudar();
  };

  ctx.estado.on('mudanca', aoMudar);
  ctx.alertas.on('alerta', aoAlertar);

  // Derruba conexões mortas (ex.: notebook que perdeu o Wi-Fi)
  const heartbeat = setInterval(() => {
    for (const socket of clientes) {
      if (socket.vivo === false) {
        socket.terminate();
        clientes.delete(socket);
        continue;
      }
      socket.vivo = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref?.();

  app.get('/ws', { websocket: true, schema: { hide: true } }, (socket) => {
    socket.vivo = true;
    clientes.add(socket);
    socket.on('pong', () => { socket.vivo = true; });
    socket.on('close', () => clientes.delete(socket));
    socket.send(JSON.stringify({ tipo: 'estado', dados: ctx.snapshotCompleto() }));
  });

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    clearTimeout(agendado);
    ctx.estado.off('mudanca', aoMudar);
    ctx.alertas.off('alerta', aoAlertar);
    for (const socket of clientes) socket.terminate();
  });

  return { totalClientes: () => clientes.size };
}

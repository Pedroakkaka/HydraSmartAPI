import { configuracaoPushValida, validarInscricao } from '../services/webPush.js';

const esquema = {
  type:'object', additionalProperties:false, required:['endpoint','keys'],
  properties: {
    endpoint:{ type:'string', maxLength:2048 },
    expirationTime:{type:['number','null']},
    keys:{
      type:'object', additionalProperties:false, required:['p256dh','auth'],
      properties:{
        p256dh:{type:'string', maxLength:200},
        auth:{type:'string', maxLength:100}
      }
    }
  }
};

// Rotas opt-in públicas: exigem HTTPS, Origin conhecido, formato restrito e
// limite de tentativas. Nunca expõem endpoints inscritos ou credenciais privadas.
export default async function rotasPush(app, { ctx }) {
  const contagem = new Map();
  const origemAceita = req => {
    const origem = req.headers.origin;
    if (!origem) return false;
    try {
      const url = new URL(origem);
      const autorizadas = ctx.config.corsOrigin;
      const localhost = /^https?:\/\/localhost(:\d+)?$/.test(url.origin) && !ctx.config.producao;
      const dominiosOficiais = [
        'https://hydrasmart-monitor.vercel.app',
        'https://hydra-smart-front.vercel.app'
      ];
      return localhost || autorizadas.includes(url.origin) || dominiosOficiais.includes(url.origin);
    } catch { return false; }
  };
  app.addHook('onRequest', async (req, reply) => {
    const caminho = req.url.split('?')[0];
    if (req.method !== 'POST' ||
        (!caminho.endsWith('/push/inscrever') && !caminho.endsWith('/push/cancelar'))) return;
    if (!origemAceita(req)) return reply.code(403).send({ erro:'Origem não autorizada' });
    const agora = Date.now();
    const anterior = contagem.get(req.ip);
    const atual = anterior && agora - anterior.inicio < 60000
      ? anterior : {inicio:agora, tentativas:0};
    atual.tentativas++;
    contagem.set(req.ip, atual);
    if (contagem.size > 3000) for (const [ip, entrada] of contagem) {
      if (agora - entrada.inicio > 60000) contagem.delete(ip);
    }
    if (atual.tentativas > 15) return reply.code(429).send({erro:'Tente novamente mais tarde'});
  });

  app.get('/push/publica', async () => ({
    disponivel: Boolean(ctx.webPush?.ativo),
    chavePublica: ctx.webPush?.ativo ? ctx.config.vapidPublicKey : null
  }));

  // Diagnóstico técnico protegido pela chave do operador; não aparece ao público.
  app.post('/push/testar', async (req, reply) => {
    if (!ctx.webPush?.ativo) return reply.code(503).send({ erro:'Web Push indisponível no servidor' });
    return { tipo:'simulacao', naoEmergencia:true, ...(await ctx.webPush.enviarTeste()) };
  });

  // Recibo gerado pelo Service Worker para cada notificação processada.
  app.post('/push/confirmar', {schema:{body:{
    type:'object',additionalProperties:false,required:['token'],
    properties:{token:{type:'string',pattern:'^[a-f0-9]{32}$'}}
  }}}, async req => ({
    confirmado: Boolean(ctx.webPush?.confirmarRecebimento(req.body.token))
  }));

  app.post('/push/resultado', {schema:{body:{
    type:'object',additionalProperties:false,required:['testeId'],
    properties:{testeId:{type:'string',pattern:'^[a-f0-9]{32}$'}}
  }}}, async (req, reply) => {
    const resumo = ctx.webPush?.consultarRecibo(req.body.testeId);
    if (!resumo) return reply.code(404).send({erro:'Teste expirado ou inexistente'});
    return resumo;
  });

  app.post('/push/inscrever', {schema:{body:esquema}}, async (req, reply) => {
    if (!configuracaoPushValida(ctx.config) || !ctx.webPush?.ativo) {
      return reply.code(503).send({erro:'Web Push indisponível no servidor'});
    }
    if (!validarInscricao(req.body)) return reply.code(400).send({erro:'Inscrição Push inválida'});
    await ctx.repositorios.pushInscricoes.salvar(req.body);
    return reply.code(201).send({inscrito:true, escopo:'somente_simulacao'});
  });

  app.post('/push/cancelar', {schema:{
    body:{type:'object',additionalProperties:false,required:['endpoint'],
      properties:{endpoint:{type:'string',maxLength:2048}}}
  }}, async (req, reply) => {
    const endpoint = req.body.endpoint;
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) {
      return reply.code(400).send({erro:'Inscrição inválida'});
    }
    await ctx.repositorios.pushInscricoes.remover(endpoint);
    return {inscrito:false};
  });
}

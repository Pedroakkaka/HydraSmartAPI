import { configuracaoPushValida, validarInscricao } from '../services/webPush.js';

const esquema = {
  type:'object', additionalProperties:false, required:['endpoint','keys'],
  properties: {
    endpoint:{ type:'string', maxLength:2048 },
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
      return localhost || autorizadas.includes(url.origin);
    } catch { return false; }
  };
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST' || !['/inscrever', '/cancelar'].includes(req.url.split('?')[0])) return;
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

  app.get('/publica', async () => ({
    disponivel: Boolean(ctx.webPush?.ativo),
    chavePublica: ctx.webPush?.ativo ? ctx.config.vapidPublicKey : null
  }));

  app.post('/inscrever', {schema:{body:esquema}}, async (req, reply) => {
    if (!configuracaoPushValida(ctx.config) || !ctx.webPush?.ativo) {
      return reply.code(503).send({erro:'Web Push indisponível no servidor'});
    }
    if (!validarInscricao(req.body)) return reply.code(400).send({erro:'Inscrição Push inválida'});
    await ctx.repositorios.pushInscricoes.salvar(req.body);
    return reply.code(201).send({inscrito:true, escopo:'somente_simulacao'});
  });

  app.post('/cancelar', {schema:{
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

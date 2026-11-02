import { createHash } from 'node:crypto';
import { coletarContextoIA } from '../services/iaFontes.js';
/**
 * Cloudflare Workers AI interpreta apenas dados e históricos do Core.
 * Nunca altera sensores, calibração, limiares ou alertas.
 */
async function gerarTextoIA(prompt, signal, config) {
  const { cloudflareAccountId, cloudflareApiToken, cloudflareAiModel } = config;
  if (!cloudflareAccountId || !cloudflareApiToken) {
    throw new Error('Cloudflare Workers AI não configurado.');
  }
  const url = 'https://api.cloudflare.com/client/v4/accounts/'
    + encodeURIComponent(cloudflareAccountId) + '/ai/run/' + cloudflareAiModel;
  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cloudflareApiToken
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'Você é um analista consultivo do HydraSmart. Não invente medições, previsões ou alertas.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1000
    }),
    signal
  });
  if (!resposta.ok) {
    const erro = new Error('Cloudflare HTTP ' + resposta.status);
    erro.statusCloudflare = resposta.status;
    throw erro;
  }
  const dados = await resposta.json();
  if (dados.success === false) throw new Error('Cloudflare recusou a solicitação.');
  const texto = dados.result?.response?.trim();
  if (!texto) throw new Error('A Cloudflare retornou uma resposta vazia.');
  return texto;
}
export default async function rotasIA(app, { ctx }) {
  // Relatório compartilhado: verifica fontes a cada 30 s e só gera texto quando elas mudam.
  // Memória de análises é volátil (reinício apaga); não é treinamento do modelo.
  let relatorioCache = null;
  let proximaTentativa = 0;
  let analisePendente = null;
  const analisesAnteriores = [];
  let testeCloudflareExecutado = false;
  let ultimaAssinaturaFontes = null;
  const INTERVALO_VERIFICACAO_MS = 30_000;

  // Teste manual: exige OPERATOR_API_KEY pelo hook global, flag específica e
  // permite no máximo uma chamada ao provedor por inicialização do servidor.
  app.post('/ia/testar-cloudflare', {
    schema: {
      tags: ['Inteligência artificial'],
      summary: 'Teste manual e limitado da conexão com Cloudflare Workers AI'
    }
  }, async (req, reply) => {
    if (!ctx.config.enableAiTest) {
      return reply.code(503).send({ erro: 'Teste de IA desativado. Configure ENABLE_AI_TEST=true apenas durante a validação.' });
    }
    if (!ctx.config.cloudflareAccountId || !ctx.config.cloudflareApiToken) {
      return reply.code(503).send({ erro: 'Credenciais Cloudflare ausentes no servidor.' });
    }
    if (testeCloudflareExecutado) {
      return reply.code(429).send({ erro: 'Teste já executado nesta inicialização. Desative ENABLE_AI_TEST após verificar o resultado.' });
    }
    testeCloudflareExecutado = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const analise = await gerarTextoIA('Responda em português brasileiro, em uma frase curta: conexão de teste HydraSmart estabelecida. Não analise riscos ou dados ambientais.', controller.signal, ctx.config);
      return { status: 'sucesso', provedor: 'cloudflare_workers_ai', resposta: analise, aviso: 'Teste de conectividade, sem dados reais ou previsão ambiental.' };
    } catch (erro) {
      req.log.warn({ statusCloudflare: erro.statusCloudflare ?? null, nome: erro.name }, 'Teste Cloudflare falhou');
      return reply.code(502).send({ status: 'erro', codigoCloudflare: erro.statusCloudflare ?? null, erro: erro.name === 'AbortError' ? 'Tempo limite excedido.' : 'Falha ao consultar a Cloudflare. Verifique credenciais, permissões e modelo.' });
    } finally {
      clearTimeout(timeout);
    }
  });
  app.get('/ia/relatorio', async (req) => {
    if (!ctx.config.enableAutomaticAi || !ctx.config.cloudflareApiToken) {
      return { status: 'indisponivel', mensagem: 'Análise automática por IA desativada ou sem configuração segura no servidor.' };
    }
    const agora = Date.now();
    if (relatorioCache && agora < proximaTentativa) return relatorioCache;
    if (analisePendente) return relatorioCache || { status: 'processando', mensagem: 'Análise em andamento.' };
    if (agora < proximaTentativa) return relatorioCache || { status: 'aguardando', mensagem: 'Aguardando próxima análise.' };
    proximaTentativa = agora + INTERVALO_VERIFICACAO_MS;
    analisePendente = (async () => {
      try {
        const contexto = await coletarContextoIA(app, ctx);
        const assinatura = createHash('sha256').update(JSON.stringify(contexto.fontes.map((f) => ({
          fonte: f.fonte, tipo: f.tipo, estacao: f.estacao,
          registros: f.registros
        })))).digest('hex');
        if (relatorioCache?.status === 'disponivel' && assinatura === ultimaAssinaturaFontes) {
          relatorioCache = { ...relatorioCache, verificadoEm: new Date().toISOString(), dadosAlterados: false, desatualizado: false };
          return;
        }
        if (!contexto.registrosConsultados) {
          relatorioCache = { status: 'sem_dados', mensagem: 'Nenhum dado real disponível nas fontes consultadas.', fontes: [], avisosFontes: contexto.avisos, registrosConsultados: 0 };
          return;
        }
        const prompt = [
          'Você é um analista consultivo de drenagem urbana em Porto Alegre, RS. Produza um relatório em português brasileiro de 2 a 4 parágrafos.',
          'Compare observações atuais com históricos disponíveis, identifique tendências e limitações. Cite estações, datas, fontes e unidades.',
          'Dados Open-Meteo históricos são reanálise, não leituras de pluviômetros. Níveis de estações regionais NÃO são níveis de bueiros.',
          'Não invente riscos, previsões, probabilidades, alarmes, leituras ausentes ou validações. Status oficial ausente não significa normalidade.',
          'Não trate medições de épocas diferentes como simultâneas. Não assuma que níveis de estações diferentes possuem a mesma referência altimétrica.',
          'A IA não altera o Core nem determina alertas. Histórico de relatórios não é treinamento ou aprendizado de pesos do modelo.',
          'Contexto real (JSON): ' + JSON.stringify(contexto.fontes).slice(0, 45000),
          'Relatórios anteriores (somente contexto, não fonte de medição): ' + JSON.stringify(analisesAnteriores).slice(0, 3500)
        ].join('\n');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const texto = await gerarTextoIA(prompt, controller.signal, ctx.config);
          const geradoEm = new Date().toISOString();
          relatorioCache = {
            status: 'disponivel', analise: texto, registrosConsultados: contexto.registrosConsultados,
            fontes: contexto.fontes.map((f) => ({ fonte: f.fonte, tipo: f.tipo, estacao: f.estacao ?? null, registros: f.registros.length })),
            avisosFontes: contexto.avisos, geradoEm,
            verificadoEm: geradoEm, dadosAlterados: true,
            memoriaAnalises: 'Contexto das últimas análises nesta execução do servidor; não há treinamento automático do modelo.',
            aviso: 'Análise consultiva de dados oficiais e históricos; não é previsão validada de alagamento.'
          };
          ultimaAssinaturaFontes = assinatura;
          analisesAnteriores.push({ geradoEm, resumo: texto.slice(0, 1100) });
          if (analisesAnteriores.length > 3) analisesAnteriores.shift();
        } finally { clearTimeout(timer); }
      } catch (erro) {
        req.log.warn({ err: erro }, 'Falha no relatório Cloudflare com fontes oficiais');
        const codigo = erro.statusCloudflare;
        const causa = codigo === 401 ? 'Token CLOUDFLARE_API_TOKEN inválido ou revogado.'
          : codigo === 429 ? 'Limite de uso ou créditos da Cloudflare atingidos.'
          : codigo === 403 ? 'Acesso ao modelo Cloudflare não autorizado.'
          : codigo === 400 ? 'A Cloudflare rejeitou a solicitação; verifique o modelo configurado.'
          : codigo >= 500 ? 'Serviço da Cloudflare temporariamente indisponível.'
          : erro.name === 'TimeoutError' || erro.name === 'AbortError' ? 'Tempo limite excedido na consulta.'
          : erro.message?.includes('resposta vazia') ? 'A Cloudflare retornou um texto vazio.'
          : 'Falha na consulta às fontes ou à Cloudflare; verifique o terminal do backend.';
        if (relatorioCache?.status === 'disponivel') {
          relatorioCache = { ...relatorioCache, desatualizado: true, avisoAtualizacao: causa };
        } else {
          relatorioCache = { status: 'erro', mensagem: causa, codigoCloudflare: codigo ?? null };
        }
        // Falhas usam intervalo maior para não insistir no provedor e nas fontes externas.
        proximaTentativa = Date.now() + 2 * 60_000;
      }
    })().finally(() => { analisePendente = null; });
    await analisePendente;
    return relatorioCache;
  });


  // Relatório generativo compartilhado: a mesma Cloudflare AI para os dois modos,
  // com dados selecionados somente pelo servidor e sem misturar fontes.
  const contextuais = new Map();
  const emAndamento = new Map();
  app.get('/ia/relatorio-contextual', {
    schema: {
      tags: ['Inteligência artificial'],
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { modo: { type: 'string', enum: ['prototipo', 'real'] } }
      }
    }
  }, async (req) => {
    const modo = req.query.modo === 'prototipo' ? 'prototipo' : 'real';
    const agora = Date.now();
    if (modo === 'prototipo') {
      const ativos = Object.values(ctx.snapshotCompleto().canais?.prototipo || {}).filter(b =>
        b?.valido === true && !b.desatualizado &&
        Number.isFinite(Number(b.timestamp)) &&
        Number(b.timestamp) <= agora + 5000 && agora - Number(b.timestamp) <= 15000
      );
      if (!ativos.length) return { status: 'sem_dados', modo, mensagem: 'Aguardando leituras recentes enviadas pelo Arduino.', fontes: [] };
    }
    if (!ctx.config.enableAutomaticAi || !ctx.config.cloudflareApiToken) {
      return { status: 'indisponivel', modo, mensagem: 'IA generativa desativada ou não configurada no servidor; análise do Core permanece ativa.', fontes: [] };
    }
    const cache = contextuais.get(modo);
    if (cache && agora < cache.expira) return cache.valor;
    if (emAndamento.has(modo)) return cache?.valor || { status: 'processando', modo, mensagem: 'Análise em andamento.' };
    const executar = (async () => {
      try {
        let fontes;
        if (modo === 'prototipo') {
          const canal = ctx.snapshotCompleto().canais?.prototipo || {};
          const registros = Object.values(canal).filter(b => b?.valido === true &&
            Number.isFinite(Number(b.timestamp)) && Date.now() - Number(b.timestamp) <= 15000 &&
            Number(b.timestamp) <= Date.now() + 5000).map(b => ({
            bueiroId: b.bueiroId, origem: 'Arduino USB / protótipo experimental',
            nivelPct: b.nivelPct, risco: b.risco, tendencia: b.tendencia,
            timestamp: b.timestamp, confiabilidadeTendencia: b.confiabilidadeTendencia
          }));
          fontes = [{ fonte: 'Arduino HydraSmart', tipo: 'leitura física experimental', registros }];
        } else {
          const contexto = await coletarContextoIA(app, ctx);
          fontes = contexto.fontes;
        }
        if (!fontes.some(f => f.registros?.length)) return { status: 'sem_dados', modo, mensagem: 'Aguardando dados válidos.', fontes: [] };
        const prompt = [
          'Atue como analista consultivo HydraSmart de Porto Alegre-RS.',
          'Interprete apenas os registros; o Core define riscos e alertas. Não invente previsões nem medições.',
          modo === 'prototipo'
            ? 'Estas medições são do protótipo físico, não de bueiros urbanos reais. Não atribua condições de Porto Alegre à bancada.'
            : 'São dados oficiais e de campo: não confunda nível de estação hidrológica com nível de bueiro.',
          'Descreva tendências observadas, dados disponíveis e limitações em até três parágrafos.',
          JSON.stringify(fontes).slice(0, 25000)
        ].join('\\n');
        const controlador = new AbortController();
        const timer = setTimeout(() => controlador.abort(), 20000);
        try {
          const analise = await gerarTextoIA(prompt, controlador.signal, ctx.config);
          const valor = { status: 'disponivel', modo, analise,
            geradoEm: new Date().toISOString(), fontes: fontes.map(f => ({
              fonte: f.fonte, tipo: f.tipo, registros: f.registros.length
            })),
            aviso: 'Análise consultiva, sem alteração de risco ou alertas.' };
          contextuais.set(modo, { valor, expira: Date.now() + 30 * 60_000 });
          return valor;
        } finally { clearTimeout(timer); }
      } catch (erro) {
        req.log.warn({ modo, err: erro }, 'Falha na IA contextual');
        const valor = { status: 'erro', modo, mensagem: 'Análise generativa temporariamente indisponível.' };
        contextuais.set(modo, { valor, expira: Date.now() + 60_000 });
        return valor;
      }
    })();
    emAndamento.set(modo, executar);
    try { return await executar; } finally { emAndamento.delete(modo); }
  });

  app.post('/ia/analisar', {
    schema: {
      tags: ['Inteligência artificial'],
      summary: 'Interpreta histórico de leituras calculadas pelo Core (sem modificar o sistema)',
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pergunta: { type: 'string', maxLength: 600 },
          bueiroId: { type: 'string', maxLength: 80 },
          limite: { type: 'integer', minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (req, reply) => {
    if (!ctx.config.cloudflareApiToken || !ctx.config.enablePublicAi) {
      return reply.code(503).send({ erro: 'Análise por IA está desativada ou sem configuração segura no servidor.' });
    }
    const { pergunta = 'Interprete as tendências observadas no histórico.', bueiroId, limite = 40 } = req.body || {};
    const leituras = await ctx.repositorios.leituras.listar({ ...(bueiroId ? { bueiroId } : {}), limite });
    const historico = Array.isArray(leituras) ? leituras : (leituras?.dados || leituras?.leituras || []);
    if (!historico.length) return reply.code(200).send({ analise: 'Ainda não há leituras reais suficientes no histórico para interpretar tendências ou avaliar possíveis alagamentos. O Core continua responsável pelos alertas em tempo real.', natureza: 'sem_dados', fonte: 'historico_core', registrosConsultados: 0, aviso: 'Sem dados reais, nenhuma previsão é apresentada.' });
    const prompt = [
      'Você é um assistente consultivo de monitoramento de drenagem urbana.',
      'O Core HydraSmart é a única autoridade para cálculos, medições e níveis de alerta.',
      'Não calcule nem redefina índices, riscos, médias ou limites; não invente números.',
      'Não afirme previsão de alagamento nem probabilidade numérica sem um modelo preditivo validado pelo Core. Você pode apontar sinais qualitativos e incertezas.',
      'Interprete somente os dados fornecidos, indique limitações e diferencie observações de hipóteses.',
      'Jamais apresente uma recomendação como alerta automático ou decisão operacional definitiva.',
      'Responda em português brasileiro, com concisão.',
      'Pergunta: ' + pergunta,
      'Histórico fornecido pelo Core (JSON): ' + JSON.stringify(historico).slice(0, 30000)
    ].join('\n');
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 15000);
    try {
      const analise = await gerarTextoIA(prompt, controlador.signal, ctx.config);
      return { analise, natureza: 'interpretacao_ia', fonte: 'historico_core', registrosConsultados: historico.length, aviso: 'Interpretação consultiva; o Core permanece responsável por cálculos e alertas.' };
    } catch (erro) {
      req.log.warn({ err: erro }, 'Falha ao consultar Cloudflare');
      return reply.code(502).send({ erro: 'Não foi possível consultar a IA agora.' });
    } finally { clearTimeout(timeout); }
  });
}

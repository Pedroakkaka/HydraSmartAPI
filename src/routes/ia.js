/**
 * OpenAI é consultiva: recebe somente históricos e resultados do Core.
 * Não altera sensores, calibração, limiares ou alertas.
 */
const MODELO = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
async function gerarTextoIA(prompt, signal) {
  const resposta = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: MODELO,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_completion_tokens: 1000
    }),
    signal
  });
  if (!resposta.ok) throw new Error('OpenAI indisponível: HTTP ' + resposta.status);
  const dados = await resposta.json();
  const texto = dados.choices?.[0]?.message?.content?.trim();
  if (!texto) throw new Error('A OpenAI retornou uma resposta vazia.');
  return texto;
}
export default async function rotasIA(app, { ctx }) {
  // Relatório automático: um único resultado em cache para todos os visitantes.
  // Nunca expõe a chave OpenAI; não gera chamadas repetidas por visitante.
  let relatorioCache = null;
  let proximaTentativa = 0;
  let analisePendente = null;
  app.get('/ia/relatorio', async (req, reply) => {
    if (process.env.ENABLE_AUTOMATIC_AI !== 'true' || !process.env.OPENAI_API_KEY) {
      return { status: 'indisponivel', mensagem: 'Relatório automático ainda não configurado no servidor.' };
    }
    const agora = Date.now();
    if (relatorioCache && agora < proximaTentativa) return relatorioCache;
    if (analisePendente) return relatorioCache || { status: 'processando', mensagem: 'Análise histórica em andamento.' };
    if (agora < proximaTentativa) return relatorioCache || { status: 'aguardando', mensagem: 'Aguardando próxima análise.' };
    proximaTentativa = agora + 15 * 60_000;
    analisePendente = (async () => {
      try {
        const registros = await ctx.repositorios.leituras.listar({ limite: 100 });
        const historico = Array.isArray(registros) ? registros : [];
        if (historico.length < 5) {
          relatorioCache = { status: 'sem_dados', mensagem: 'São necessárias pelo menos cinco leituras históricas para gerar um relatório.', registrosConsultados: historico.length };
          return;
        }
        const prompt = [
          'Você é um analista consultivo de drenagem urbana. Escreva um relatório original em português brasileiro, com 2 a 4 parágrafos.',
          'Analise somente as leituras históricas fornecidas, destacando tendências, anomalias, comparações e limitações.',
          'Não invente medições, probabilidades de alagamento, tempo de enchimento nem previsões numéricas não validadas.',
          'Diferencie observação de hipótese. Não modifique alertas ou regras do sistema.',
          'Leituras históricas (JSON): ' + JSON.stringify(historico).slice(0, 30000)
        ].join('\\n');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const texto = await gerarTextoIA(prompt, controller.signal);
          relatorioCache = { status: 'disponivel', analise: texto, registrosConsultados: historico.length, geradoEm: new Date().toISOString(), aviso: 'Interpretação automática; não constitui previsão validada de alagamento.' };
        } finally { clearTimeout(timer); }
      } catch (erro) {
        req.log.warn({ err: erro }, 'Falha no relatório automático');
        if (!relatorioCache) relatorioCache = { status: 'erro', mensagem: 'Não foi possível gerar o relatório agora.' };
      }
    })().finally(() => { analisePendente = null; });
    await analisePendente;
    return relatorioCache;
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
    const chave = process.env.OPENAI_API_KEY;
    if (!chave) return reply.code(503).send({ erro: 'IA indisponível: configure OPENAI_API_KEY no backend.' });
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
      const analise = await gerarTextoIA(prompt, controlador.signal);
      return { analise, natureza: 'interpretacao_ia', fonte: 'historico_core', registrosConsultados: historico.length, aviso: 'Interpretação consultiva; o Core permanece responsável por cálculos e alertas.' };
    } catch (erro) {
      req.log.warn({ err: erro }, 'Falha ao consultar OpenAI');
      return reply.code(502).send({ erro: 'Não foi possível consultar a IA agora.' });
    } finally { clearTimeout(timeout); }
  });
}

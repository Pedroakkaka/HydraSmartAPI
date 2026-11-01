/**
 * Gemini é consultivo: recebe somente históricos e resultados do Core.
 * Não altera sensores, calibração, limiares ou alertas.
 */
const MODELO = 'gemini-2.5-flash';
export default async function rotasIA(app, { ctx }) {
  // Relatório automático: um único resultado em cache para todos os visitantes.
  // Nunca expõe a chave Gemini; não gera chamadas repetidas por visitante.
  let relatorioCache = null;
  let proximaTentativa = 0;
  let analisePendente = null;
  app.get('/ia/relatorio', async (req, reply) => {
    if (process.env.ENABLE_AUTOMATIC_AI !== 'true' || !process.env.GEMINI_API_KEY) {
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
          const resposta = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODELO + ':generateContent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: 1000 } }),
            signal: controller.signal
          });
          if (!resposta.ok) throw new Error('Gemini retornou status ' + resposta.status);
          const dados = await resposta.json();
          const texto = dados.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\\n').trim();
          if (!texto) throw new Error('Resposta vazia');
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
    const chave = process.env.GEMINI_API_KEY;
    if (!chave) return reply.code(503).send({ erro: 'IA indisponível: configure GEMINI_API_KEY no backend.' });
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
      const resposta = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODELO + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1000 } }),
        signal: controlador.signal
      });
      if (!resposta.ok) {
        req.log.warn({ status: resposta.status }, 'Gemini indisponível');
        return reply.code(502).send({ erro: 'Serviço de IA temporariamente indisponível.' });
      }
      const dados = await resposta.json();
      const analise = dados.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim();
      if (!analise) return reply.code(502).send({ erro: 'A IA não retornou uma análise.' });
      return { analise, natureza: 'interpretacao_ia', fonte: 'historico_core', registrosConsultados: historico.length, aviso: 'Interpretação consultiva; o Core permanece responsável por cálculos e alertas.' };
    } catch (erro) {
      req.log.warn({ err: erro }, 'Falha ao consultar Gemini');
      return reply.code(502).send({ erro: 'Não foi possível consultar a IA agora.' });
    } finally { clearTimeout(timeout); }
  });
}

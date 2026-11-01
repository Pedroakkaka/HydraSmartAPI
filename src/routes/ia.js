import { coletarContextoIA } from '../services/iaFontes.js';
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
  // Relatório compartilhado, cache de 30 min e memória curta de análises.
  // Memória de análises é volátil (reinício apaga); não é treinamento do modelo.
  let relatorioCache = null;
  let proximaTentativa = 0;
  let analisePendente = null;
  const analisesAnteriores = [];
  app.get('/ia/relatorio', async (req) => {
    if (process.env.ENABLE_AUTOMATIC_AI !== 'true' || !process.env.OPENAI_API_KEY) {
      return { status: 'indisponivel', mensagem: 'Configure OPENAI_API_KEY e ENABLE_AUTOMATIC_AI=true no servidor.' };
    }
    const agora = Date.now();
    if (relatorioCache && agora < proximaTentativa) return relatorioCache;
    if (analisePendente) return relatorioCache || { status: 'processando', mensagem: 'Análise em andamento.' };
    if (agora < proximaTentativa) return relatorioCache || { status: 'aguardando', mensagem: 'Aguardando próxima análise.' };
    proximaTentativa = agora + 30 * 60_000;
    analisePendente = (async () => {
      try {
        const contexto = await coletarContextoIA(app, ctx);
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
        ].join('\\n');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const texto = await gerarTextoIA(prompt, controller.signal);
          const geradoEm = new Date().toISOString();
          relatorioCache = {
            status: 'disponivel', analise: texto, registrosConsultados: contexto.registrosConsultados,
            fontes: contexto.fontes.map((f) => ({ fonte: f.fonte, tipo: f.tipo, estacao: f.estacao ?? null, registros: f.registros.length })),
            avisosFontes: contexto.avisos, geradoEm,
            memoriaAnalises: 'Contexto das últimas análises nesta execução do servidor; não há treinamento automático do modelo.',
            aviso: 'Análise consultiva de dados oficiais e históricos; não é previsão validada de alagamento.'
          };
          analisesAnteriores.push({ geradoEm, resumo: texto.slice(0, 1100) });
          if (analisesAnteriores.length > 3) analisesAnteriores.shift();
        } finally { clearTimeout(timer); }
      } catch (erro) {
        req.log.warn({ err: erro }, 'Falha no relatório OpenAI com fontes oficiais');
        relatorioCache = { status: 'erro', mensagem: 'Não foi possível gerar a análise agora. Verifique as fontes e a configuração da OpenAI.' };
        proximaTentativa = Date.now() + 5 * 60_000;
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

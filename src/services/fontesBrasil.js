/**
 * Integração consultiva com fontes públicas oficiais de Blumenau e INMET.
 * Nunca transforma cotas de inundação em medições ao vivo nem cria alertas.
 */
export const FONTES_NACIONAIS = Object.freeze({
  inmet: {
    nome: 'Instituto Nacional de Meteorologia (INMET)',
    anomaliaMensal: 'https://clima.inmet.gov.br/prec',
    servicoAnomalia: 'https://portal.inmet.gov.br/servicos/desvio-de-chuva-mensal',
    historico: 'https://bdmep.inmet.gov.br/',
    portal: 'https://portal.inmet.gov.br/',
    aviso: 'Anomalia mensal é retrospectiva, não previsão de alagamento.'
  },
  blumenau: {
    nivel: 'https://defesacivil.blumenau.sc.gov.br/d/nivel-do-rio',
    inundacao: 'https://defesacivil.blumenau.sc.gov.br/m/inundacao',
    aviso: 'O mapa de cotas de inundação é consultivo e não indica a extensão de uma cheia atual.'
  }
});

const URL_RIO = FONTES_NACIONAIS.blumenau.nivel;
const TTL = 5 * 60_000;
let cache = null;
let expiraEm = 0;
let pendente = null;

const textoLimpo = (s) => s
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

export function interpretarTabelaNivel(html, agora = Date.now()) {
  if (typeof html !== 'string' || html.length > 2_000_000) return [];
  const registros = [];
  const linhas = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const linha of linhas) {
    const colunas = [...linha.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((x) => textoLimpo(x[1]));
    if (colunas.length < 2) continue;
    const data = colunas[0].match(/\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\b/);
    if (!data) continue;
    const [,dia,mes,ano,hora,minuto] = data;
    const isoLocal = `${ano}-${mes}-${dia}T${hora}:${minuto}:00-03:00`;
    const timestamp = Date.parse(isoLocal);
    const nivel = Number(colunas[1].replace(',', '.').replace(/[^\d.-]/g, ''));
    const variacao = colunas[2] && /^[+-]?\d+(?:[,.]\d+)?$/.test(colunas[2])
      ? Number(colunas[2].replace(',', '.')) : null;
    if (!Number.isFinite(timestamp) || timestamp > agora + 10 * 60_000 ||
        !Number.isFinite(nivel) || nivel < 0 || nivel > 40) continue;
    registros.push({ horario: new Date(timestamp).toISOString(), nivelMetros: nivel,
      variacaoMetros: Number.isFinite(variacao) ? variacao : null });
  }
  return registros.sort((a,b) => b.horario.localeCompare(a.horario)).slice(0, 48);
}

export async function obterNivelBlumenau({ agora = Date.now(), fetcher = fetch } = {}) {
  if (cache && agora < expiraEm) return cache;
  if (pendente) return pendente;
  pendente = (async () => {
    try {
      const resposta = await fetcher(URL_RIO, {
        headers: { accept: 'text/html', 'user-agent': 'HydraSmart/1.0 (consulta de fonte pública)' },
        signal: AbortSignal.timeout(10000)
      });
      if (!resposta.ok) throw new Error('Fonte HTTP ' + resposta.status);
      const html = await resposta.text();
      const leituras = interpretarTabelaNivel(html, Date.now());
      if (!leituras.length) throw new Error('Tabela de leituras ausente ou formato incompatível');
      const ultima = leituras[0];
      // O dado só pode receber status atual se a fonte informar hora recente.
      const idadeMinutos = Math.max(0, Math.round((Date.now() - Date.parse(ultima.horario)) / 60000));
      cache = {
        status: idadeMinutos <= 180 ? 'sucesso' : 'desatualizado',
        fonte: 'Defesa Civil de Blumenau / AlertaBlu',
        municipio: 'Blumenau - SC', rio: 'Itajaí-Açu',
        horarioUltimaLeitura: ultima.horario, idadeMinutos,
        ultimaLeitura: ultima, leituras,
        consultadoEm: new Date().toISOString(),
        nivelFonte: URL_RIO, inundacaoFonte: FONTES_NACIONAIS.blumenau.inundacao,
        aviso: 'Leituras do rio não são leituras de bueiros. Mapa de inundação é consultivo e requer consulta à fonte oficial.'
      };
      expiraEm = Date.now() + TTL;
      return cache;
    } catch (erro) {
      expiraEm = Date.now() + 60_000;
      if (cache?.leituras?.length) {
        cache = { ...cache, status: 'desatualizado',
          aviso: 'Fonte indisponível; exibindo a última consulta em cache, não representa o nível atual.' };
        return cache;
      }
      return {
        status: 'indisponivel', municipio: 'Blumenau - SC',
        fonte: 'Defesa Civil de Blumenau / AlertaBlu',
        nivelFonte: URL_RIO, inundacaoFonte: FONTES_NACIONAIS.blumenau.inundacao,
        ultimaLeitura: null, leituras: [],
        aviso: 'Sem dados verificáveis nesta consulta; acesse a fonte oficial. Não usar para emitir alertas.'
      };
    }
  })();
  try { return await pendente; } finally { pendente = null; }
}

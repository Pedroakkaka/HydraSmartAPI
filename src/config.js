/**
 * Configuração centralizada, lida das variáveis de ambiente (.env em desenvolvimento,
 * variáveis do container em produção). Nenhum segredo fica no código.
 */

const bool = (v, padrao) => (v === undefined || v === '' ? padrao : ['1', 'true', 'sim', 'yes'].includes(String(v).toLowerCase()));
const int = (v, padrao) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : padrao);

export function carregarConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const producao = nodeEnv === 'production';

  return {
    nodeEnv,
    producao,
    host: env.HOST || '0.0.0.0',
    port: int(env.PORT, 3333),
    logLevel: env.LOG_LEVEL || (producao ? 'info' : 'debug'),

    // Lista separada por vírgula. "*" libera qualquer origem (apenas para desenvolvimento).
    corsOrigin: (env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),

    banco: {
      url: env.DATABASE_URL || 'postgres://hydrasmart:hydrasmart@localhost:5433/hydrasmart',
      // Em desenvolvimento a API sobe mesmo sem banco (dados só em memória), para a demonstração não parar.
      permitirFallbackMemoria: bool(env.DB_FALLBACK_MEMORIA, !producao)
    },

    serial: {
      habilitada: bool(env.SERIAL_ENABLED, true),
      // "auto" procura uma placa Arduino/CH340/FTDI; também aceita "COM3", "/dev/ttyUSB0"...
      porta: env.SERIAL_PORT || 'auto',
      baudRate: int(env.SERIAL_BAUD, 115200),
      reconectarAutomaticamente: bool(env.SERIAL_AUTO_RECONNECT, true),
      timeoutDadosObsoletosMs: int(env.SERIAL_STALE_MS, 8000)
    },

    // Chave exigida no POST /api/v1/leituras (sensores em campo enviando via HTTP).
    ingestApiKey: env.INGEST_API_KEY || '',
    operatorApiKey: env.OPERATOR_API_KEY || '',
    // Cloudflare Workers AI: credenciais apenas no backend.
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID || '',
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN || '',
    cloudflareAiModel: env.CLOUDFLARE_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    // Compatibilidade temporária até migrar src/routes/ia.js para Cloudflare.
    openAiApiKey: env.OPENAI_API_KEY || '',
    openAiModel: env.OPENAI_MODEL || 'gpt-4.1-mini',
    enableAutomaticAi: bool(env.ENABLE_AUTOMATIC_AI, false),
    enablePublicAi: bool(env.ENABLE_PUBLIC_AI, false),
    cemadenToken: env.CEMADEN_JWT_TOKEN || env.CEMADEN_TOKEN || '',
    cemadenEmail: env.CEMADEN_EMAIL || '',
    cemadenSenha: env.CEMADEN_PASSWORD || '',

    municipio: {
      nome: env.MUNICIPIO_NOME || 'Porto Alegre - RS',
      latitude: Number(env.MUNICIPIO_LATITUDE ?? -30.0346),
      longitude: Number(env.MUNICIPIO_LONGITUDE ?? -51.2177),
      timezone: env.MUNICIPIO_TIMEZONE || 'America/Sao_Paulo'
    },

    historicoMemoriaAmostras: 50
  };
}

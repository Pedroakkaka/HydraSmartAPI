/**
 * Ponto de entrada da API.
 * 1. Conecta no PostgreSQL e aplica as migrações (ou cai para memória em desenvolvimento).
 * 2. Monta os serviços, abre a porta HTTP e inicia a leitura serial do Arduino.
 * 3. Encerra tudo com segurança em Ctrl+C / docker stop.
 */

import pino from 'pino';
import { carregarConfig } from './config.js';
import { criarPool } from './db/pool.js';
import { aplicarMigracoes } from './db/migrate.js';
import { criarRepositoriosPostgres } from './repositories/postgres.js';
import { criarRepositoriosMemoria } from './repositories/memoria.js';
import { criarContexto } from './container.js';
import { construirApp } from './app.js';

const config = carregarConfig();
const log = pino({
  level: config.logLevel,
  // Em desenvolvimento, logs coloridos e legíveis; em produção, JSON (para ferramentas de log).
  ...(config.producao ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } })
});

async function prepararRepositorios() {
  const pool = criarPool(config.banco.url);
  try {
    await aplicarMigracoes(pool, log);
    log.info('[banco] PostgreSQL conectado e atualizado');
    return criarRepositoriosPostgres(pool);
  } catch (err) {
    await pool.end().catch(() => {});
    if (!config.banco.permitirFallbackMemoria) throw err;
    log.warn('==================================================================');
    log.warn(`[banco] PostgreSQL indisponível (${err.code || err.message || 'sem resposta'}).`);
    log.warn('[banco] Rodando com dados SOMENTE EM MEMÓRIA — nada será salvo.');
    log.warn('[banco] Para usar o banco: `npm run db:up` e reinicie a API.');
    log.warn('==================================================================');
    return criarRepositoriosMemoria();
  }
}

async function iniciar() {
  const repositorios = await prepararRepositorios();
  const ctx = await criarContexto({ config, repositorios, log });
  const app = await construirApp(ctx, { logger: log });

  await app.listen({ host: config.host, port: config.port });
  log.info(`HydraSmart API em http://localhost:${config.port}  •  documentação: http://localhost:${config.port}/docs`);

  // Serial não bloqueia a subida da API: se o Arduino não estiver plugado, tenta de novo sozinho.
  ctx.serial.iniciar().catch((err) => log.warn(`[serial] ${err.message}`));

  let encerrando = false;
  const encerrar = async (sinal) => {
    if (encerrando) return;
    encerrando = true;
    log.info(`[api] ${sinal} recebido, encerrando...`);
    try {
      await app.close();
      await ctx.encerrar();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
}

iniciar().catch((err) => {
  log.fatal({ err }, 'Falha ao iniciar a API');
  process.exit(1);
});

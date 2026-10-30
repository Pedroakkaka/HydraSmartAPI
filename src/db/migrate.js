/**
 * Executor de migrações SQL.
 * Aplica, em ordem alfabética, os arquivos de src/db/migrations que ainda não rodaram.
 * Cada arquivo roda dentro de uma transação. Pode ser executado direto: `npm run db:migrate`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { criarPool } from './pool.js';
import { carregarConfig } from '../config.js';

const PASTA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function aplicarMigracoes(pool, log = console) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nome TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query('SELECT nome FROM schema_migrations');
  const aplicadas = new Set(rows.map((r) => r.nome));
  const arquivos = (await readdir(PASTA)).filter((f) => f.endsWith('.sql')).sort();

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = await readFile(path.join(PASTA, arquivo), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
      await client.query('COMMIT');
      log.info(`[migracao] aplicada: ${arquivo}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Falha na migração ${arquivo}: ${err.message}`, { cause: err });
    } finally {
      client.release();
    }
  }
}

// Execução direta pela linha de comando
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = carregarConfig();
  const pool = criarPool(config.banco.url);
  aplicarMigracoes(pool)
    .then(() => console.log('[migracao] banco atualizado.'))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

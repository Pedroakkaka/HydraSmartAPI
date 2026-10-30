import pg from 'pg';

// NUMERIC chega como string no driver pg; converte para número (precisão suficiente para este domínio).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));
// BIGINT (ids) como número.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));

export function criarPool(url) {
  return new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}

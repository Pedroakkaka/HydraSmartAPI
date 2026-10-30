/**
 * Repositórios PostgreSQL. Toda a SQL da aplicação fica aqui.
 * A interface é a mesma de ./memoria.js, para que serviços e testes não dependam do banco.
 */

import { CALIBRACAO_PADRAO } from '../core/calibration.js';

const mapBueiro = (r) => ({
  id: r.id,
  codigoCurto: r.codigo_curto,
  nome: r.nome,
  pinoTrig: r.pino_trig,
  pinoEcho: r.pino_echo,
  alturaTotalCm: r.altura_total_cm,
  distanciaCegaCm: r.distancia_cega_cm,
  volumeTotalMl: r.volume_total_ml,
  limiteAtencaoPct: r.limite_atencao_pct,
  limiteCriticoPct: r.limite_critico_pct,
  latitude: r.latitude,
  longitude: r.longitude,
  atualizadoEm: r.atualizado_em
});

const mapLeitura = (r) => ({
  id: r.id,
  bueiroId: r.bueiro_id,
  origem: r.origem,
  distanciaCm: r.distancia_cm,
  alturaAguaCm: r.altura_agua_cm,
  nivelPct: r.nivel_pct,
  volumeMl: r.volume_ml,
  risco: r.risco,
  raw: r.raw,
  registradoEm: r.registrado_em
});

const mapAlerta = (r) => ({
  id: r.id,
  bueiroId: r.bueiro_id,
  nivelPctPico: r.nivel_pct_pico,
  mensagem: r.mensagem,
  simulado: r.simulado,
  iniciadoEm: r.iniciado_em,
  encerradoEm: r.encerrado_em,
  reconhecidoEm: r.reconhecido_em
});

export function criarRepositoriosPostgres(pool) {
  const bueiros = {
    async listar() {
      const { rows } = await pool.query('SELECT * FROM bueiros ORDER BY id');
      return rows.map(mapBueiro);
    },

    async atualizarCalibracao(id, p) {
      const { rows } = await pool.query(
        `UPDATE bueiros SET altura_total_cm = $2, distancia_cega_cm = $3, volume_total_ml = $4,
                limite_atencao_pct = $5, limite_critico_pct = $6, atualizado_em = now()
         WHERE id = $1 RETURNING *`,
        [id, p.alturaTotalCm, p.distanciaCegaCm, p.volumeTotalMl, p.limiteAtencaoPct, p.limiteCriticoPct]
      );
      return rows[0] ? mapBueiro(rows[0]) : null;
    },

    async definirCoordenadas(id, latitude, longitude) {
      const { rows } = await pool.query(
        'UPDATE bueiros SET latitude = $2, longitude = $3, atualizado_em = now() WHERE id = $1 RETURNING *',
        [id, latitude, longitude]
      );
      return rows[0] ? mapBueiro(rows[0]) : null;
    },

    async restaurarPadroes() {
      for (const p of Object.values(CALIBRACAO_PADRAO)) {
        await bueiros.atualizarCalibracao(p.id, p);
      }
      return bueiros.listar();
    }
  };

  const leituras = {
    async inserir(l) {
      await pool.query(
        `INSERT INTO leituras (bueiro_id, origem, distancia_cm, altura_agua_cm, nivel_pct, volume_ml, risco, raw, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [l.bueiroId, l.origem, l.distanciaCm, l.alturaAguaCm, l.nivelPct, l.volumeMl, l.risco, l.raw ?? null, new Date(l.timestamp)]
      );
    },

    async listar({ bueiroId, desde, ate, limite = 500, ordem = 'desc' } = {}) {
      const filtros = [];
      const params = [];
      if (bueiroId) { params.push(bueiroId); filtros.push(`bueiro_id = $${params.length}`); }
      if (desde) { params.push(desde); filtros.push(`registrado_em >= $${params.length}`); }
      if (ate) { params.push(ate); filtros.push(`registrado_em <= $${params.length}`); }
      params.push(limite);
      const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
      const dir = ordem === 'asc' ? 'ASC' : 'DESC';
      const { rows } = await pool.query(
        `SELECT * FROM leituras ${where} ORDER BY registrado_em ${dir} LIMIT $${params.length}`,
        params
      );
      return rows.map(mapLeitura);
    },

    async estatisticas({ desde, ate } = {}) {
      const { rows } = await pool.query(
        `SELECT bueiro_id, COUNT(*)::int AS total, MIN(nivel_pct) AS minimo, MAX(nivel_pct) AS maximo,
                ROUND(AVG(nivel_pct), 1) AS media, MIN(registrado_em) AS primeira, MAX(registrado_em) AS ultima
         FROM leituras
         WHERE ($1::timestamptz IS NULL OR registrado_em >= $1) AND ($2::timestamptz IS NULL OR registrado_em <= $2)
         GROUP BY bueiro_id ORDER BY bueiro_id`,
        [desde ?? null, ate ?? null]
      );
      return rows.map((r) => ({
        bueiroId: r.bueiro_id,
        total: r.total,
        nivelMinimoPct: r.minimo,
        nivelMaximoPct: r.maximo,
        nivelMedioPct: r.media,
        primeiraLeitura: r.primeira,
        ultimaLeitura: r.ultima
      }));
    }
  };

  const alertas = {
    async abrir({ bueiroId, nivelPct, mensagem, simulado }) {
      const { rows } = await pool.query(
        `INSERT INTO alertas (bueiro_id, nivel_pct_pico, mensagem, simulado) VALUES ($1, $2, $3, $4) RETURNING *`,
        [bueiroId, nivelPct, mensagem, simulado]
      );
      return mapAlerta(rows[0]);
    },

    async atualizarPico(id, nivelPct) {
      await pool.query('UPDATE alertas SET nivel_pct_pico = GREATEST(nivel_pct_pico, $2) WHERE id = $1', [id, nivelPct]);
    },

    async encerrar(id) {
      const { rows } = await pool.query(
        'UPDATE alertas SET encerrado_em = now() WHERE id = $1 AND encerrado_em IS NULL RETURNING *',
        [id]
      );
      return rows[0] ? mapAlerta(rows[0]) : null;
    },

    async encerrarTodosAbertos() {
      await pool.query('UPDATE alertas SET encerrado_em = now() WHERE encerrado_em IS NULL');
    },

    async reconhecer(id) {
      const { rows } = await pool.query(
        'UPDATE alertas SET reconhecido_em = COALESCE(reconhecido_em, now()) WHERE id = $1 RETURNING *',
        [id]
      );
      return rows[0] ? mapAlerta(rows[0]) : null;
    },

    async listar({ apenasAtivos = false, incluirSimulados = false, limite = 100 } = {}) {
      const { rows } = await pool.query(
        `SELECT * FROM alertas
         WHERE ($1::boolean = false OR encerrado_em IS NULL) AND ($2::boolean = true OR simulado = false)
         ORDER BY iniciado_em DESC LIMIT $3`,
        [apenasAtivos, incluirSimulados, limite]
      );
      return rows.map(mapAlerta);
    }
  };

  return {
    tipo: 'postgres',
    bueiros,
    leituras,
    alertas,
    async verificarSaude() {
      await pool.query('SELECT 1');
      return true;
    },
    async fechar() {
      await pool.end();
    }
  };
}

/**
 * Relatórios exportáveis gerados a partir das leituras reais gravadas no banco.
 */

const CABECALHO_CSV = [
  'id', 'bueiro_id', 'registrado_em_utc', 'origem', 'distancia_cm', 'altura_agua_cm',
  'nivel_pct', 'volume_ml', 'risco', 'raw'
];

const celula = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export class ReportService {
  constructor({ repositorios, estado }) {
    this.repo = repositorios;
    this.estado = estado;
  }

  /** CSV separado por ";" (abre direto no Excel em pt-BR). */
  async leiturasCsv({ desde, ate, bueiroId, limite = 50_000 }) {
    const leituras = await this.repo.leituras.listar({ desde, ate, bueiroId, limite, ordem: 'asc' });
    const linhas = leituras.map((l) =>
      [l.id, l.bueiroId, l.registradoEm, l.origem, l.distanciaCm, l.alturaAguaCm, l.nivelPct, l.volumeMl, l.risco, l.raw]
        .map(celula)
        .join(';')
    );
    // BOM para o Excel reconhecer UTF-8 (acentos)
    return '﻿' + [CABECALHO_CSV.join(';'), ...linhas].join('\r\n') + '\r\n';
  }

  async auditoria({ desde, ate }) {
    const [estatisticas, alertas] = await Promise.all([
      this.repo.leituras.estatisticas({ desde, ate }),
      this.repo.alertas.listar({ limite: 500 })
    ]);

    const noPeriodo = (d) => (!desde || new Date(d) >= new Date(desde)) && (!ate || new Date(d) <= new Date(ate));

    return {
      plataforma: 'HydraSmart',
      versaoApi: '3.0.0',
      municipio: 'Cáceres - MT',
      geradoEm: new Date().toISOString(),
      periodo: { desde: desde ?? null, ate: ate ?? null },
      regras: {
        conversao: 'H_agua = clamp(H_total - d_medida, 0, H_total - d_cega); Nivel% = H_agua / H_util * 100',
        risco: 'Normal < limiar de atenção <= Atenção < limiar crítico <= Crítico'
      },
      bueiros: Object.values(this.estado.calibracoes).map((cfg) => ({
        calibracao: cfg,
        estatisticas: estatisticas.find((e) => e.bueiroId === cfg.id) ?? { bueiroId: cfg.id, total: 0 }
      })),
      alertas: alertas.filter((a) => noPeriodo(a.iniciadoEm))
    };
  }
}

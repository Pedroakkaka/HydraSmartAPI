/**
 * Regras de classificação de risco hidrológico (Core Determinístico).
 * Regras explícitas e auditáveis. Os limiares podem ser ajustados por bueiro
 * (calibração); quando não informados, valem os padrões 50% / 80%.
 */

import { DataValidator } from './validator.js';

export const RISK_THRESHOLDS = {
  LIMITE_NORMAL_MAX: 49.9,
  LIMITE_ATENCAO_MIN: 50.0,
  LIMITE_ATENCAO_MAX: 79.9,
  LIMITE_CRITICO_MIN: 80.0,
  LIMITE_EXTRAVASAMENTO_TOTAL: 100.0
};

export const RISK_LEVELS = {
  NORMAL: 'normal',
  ATENCAO: 'atencao',
  CRITICO: 'critico',
  DESCONHECIDO: 'desconhecido'
};

export const RISK_META = {
  [RISK_LEVELS.NORMAL]: { id: RISK_LEVELS.NORMAL, rotulo: 'Normal', cor: '#10b981', prioridade: 0 },
  [RISK_LEVELS.ATENCAO]: { id: RISK_LEVELS.ATENCAO, rotulo: 'Atenção', cor: '#f59e0b', prioridade: 1 },
  [RISK_LEVELS.CRITICO]: { id: RISK_LEVELS.CRITICO, rotulo: 'Crítico', cor: '#ef4444', prioridade: 2 },
  [RISK_LEVELS.DESCONHECIDO]: { id: RISK_LEVELS.DESCONHECIDO, rotulo: 'Sem Sinal / N/D', cor: '#64748b', prioridade: -1 }
};

export class RiskRules {
  /**
   * Classifica o nível percentual de água.
   * @param {number|null} nivel
   * @param {{ limiteAtencaoPct?: number, limiteCriticoPct?: number }} [limites]
   * @returns {'normal' | 'atencao' | 'critico' | 'desconhecido'}
   */
  static classificarNivel(nivel, limites = {}) {
    const val = DataValidator.normalizarNivel(nivel);
    if (val === null) return RISK_LEVELS.DESCONHECIDO;

    const critico = Number(limites.limiteCriticoPct ?? RISK_THRESHOLDS.LIMITE_CRITICO_MIN);
    const atencao = Number(limites.limiteAtencaoPct ?? RISK_THRESHOLDS.LIMITE_ATENCAO_MIN);

    if (val >= critico) return RISK_LEVELS.CRITICO;
    if (val >= atencao) return RISK_LEVELS.ATENCAO;
    return RISK_LEVELS.NORMAL;
  }

  static obterMetadados(chaveRisco) {
    return RISK_META[chaveRisco] || RISK_META[RISK_LEVELS.DESCONHECIDO];
  }

  static exigeAlertaEmergencia(chaveRisco) {
    return chaveRisco === RISK_LEVELS.CRITICO;
  }
}

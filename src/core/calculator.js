/**
 * Core Calculator (Cálculos Determinísticos)
 * Executa taxas de variação temporal, tendências, TTE e métricas hidrodinâmicas.
 * Sem inteligência artificial: 100% reprodutível e auditável.
 */

import { DataValidator } from './validator.js';
import { RISK_THRESHOLDS } from './riskRules.js';

export const TREND_THRESHOLDS = {
  VELOCIDADE_MINIMA_VARIACAO: 0.05, // % por minuto
  LIMITE_HORAS_MAX_TTE: 24 // Projeções acima de 24h são marcadas como baixa sensibilidade
};

export class CoreCalculator {
  /**
   * Calcula taxa de variação (%/min) e tendência a partir de série temporal de leituras.
   * Exige ao menos 2 amostras com timestamps distintos.
   * @param {Array<number>} niveis
   * @param {Array<number>} timestampsMs
   * @returns {{
   *   taxaMinuto: number,
   *   taxaSegundo: number,
   *   tendencia: 'elevacao'|'queda'|'estavel'|'indeterminado',
   *   deltaNivel: number,
   *   deltaTempoSegundos: number,
   *   amostrasProcessadas: number
   * }}
   */
  static calcularTaxaVariacao(niveis, timestampsMs) {
    const { niveis: nLimpos, timestamps: tLimpos, pontosValidos } =
      DataValidator.higienizarSerieTemporal(niveis, timestampsMs);

    if (pontosValidos < 2) {
      return {
        taxaMinuto: 0.0,
        taxaSegundo: 0.0,
        tendencia: 'indeterminado',
        deltaNivel: 0.0,
        deltaTempoSegundos: 0,
        amostrasProcessadas: pontosValidos
      };
    }

    const nAtual = nLimpos[pontosValidos - 1];
    // Pegar amostra passada (janela móvel recente para suavizar ruído de alta frequência)
    const idxPassado = Math.max(0, pontosValidos - 4);
    const nPassado = nLimpos[idxPassado];
    const tAtual = tLimpos[pontosValidos - 1];
    const tPassado = tLimpos[idxPassado];

    const deltaNivel = nAtual - nPassado;
    const deltaTempoMs = tAtual - tPassado;
    const deltaTempoSegundos = deltaTempoMs / 1000.0;

    if (deltaTempoSegundos <= 0) {
      return {
        taxaMinuto: 0.0,
        taxaSegundo: 0.0,
        tendencia: 'estavel',
        deltaNivel: 0.0,
        deltaTempoSegundos: 0,
        amostrasProcessadas: pontosValidos
      };
    }

    const taxaMinuto = deltaNivel / (deltaTempoSegundos / 60.0);
    const taxaSegundo = deltaNivel / deltaTempoSegundos;

    const taxaMinutoArred = Math.round(taxaMinuto * 100) / 100;
    const taxaSegundoArred = Math.round(taxaSegundo * 1000) / 1000;

    let tendencia = 'estavel';
    if (taxaMinutoArred > TREND_THRESHOLDS.VELOCIDADE_MINIMA_VARIACAO) {
      tendencia = 'elevacao';
    } else if (taxaMinutoArred < -TREND_THRESHOLDS.VELOCIDADE_MINIMA_VARIACAO) {
      tendencia = 'queda';
    }

    return {
      taxaMinuto: taxaMinutoArred,
      taxaSegundo: taxaSegundoArred,
      tendencia,
      deltaNivel: Math.round(deltaNivel * 10) / 10,
      deltaTempoSegundos: Math.round(deltaTempoSegundos),
      amostrasProcessadas: pontosValidos
    };
  }

  /**
   * Projeta tempo linear até atingir um limiar determinístico (ex: 80% crítico ou 100% transbordo).
   * Retorna minutos até o evento ou null caso a cota esteja em recessão/estabilidade.
   * @param {number} nivelAtual
   * @param {number} taxaMinuto
   * @param {number} nivelAlvo Padrão 80.0%
   * @returns {{
   *   minutosEstimados: number|null,
   *   alcancavel: boolean,
   *   confiavel: boolean,
   *   motivo: string
   * }}
   */
  static estimarTempoAteLimiar(nivelAtual, taxaMinuto, nivelAlvo = RISK_THRESHOLDS.LIMITE_CRITICO_MIN) {
    const n = DataValidator.normalizarNivel(nivelAtual);
    if (n === null) {
      return {
        minutosEstimados: null,
        alcancavel: false,
        confiavel: false,
        motivo: 'Leitura de nível ausente ou inválida'
      };
    }

    if (n >= nivelAlvo) {
      return {
        minutosEstimados: 0.0,
        alcancavel: true,
        confiavel: true,
        motivo: `Limiar de ${nivelAlvo}% já atingido ou superado (${n}%)`
      };
    }

    if (!taxaMinuto || taxaMinuto <= TREND_THRESHOLDS.VELOCIDADE_MINIMA_VARIACAO) {
      return {
        minutosEstimados: null,
        alcancavel: false,
        confiavel: true,
        motivo: 'Cota em recessão ou estável (sem risco iminente de elevação)'
      };
    }

    const deltaRestante = nivelAlvo - n;
    const minutos = Math.round((deltaRestante / taxaMinuto) * 10) / 10;

    // Acima de 24 horas não possui acurácia hidrológica determinística de curto prazo
    if (minutos > (TREND_THRESHOLDS.LIMITE_HORAS_MAX_TTE * 60)) {
      return {
        minutosEstimados: null,
        alcancavel: false,
        confiavel: false,
        motivo: 'Projeção superior a 24 horas (fora do horizonte operacional crítico)'
      };
    }

    return {
      minutosEstimados: minutos,
      alcancavel: true,
      confiavel: true,
      motivo: `Projeção linear determinística: ${minutos} min a +${taxaMinuto.toFixed(2)}%/min`
    };
  }

  /**
   * Converte percentual em grandezas físicas calibradas (altura da lâmina em cm e volume da bacia).
   * @param {number} nivelPercentual
   * @param {number} alturaUtilCm Altura útil calibrada da seção (padrão 120.0 cm / 1.2 m)
   * @param {number} volumeMaximoLitros Volume útil calibrado da calha (padrão 15.000 L)
   * @returns {{ alturaCm: number, alturaMetros: number, volumeLitros: number, volumeM3: number }}
   */
  static calcularGrandezasFisicas(nivelPercentual, alturaUtilCm = 120.0, volumeMaximoLitros = 15000.0) {
    const n = DataValidator.normalizarNivel(nivelPercentual) ?? 0;
    const alturaCm = Math.round((n / 100.0) * alturaUtilCm * 10) / 10;
    const alturaMetros = Math.round((alturaCm / 100.0) * 100) / 100;
    const volumeLitros = Math.round((n / 100.0) * volumeMaximoLitros);
    const volumeM3 = Math.round((volumeLitros / 1000.0) * 10) / 10;

    return {
      alturaCm,
      alturaMetros,
      volumeLitros,
      volumeM3
    };
  }

  /**
   * Formata duração em minutos para visualização militar/SCADA ("01h 24m", "15m", "Estável").
   * @param {number|null} minutos
   * @returns {string}
   */
  static formatarDuracao(minutos) {
    if (minutos === null || minutos === undefined || !Number.isFinite(minutos)) {
      return 'Sem Risco Iminente';
    }
    if (minutos <= 0) return 'Transbordo Ativo';

    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);

    if (h > 0) {
      return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}min`;
    }
    return `${m} min`;
  }
}

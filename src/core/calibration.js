/**
 * Calibração física dos bueiros (funções puras).
 *
 * O sensor HC-SR04 fica no topo do bueiro apontando para baixo:
 * quanto MENOR a distância medida, MAIOR a coluna d'água.
 *
 *   H_util  = H_total - d_cega
 *   H_agua  = clamp(H_total - d_medida, 0, H_util)
 *   Nivel%  = H_agua / H_util * 100
 *   Volume  = Nivel% / 100 * V_max
 */

import { DataValidator } from './validator.js';

export const BUEIRO_IDS = ['bueiro_1', 'bueiro_2'];

export const CALIBRACAO_PADRAO = {
  bueiro_1: {
    id: 'bueiro_1',
    codigoCurto: '01',
    nome: 'Bueiro 01 (Entrada / Montante)',
    pinoTrig: 'D9',
    pinoEcho: 'D10',
    alturaTotalCm: 20.0,
    distanciaCegaCm: 2.0,
    volumeTotalMl: 2000.0,
    limiteAtencaoPct: 50.0,
    limiteCriticoPct: 80.0,
    latitude: null,
    longitude: null
  },
  bueiro_2: {
    id: 'bueiro_2',
    codigoCurto: '02',
    nome: 'Bueiro 02 (Saída / Jusante)',
    pinoTrig: 'D6',
    pinoEcho: 'D7',
    alturaTotalCm: 20.0,
    distanciaCegaCm: 2.0,
    volumeTotalMl: 2000.0,
    limiteAtencaoPct: 50.0,
    limiteCriticoPct: 80.0,
    latitude: null,
    longitude: null
  }
};

/**
 * Normaliza qualquer identificador aceito ('1', '01', 'bueiro2', 2...) para 'bueiro_1' | 'bueiro_2'.
 * Retorna null para identificadores desconhecidos.
 */
export function normalizarBueiroId(id) {
  const s = String(id ?? '').toLowerCase().trim();
  if (['1', '01', 'b1', 'bueiro1', 'bueiro_1'].includes(s)) return 'bueiro_1';
  if (['2', '02', 'b2', 'bueiro2', 'bueiro_2'].includes(s)) return 'bueiro_2';
  return null;
}

export function coordenadasConfirmadas(cfg) {
  return cfg.latitude !== null && cfg.latitude !== undefined &&
    cfg.longitude !== null && cfg.longitude !== undefined;
}

/**
 * Aplica as mesmas travas físicas do sistema original aos novos parâmetros.
 */
export function sanitizarParametros(atual, novos = {}) {
  const num = (v, fallback) => {
    const n = Number(v);
    return v === undefined || v === null || v === '' || !Number.isFinite(n) ? fallback : n;
  };

  const alturaTotalCm = Math.max(5.0, num(novos.alturaTotalCm, atual.alturaTotalCm));
  const distanciaCegaCm = Math.max(0.0, Math.min(alturaTotalCm - 2.0, num(novos.distanciaCegaCm, atual.distanciaCegaCm)));
  const volumeTotalMl = Math.max(100.0, num(novos.volumeTotalMl, atual.volumeTotalMl));
  const limiteAtencaoPct = Math.max(10.0, Math.min(90.0, num(novos.limiteAtencaoPct, atual.limiteAtencaoPct)));
  const limiteCriticoPct = Math.max(limiteAtencaoPct + 5.0, Math.min(99.0, num(novos.limiteCriticoPct, atual.limiteCriticoPct)));

  return { ...atual, alturaTotalCm, distanciaCegaCm, volumeTotalMl, limiteAtencaoPct, limiteCriticoPct };
}

/**
 * Converte a distância medida pelo sensor em grandezas hidrológicas.
 * @param {object} cfg Calibração do bueiro
 * @param {number} distanciaMedidaCm
 */
export function converterDistanciaParaNivel(cfg, distanciaMedidaCm) {
  const dist = DataValidator.validarDistanciaUltrassonica(distanciaMedidaCm);
  const alturaUtilCm = Math.max(1.0, cfg.alturaTotalCm - cfg.distanciaCegaCm);

  if (dist === null) {
    return {
      valido: false,
      motivo: 'Distância fora dos limites físicos do sensor (2 a 400 cm) ou não finita',
      distanciaMedidaCm: null,
      alturaAguaCm: 0,
      nivelPct: 0,
      volumeMl: 0,
      alturaUtilCm
    };
  }

  // Água encostou na zona cega do sensor: bueiro cheio / transbordo
  if (dist <= cfg.distanciaCegaCm) {
    return {
      valido: true,
      distanciaMedidaCm: dist,
      alturaAguaCm: Math.round(alturaUtilCm * 10) / 10,
      nivelPct: 100.0,
      volumeMl: Math.round(cfg.volumeTotalMl),
      alturaUtilCm
    };
  }

  // Distância maior que a altura total: bueiro seco
  if (dist >= cfg.alturaTotalCm) {
    return { valido: true, distanciaMedidaCm: dist, alturaAguaCm: 0.0, nivelPct: 0.0, volumeMl: 0, alturaUtilCm };
  }

  const alturaAguaCm = cfg.alturaTotalCm - dist;
  const nivelPct = Math.max(0.0, Math.min(100.0, (alturaAguaCm / alturaUtilCm) * 100.0));
  const volumeMl = Math.round((nivelPct / 100.0) * cfg.volumeTotalMl);

  return {
    valido: true,
    distanciaMedidaCm: Math.round(dist * 10) / 10,
    alturaAguaCm: Math.round(alturaAguaCm * 10) / 10,
    nivelPct: Math.round(nivelPct * 10) / 10,
    volumeMl,
    alturaUtilCm: Math.round(alturaUtilCm * 10) / 10
  };
}

/**
 * Converte um nível percentual (ex.: vindo do simulador ou de um dispositivo que
 * já envia %) nas mesmas grandezas físicas.
 */
export function converterNivelParaGrandezas(cfg, nivelPct) {
  const norm = DataValidator.normalizarNivel(nivelPct);
  if (norm === null) return { valido: false, motivo: 'Nível percentual inválido' };

  const alturaUtilCm = Math.max(1.0, cfg.alturaTotalCm - cfg.distanciaCegaCm);
  const alturaAguaCm = Math.round((norm / 100.0) * alturaUtilCm * 10) / 10;
  return {
    valido: true,
    distanciaMedidaCm: Math.round((cfg.alturaTotalCm - alturaAguaCm) * 10) / 10,
    alturaAguaCm,
    nivelPct: norm,
    volumeMl: Math.round((norm / 100.0) * cfg.volumeTotalMl),
    alturaUtilCm: Math.round(alturaUtilCm * 10) / 10
  };
}

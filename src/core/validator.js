/**
 * Data Validator & Normalizer (Core Determinístico)
 * Garante higienização estrita de todas as entradas físicas, temporais e geográficas.
 * Regra de ouro: dados inválidos são isolados imediatamente para evitar poluição dos cálculos.
 */

export class DataValidator {
  /**
   * Valida e normaliza percentual de nível de água (escala 0.0 a 100.0%).
   * Rejeita valores nulos, vazios, não numéricos ou infinitos.
   * Aplica clamp estrito entre 0 e 100 com precisão de 1 casa decimal.
   * @param {*} valor
   * @returns {number|null}
   */
  static normalizarNivel(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const num = Number(valor);
    if (!Number.isFinite(num) || Number.isNaN(num)) return null;
    const clamped = Math.max(0, Math.min(100, num));
    return Math.round(clamped * 10) / 10;
  }

  /**
   * Converte leitura bruta analógica (ex: microcontrolador ADC 10 bits 0..1023)
   * para escala percentual (0..100%).
   * @param {*} rawVal
   * @param {number} maxAdc Padrão 1023 (Arduino UNO / Nano)
   * @returns {number|null}
   */
  static converterAdcParaPercentual(rawVal, maxAdc = 1023) {
    if (rawVal === null || rawVal === undefined) return null;
    const num = Number(rawVal);
    if (!Number.isFinite(num) || num < 0 || maxAdc <= 0) return null;
    const percentual = (num / maxAdc) * 100.0;
    return this.normalizarNivel(percentual);
  }

  /**
   * Valida leitura física de distância em centímetros (ex: sensor HC-SR04).
   * Faixa física do HC-SR04: 2.0 cm a 400.0 cm.
   * @param {*} dist
   * @param {number} maxCm
   * @param {number} minCm
   * @returns {number|null}
   */
  static validarDistanciaUltrassonica(dist, maxCm = 400.0, minCm = 2.0) {
    if (dist === null || dist === undefined || dist === '') return null;
    const num = Number(dist);
    if (!Number.isFinite(num) || Number.isNaN(num)) return null;
    if (num < minCm || num > maxCm) return null;
    return Math.round(num * 10) / 10;
  }

  /**
   * Valida coordenadas geográficas no formato WGS84 [lat, lng].
   * @param {Array<number>} coords
   * @returns {boolean}
   */
  static validarCoordenadas(coords) {
    if (!Array.isArray(coords) || coords.length !== 2) return false;
    const [lat, lng] = coords.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return lat >= -90.0 && lat <= 90.0 && lng >= -180.0 && lng <= 180.0;
  }

  /**
   * Valida e normaliza timestamp para milissegundos Unix positivos.
   * @param {*} timestamp
   * @returns {number|null}
   */
  static normalizarTimestamp(timestamp) {
    if (!timestamp) return null;
    if (timestamp instanceof Date) {
      const ms = timestamp.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    const num = Number(timestamp);
    if (Number.isFinite(num) && num > 0) return Math.floor(num);
    const parse = Date.parse(timestamp);
    return Number.isFinite(parse) ? parse : null;
  }

  /**
   * Higieniza séries temporais combinadas (níveis e timestamps).
   * Garante que pares incompletos sejam descartados e ordena cronologicamente.
   * @param {Array<number>} niveis
   * @param {Array<number>} timestamps
   * @returns {{ niveis: Array<number>, timestamps: Array<number>, pontosValidos: number }}
   */
  static higienizarSerieTemporal(niveis, timestamps) {
    if (!Array.isArray(niveis) || !Array.isArray(timestamps)) {
      return { niveis: [], timestamps: [], pontosValidos: 0 };
    }

    const pares = [];
    const len = Math.min(niveis.length, timestamps.length);

    for (let i = 0; i < len; i++) {
      const n = this.normalizarNivel(niveis[i]);
      const t = this.normalizarTimestamp(timestamps[i]);
      if (n !== null && t !== null) {
        pares.push({ nivel: n, timestamp: t });
      }
    }

    // Ordenar estritamente por timestamp ascendente
    pares.sort((a, b) => a.timestamp - b.timestamp);

    return {
      niveis: pares.map(p => p.nivel),
      timestamps: pares.map(p => p.timestamp),
      pontosValidos: pares.length
    };
  }
}

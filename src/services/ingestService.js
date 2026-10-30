/**
 * Porta de entrada de TODAS as leituras (Arduino USB, dispositivos via HTTP e simulador).
 *
 * Regras:
 *  - Leituras simuladas só são aceitas no modo demonstração e nunca vão para o banco.
 *  - Leituras reais sempre são gravadas no banco; no modo demonstração elas não
 *    substituem os valores simulados exibidos no painel.
 */

import { normalizarBueiroId, converterDistanciaParaNivel, converterNivelParaGrandezas } from '../core/calibration.js';
import { RiskRules } from '../core/riskRules.js';
import { MODOS } from '../domain/telemetryState.js';

export const ORIGENS = {
  ARDUINO_USB: 'Arduino USB',
  HTTP: 'Dispositivo HTTP',
  SIMULADOR: 'Simulador (demonstração)'
};

export class IngestService {
  constructor({ estado, repositorios, alertas, log }) {
    this.estado = estado;
    this.repo = repositorios.leituras;
    this.alertas = alertas;
    this.log = log;
  }

  /**
   * @param {{ bueiroId: string|number, distanciaCm?: number, nivelPct?: number, raw?: number, origem: string, timestamp?: number }} entrada
   * @returns {Promise<{ aceita: boolean, motivo?: string, leitura?: object }>}
   */
  async registrar(entrada) {
    const id = normalizarBueiroId(entrada.bueiroId);
    if (!id || !this.estado.calibracoes[id]) return { aceita: false, motivo: 'Bueiro desconhecido' };

    const simulado = entrada.origem === ORIGENS.SIMULADOR;
    if (simulado && this.estado.modo !== MODOS.DEMO) {
      return { aceita: false, motivo: 'Leituras simuladas só são aceitas no modo demonstração' };
    }

    const cfg = this.estado.calibracoes[id];
    const temDistancia = entrada.distanciaCm !== undefined && entrada.distanciaCm !== null;
    const grandezas = temDistancia
      ? converterDistanciaParaNivel(cfg, entrada.distanciaCm)
      : converterNivelParaGrandezas(cfg, entrada.nivelPct);

    if (!grandezas.valido) return { aceita: false, motivo: grandezas.motivo };

    const timestamp = entrada.timestamp ?? Date.now();
    const risco = RiskRules.classificarNivel(grandezas.nivelPct, cfg);
    const leitura = {
      bueiroId: id,
      origem: entrada.origem,
      distanciaCm: grandezas.distanciaMedidaCm,
      alturaAguaCm: grandezas.alturaAguaCm,
      nivelPct: grandezas.nivelPct,
      volumeMl: grandezas.volumeMl,
      risco,
      raw: entrada.raw ?? null,
      timestamp
    };

    const exibirNoPainel = simulado || this.estado.modo === MODOS.REAL;
    if (exibirNoPainel) {
      this.estado.aplicarLeitura(id, grandezas, { origem: entrada.origem, raw: entrada.raw, timestamp });
    }

    if (!simulado) {
      this.repo.inserir(leitura).catch((err) => this.log.error({ err }, '[leituras] falha ao gravar no banco'));
    }

    await this.alertas.avaliar({ bueiroId: id, nomeBueiro: cfg.nome, nivelPct: grandezas.nivelPct, risco }, { simulado });

    return { aceita: true, leitura };
  }
}

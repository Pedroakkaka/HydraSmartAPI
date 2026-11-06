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
import { CoreCalculator } from '../core/calculator.js';
import { MODOS } from '../domain/telemetryState.js';
import { diagnosticarPrototipo } from './diagnosticoPrototipo.js';

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
    // Canais de exibição isolados: bancada Arduino e sensores de campo HTTP.
    // Os dados sintéticos do simulador legado nunca entram nesses canais.
    this.canais = { prototipo: {}, campo: {}, demonstracao: {} };
    this.calibracoesDemonstracao = {};
  }

  snapshotCanais() {
    return Object.fromEntries(Object.entries(this.canais).map(([canal, bueiros]) => [canal,
      Object.fromEntries(Object.entries(bueiros).map(([id, b]) => [id, {
        ...(canal === 'prototipo' ? { diagnostico: diagnosticarPrototipo(b) } : {}),
        ...b,
        historicoNiveis: [...b.historicoNiveis],
        historicoTimestamps: [...b.historicoTimestamps],
        historicoDistancias: [...b.historicoDistancias]
      }]))
    ]));
  }

  registrarCanal(id, grandezas, leitura) {
    const canal = leitura.origem === ORIGENS.SIMULADOR ? 'demonstracao' : leitura.origem === ORIGENS.ARDUINO_USB ? 'prototipo' : 'campo';
    const anterior = this.canais[canal][id] || {
      historicoNiveis: [], historicoTimestamps: [], historicoDistancias: []
    };
    const b = {
      ...anterior, id, bueiroId: id, nome: this.estado.calibracoes[id].nome,
      conectado: true, valido: true, desatualizado: false,
      origem: leitura.origem, timestamp: leitura.timestamp,
      tipoMedicao: leitura.tipoMedicao,
      distanciaCm: leitura.distanciaCm, distanciaMedidaCm: leitura.distanciaCm,
      nivelPct: leitura.nivelPct, alturaAguaCm: leitura.alturaAguaCm,
      volumeMl: leitura.volumeMl, risco: leitura.risco
    };
    b.historicoNiveis.push(leitura.nivelPct);
    b.historicoTimestamps.push(leitura.timestamp);
    b.historicoDistancias.push(leitura.distanciaCm);
    for (const chave of ['historicoNiveis', 'historicoTimestamps', 'historicoDistancias']) {
      if (b[chave].length > 50) b[chave].shift();
    }
    const variacao = CoreCalculator.calcularTaxaVariacao(b.historicoNiveis, b.historicoTimestamps);
    b.tendencia = variacao.tendencia;
    b.taxaVariacaoMinuto = variacao.taxaMinuto;
    b.confiabilidadeTendencia = CoreCalculator.avaliarConfiabilidadeSerie(b.historicoNiveis, b.historicoTimestamps);
    if (canal === 'prototipo') b.diagnostico = diagnosticarPrototipo(b);
    this.canais[canal][id] = b;
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

    const cfg = simulado ? (this.calibracoesDemonstracao[id] || this.estado.calibracoes[id]) : this.estado.calibracoes[id];
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
      tipoMedicao: temDistancia ? 'distancia_ultrassonica' : 'nivel_percentual',
      timestamp
    };

    // Canal de procedência: bancada (Arduino USB), cenário sintético ou campo (HTTP).
    const canal = entrada.origem === ORIGENS.SIMULADOR ? 'demonstracao'
      : entrada.origem === ORIGENS.ARDUINO_USB ? 'prototipo' : 'campo';
    this.registrarCanal(id, grandezas, leitura);
    this.estado.registrarCanal?.(canal, id, leitura);
    const exibirNoPainel = simulado || this.estado.modo === MODOS.REAL;
    if (exibirNoPainel) {
      this.estado.aplicarLeitura(id, grandezas, { origem: entrada.origem, raw: entrada.raw, timestamp });
    }

    // Somente os dispositivos operacionais de campo entram no histórico real.
    // Protótipo USB é experimental e permanece isolado no canal em memória.
    if (entrada.origem === ORIGENS.HTTP) {
      this.repo.inserir(leitura).catch((err) => this.log.error({ err }, '[leituras] falha ao gravar no banco'));
    }

    // Protótipo de bancada é experimental: seus alertas são de teste, nunca à população.
    await this.alertas.avaliar(
      { bueiroId: id, nomeBueiro: cfg.nome, nivelPct: grandezas.nivelPct, risco },
      { simulado: simulado || canal === 'prototipo', canal }
    );
    this.estado._emitir('canal');

    return { aceita: true, leitura };
  }
}

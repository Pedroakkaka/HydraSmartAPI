/**
 * Estado em tempo real do sistema (fonte única da verdade no servidor).
 *
 * Guarda a última leitura e uma janela curta de histórico de cada bueiro, o status
 * da porta serial, o modo de operação (real / demonstração) e o cenário simulado.
 * Toda mudança emite o evento 'mudanca', que o WebSocket repassa para os painéis.
 *
 * Os dados históricos completos ficam no banco (tabela leituras); aqui fica apenas
 * o necessário para desenhar o painel ao vivo.
 */

import { EventEmitter } from 'node:events';
import { CoreCalculator } from '../core/calculator.js';
import { RiskRules } from '../core/riskRules.js';
import { coordenadasConfirmadas } from '../core/calibration.js';

export const MODOS = { REAL: 'real', DEMO: 'demo' };

function bueiroVazio(cfg, origem = 'Nenhum dado recebido') {
  return {
    id: cfg.id,
    codigoCurto: cfg.codigoCurto,
    nome: cfg.nome,
    conectado: false,
    valido: false,
    desatualizado: true,
    origem,
    raw: null,
    distanciaMedidaCm: null,
    alturaAguaCm: 0,
    nivelPct: 0,
    volumeMl: 0,
    alturaUtilCm: Math.round((cfg.alturaTotalCm - cfg.distanciaCegaCm) * 10) / 10,
    timestamp: null,
    taxaVariacaoMinuto: 0,
    confiabilidadeTendencia: { confiavel: false, motivo: 'Aguardando amostras suficientes', amostras: 0 },
    tendencia: 'indeterminado',
    risco: 'desconhecido',
    historicoNiveis: [],
    historicoTimestamps: [],
    historicoDistancias: []
  };
}

export class TelemetryState extends EventEmitter {
  /**
   * @param {{ calibracoes: object[], maxHistorico?: number, serialHabilitada?: boolean }} opcoes
   */
  constructor({ calibracoes, maxHistorico = 50, serialHabilitada = true }) {
    super();
    this.setMaxListeners(50);
    this.maxHistorico = maxHistorico;
    this.modo = MODOS.REAL;
    this.calibracoes = {};
    this.bueiros = {};
    for (const cfg of calibracoes) {
      this.calibracoes[cfg.id] = { ...cfg };
      this.bueiros[cfg.id] = bueiroVazio(cfg);
    }

    this.serial = {
      habilitada: serialHabilitada,
      conectado: false,
      porta: null,
      baudRate: null,
      statusTexto: serialHabilitada ? 'Desconectado' : 'Leitura serial desativada neste servidor',
      erroMensagem: null,
      ultimaMensagemBruta: '',
      timestampUltimaMensagem: null,
      totalMensagens: 0,
      leiturasRecebidas: 0,
      errosParser: 0
    };

    this.simulacao = {
      ativo: false,
      pausado: false,
      cenario: 'chuva_moderada',
      laminaRuaCm: 0,
      horarioAtualizacao: null
    };
  }

  _emitir(motivo) {
    this.emit('mudanca', motivo);
  }

  obterCalibracao(id) {
    return this.calibracoes[id] ? { ...this.calibracoes[id] } : null;
  }

  definirCalibracao(cfg) {
    this.calibracoes[cfg.id] = { ...cfg };
    const b = this.bueiros[cfg.id];
    b.alturaUtilCm = Math.round((cfg.alturaTotalCm - cfg.distanciaCegaCm) * 10) / 10;
    if (b.valido) b.risco = RiskRules.classificarNivel(b.nivelPct, cfg);
    this._emitir('calibracao');
  }

  /**
   * Aplica uma leitura já convertida (grandezas físicas calculadas) ao bueiro.
   */
  aplicarLeitura(id, grandezas, { origem, raw = null, timestamp = Date.now() }) {
    const b = this.bueiros[id];
    const cfg = this.calibracoes[id];

    b.conectado = true;
    b.valido = true;
    b.desatualizado = false;
    b.origem = origem;
    b.raw = raw ?? (grandezas.distanciaMedidaCm !== null ? Math.round(grandezas.distanciaMedidaCm * 10) : null);
    b.distanciaMedidaCm = grandezas.distanciaMedidaCm;
    b.alturaAguaCm = grandezas.alturaAguaCm;
    b.nivelPct = grandezas.nivelPct;
    b.volumeMl = grandezas.volumeMl;
    b.timestamp = timestamp;

    b.historicoNiveis.push(grandezas.nivelPct);
    b.historicoTimestamps.push(timestamp);
    b.historicoDistancias.push(grandezas.distanciaMedidaCm);
    if (b.historicoNiveis.length > this.maxHistorico) {
      b.historicoNiveis.shift();
      b.historicoTimestamps.shift();
      b.historicoDistancias.shift();
    }

    const variacao = CoreCalculator.calcularTaxaVariacao(b.historicoNiveis, b.historicoTimestamps);
    b.taxaVariacaoMinuto = variacao.taxaMinuto;
    b.confiabilidadeTendencia = CoreCalculator.avaliarConfiabilidadeSerie(b.historicoNiveis, b.historicoTimestamps);
    b.tendencia = variacao.tendencia;
    b.risco = RiskRules.classificarNivel(b.nivelPct, cfg);

    this._emitir('leitura');
    return { ...b };
  }

  resetarBueiros(origem = 'Aguardando leituras reais') {
    for (const id of Object.keys(this.bueiros)) {
      this.bueiros[id] = bueiroVazio(this.calibracoes[id], origem);
    }
    this._emitir('reset');
  }

  definirModo(modo) {
    if (modo !== MODOS.REAL && modo !== MODOS.DEMO) return;
    if (this.modo === modo) return;
    this.modo = modo;
    this._emitir('modo');
  }

  atualizarSerial(parcial) {
    this.serial = { ...this.serial, ...parcial };
    if (!this.serial.conectado) {
      for (const b of Object.values(this.bueiros)) {
        if (b.origem === 'Arduino USB') {
          b.desatualizado = true;
          b.confiabilidadeTendencia = { confiavel: false, motivo: 'Arduino desconectado', amostras: b.historicoNiveis.length };
        }
      }
    }
    this._emitir('serial');
  }

  registrarMensagemSerial(linha, sucesso) {
    this.serial.ultimaMensagemBruta = linha.slice(0, 500);
    this.serial.timestampUltimaMensagem = Date.now();
    this.serial.totalMensagens += 1;
    if (sucesso) this.serial.leiturasRecebidas += 1;
    else this.serial.errosParser += 1;
    // Sem emitir: a leitura aceita já emite; a contagem segue no próximo snapshot.
  }

  atualizarSimulacao(parcial) {
    this.simulacao = { ...this.simulacao, ...parcial, horarioAtualizacao: Date.now() };
    this._emitir('simulacao');
  }

  /**
   * Marca como desatualizados os bueiros sem leitura recente.
   */
  verificarLiveness(timeoutMs) {
    const agora = Date.now();
    let mudou = false;
    for (const b of Object.values(this.bueiros)) {
      if (b.conectado && !b.desatualizado && b.timestamp && agora - b.timestamp > timeoutMs) {
        b.desatualizado = true;
        b.confiabilidadeTendencia = { confiavel: false, motivo: 'Leitura desatualizada', amostras: b.historicoNiveis.length };
        mudou = true;
      }
    }
    if (mudou) this._emitir('liveness');
  }

  /**
   * Dados que alimentam a maquete 3D.
   * 'simulado' no modo demonstração, 'real' com sensores ativos, 'indisponivel' sem dados.
   */
  estadoMaquete3D() {
    const b1 = this.bueiros.bueiro_1;
    const b2 = this.bueiros.bueiro_2;

    if (this.modo === MODOS.DEMO && this.simulacao.ativo) {
      return {
        status: 'simulado',
        origemTexto: 'Modo Demonstração (Dados Sintéticos)',
        bueiro1Nivel: b1.valido ? b1.nivelPct : 0,
        bueiro2Nivel: b2.valido ? b2.nivelPct : 0,
        laminaRuaCm: this.simulacao.laminaRuaCm,
        cenario: this.simulacao.cenario,
        horario: this.simulacao.horarioAtualizacao
      };
    }

    const ativos = [b1, b2].filter((b) => b.conectado && !b.desatualizado);
    if (ativos.length) {
      const maxN = Math.max(...ativos.map((b) => b.nivelPct));
      return {
        status: 'real',
        origemTexto: 'Sensores Físicos Reais',
        bueiro1Nivel: b1.conectado ? b1.nivelPct : null,
        bueiro2Nivel: b2.conectado ? b2.nivelPct : null,
        // Água na rua só aparece com transbordo (> 80%)
        laminaRuaCm: maxN > 80 ? Math.round((maxN - 80) * 0.75 * 10) / 10 : 0,
        cenario: 'monitoramento_real',
        horario: Math.max(b1.timestamp || 0, b2.timestamp || 0)
      };
    }

    return {
      status: 'indisponivel',
      origemTexto: 'Aguardando dados para iniciar a simulação',
      bueiro1Nivel: null,
      bueiro2Nivel: null,
      laminaRuaCm: 0,
      cenario: 'indisponivel',
      horario: null
    };
  }

  snapshot() {
    const bueiros = {};
    for (const [id, b] of Object.entries(this.bueiros)) {
      const cfg = this.calibracoes[id];
      bueiros[id] = {
        ...b,
        historicoNiveis: [...b.historicoNiveis],
        historicoTimestamps: [...b.historicoTimestamps],
        historicoDistancias: [...b.historicoDistancias],
        calibracao: { ...cfg, coordenadasConfirmadas: coordenadasConfirmadas(cfg) }
      };
    }
    return {
      modo: this.modo,
      bueiros,
      serial: { ...this.serial },
      simulacao: { ...this.simulacao },
      maquete3D: this.estadoMaquete3D(),
      geradoEm: Date.now()
    };
  }
}

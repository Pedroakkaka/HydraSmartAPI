/**
 * Simulador de cenários para o modo demonstração.
 * Gera leituras sintéticas (marcadas como simuladas) para os dois bueiros.
 * Nada do que é gerado aqui vai para o banco.
 */

import { MODOS } from '../domain/telemetryState.js';
import { ORIGENS } from './ingestService.js';

export const CENARIOS = [
  {
    id: 'seco',
    nome: '1. Drenagem Normal / Seco',
    descricao: 'Tempo estável. Bueiros em nível de segurança (20%), sarjetas limpas, sem alagamento na rua.',
    b1Alvo: 20.0,
    b2Alvo: 18.0
  },
  {
    id: 'chuva_moderada',
    nome: '2. Chuva Moderada (Atenção)',
    descricao: 'Precipitação contínua. Galerias pluviais em carga (~60%), retenção inicial de água nas sarjetas.',
    b1Alvo: 65.0,
    b2Alvo: 58.0
  },
  {
    id: 'tempestade_transbordo',
    nome: '3. Tempestade Crítica / Níveis Simulados Elevados',
    descricao: 'Cenário sintético de níveis elevados nos sensores; não representa uma medição de água na rua.',
    b1Alvo: 89.0,
    b2Alvo: 93.0
  },
  {
    id: 'refluxo_rio',
    nome: '4. Refluxo simulado associado ao Guaíba',
    descricao: 'Cenário sintético de níveis críticos nos sensores; não representa medição ou previsão do Guaíba.',
    b1Alvo: 100.0,
    b2Alvo: 100.0
  }
];

export class Simulator {
  constructor({ estado, ingest, alertas, log, intervaloMs = 2500 }) {
    this.estado = estado;
    this.ingest = ingest;
    this.alertas = alertas;
    this.log = log;
    this.intervaloMs = intervaloMs;
    this.timer = null;
    this.cenario = CENARIOS[1];
    this.fatorRampa = 1;
  }

  obterCenario(id) {
    return CENARIOS.find((c) => c.id === id) ?? null;
  }

  async iniciar(cenarioId = 'chuva_moderada') {
    const cenario = this.obterCenario(cenarioId) ?? CENARIOS[1];
    const estavaAtivo = this.estado.simulacao.ativo;

    this.cenario = cenario;
    if (!estavaAtivo) {
      this.estado.definirModo(MODOS.DEMO);
      this.estado.resetarBueiros('Modo demonstração');
    }
    this.estado.atualizarSimulacao({ ativo: true, pausado: false, cenario: cenario.id });
    this._agendar();
    await this._ciclo();
    this.log.info(`[simulador] cenário ativo: ${cenario.nome}`);
  }

  async definirCenario(cenarioId) {
    const cenario = this.obterCenario(cenarioId);
    if (!cenario) return false;
    this.cenario = cenario;
    if (this.estado.simulacao.ativo) {
      this.estado.atualizarSimulacao({ cenario: cenario.id });
      await this._ciclo();
    } else {
      this.estado.atualizarSimulacao({ cenario: cenario.id });
    }
    return true;
  }

  alternarPausa() {
    if (!this.estado.simulacao.ativo) return false;
    const pausado = !this.estado.simulacao.pausado;
    if (pausado) this._parar();
    else this._agendar();
    this.estado.atualizarSimulacao({ pausado });
    return pausado;
  }

  async reiniciar() {
    // Recomeça com os níveis em 40% do alvo e sobe gradualmente até o cenário.
    this.fatorRampa = 0.4;
    await this.iniciar(this.cenario.id);
  }

  async encerrar() {
    this._parar();
    this.fatorRampa = 1;
    await this.alertas.encerrarSimulados();
    this.estado.atualizarSimulacao({ ativo: false, pausado: false });
    this.estado.definirModo(MODOS.REAL);
    this.estado.resetarBueiros('Aguardando leituras reais');
    this.log.info('[simulador] encerrado, retorno ao modo real');
  }

  _agendar() {
    this._parar();
    this.timer = setInterval(() => {
      this._ciclo().catch((err) => this.log.error({ err }, '[simulador] falha no ciclo'));
    }, this.intervaloMs);
    this.timer.unref?.();
  }

  _parar() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async _ciclo() {
    if (!this.estado.simulacao.ativo || this.estado.simulacao.pausado) return;
    this.fatorRampa = Math.min(1, this.fatorRampa + 0.15);
    const ruido = () => (Math.random() - 0.5) * 0.8;
    const nivel = (alvo) => Math.round(Math.max(0, Math.min(100, alvo * this.fatorRampa + ruido())) * 10) / 10;

    await this.ingest.registrar({ bueiroId: 'bueiro_1', nivelPct: nivel(this.cenario.b1Alvo), origem: ORIGENS.SIMULADOR });
    await this.ingest.registrar({ bueiroId: 'bueiro_2', nivelPct: nivel(this.cenario.b2Alvo), origem: ORIGENS.SIMULADOR });
  }

  parar() {
    this._parar();
  }
}

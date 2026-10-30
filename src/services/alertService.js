/**
 * Alertas críticos.
 * Abre um alerta quando um bueiro passa do limiar crítico e encerra quando o nível volta
 * para baixo dele. Alertas de dados reais e simulados são controlados separadamente.
 * Emite 'alerta' com { acao: 'disparado' | 'encerrado' | 'reconhecido', alerta }.
 */

import { EventEmitter } from 'node:events';
import { RiskRules } from '../core/riskRules.js';

export class AlertService extends EventEmitter {
  constructor({ repositorios, log }) {
    super();
    this.repo = repositorios.alertas;
    this.log = log;
    this.abertos = new Map(); // chave "bueiro_1:real" -> alerta
  }

  async inicializar() {
    // Alertas que ficaram abertos de uma execução anterior perderam o contexto ao vivo.
    await this.repo.encerrarTodosAbertos();
  }

  _chave(bueiroId, simulado) {
    return `${bueiroId}:${simulado ? 'simulado' : 'real'}`;
  }

  async avaliar({ bueiroId, nomeBueiro, nivelPct, risco }, { simulado }) {
    const chave = this._chave(bueiroId, simulado);
    const aberto = this.abertos.get(chave);

    try {
      if (RiskRules.exigeAlertaEmergencia(risco)) {
        if (!aberto) {
          const alerta = await this.repo.abrir({
            bueiroId,
            nivelPct,
            simulado,
            mensagem: `Nível crítico no ${nomeBueiro} (${nivelPct.toFixed(1)}%). Risco iminente de transbordo!`
          });
          this.abertos.set(chave, alerta);
          this.emit('alerta', { acao: 'disparado', alerta });
        } else if (nivelPct > aberto.nivelPctPico) {
          aberto.nivelPctPico = nivelPct;
          await this.repo.atualizarPico(aberto.id, nivelPct);
        }
      } else if (aberto) {
        this.abertos.delete(chave);
        const alerta = (await this.repo.encerrar(aberto.id)) ?? { ...aberto, encerradoEm: new Date() };
        this.emit('alerta', { acao: 'encerrado', alerta });
      }
    } catch (err) {
      this.log.error({ err }, '[alertas] falha ao registrar alerta');
    }
  }

  async encerrarSimulados() {
    for (const [chave, alerta] of this.abertos) {
      if (!alerta.simulado) continue;
      this.abertos.delete(chave);
      const encerrado = (await this.repo.encerrar(alerta.id)) ?? alerta;
      this.emit('alerta', { acao: 'encerrado', alerta: encerrado });
    }
  }

  async reconhecer(id) {
    const alerta = await this.repo.reconhecer(id);
    if (!alerta) return null;
    for (const a of this.abertos.values()) {
      if (a.id === id) a.reconhecidoEm = alerta.reconhecidoEm;
    }
    this.emit('alerta', { acao: 'reconhecido', alerta });
    return alerta;
  }

  ativos() {
    return [...this.abertos.values()];
  }
}

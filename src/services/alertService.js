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
    this.faixasTestePrototipo = new Map(); // faixas independentes por canal e bueiro
  }

  async inicializar() {
    // Alertas que ficaram abertos de uma execução anterior perderam o contexto ao vivo.
    await this.repo.encerrarTodosAbertos();
  }

  _chave(bueiroId, simulado, canal = null) {
    return `${bueiroId}:${canal || (simulado ? 'simulado' : 'real')}`;
  }

  async avaliar({ bueiroId, nomeBueiro, nivelPct, risco }, { simulado, canal = null }) {
    const chave = this._chave(bueiroId, simulado, canal);
    const aberto = this.abertos.get(chave);

    // Notificação didática: ao atingir a faixa de ATENÇÃO pela primeira vez,
    // emitir um evento do protótipo. Leituras seguintes na mesma faixa não repetem.
    // Nenhum SMS, push externo ou aviso oficial é emitido aqui.
    if ((canal === 'prototipo' || canal === 'demonstracao') && simulado === true) {
      const identificador = canal + ':' + bueiroId;
      const prefixo = canal === 'demonstracao' ? 'SIMULAÇÃO' : 'PROTÓTIPO';
      const anterior = this.faixasTestePrototipo.get(identificador) || 'normal';
      if (risco === 'normal' || risco === 'desconhecido') {
        this.faixasTestePrototipo.set(identificador, risco);
      } else if (risco === 'atencao' && anterior !== 'atencao' && anterior !== 'critico') {
        this.faixasTestePrototipo.set(identificador, 'atencao');
        this.emit('alerta', {
          acao: 'nivel_alto_teste',
          alerta: {
            id: 'atencao-' + canal + '-' + bueiroId + '-' + Date.now(),
            bueiroId, simulado: true, canal,
            nivelPctPico: nivelPct,
            mensagem: '[TESTE ' + prefixo + '] Nível alto experimental no ' + nomeBueiro
              + ' (' + nivelPct.toFixed(1) + '%). TESTE DO SISTEMA — NÃO É EMERGÊNCIA. Nenhuma ação necessária.'
          }
        });
      } else {
        this.faixasTestePrototipo.set(identificador, risco);
      }
    }

    try {
      if (RiskRules.exigeAlertaEmergencia(risco)) {
        if (!aberto) {
          const alerta = await this.repo.abrir({
            bueiroId,
            nivelPct,
            simulado,
            mensagem: simulado
              ? `[TESTE ${canal === 'prototipo' ? 'PROTÓTIPO' : 'SIMULAÇÃO'}] Nível crítico no ${nomeBueiro} (${nivelPct.toFixed(1)}%). Não é um alerta à população.`
              : `Nível crítico no ${nomeBueiro} (${nivelPct.toFixed(1)}%). Risco iminente de transbordo!`
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

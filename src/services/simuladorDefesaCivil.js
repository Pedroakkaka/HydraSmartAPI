/**
 * Receptor isolado de ensaio da Defesa Civil.
 * Não realiza HTTP, SMS, Cell Broadcast, e-mail ou comunicação externa.
 * Registra somente uma confirmação interna quando um alerta é disparado.
 */
export class SimuladorDefesaCivil {
  constructor({ alertas }) {
    this.registros = [];
    this.contador = 0;
    this.escuta = ({ acao, alerta }) => {
      if (acao !== 'disparado' || !alerta) return;
      const agora = new Date().toISOString();
      this.contador += 1;
      this.registros.unshift({
        protocolo: 'TESTE-' + String(this.contador).padStart(5, '0'),
        natureza: 'SIMULACAO_INTERNA',
        destinatario: 'Receptor simulado da Defesa Civil',
        transmissaoExterna: false,
        status: 'RECEBIDO_PELO_SIMULADOR',
        criadoEm: agora,
        recebidoEm: agora,
        origem: alerta.simulado ? 'experimental' : 'campo',
        simulado: Boolean(alerta.simulado),
        bueiroId: alerta.bueiroId,
        nivelPct: alerta.nivelPctPico ?? alerta.nivelPct ?? null,
        mensagem: alerta.mensagem || 'Alerta recebido'
      });
      if (this.registros.length > 100) this.registros.length = 100;
    };
    alertas.on('alerta', this.escuta);
    this.alertas = alertas;
  }
  listar() { return this.registros.map(registro => ({ ...registro })); }
  encerrar() { this.alertas.off('alerta', this.escuta); }
}

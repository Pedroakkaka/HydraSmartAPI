import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SimuladorDefesaCivil } from '../src/services/simuladorDefesaCivil.js';

test('alerta crítico vira recibo local de teste sem transmissão externa', () => {
  const alertas = new EventEmitter();
  const receptor = new SimuladorDefesaCivil({ alertas });
  alertas.emit('alerta', { acao: 'disparado', alerta: {
    simulado: true, bueiroId: 'bueiro_1', nivelPctPico: 91,
    mensagem: '[TESTE PROTÓTIPO] Nível crítico'
  } });
  const [recibo] = receptor.listar();
  assert.equal(recibo.transmissaoExterna, false);
  assert.equal(recibo.status, 'RECEBIDO_PELO_SIMULADOR');
  assert.equal(recibo.simulado, true);
  assert.equal(recibo.bueiroId, 'bueiro_1');
  assert.equal(recibo.nivelPct, 91);
  receptor.encerrar();
  alertas.emit('alerta', { acao: 'disparado', alerta: { simulado: true } });
  assert.equal(receptor.listar().length, 1);
});

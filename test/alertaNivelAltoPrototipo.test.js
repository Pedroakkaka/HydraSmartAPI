import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertService } from '../src/services/alertService.js';

test('aviso de nivel alto e automatico e nao repete ate retornar ao normal', async () => {
  let seq = 0;
  const repo = {
    abrir: async (a) => ({ ...a, id: ++seq, nivelPctPico: a.nivelPct }),
    atualizarPico: async () => {},
    encerrar: async () => ({}),
    encerrarTodosAbertos: async () => {}
  };
  const service = new AlertService({ repositorios: { alertas: repo }, log: { error: () => {} } });
  const eventos = [];
  service.on('alerta', evento => eventos.push(evento));
  const base = { bueiroId: 'bueiro_1', nomeBueiro: 'bueiro experimental' };
  const contexto = { simulado: true, canal: 'prototipo' };
  await service.avaliar({ ...base, nivelPct: 55, risco: 'atencao' }, contexto);
  await service.avaliar({ ...base, nivelPct: 62, risco: 'atencao' }, contexto);
  assert.equal(eventos.filter(e => e.acao === 'nivel_alto_teste').length, 1);
  assert.match(eventos[0].alerta.mensagem, /NÃO É EMERGÊNCIA/);
  await service.avaliar({ ...base, nivelPct: 25, risco: 'normal' }, contexto);
  await service.avaliar({ ...base, nivelPct: 57, risco: 'atencao' }, contexto);
  assert.equal(eventos.filter(e => e.acao === 'nivel_alto_teste').length, 2);
  await service.avaliar({ ...base, nivelPct: 85, risco: 'critico' }, contexto);
  assert.equal(eventos.filter(e => e.acao === 'disparado').length, 1);
  assert.equal(eventos.find(e => e.acao === 'disparado').alerta.simulado, true);
});

test('dados de campo nao geram notificação experimental de nível alto', async () => {
  const service = new AlertService({ repositorios: { alertas: {} }, log: { error: () => {} } });
  const eventos = [];
  service.on('alerta', e => eventos.push(e));
  await service.avaliar({ bueiroId: 'bueiro_1', nomeBueiro: 'campo', nivelPct: 60, risco: 'atencao' }, { simulado: false, canal: 'campo' });
  assert.equal(eventos.length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createECDH } from 'node:crypto';
import { AlertService } from '../src/services/alertService.js';
import { criarRepositoriosMemoria } from '../src/repositories/memoria.js';
import { criarWebPush } from '../src/services/webPush.js';
import { Simulator } from '../src/services/simulator.js';

const log = { info(){}, warn(){}, error(){} };
const config = (() => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    vapidPublicKey: ecdh.getPublicKey().toString('base64url'),
    vapidPrivateKey: ecdh.getPrivateKey().toString('base64url'),
    vapidSubject:'mailto:hydrasmart@example.org'
  };
})();

test('encerrar cenário digital rearma atenção B01/B02 sem rearmar o protótipo USB', async () => {
  const service = new AlertService({ repositorios: criarRepositoriosMemoria(), log });
  const eventos = [];
  service.on('alerta', evento => eventos.push(evento));
  for (const bueiroId of ['bueiro_1', 'bueiro_2']) {
    await service.avaliar({ bueiroId,nomeBueiro:bueiroId,nivelPct:55,risco:'atencao' },
      { simulado:true,canal:'demonstracao' });
  }
  await service.avaliar({ bueiroId:'bueiro_1',nomeBueiro:'B01',nivelPct:55,risco:'atencao' },
    { simulado:true,canal:'prototipo' });
  assert.equal(eventos.length,3);
  await service.encerrarSimulados();
  for (const bueiroId of ['bueiro_1', 'bueiro_2']) {
    await service.avaliar({ bueiroId,nomeBueiro:bueiroId,nivelPct:55,risco:'atencao' },
      { simulado:true,canal:'demonstracao' });
  }
  assert.equal(eventos.length,5);
  await service.avaliar({ bueiroId:'bueiro_1',nomeBueiro:'B01',nivelPct:55,risco:'atencao' },
    { simulado:true,canal:'prototipo' });
  assert.equal(eventos.length,5);
});

test('envio remoto em lotes controla a concorrência e confirma cada receptor', async () => {
  const alertas = new EventEmitter();
  const inscritos = Array.from({length:19}, (_,i) => ({endpoint:'https://fcm.googleapis.com/' + i}));
  let ativos=0, maxAtivos=0, enviados=0, primeiroToken;
  const push = criarWebPush({
    config, alertas, log,
    repositorio:{
      listar:async()=>inscritos,
      remover:async()=>{}
    },
    transmitir:async(_inscricao,mensagem)=>{
      ativos++;
      maxAtivos = Math.max(maxAtivos,ativos);
      enviados++;
      primeiroToken ??= mensagem.reciboToken;
      await new Promise(resolve=>setImmediate(resolve));
      ativos--;
      return 201;
    }
  });
  try {
    const resultado = await push.enviarTeste();
    assert.equal(resultado.inscritos,19);
    assert.equal(resultado.aceitosGateway,19);
    assert.ok(maxAtivos <= 8 && maxAtivos > 1);
    assert.equal(enviados,19);
    assert.equal(push.confirmarRecebimento(primeiroToken),true);
    assert.equal(push.confirmarRecebimento('0'.repeat(32)),false);
    assert.equal(push.consultarRecibo(resultado.testeId).confirmadosCelulares,1);
  } finally { push.encerrar(); }
});

test('notificações remotas nunca são enviadas por alerta de campo', async () => {
  const alertas = new EventEmitter();
  let enviados=0;
  const push = criarWebPush({
    config, alertas, log,
    repositorio:{ listar:async()=>[{endpoint:'https://fcm.googleapis.com/test'}] },
    transmitir:async()=>{ enviados++;return 201; }
  });
  try {
    alertas.emit('alerta',{acao:'disparado',alerta:{
      simulado:false,bueiroId:'bueiro_1',
      mensagem:'Nível crítico no campo'
    }});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(enviados,0);
  } finally {push.encerrar();}
});

test('simulador não sobrepõe ciclos nem mistura bueiros enquanto ingestão aguarda', async () => {
  let liberar;
  const bloqueio = new Promise(resolve=>{ liberar=resolve; });
  const chamadas=[];
  const estado={simulacao:{ativo:true,pausado:false},modo:'demo'};
  const ingest={registrar:async leitura=>{
    chamadas.push(leitura.bueiroId);
    if (leitura.bueiroId === 'bueiro_1') await bloqueio;
  }};
  const sim = new Simulator({ estado,ingest,alertas:{},log });
  const primeira = sim._ciclo();
  await new Promise(resolve=>setImmediate(resolve));
  const segunda = sim._ciclo();
  liberar();
  await Promise.all([primeira,segunda]);
  assert.deepEqual(chamadas,['bueiro_1','bueiro_2']);
  assert.equal(sim.cicloEmAndamento,false);
});

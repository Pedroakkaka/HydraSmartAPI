import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarRepositoriosMemoria } from '../src/repositories/memoria.js';
import { AlertService } from '../src/services/alertService.js';

const log = {info(){},warn(){},error(){}};
const leitura = (pct, risco) => ({bueiroId:'bueiro_1',nomeBueiro:'B01',nivelPct:pct,risco});

test('simulação digital emite atenção sem repetir a cada leitura, e rearma após normalizar', async()=>{
  const service = new AlertService({repositorios:criarRepositoriosMemoria(),log});
  const eventos = [];
  service.on('alerta',evento=>eventos.push(evento));
  await service.inicializar();
  await service.avaliar(leitura(50,'atencao'),{simulado:true,canal:'demonstracao'});
  await service.avaliar(leitura(66.7,'atencao'),{simulado:true,canal:'demonstracao'});
  assert.equal(eventos.length,1);
  assert.equal(eventos[0].acao,'nivel_alto_teste');
  assert.equal(eventos[0].alerta.simulado,true);
  assert.match(eventos[0].alerta.mensagem,/^\[TESTE SIMULAÇÃO\]/);
  await service.avaliar(leitura(0,'normal'),{simulado:true,canal:'demonstracao'});
  await service.avaliar(leitura(50,'atencao'),{simulado:true,canal:'demonstracao'});
  assert.equal(eventos.length,2);
});

test('protótipo e simulação têm estados de atenção independentes', async()=>{
  const service = new AlertService({repositorios:criarRepositoriosMemoria(),log});
  const eventos = [];
  service.on('alerta',evento=>eventos.push(evento));
  await service.avaliar(leitura(50,'atencao'),{simulado:true,canal:'prototipo'});
  await service.avaliar(leitura(50,'atencao'),{simulado:true,canal:'demonstracao'});
  assert.equal(eventos.length,2);
  assert.match(eventos[0].alerta.mensagem,/^\[TESTE PROTÓTIPO\]/);
  assert.match(eventos[1].alerta.mensagem,/^\[TESTE SIMULAÇÃO\]/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticarPrototipo } from '../src/services/diagnosticoPrototipo.js';

const agora = 1_800_000_000_000;
const serie = niveis => ({
  nivelPct:niveis.at(-1),timestamp:agora,
  historicoNiveis:niveis,
  historicoTimestamps:niveis.map((_,i)=>agora-(niveis.length-i-1)*5000)
});

test('não prevê enchimento sem dados ou após perda de sinal',()=>{
  assert.equal(diagnosticarPrototipo(null,agora).tempoAte100Min,null);
  assert.equal(diagnosticarPrototipo({...serie([0,0,0]),timestamp:agora-60000},agora).confiavel,false);
});
test('não prevê enchimento em nível estável',()=>{
  const d=diagnosticarPrototipo(serie([16.7,16.7,16.7,16.7,16.7,16.7,16.7,16.7,16.7,16.7]),agora);
  assert.equal(d.tempoAte100Min,null);
  assert.equal(d.tendencia,'estavel');
});
test('projeção de subida exige mais que um único salto entre eletrodos',()=>{
  const d=diagnosticarPrototipo(serie([0,0,0,0,0,0,0,16.7,16.7,16.7]),agora);
  assert.equal(d.confiavel,false);
  assert.equal(d.tempoAte100Min,null);
});
test('subida sustentada de contatos pode gerar extrapolação experimental',()=>{
  const d=diagnosticarPrototipo(serie([0,0,16.7,16.7,33.3,33.3,50,50,66.7,66.7]),agora);
  assert.equal(d.confiavel,true);
  assert.ok(d.taxaPctMin>0);
  assert.ok(d.tempoAte100Min>0);
});
test('limite atingido não exige extrapolação',()=>{
  const d=diagnosticarPrototipo(serie([100]),agora);
  assert.equal(d.tempoAte100Min,0);
  assert.equal(d.confiavel,false);
});

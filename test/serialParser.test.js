import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinhaSerial } from '../src/core/serialParser.js';

test('JSON individual do firmware oficial', () => {
  const r = parseLinhaSerial('{"bueiro":1,"dist_cm":11.0,"raw":110}');
  assert.equal(r.tipo, 'leituras');
  assert.deepEqual(r.leituras, [{ bueiroId: 'bueiro_1', distanciaCm: 11, nivelPct: undefined, raw: 110, formato: 'json' }]);
});

test('JSON com nível percentual', () => {
  const r = parseLinhaSerial('{"id":"02","nivel_pct":55}');
  assert.equal(r.leituras[0].bueiroId, 'bueiro_2');
  assert.equal(r.leituras[0].nivelPct, 55);
});

test('JSON combinado com os dois bueiros', () => {
  const r = parseLinhaSerial('{"b1":14.5,"b2":{"dist_cm":18.2}}');
  assert.deepEqual(r.leituras.map((l) => [l.bueiroId, l.distanciaCm]), [['bueiro_1', 14.5], ['bueiro_2', 18.2]]);
});

test('formato texto e CSV', () => {
  assert.deepEqual(parseLinhaSerial('B1: 14.5, B2: 18.2').leituras.map((l) => l.distanciaCm), [14.5, 18.2]);
  assert.equal(parseLinhaSerial('BUEIRO 2 = 7').leituras[0].bueiroId, 'bueiro_2');
  assert.equal(parseLinhaSerial('2, 18.2').leituras[0].distanciaCm, 18.2);
});

test('mensagens de status e erro do sensor não são falhas de parser', () => {
  assert.equal(parseLinhaSerial('{"status":"HYDRASMART_FIRMWARE_V2_READY","baud":115200}').tipo, 'status');
  assert.equal(parseLinhaSerial('{"bueiro":1,"erro":"FORA_DE_ALCANCE"}').tipo, 'erro_sensor');
});

test('ruído e linhas corrompidas são rejeitados', () => {
  for (const linha of ['RUÍDO_@@@', '', '{"bueiro":', '12, 15', '{"bueiro":9,"dist_cm":3}']) {
    assert.equal(parseLinhaSerial(linha).tipo, 'invalida', linha);
  }
});

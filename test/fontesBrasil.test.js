import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarTabelaNivel, obterNivelBlumenau } from '../src/services/fontesBrasil.js';

test('extrai leituras com horário de Brasília e números decimais da tabela do AlertaBlu', () => {
  const html = '<table><tr><th>Hora da Leitura</th><th>Nível (m)</th><th>Variação</th></tr>' +
    '<tr><td>05/11/2026 12:00</td><td>5,67</td><td>0,12</td></tr>' +
    '<tr><td>05/11/2026 11:00</td><td>5,55</td><td>0,10</td></tr></table>';
  const leituras = interpretarTabelaNivel(html, Date.parse('2026-11-05T16:00:00Z'));
  assert.equal(leituras.length, 2);
  assert.equal(leituras[0].nivelMetros, 5.67);
  assert.equal(leituras[0].variacaoMetros, 0.12);
  assert.equal(leituras[0].horario, '2026-11-05T15:00:00.000Z');
});

test('recusa números inválidos e datas do futuro', () => {
  const html = '<table><tr><td>05/11/2026 12:00</td><td>desconhecido</td></tr>' +
    '<tr><td>06/11/2026 12:00</td><td>9,99</td></tr></table>';
  assert.deepEqual(interpretarTabelaNivel(html, Date.parse('2026-11-05T16:00:00Z')), []);
});

test('fonte inacessível não fabrica nível do rio', async () => {
  const resultado = await obterNivelBlumenau({
    fetcher: async () => { throw new Error('rede indisponível'); }
  });
  assert.equal(resultado.status, 'indisponivel');
  assert.equal(resultado.ultimaLeitura, null);
});

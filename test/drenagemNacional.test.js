import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarBbox } from '../src/routes/drenagemNacional.js';

test('aceita janela pequena na região de qualquer cidade do Brasil', () => {
  assert.deepEqual(validarBbox('-56.10,-16.10,-56.05,-16.05'), [-56.1,-16.1,-56.05,-16.05]);
  assert.deepEqual(validarBbox('-43.45,-21.83,-43.39,-21.78'), [-43.45,-21.83,-43.39,-21.78]);
});
test('rejeita consultas continentais para proteger os serviços públicos', () => {
  assert.equal(validarBbox('-74,-34,-34,6'), null);
  assert.equal(validarBbox('-56.5,-16.5,-56.0,-16.0'), null);
  assert.equal(validarBbox('-80,-16,-79,-15'), null);
  assert.equal(validarBbox('-56.01,-16,-56.03,-16.02'), null);
});
test('rejeita parâmetros não numéricos e bbox incompleta', () => {
  assert.equal(validarBbox('a,b,c,d'), null);
  assert.equal(validarBbox('-56,-16,-55'), null);
});

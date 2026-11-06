import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNomeMunicipio, sugestoesMunicipios, distanciaEdicao } from '../src/services/buscaMunicipios.js';

const cidades = [
  { id: 1, nome: 'Cáceres', estado: 'MT' },
  { id: 2, nome: 'São Paulo', estado: 'SP' },
  { id: 3, nome: 'Porto Alegre', estado: 'RS' },
  { id: 4, nome: 'Belo Horizonte', estado: 'MG' },
  { id: 5, nome: 'Blumenau', estado: 'SC' }
];

test('normaliza acentos e sinais para busca', () => {
  assert.equal(normalizarNomeMunicipio('SÃO PAULO!'), 'sao paulo');
  assert.equal(normalizarNomeMunicipio('  cáCeReS  '), 'caceres');
});

test('sugere nomes reais para cidade sem acento', () => {
  assert.equal(sugestoesMunicipios(cidades, 'caceres')[0].nome, 'Cáceres');
  assert.equal(sugestoesMunicipios(cidades, 'sao paulo')[0].nome, 'São Paulo');
});

test('aceita pequenos erros de escrita e prefixo', () => {
  assert.equal(sugestoesMunicipios(cidades, 'Blumena')[0].nome, 'Blumenau');
  assert.equal(sugestoesMunicipios(cidades, 'porto alegri')[0].nome, 'Porto Alegre');
  assert.equal(sugestoesMunicipios(cidades, 'belo horiznte')[0].nome, 'Belo Horizonte');
});

test('não apresenta nomes aleatórios para termo desconexo', () => {
  assert.deepEqual(sugestoesMunicipios(cidades, 'xyzqwv'), []);
  assert.equal(distanciaEdicao('caceres', 'caceres'), 0);
});

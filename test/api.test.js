/**
 * Testes de integração da API (Fastify em memória, sem banco e sem porta USB).
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { carregarConfig } from '../src/config.js';
import { criarRepositoriosMemoria } from '../src/repositories/memoria.js';
import { criarContexto } from '../src/container.js';
import { construirApp } from '../src/app.js';

const CHAVE_OPERADOR = 'chave-operador-teste';
const OPERADOR = { 'x-operator-key': CHAVE_OPERADOR };
const logMudo = { info() {}, warn() {}, error() {}, debug() {} };
let ctx;
let app;

async function montar(env = {}) {
  const config = carregarConfig({ NODE_ENV: 'test', SERIAL_ENABLED: 'false', OPERATOR_API_KEY: CHAVE_OPERADOR, ...env });
  ctx = await criarContexto({ config, repositorios: criarRepositoriosMemoria(), log: logMudo });
  app = await construirApp(ctx);
  await app.ready();
}

const enviar = (corpo, headers = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/leituras', payload: corpo, headers });

beforeEach(() => montar());
afterEach(async () => {
  await app.close();
  await ctx.encerrar();
});

test('health responde com o tipo de banco', async () => {
  const r = await app.inject('/api/v1/health');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().banco, 'memoria (sem PostgreSQL)');
});

test('leitura via HTTP é convertida, exibida ao vivo e gravada', async () => {
  const r = await enviar({ bueiroId: 1, distanciaCm: 11 });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().nivelPct, 50);

  const estado = (await app.inject('/api/v1/estado')).json();
  assert.equal(estado.bueiros.bueiro_1.nivelPct, 50);
  assert.equal(estado.bueiros.bueiro_2.conectado, false, 'bueiro 2 não é contaminado pelo bueiro 1');

  const historico = (await app.inject('/api/v1/leituras')).json();
  assert.equal(historico.length, 1);
});

test('leituras inválidas são rejeitadas', async () => {
  assert.equal((await enviar({ bueiroId: 1, distanciaCm: 500 })).statusCode, 422);
  assert.equal((await enviar({ bueiroId: 9, distanciaCm: 10 })).statusCode, 422);
  assert.equal((await enviar({ bueiroId: 1 })).statusCode, 400);
});

test('X-API-Key é exigida quando configurada', async () => {
  await app.close();
  await ctx.encerrar();
  await montar({ INGEST_API_KEY: 'segredo-123' });
  assert.equal((await enviar({ bueiroId: 1, distanciaCm: 11 })).statusCode, 401);
  assert.equal((await enviar({ bueiroId: 1, distanciaCm: 11 }, { 'x-api-key': 'errada' })).statusCode, 401);
  assert.equal((await enviar({ bueiroId: 1, distanciaCm: 11 }, { 'x-api-key': 'segredo-123' })).statusCode, 201);
});

test('alerta crítico abre acima do limiar e encerra quando o nível baixa', async () => {
  await enviar({ bueiroId: 2, distanciaCm: 3 }); // 94,4%
  let ativos = (await app.inject('/api/v1/alertas?ativos=true')).json();
  assert.equal(ativos.length, 1);
  assert.equal(ativos[0].bueiroId, 'bueiro_2');

  await enviar({ bueiroId: 2, distanciaCm: 2.2 }); // pico maior, mesmo alerta
  await enviar({ bueiroId: 2, distanciaCm: 15 }); // normalizou
  ativos = (await app.inject('/api/v1/alertas?ativos=true')).json();
  assert.equal(ativos.length, 0);
  const todos = (await app.inject('/api/v1/alertas')).json();
  assert.equal(todos.length, 1);
  assert.ok(todos[0].nivelPctPico > 98);
});

test('calibração altera a conversão das próximas leituras', async () => {
  const r = await app.inject({ method: 'PUT', url: '/api/v1/bueiros/bueiro_1/calibracao', payload: { alturaTotalCm: 40, distanciaCegaCm: 4 } , headers: OPERADOR });
  assert.equal(r.statusCode, 200);
  const leitura = (await enviar({ bueiroId: 1, distanciaCm: 22 })).json();
  assert.equal(leitura.nivelPct, 50); // (40-22)/36
  const invalida = await app.inject({ method: 'PUT', url: '/api/v1/bueiros/1/calibracao', payload: { alturaTotalCm: 'abc' } , headers: OPERADOR });
  assert.equal(invalida.statusCode, 400);
});

test('coordenadas são confirmadas e removidas', async () => {
  const put = await app.inject({ method: 'PUT', url: '/api/v1/bueiros/2/coordenadas', payload: { latitude: -16.0718, longitude: -57.6789 } , headers: OPERADOR });
  assert.equal(put.json().coordenadasConfirmadas, true);
  const del = await app.inject({ method: 'DELETE', url: '/api/v1/bueiros/2/coordenadas' , headers: OPERADOR });
  assert.equal(del.json().coordenadasConfirmadas, false);
  const fora = await app.inject({ method: 'PUT', url: '/api/v1/bueiros/2/coordenadas', payload: { latitude: 120, longitude: 0 } , headers: OPERADOR });
  assert.equal(fora.statusCode, 400);
});

test('modo demonstração não grava dados simulados no banco', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/v1/simulacao/iniciar', payload: { cenario: 'tempestade_transbordo' } , headers: OPERADOR });
  assert.equal(r.statusCode, 200);
  const estado = r.json();
  assert.equal(estado.modo, 'demo');
  assert.ok(estado.bueiros.bueiro_1.nivelPct > 80);
  assert.equal(estado.maquete3D.status, 'simulado');
  assert.equal(estado.alertasAtivos.length, 2);

  assert.equal((await app.inject('/api/v1/leituras')).json().length, 0);
  assert.equal((await app.inject('/api/v1/alertas')).json().length, 0, 'alertas simulados ficam fora da lista padrão');

  const fim = (await app.inject({ method: 'POST', url: '/api/v1/simulacao/encerrar' , headers: OPERADOR })).json();
  assert.equal(fim.modo, 'real');
  assert.equal(fim.alertasAtivos.length, 0);
  assert.equal(fim.bueiros.bueiro_1.conectado, false);
});

test('linhas da serial passam pelo mesmo fluxo de leitura', async () => {
  assert.equal(await ctx.serial.processarLinha('{"bueiro":1,"dist_cm":11.0,"raw":110}'), true);
  assert.equal(await ctx.serial.processarLinha('{"bueiro":2,"dist_cm":6.5}'), true);
  assert.equal(await ctx.serial.processarLinha('{"bueiro":1,"dist_cm":500}'), false);
  assert.equal(await ctx.serial.processarLinha('RUIDO'), false);

  const { bueiros, serial } = ctx.snapshotCompleto();
  assert.equal(bueiros.bueiro_1.nivelPct, 50);
  assert.equal(bueiros.bueiro_1.origem, 'Arduino USB');
  assert.equal(bueiros.bueiro_2.alturaAguaCm, 13.5);
  assert.equal(serial.leiturasRecebidas, 2);
  assert.equal(serial.errosParser, 2);
});

test('relatório CSV traz cabeçalho e leituras', async () => {
  await enviar({ bueiroId: 1, distanciaCm: 11 });
  const r = await app.inject('/api/v1/relatorios/leituras.csv');
  assert.equal(r.statusCode, 200);
  const linhas = r.body.trim().split('\r\n');
  assert.match(linhas[0], /bueiro_id;registrado_em_utc/);
  assert.equal(linhas.length, 2);
});

test('série histórica agrega leituras por intervalo', async () => {
  await enviar({ bueiroId: 1, distanciaCm: 11 }); // 50%
  await enviar({ bueiroId: 1, distanciaCm: 2 }); // 100%
  await enviar({ bueiroId: 2, distanciaCm: 20 }); // 0%
  const desde = new Date(Date.now() - 3600e3).toISOString();
  const r = await app.inject(`/api/v1/leituras/serie?desde=${encodeURIComponent(desde)}&intervaloSegundos=3600`);
  assert.equal(r.statusCode, 200);
  const b1 = r.json().find((p) => p.bueiroId === 'bueiro_1');
  assert.equal(b1.nivelMedioPct, 75);
  assert.equal(b1.nivelMaximoPct, 100);
  assert.equal(b1.totalLeituras, 2);

  const excessivo = await app.inject(`/api/v1/leituras/serie?desde=2020-01-01T00:00:00Z&intervaloSegundos=10`);
  assert.equal(excessivo.statusCode, 400);
});

test('ações de operador exigem a chave correta', async () => {
  const semChave = await app.inject({ method: 'POST', url: '/api/v1/simulacao/iniciar', payload: {} });
  assert.equal(semChave.statusCode, 401);
  const errada = await app.inject({ method: 'POST', url: '/api/v1/simulacao/iniciar', payload: {}, headers: { 'x-operator-key': 'outra' } });
  assert.equal(errada.statusCode, 401);
  const certa = await app.inject({ method: 'POST', url: '/api/v1/simulacao/encerrar', headers: OPERADOR });
  assert.equal(certa.statusCode, 200);
  // Leituras de sensores em campo usam a X-API-Key própria, não a chave do operador
  assert.equal((await enviar({ bueiroId: 1, distanciaCm: 11 })).statusCode, 201);
});

test('sem OPERATOR_API_KEY configurada as ações de operador ficam bloqueadas (falha segura)', async () => {
  await app.close();
  await ctx.encerrar();
  await montar({ OPERATOR_API_KEY: '' });
  const r = await app.inject({ method: 'POST', url: '/api/v1/simulacao/iniciar', payload: {}, headers: OPERADOR });
  assert.equal(r.statusCode, 503);
});

test('rota inexistente devolve 404 em JSON', async () => {
  const r = await app.inject('/api/v1/nao-existe');
  assert.equal(r.statusCode, 404);
  assert.ok(r.json().erro);
});

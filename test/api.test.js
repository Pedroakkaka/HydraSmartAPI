/**
 * Testes de integração da API (Fastify em memória, sem banco e sem porta USB).
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { carregarConfig } from '../src/config.js';
import { criarRepositoriosMemoria } from '../src/repositories/memoria.js';
import { criarContexto } from '../src/container.js';
import { construirApp } from '../src/app.js';
import { CemadenService } from '../src/services/cemadenService.js';

const logMudo = { info() {}, warn() {}, error() {}, debug() {} };
const operatorKey = 'test-only-hydrasmart-operator-key';
const operatorHeaders = { 'x-operator-key': operatorKey };
let ctx;
let app;

async function montar(env = {}) {
  const config = carregarConfig({ NODE_ENV: 'test', SERIAL_ENABLED: 'false', OPERATOR_API_KEY: operatorKey, ...env });
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

test('operações administrativas exigem a chave de operador', async () => {
  const url = '/api/v1/simulacao/iniciar';
  const payload = { cenario: 'chuva_moderada' };
  assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url, payload, headers: { 'x-operator-key': 'incorreta' } })).statusCode, 401);
});

test('IA permanece desativada sem ativação explícita e não chama serviço externo', async () => {
  const fetchOriginal = globalThis.fetch;
  let chamadasExternas = 0;
  globalThis.fetch = async () => { chamadasExternas++; throw new Error('chamada externa inesperada'); };
  try {
    const semAutenticacao = await app.inject({ method: 'POST', url: '/api/v1/ia/analisar', payload: { pergunta: 'Teste sem dados pagos' } });
    assert.equal(semAutenticacao.statusCode, 401);
    const resposta = await app.inject({ method: 'POST', url: '/api/v1/ia/analisar', headers: operatorHeaders, payload: { pergunta: 'Teste sem dados pagos' } });
    assert.equal(resposta.statusCode, 503);
    assert.equal(chamadasExternas, 0);
    assert.equal((await app.inject('/api/v1/ia/relatorio')).json().status, 'indisponivel');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('CEMADEN preserva a última resposta válida como desatualizada após falha', async () => {
  const fetchOriginal = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => {
    chamadas++;
    if (chamadas > 1) throw new Error('indisponibilidade simulada');
    return { ok: true, json: async () => ({ data: [{ municipio: 'Porto Alegre', codigo: 'estacao-teste', chuva: 2.4 }] }) };
  };
  try {
    const cemaden = new CemadenService({ token: 'unit-test-token', log: logMudo, ttlMs: 0 });
    const atual = await cemaden.obter();
    const anterior = await cemaden.obter({ forcar: true });
    assert.equal(atual.status, 'sucesso');
    assert.equal(anterior.status, 'desatualizado');
    assert.equal(anterior.ultimaConsulta, atual.ultimaConsulta);
    assert.deepEqual(anterior.dadosEstacaoPortoAlegre, atual.dadosEstacaoPortoAlegre);
    assert.ok(anterior.erroMensagem);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('Defesa Civil preserva a última consulta válida como desatualizada após falha', async () => {
  const fetchOriginal = globalThis.fetch;
  const nowOriginal = Date.now;
  let agora = nowOriginal();
  Date.now = () => agora;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { tags_data: {
      qualle_meteorologia: [{ codigo: 'DCRS-00044', name: { general: 'Estação teste' }, position: {}, data: {} }],
      proximaAtualizacaoEm: null
    } } })
  });
  try {
    const atual = await app.inject('/api/v1/hidrologia/estacoes');
    assert.equal(atual.statusCode, 200);
    assert.equal(atual.json().status, 'sucesso');
    const consultadoEm = atual.json().consultadoEm;
    agora += 300_001;
    globalThis.fetch = async () => { throw new Error('indisponibilidade simulada'); };
    const anterior = await app.inject('/api/v1/hidrologia/estacoes');
    assert.equal(anterior.statusCode, 200);
    assert.equal(anterior.json().status, 'desatualizado');
    assert.equal(anterior.json().consultadoEm, consultadoEm);
    assert.equal(anterior.json().estacoes.length, 1);
    assert.ok(anterior.json().erroMensagem);
  } finally {
    Date.now = nowOriginal;
    globalThis.fetch = fetchOriginal;
  }
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
  const r = await app.inject({ method: 'PUT', url: '/api/v1/bueiros/bueiro_1/calibracao', payload: { alturaTotalCm: 40, distanciaCegaCm: 4 }, headers: operatorHeaders });
  assert.equal(r.statusCode, 200);
  const leitura = (await enviar({ bueiroId: 1, distanciaCm: 22 })).json();
  assert.equal(leitura.nivelPct, 50); // (40-22)/36
  const invalida = await app.inject({ method: 'PUT', url: '/api/v1/bueiros/1/calibracao', payload: { alturaTotalCm: 'abc' }, headers: operatorHeaders });
  assert.equal(invalida.statusCode, 400);
});

test('coordenadas são confirmadas e removidas', async () => {
  const put = await app.inject({ method: 'PUT', url: '/api/v1/bueiros/2/coordenadas', payload: { latitude: -30.0346, longitude: -51.2177 }, headers: operatorHeaders });
  assert.equal(put.json().coordenadasConfirmadas, true);
  const del = await app.inject({ method: 'DELETE', url: '/api/v1/bueiros/2/coordenadas', headers: operatorHeaders });
  assert.equal(del.json().coordenadasConfirmadas, false);
  const fora = await app.inject({ method: 'PUT', url: '/api/v1/bueiros/2/coordenadas', payload: { latitude: 120, longitude: 0 }, headers: operatorHeaders });
  assert.equal(fora.statusCode, 400);
});

test('modo demonstração não grava dados simulados no banco', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/v1/simulacao/iniciar', payload: { cenario: 'tempestade_transbordo' }, headers: operatorHeaders });
  assert.equal(r.statusCode, 200);
  const estado = r.json();
  assert.equal(estado.modo, 'demo');
  assert.ok(estado.bueiros.bueiro_1.nivelPct > 80);
  assert.equal(estado.maquete3D.status, 'simulado');
  assert.equal(estado.alertasAtivos.length, 2);

  assert.equal((await app.inject('/api/v1/leituras')).json().length, 0);
  assert.equal((await app.inject('/api/v1/alertas')).json().length, 0, 'alertas simulados ficam fora da lista padrão');

  const fim = (await app.inject({ method: 'POST', url: '/api/v1/simulacao/encerrar', headers: operatorHeaders })).json();
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

test('relatório de auditoria identifica o município configurado', async () => {
  const r = await app.inject('/api/v1/relatorios/auditoria.json');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().municipio, 'Porto Alegre - RS');
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

test('rota inexistente devolve 404 em JSON', async () => {
  const r = await app.inject('/api/v1/nao-existe');
  assert.equal(r.statusCode, 404);
  assert.ok(r.json().erro);
});

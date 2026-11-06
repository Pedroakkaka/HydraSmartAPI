import test from 'node:test';
import assert from 'node:assert/strict';
import { CALIBRACAO_PADRAO } from '../src/core/calibration.js';
import { TelemetryState, MODOS } from '../src/domain/telemetryState.js';
import { IngestService, ORIGENS } from '../src/services/ingestService.js';

test('origens separadas: bancada, cenário sintético e campo', async () => {
  const estado = new TelemetryState({
    calibracoes: Object.values(CALIBRACAO_PADRAO),
    serialHabilitada: false
  });
  const banco = [];
  const alertas = [];
  const ingest = new IngestService({
    estado,
    repositorios: { leituras: { inserir: async (leitura) => { banco.push(leitura); } } },
    alertas: { avaliar: async (leitura, classificacao) => { alertas.push({ leitura, classificacao }); } },
    log: { error() {} }
  });

  assert.equal((await ingest.registrar({
    bueiroId: 'bueiro_1', nivelPct: 24, origem: ORIGENS.ARDUINO_USB
  })).aceita, true);
  assert.equal(estado.snapshot().canais.prototipo.bueiro_1.natureza, 'experimental');
  assert.equal(estado.snapshot().canais.campo.bueiro_1, undefined);
  assert.equal(banco.length, 0);
  assert.equal(alertas[0].classificacao.simulado, true);

  estado.definirModo(MODOS.DEMO);
  assert.equal((await ingest.registrar({
    bueiroId: 'bueiro_1', nivelPct: 90, origem: ORIGENS.SIMULADOR
  })).aceita, true);
  assert.equal(estado.snapshot().canais.demonstracao.bueiro_1.natureza, 'sintetico');
  assert.equal(estado.snapshot().canais.prototipo.bueiro_1.nivelPct, 24);
  assert.equal(banco.length, 0);
  assert.equal(alertas[1].classificacao.canal, 'demonstracao');

  assert.equal((await ingest.registrar({
    bueiroId: 'bueiro_1', nivelPct: 42, origem: ORIGENS.HTTP
  })).aceita, true);
  assert.equal(estado.snapshot().canais.campo.bueiro_1.natureza, 'campo');
  assert.equal(estado.snapshot().canais.demonstracao.bueiro_1.nivelPct, 90);
  assert.equal(banco.length, 1);
  assert.equal(banco[0].origem, ORIGENS.HTTP);
  assert.equal(alertas[2].classificacao.simulado, false);
  assert.equal(alertas[2].classificacao.canal, 'campo');
});

test('simulação sintética não entra no modo real', async () => {
  const estado = new TelemetryState({ calibracoes: Object.values(CALIBRACAO_PADRAO) });
  const ingest = new IngestService({
    estado,
    repositorios: { leituras: { inserir: async () => {} } },
    alertas: { avaliar: async () => {} },
    log: { error() {} }
  });
  const resultado = await ingest.registrar({
    bueiroId: 'bueiro_2', nivelPct: 85, origem: ORIGENS.SIMULADOR
  });
  assert.equal(resultado.aceita, false);
  assert.deepEqual(estado.snapshot().canais.demonstracao, {});
});

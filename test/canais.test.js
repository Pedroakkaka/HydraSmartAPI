import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IngestService, ORIGENS } from '../src/services/ingestService.js';
import { CALIBRACAO_PADRAO } from '../src/core/calibration.js';

test('canais isolados: Arduino alimenta protótipo; HTTP alimenta campo; simulação não mistura', async () => {
  const cfg = CALIBRACAO_PADRAO.bueiro_1;
  const estado = {
    modo: 'real', calibracoes: { bueiro_1: cfg },
    aplicarLeitura() {}, _emitir() {}
  };
  const ingest = new IngestService({
    estado,
    repositorios: { leituras: { inserir: async () => {} } },
    alertas: { avaliar: async () => {} },
    log: { error() {} }
  });
  const timestamp = Date.now();
  assert.equal((await ingest.registrar({
    bueiroId: 'bueiro_1', nivelPct: 25, origem: ORIGENS.ARDUINO_USB, timestamp
  })).aceita, true);
  assert.equal(ingest.snapshotCanais().prototipo.bueiro_1.nivelPct, 25);
  assert.equal(ingest.snapshotCanais().prototipo.bueiro_1.natureza, 'experimental');
  assert.equal(Object.keys(ingest.snapshotCanais().campo).length, 0);
  assert.equal((await ingest.registrar({
    bueiroId: 'bueiro_1', nivelPct: 70, origem: ORIGENS.HTTP, timestamp
  })).aceita, true);
  assert.equal(ingest.snapshotCanais().campo.bueiro_1.nivelPct, 70);
  assert.equal(ingest.snapshotCanais().prototipo.bueiro_1.nivelPct, 25);
  assert.equal((await ingest.registrar({
    bueiroId: 'bueiro_1', nivelPct: 99, origem: ORIGENS.SIMULADOR, timestamp
  })).aceita, false);
  assert.equal(ingest.snapshotCanais().prototipo.bueiro_1.nivelPct, 25);
});

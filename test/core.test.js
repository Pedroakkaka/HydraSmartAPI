import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DataValidator } from '../src/core/validator.js';
import { RiskRules, RISK_LEVELS } from '../src/core/riskRules.js';
import { CoreCalculator } from '../src/core/calculator.js';
import {
  CALIBRACAO_PADRAO,
  converterDistanciaParaNivel,
  converterNivelParaGrandezas,
  normalizarBueiroId,
  sanitizarParametros
} from '../src/core/calibration.js';

const cfg = CALIBRACAO_PADRAO.bueiro_1; // H_total 20 cm, zona cega 2 cm, H_útil 18 cm, 2000 mL

test('DataValidator normaliza e rejeita valores', () => {
  assert.equal(DataValidator.normalizarNivel(55.44), 55.4);
  assert.equal(DataValidator.normalizarNivel(140), 100);
  assert.equal(DataValidator.normalizarNivel(-20), 0);
  assert.equal(DataValidator.normalizarNivel(NaN), null);
  assert.equal(DataValidator.normalizarNivel(null), null);
  assert.equal(DataValidator.converterAdcParaPercentual(1023), 100);
  assert.equal(DataValidator.converterAdcParaPercentual(512), 50);
  assert.equal(DataValidator.validarCoordenadas([-16.0718, -57.6789]), true);
  assert.equal(DataValidator.validarCoordenadas([95, -57]), false);
  assert.equal(DataValidator.validarDistanciaUltrassonica(15.5), 15.5);
  assert.equal(DataValidator.validarDistanciaUltrassonica(-2), null);
  assert.equal(DataValidator.validarDistanciaUltrassonica(450), null);
});

test('RiskRules classifica com limiares padrão', () => {
  assert.equal(RiskRules.classificarNivel(49.9), RISK_LEVELS.NORMAL);
  assert.equal(RiskRules.classificarNivel(50), RISK_LEVELS.ATENCAO);
  assert.equal(RiskRules.classificarNivel(79.9), RISK_LEVELS.ATENCAO);
  assert.equal(RiskRules.classificarNivel(80), RISK_LEVELS.CRITICO);
  assert.equal(RiskRules.classificarNivel(null), RISK_LEVELS.DESCONHECIDO);
  assert.equal(RiskRules.exigeAlertaEmergencia(RISK_LEVELS.CRITICO), true);
  assert.equal(RiskRules.exigeAlertaEmergencia(RISK_LEVELS.ATENCAO), false);
});

test('RiskRules respeita limiares calibrados por bueiro', () => {
  const limites = { limiteAtencaoPct: 40, limiteCriticoPct: 70 };
  assert.equal(RiskRules.classificarNivel(45, limites), RISK_LEVELS.ATENCAO);
  assert.equal(RiskRules.classificarNivel(72, limites), RISK_LEVELS.CRITICO);
});

test('CoreCalculator calcula taxa, tendência e tempo até o limiar', () => {
  const taxa = CoreCalculator.calcularTaxaVariacao([30, 42], [1_000_000, 1_060_000]);
  assert.equal(taxa.taxaMinuto, 12);
  assert.equal(taxa.tendencia, 'elevacao');
  assert.equal(CoreCalculator.estimarTempoAteLimiar(60, 2, 80).minutosEstimados, 10);
  assert.equal(CoreCalculator.estimarTempoAteLimiar(60, -1, 80).minutosEstimados, null);
  assert.equal(CoreCalculator.formatarDuracao(4), '4 min');
});

test('Conversão distância → nível segue a física do HC-SR04', () => {
  assert.equal(converterDistanciaParaNivel(cfg, 20).nivelPct, 0, 'seco na altura total');
  const meio = converterDistanciaParaNivel(cfg, 11);
  assert.equal(meio.nivelPct, 50);
  assert.equal(meio.alturaAguaCm, 9);
  assert.equal(meio.volumeMl, 1000);
  assert.equal(converterDistanciaParaNivel(cfg, 2).nivelPct, 100, 'zona cega = cheio');
  assert.equal(converterDistanciaParaNivel(cfg, 6.5).alturaAguaCm, 13.5);
  assert.equal(converterDistanciaParaNivel(cfg, 500).valido, false, 'fora do alcance do sensor');
});

test('Conversão nível → grandezas (simulador / dispositivos que mandam %)', () => {
  const g = converterNivelParaGrandezas(cfg, 50);
  assert.equal(g.alturaAguaCm, 9);
  assert.equal(g.distanciaMedidaCm, 11);
  assert.equal(g.volumeMl, 1000);
  assert.equal(converterNivelParaGrandezas(cfg, 'x').valido, false);
});

test('normalizarBueiroId aceita os formatos usados pelo firmware e pela API', () => {
  for (const v of [1, '1', '01', 'b1', 'bueiro1', 'bueiro_1']) assert.equal(normalizarBueiroId(v), 'bueiro_1');
  for (const v of [2, '02', 'bueiro_2']) assert.equal(normalizarBueiroId(v), 'bueiro_2');
  assert.equal(normalizarBueiroId('12'), null, 'não confunde 12 com bueiro 2');
  assert.equal(normalizarBueiroId(undefined), null);
});

test('sanitizarParametros aplica travas físicas', () => {
  const r = sanitizarParametros(cfg, { alturaTotalCm: 1, distanciaCegaCm: 50, limiteAtencaoPct: 70, limiteCriticoPct: 60 });
  assert.equal(r.alturaTotalCm, 5);
  assert.equal(r.distanciaCegaCm, 3);
  assert.equal(r.limiteCriticoPct, 75, 'crítico sempre pelo menos 5 pontos acima da atenção');
  assert.equal(sanitizarParametros(cfg, {}).alturaTotalCm, 20, 'campos ausentes mantêm o valor atual');
});

test('Previsão rejeita séries com poucas amostras', () => {
  const agora = 1_800_000_000_000;
  const serie = { niveis: [50, 51], timestamps: [agora - 5000, agora], agoraMs: agora };
  assert.equal(CoreCalculator.avaliarConfiabilidadeSerie(serie.niveis, serie.timestamps, agora).confiavel, false);
  const p = CoreCalculator.estimarTempoAteLimiar(51, 2, 80, serie);
  assert.equal(p.confiavel, false);
  assert.equal(p.alcancavel, true);
});

test('Previsão valida elevação estável e rejeita oscilações', () => {
  const agora = 1_800_000_000_000;
  const timestamps = Array.from({ length: 5 }, (_, i) => agora - 20000 + i * 5000);
  const estavel = { niveis: [50, 51, 52, 53, 54], timestamps, agoraMs: agora };
  const oscilante = { ...estavel, niveis: [50, 54, 51, 56, 54] };
  assert.equal(CoreCalculator.avaliarConfiabilidadeSerie(estavel.niveis, timestamps, agora).confiavel, true);
  assert.equal(CoreCalculator.estimarTempoAteLimiar(54, 12, 80, estavel).confiavel, true);
  assert.equal(CoreCalculator.avaliarConfiabilidadeSerie(oscilante.niveis, timestamps, agora).confiavel, false);
  assert.equal(CoreCalculator.estimarTempoAteLimiar(54, 12, 80, oscilante).confiavel, false);
});

test('Previsão rejeita leituras antigas e timestamps repetidos', () => {
  const agora = 1_800_000_000_000;
  const tempos = Array.from({ length: 5 }, (_, i) => agora - 50000 + i * 5000);
  assert.equal(CoreCalculator.avaliarConfiabilidadeSerie([50,51,52,53,54], tempos, agora).confiavel, false);
  assert.equal(CoreCalculator.avaliarConfiabilidadeSerie([50,51,52,53,54], [agora - 20000, agora - 15000, agora - 10000, agora, agora], agora).confiavel, false);
  assert.equal(CoreCalculator.estimarTempoAteLimiar(60, 2, 80).confiavel, false);
});

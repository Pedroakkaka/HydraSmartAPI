/**
 * Parser das linhas enviadas pelo Arduino (função pura, sem efeitos colaterais).
 *
 * Formatos aceitos:
 *  1. JSON individual:  {"bueiro":1,"dist_cm":14.5,"raw":145}  ou  {"id":"02","nivel_pct":55}
 *  2. JSON combinado:   {"b1":14.5,"b2":18.2}  ou  {"bueiro1":{"dist_cm":15.2},"bueiro2":{...}}
 *  3. Texto:            "B1: 14.5, B2: 18.2"  ou  "BUEIRO 1 = 14.5"
 *  4. CSV:              "1, 15.4"
 *
 * Mensagens de status do firmware ({"status":...}) e avisos de erro do sensor
 * ({"bueiro":1,"erro":"FORA_DE_ALCANCE"}) são reconhecidas e não contam como falha de parser.
 *
 * @param {string} linha
 * @returns {{ tipo: 'leituras'|'status'|'erro_sensor'|'invalida', leituras: Array<{bueiroId:string, distanciaCm?:number, nivelPct?:number, raw?:number, formato:string}>, mensagem?: string }}
 */

import { normalizarBueiroId } from './calibration.js';

const numero = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function interpretarJson(json) {
  const leituras = [];

  if (json && typeof json === 'object' && json.status !== undefined && json.bueiro === undefined) {
    return { tipo: 'status', leituras, mensagem: String(json.status) };
  }

  const idBruto = json.bueiro ?? json.id ?? json.sensor ?? json.b;
  if (idBruto !== undefined && idBruto !== null && typeof idBruto !== 'object') {
    const bueiroId = normalizarBueiroId(idBruto);
    if (bueiroId && json.erro !== undefined) {
      return { tipo: 'erro_sensor', leituras, mensagem: `${bueiroId}: ${json.erro}` };
    }
    const distanciaCm = numero(json.dist_cm ?? json.distancia_cm ?? json.dist ?? json.distancia);
    const nivelPct = numero(json.nivel_pct ?? json.nivel ?? json.pct);
    if (bueiroId && (distanciaCm !== undefined || nivelPct !== undefined)) {
      leituras.push({ bueiroId, distanciaCm, nivelPct: distanciaCm === undefined ? nivelPct : undefined, raw: numero(json.raw), formato: 'json' });
    }
  }

  const combinados = [
    ['bueiro_1', json.b1 ?? json.bueiro1],
    ['bueiro_2', json.b2 ?? json.bueiro2]
  ];
  for (const [bueiroId, val] of combinados) {
    if (val === undefined || val === null) continue;
    const distanciaCm = numero(typeof val === 'object' ? (val.dist_cm ?? val.distancia_cm ?? val.distancia) : val);
    if (distanciaCm !== undefined) leituras.push({ bueiroId, distanciaCm, formato: 'json_combinado' });
  }

  return { tipo: leituras.length ? 'leituras' : 'invalida', leituras };
}

function interpretarTexto(linha) {
  const leituras = [];
  const padroes = [
    ['bueiro_1', /(?:B1|BUEIRO\s*1|SENSOR\s*1)\s*[:=]\s*(-?[\d.]+)/i],
    ['bueiro_2', /(?:B2|BUEIRO\s*2|SENSOR\s*2)\s*[:=]\s*(-?[\d.]+)/i]
  ];

  for (const [bueiroId, regex] of padroes) {
    const m = linha.match(regex);
    const distanciaCm = m ? numero(m[1]) : undefined;
    if (distanciaCm !== undefined) leituras.push({ bueiroId, distanciaCm, formato: 'texto' });
  }

  if (!leituras.length && linha.includes(',')) {
    const [id, valor] = linha.split(',').map((p) => p.trim());
    const bueiroId = normalizarBueiroId(id);
    const distanciaCm = numero(valor);
    if (bueiroId && distanciaCm !== undefined && /^\d+$/.test(id)) {
      leituras.push({ bueiroId, distanciaCm, formato: 'csv' });
    }
  }

  return { tipo: leituras.length ? 'leituras' : 'invalida', leituras };
}

export function parseLinhaSerial(linhaBruta) {
  const linha = String(linhaBruta ?? '').trim();
  if (!linha) return { tipo: 'invalida', leituras: [] };

  if (linha.startsWith('{') && linha.endsWith('}')) {
    try {
      const resultado = interpretarJson(JSON.parse(linha));
      if (resultado.tipo !== 'invalida') return resultado;
    } catch {
      // JSON malformado: tenta o parser de texto abaixo
    }
  }

  return interpretarTexto(linha);
}

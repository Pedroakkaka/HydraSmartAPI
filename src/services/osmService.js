/**
 * Elementos de drenagem reais do OpenStreetMap em Porto Alegre (via Overpass API),
 * consultados pelo servidor com cache de 6 horas e servidores alternativos.
 */

import { CacheTtl } from './cacheTtl.js';

// Área aproximada de Porto Alegre. Não representa cadastro municipal completo.
const BBOX = '-30.27,-51.31,-29.93,-51.03';
const CONSULTA = `[out:json][timeout:15];(node["manhole"="drain"](${BBOX});node["manhole"="storm_drain"](${BBOX});node["waterway"="drain"](${BBOX});way["waterway"="drain"](${BBOX}););out center 2000;`;
const SERVIDORES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
const TIMEOUT_POR_SERVIDOR_MS = 10_000;
// Após uma falha geral, espera este tempo antes de tentar de novo (não trava o painel a cada acesso).
const ESPERA_APOS_FALHA_MS = 5 * 60 * 1000;

export class OsmService {
  constructor({ log, ttlMs = 6 * 60 * 60 * 1000 }) {
    this.log = log;
    this.cache = new CacheTtl(ttlMs);
    this.falhaRecente = null; // { ate: timestamp, resposta }
  }

  /** Consulta em segundo plano na inicialização, para o mapa abrir rápido. */
  aquecer() {
    this.obterDrenos().catch(() => {});
  }

  async obterDrenos({ forcar = false } = {}) {
    if (!forcar && !this.cache.valido() && this.falhaRecente && Date.now() < this.falhaRecente.ate) {
      return this.falhaRecente.resposta;
    }
    try {
      const resultado = await this.cache.obter(() => this._consultar(), { forcar });
      this.falhaRecente = null;
      return resultado;
    } catch (err) {
      this.log.warn(`[osm] Overpass indisponível: ${err.message}`);
      const resposta = this.cache.valor
        ? { ...this.cache.valor, status: 'desatualizado' }
        : {
          status: 'indisponivel',
          mensagem: 'Overpass API/OSM temporariamente indisponível. Os elementos OSM não estão disponíveis no momento; sensores físicos são exibidos separadamente.',
          elementos: [],
          consultadoEm: new Date().toISOString()
        };
      this.falhaRecente = { ate: Date.now() + ESPERA_APOS_FALHA_MS, resposta };
      return resposta;
    }
  }

  async _consultar() {
    let ultimoErro;
    for (const servidor of SERVIDORES) {
      try {
        const resp = await fetch(servidor, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'HydraSmart-API/3.0' },
          body: new URLSearchParams({ data: CONSULTA }),
          signal: AbortSignal.timeout(TIMEOUT_POR_SERVIDOR_MS)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${servidor}`);
        const data = await resp.json();
        const elementos = (data.elements ?? [])
          .map((el) => ({
            id: el.id,
            tipo: el.tags?.manhole || el.tags?.waterway || 'dreno_urbano',
            lat: el.lat ?? el.center?.lat,
            lon: el.lon ?? el.center?.lon,
            tags: el.tags ?? {}
          }))
          .filter((el) => el.lat && el.lon);

        return {
          status: 'sucesso',
          mensagem: `${elementos.length} elementos de drenagem cadastrados no OpenStreetMap para Porto Alegre (cobertura não exaustiva).`,
          fonte: servidor,
          elementos,
          consultadoEm: new Date().toISOString()
        };
      } catch (err) {
        ultimoErro = err;
      }
    }
    throw ultimoErro;
  }
}

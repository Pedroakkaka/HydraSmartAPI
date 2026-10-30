/**
 * Elementos de drenagem reais do OpenStreetMap em Cáceres (via Overpass API),
 * consultados pelo servidor com cache de 6 horas e servidores alternativos.
 */

import { CacheTtl } from './cacheTtl.js';

const BBOX = '-16.12,-57.75,-16.02,-57.62';
const CONSULTA = `[out:json][timeout:15];(node["manhole"](${BBOX});node["waterway"="drain"](${BBOX});way["waterway"="drain"](${BBOX}););out center 200;`;
const SERVIDORES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

export class OsmService {
  constructor({ log, ttlMs = 6 * 60 * 60 * 1000 }) {
    this.log = log;
    this.cache = new CacheTtl(ttlMs);
  }

  async obterDrenos({ forcar = false } = {}) {
    try {
      return await this.cache.obter(() => this._consultar(), { forcar });
    } catch (err) {
      this.log.warn(`[osm] Overpass indisponível: ${err.message}`);
      if (this.cache.valor) return { ...this.cache.valor, status: 'desatualizado' };
      return {
        status: 'indisponivel',
        mensagem: 'Overpass API/OSM temporariamente indisponível. A drenagem exibida baseia-se nos sensores do protótipo.',
        elementos: [],
        consultadoEm: new Date().toISOString()
      };
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
          signal: AbortSignal.timeout(15_000)
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
          mensagem: `${elementos.length} elementos de drenagem obtidos do OpenStreetMap.`,
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

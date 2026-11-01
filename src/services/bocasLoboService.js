/**
 * Cadastro georreferenciado de bocas de lobo da Prefeitura de Porto Alegre (SMAMUS).
 * Fonte: serviço ArcGIS público; somente leitura, com consulta limitada por área.
 * Não confundir cadastro de infraestrutura com sensores em tempo real.
 */
import { CacheTtl } from './cacheTtl.js';

const URL = 'https://gis-smamus.portoalegre.rs.gov.br/server/rest/services/01_PUBLICACOES/bocas_de_lobo/FeatureServer/0/query';
const LIMITE = 2000;

export class BocasLoboService {
  constructor({ log, ttlMs = 60 * 60 * 1000 }) {
    this.log = log;
    this.cache = new CacheTtl(ttlMs);
  }

  async obter({ forcar = false, bbox } = {}) {
    // A consulta por extensão reduz carga, tráfego e tempo de renderização.
    const coords = String(bbox || '-51.27,-30.09,-51.15,-29.98').split(',').map(Number);
    if (coords.length !== 4 || coords.some((n) => !Number.isFinite(n)) ||
        coords[0] >= coords[2] || coords[1] >= coords[3] ||
        coords[2] - coords[0] > 0.25 || coords[3] - coords[1] > 0.25 ||
        coords[0] < -51.7 || coords[2] > -50.9 || coords[1] < -30.4 || coords[3] > -29.8) {
      return { status: 'bbox_invalida', elementos: [], mensagem: 'Extensão de mapa inválida ou muito ampla.' };
    }
    const chave = coords.join(',');
    if (!this.caches) this.caches = new Map();
    if (!this.caches.has(chave)) {
      if (this.caches.size >= 12) this.caches.delete(this.caches.keys().next().value);
      this.caches.set(chave, new CacheTtl(60 * 60 * 1000));
    }
    const cache = this.caches.get(chave);
    try {
      return await cache.obter(async () => {
        const params = new URLSearchParams({
          f: 'json', where: '1=1', outFields: '*', returnGeometry: 'true',
          outSR: '4326', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
          geometryType: 'esriGeometryEnvelope',
          geometry: JSON.stringify({ xmin: coords[0], ymin: coords[1], xmax: coords[2], ymax: coords[3], spatialReference: { wkid: 4326 } }),
          resultRecordCount: String(LIMITE)
        });
        const response = await fetch(URL + '?' + params, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || 'Erro no serviço geográfico');
        const elementos = (data.features || []).map((feature) => ({
          id: feature.attributes?.OBJECTID ?? feature.attributes?.objectid ?? null,
          lat: feature.geometry?.y, lon: feature.geometry?.x,
          tipo: feature.attributes?.TIPO ?? 'boca_de_lobo',
          origem: 'Prefeitura de Porto Alegre / SMAMUS',
        })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
        return { status: 'sucesso', elementos, parcial: Boolean(data.exceededTransferLimit) || elementos.length >= LIMITE,
          consultadoEm: new Date().toISOString(),
          fonte: 'Prefeitura de Porto Alegre / SMAMUS — cadastro de bocas de lobo',
          mensagem: 'Cadastro público de infraestrutura; não representa sensores ou medição de alagamentos.' };
      }, { forcar });
    } catch (err) {
      this.log.warn({ err }, 'Cadastro municipal de bocas de lobo indisponível');
      if (cache.valor) {
        return {
          ...cache.valor,
          status: 'desatualizado',
          mensagem: 'Serviço municipal indisponível; exibindo o último cadastro válido em cache, que pode estar desatualizado.',
          erroMensagem: 'Não foi possível atualizar o cadastro municipal.'
        };
      }
      return { status: 'indisponivel', elementos: [], mensagem: 'Cadastro municipal temporariamente indisponível.', fonte: 'SMAMUS' };
    }
  }
}

/**
 * Consulta CEMADEN para RS/Porto Alegre. Sem estação fixa inventada.
 * O token é armazenado somente no backend.
 */
import { CacheTtl, buscarJson } from './cacheTtl.js';
const URL = 'https://sws.cemaden.gov.br/PED/api/pcds/pcds-dados-recentes?uf=RS&rede=11';
export class CemadenService {
  constructor({ token, log, ttlMs = 5 * 60 * 1000 }) {
    this.token = token; this.log = log; this.cache = new CacheTtl(ttlMs);
  }
  async obter({ forcar = false } = {}) {
    return this.cache.obter(() => this._consultar(), { forcar });
  }
  async _consultar() {
    const base = { metadados: { cidade: 'Porto Alegre', uf: 'RS', estacaoCodigo: null, estacaoNome: 'Estações a identificar pela fonte' },
      ultimaConsulta: new Date().toISOString(), dadosEstacaoPortoAlegre: null };
    if (!this.token) return { ...base, autenticado: false, status: 'sem_token',
      mensagem: 'CEMADEN não configurado: requer credencial válida. Não são exibidos dados de outras cidades.' };
    try {
      const data = await buscarJson(URL, { timeoutMs: 10000,
        headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/json', 'User-Agent': 'HydraSmart-API/3.0' } });
      if (!Array.isArray(data)) return { ...base, autenticado: true, status: 'sem_dados_recentes',
        mensagem: data?.Info || 'Fonte sem registros recentes.' };
      const lista = data.filter((item) => String(item.cidade || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes('PORTO ALEGRE'));
      return { ...base, autenticado: true, status: lista.length ? 'sucesso' : 'sem_dados_recentes',
        dadosEstacaoPortoAlegre: lista.length ? lista : null,
        mensagem: lista.length ? 'Registros CEMADEN identificados para Porto Alegre.' : 'Sem dados recentes de Porto Alegre nesta consulta.' };
    } catch (err) {
      this.log.warn({ err }, 'Falha CEMADEN RS');
      return { ...base, autenticado: false, status: 'erro_conexao', mensagem: 'Fonte CEMADEN indisponível.' };
    }
  }
}

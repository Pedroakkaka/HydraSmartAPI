/**
 * Integração com o CEMADEN (estação 510250401A — Jardim das Oliveiras, Cáceres-MT).
 * O token JWT fica só no servidor (CEMADEN_JWT_TOKEN), nunca no navegador.
 */

import { CacheTtl, buscarJson } from './cacheTtl.js';

const URL_CEMADEN = 'https://sws.cemaden.gov.br/PED/api/pcds/pcds-dados-recentes?uf=MT&rede=11';
const CODIGO_ESTACAO = '510250401A';

export const METADADOS_CACERES = {
  ibge: '5102504',
  cidade: 'Cáceres',
  uf: 'MT',
  estacaoCodigo: CODIGO_ESTACAO,
  estacaoNome: 'Jardim das Oliveiras',
  tipoEstacao: '1 (Pluviométrica)',
  sensores: [
    { id: 10, nome: 'Chuva', unidade: 'mm' },
    { id: 240, nome: 'Intensidade de Precipitação', unidade: 'mm/h' }
  ]
};

export class CemadenService {
  constructor({ token, log, ttlMs = 5 * 60 * 1000 }) {
    this.token = token;
    this.log = log;
    this.cache = new CacheTtl(ttlMs);
  }

  async obter({ forcar = false } = {}) {
    return this.cache.obter(() => this._consultar(), { forcar });
  }

  async _consultar() {
    const base = { metadados: METADADOS_CACERES, ultimaConsulta: new Date().toISOString(), dadosEstacaoCaceres: null };

    if (!this.token) {
      return {
        ...base,
        autenticado: false,
        status: 'sem_token',
        mensagem: 'Token JWT do CEMADEN não configurado no servidor. O acesso exige credencial governamental emitida pelo CEMADEN.',
        instrucao: 'Defina a variável de ambiente CEMADEN_JWT_TOKEN e reinicie a API.'
      };
    }

    try {
      const data = await buscarJson(URL_CEMADEN, {
        timeoutMs: 10_000,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', 'User-Agent': 'HydraSmart-API/3.0' }
      });

      if (data && !Array.isArray(data) && data.Info) {
        return { ...base, autenticado: true, status: 'sem_dados_recentes', mensagem: `CEMADEN: ${data.Info}` };
      }

      const lista = Array.isArray(data) ? data : [];
      const deCaceres = lista.filter((item) => {
        const cod = String(item.cod_estacao ?? '').trim();
        const cidade = String(item.cidade ?? '').toUpperCase();
        return cod === CODIGO_ESTACAO || cidade.includes('CÁCERES') || cidade.includes('CACERES');
      });
      const outras = lista
        .filter((item) => !deCaceres.includes(item))
        .slice(0, 5)
        .map((item) => ({ estacao: item.cod_estacao, cidade: item.cidade, sensor: item.sensor, valor: item.valor, datahora: item.datahora }));

      return {
        ...base,
        autenticado: true,
        status: deCaceres.length ? 'sucesso' : 'sem_dados_recentes',
        mensagem: deCaceres.length
          ? 'Dados consultados com sucesso via API do CEMADEN'
          : `Sem dados recentes da estação de Cáceres (${CODIGO_ESTACAO})`,
        dadosEstacaoCaceres: deCaceres.length ? deCaceres : null,
        totalOutrasEstacoesMt: lista.length - deCaceres.length,
        amostrasOutrasEstacoesMt: outras
      };
    } catch (err) {
      this.log.warn(`[cemaden] ${err.message}`);
      const auth = err.status === 401 || err.status === 403;
      return {
        ...base,
        autenticado: false,
        status: auth ? 'erro_autenticacao' : 'erro_conexao',
        mensagem: `Falha na comunicação com o CEMADEN: ${err.message}`
      };
    }
  }
}

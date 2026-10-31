/**
 * Integração CEMADEN para Porto Alegre-RS.
 * Tokens e credenciais permanecem exclusivamente no backend.
 * O SGAA emite tokens com validade curta; renovação sob demanda e em 401.
 */
import { CacheTtl, buscarJson } from './cacheTtl.js';

const URL_DADOS = 'https://sws.cemaden.gov.br/PED/api/pcds/pcds-dados-recentes?uf=RS&rede=11';
const URL_TOKEN = 'https://sgaa.cemaden.gov.br/SGAA/rest/controle-token/tokens';
const normalizar = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const estaEmPortoAlegre = (r) => {
  const cidade = r.cidade ?? r.municipio ?? r.nomeMunicipio ?? r.nome_municipio ?? r.nomeCidade;
  const codigo = r.codigoIbge ?? r.codIbge ?? r.codigo_ibge ?? r.codMunicipio;
  return normalizar(cidade) === 'PORTO ALEGRE' || String(codigo ?? '') === '4314902';
};

export class CemadenService {
  constructor({ token = '', email = '', senha = '', log, ttlMs = 5 * 60 * 1000 }) {
    this.token = token;
    this.email = email;
    this.senha = senha;
    this.log = log;
    this.cache = new CacheTtl(ttlMs);
    this.expiraEm = 0;
    this.renovacao = null;
  }

  async obter({ forcar = false } = {}) {
    return this.cache.obter(() => this._consultar(), { forcar });
  }

  async _obterToken({ renovar = false } = {}) {
    if (!renovar && this.token && (!this.expiraEm || Date.now() < this.expiraEm - 60000)) return this.token;
    if (!this.email || !this.senha) return renovar ? '' : this.token;
    if (this.renovacao) return this.renovacao;
    this.renovacao = (async () => {
      const resposta = await buscarJson(URL_TOKEN, {
        method: 'POST', timeoutMs: 12000,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.senha })
      });
      if (typeof resposta?.token !== 'string' || !resposta.token) throw new Error('SGAA não retornou token');
      this.token = resposta.token;
      // timeToExp é informado em segundos no exemplo real do SGAA (14399 ≈ 4h).
      const segundos = Number(resposta.timeToExp);
      this.expiraEm = Number.isFinite(segundos) && segundos > 0
        ? Date.now() + segundos * 1000 : Date.now() + 60 * 60 * 1000;
      return this.token;
    })();
    try { return await this.renovacao; } finally { this.renovacao = null; }
  }

  async _consultar() {
    const base = {
      metadados: { cidade: 'Porto Alegre', uf: 'RS', estacaoCodigo: null, estacaoNome: 'Estações verificadas na consulta' },
      ultimaConsulta: new Date().toISOString(), dadosEstacaoPortoAlegre: null
    };
    if (!this.token && !(this.email && this.senha)) {
      return { ...base, autenticado: false, status: 'sem_token',
        mensagem: 'Configure CEMADEN_EMAIL e CEMADEN_PASSWORD (renovação automática) ou CEMADEN_JWT_TOKEN no backend.' };
    }
    try {
      let token = await this._obterToken();
      let data;
      try {
        data = await buscarJson(URL_DADOS, { timeoutMs: 12000,
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
      } catch (err) {
        if (err.status !== 401 && err.status !== 403) throw err;
        if (!this.email || !this.senha) return { ...base, autenticado: false, status: 'erro_autenticacao',
          mensagem: 'Token expirado ou recusado. Configure credenciais SGAA para renovação automática.' };
        token = await this._obterToken({ renovar: true });
        data = await buscarJson(URL_DADOS, { timeoutMs: 12000,
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
      }
      // Nunca rotular estações de outras cidades como dados de Porto Alegre.
      const registros = Array.isArray(data) ? data
        : Array.isArray(data?.dados) ? data.dados
        : Array.isArray(data?.data) ? data.data : null;
      if (!registros) return { ...base, autenticado: true, status: 'sem_dados_recentes',
        mensagem: 'Resposta do CEMADEN sem lista reconhecida de estações; verificar formato do endpoint.' };
      const lista = registros.filter(estaEmPortoAlegre);
      return { ...base, autenticado: true, status: lista.length ? 'sucesso' : 'sem_dados_recentes',
        metadados: { ...base.metadados, estacaoNome: lista.length ? lista.length + ' registro(s) de Porto Alegre' : 'Nenhuma estação confirmada' },
        dadosEstacaoPortoAlegre: lista.length ? lista : null,
        mensagem: lista.length ? 'Registros identificados para Porto Alegre-RS.' : 'Nenhum registro recente identificado para Porto Alegre-RS.' };
    } catch (err) {
      this.log?.warn?.({ status: err.status, message: err.message }, 'Consulta CEMADEN falhou');
      return { ...base, autenticado: false,
        status: err.status === 401 || err.status === 403 ? 'erro_autenticacao' : 'erro_conexao',
        mensagem: err.status === 401 || err.status === 403
          ? 'Credencial recusada pelo CEMADEN.' : 'Não foi possível consultar o CEMADEN. Confira a integração no servidor.' };
    }
  }
}

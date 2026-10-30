/**
 * Cache simples com validade (TTL) para consultas a APIs externas.
 * Evita sobrecarregar serviços públicos e mantém o último dado bom quando a rede falha.
 */
export class CacheTtl {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.valor = null;
    this.gravadoEm = 0;
    this.emAndamento = null;
  }

  valido() {
    return this.valor !== null && Date.now() - this.gravadoEm < this.ttlMs;
  }

  /**
   * Retorna o valor em cache ou executa `buscar`. Chamadas simultâneas compartilham a mesma consulta.
   */
  async obter(buscar, { forcar = false } = {}) {
    if (!forcar && this.valido()) return this.valor;
    if (this.emAndamento) return this.emAndamento;

    this.emAndamento = (async () => {
      try {
        const novo = await buscar(this.valor);
        this.valor = novo;
        this.gravadoEm = Date.now();
        return novo;
      } finally {
        this.emAndamento = null;
      }
    })();
    return this.emAndamento;
  }
}

export async function buscarJson(url, { timeoutMs = 8000, ...opcoes } = {}) {
  const resp = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) {
    const erro = new Error(`HTTP ${resp.status} (${resp.statusText})`);
    erro.status = resp.status;
    throw erro;
  }
  return resp.json();
}

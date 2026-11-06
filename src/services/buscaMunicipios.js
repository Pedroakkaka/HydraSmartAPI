/**
 * Busca tolerante a acentos e pequenos erros sobre a lista oficial IBGE.
 * Apenas nomes reais de municípios são sugeridos.
 */
export const normalizarNomeMunicipio = valor => String(valor || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function distanciaEdicao(a, b, maximo = 4) {
  if (Math.abs(a.length - b.length) > maximo) return maximo + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = atual;
    if (Math.min(...anterior) > maximo) return maximo + 1;
  }
  return anterior[b.length];
}

export function sugestoesMunicipios(municipios, termo, limite = 8) {
  const busca = normalizarNomeMunicipio(termo);
  if (busca.length < 2) return [];
  const termoSemEspacos = busca.replace(/ /g, '');
  return municipios.map(municipio => {
    const nome = normalizarNomeMunicipio(municipio.nome);
    const semEspacos = nome.replace(/ /g, '');
    const primeiro = nome.split(' ')[0];
    let rank = Infinity;
    if (nome === busca) rank = 0;
    else if (nome.startsWith(busca)) rank = 1 + (nome.length - busca.length) * .008;
    else if (nome.split(' ').some(p => p.startsWith(busca))) rank = 2 + (nome.length - busca.length) * .008;
    else if (nome.includes(busca)) rank = 3 + (nome.length - busca.length) * .008;
    else if (busca.length >= 3) {
      const tolerancia = busca.length <= 4 ? 1 : busca.length <= 7 ? 2 : 3;
      const d = Math.min(
        distanciaEdicao(busca, nome, tolerancia),
        distanciaEdicao(termoSemEspacos, semEspacos, tolerancia),
        distanciaEdicao(busca, primeiro, tolerancia)
      );
      if (d <= tolerancia) rank = 4 + d + nome.length * .001;
    }
    return { ...municipio, rank };
  }).filter(m => Number.isFinite(m.rank))
    .sort((a, b) => a.rank - b.rank || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, limite)
    .map(({ rank, ...municipio }) => municipio);
}

let catalogo = null;
let vence = 0;
let pendente = null;
export async function catalogoMunicipios(fetcher = fetch) {
  if (catalogo && Date.now() < vence) return catalogo;
  if (pendente) return pendente;
  pendente = (async () => {
    try {
      const resposta = await fetcher('https://servicodados.ibge.gov.br/api/v1/localidades/municipios', {
        signal: AbortSignal.timeout(20000)
      });
      if (!resposta.ok) throw new Error('IBGE HTTP ' + resposta.status);
      const lista = await resposta.json();
      if (!Array.isArray(lista) || lista.length < 5000) throw new Error('Catálogo IBGE incompleto');
      catalogo = lista.filter(m => Number.isInteger(m.id) && typeof m.nome === 'string')
        .map(m => ({
          id: m.id, nome: m.nome,
          estado: m['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla ||
            m.microrregiao?.mesorregiao?.UF?.sigla || ''
        }));
      vence = Date.now() + 24 * 60 * 60_000;
      return catalogo;
    } catch (erro) {
      if (catalogo) return catalogo;
      throw erro;
    } finally { pendente = null; }
  })();
  return pendente;
}

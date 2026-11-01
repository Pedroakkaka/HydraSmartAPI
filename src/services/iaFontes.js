/**
 * Coleta contexto público e histórico para análise consultiva pela OpenAI.
 * Não converte níveis regionais em leituras de bueiros.
 * Consultas passam pelas rotas existentes, reutilizando validação e cache.
 */
const CODIGOS = ['DCRS-00044', 'DCRS-00054', 'DCRS-00076', 'DCRS-00105'];
const formatoDia = (d) => d.toISOString().slice(0, 10);
const horarioBrasil = (d) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).format(d).replace(' ', ' ');
async function consultar(app, caminho) {
  const resposta = await app.inject({ method: 'GET', url: '/api/v1' + caminho });
  if (resposta.statusCode !== 200) throw new Error('Fonte indisponível: ' + caminho.split('?')[0] + ' (' + resposta.statusCode + ')');
  return resposta.json();
}
export async function coletarContextoIA(app, ctx) {
  const fontes = [];
  const avisos = [];
  const [sensores, estacoes] = await Promise.all([
    ctx.repositorios.leituras.listar({ limite: 100 }).catch(() => []),
    consultar(app, '/hidrologia/estacoes').catch((err) => { avisos.push(err.message); return null; })
  ]);
  const selecionadas = (estacoes?.estacoes || []).filter((e) => CODIGOS.includes(e.codigo)).map((e) => ({
    codigo: e.codigo, nome: e.nome, bacia: e.bacia, horarioLeitura: e.horarioLeitura,
    rio: e.rio, chuva: e.chuva, manutencao: e.manutencao
  }));
  if (selecionadas.length) fontes.push({ fonte: 'Defesa Civil RS', tipo: 'leituras oficiais pontuais', url: estacoes.urlFonte, registros: selecionadas });

  // Histórico meteorológico de reanálise, que possui atraso de publicação.
  const fimClima = new Date(Date.now() - 9 * 86400000);
  const inicioClima = new Date(fimClima.getTime() - 13 * 86400000);
  const clima = await consultar(app, '/clima/historico?inicio=' + formatoDia(inicioClima) + '&fim=' + formatoDia(fimClima))
    .catch((err) => { avisos.push(err.message); return null; });
  if (clima?.diario?.length) fontes.push({
    fonte: clima.fonte, tipo: clima.tipo, localidade: clima.municipio,
    periodo: clima.periodo, registros: clima.diario
  });

  // Histórico hidrológico oficial: uma estação por consulta, janela curta e dados limitados.
  const fim = new Date(Date.now() - 60 * 60 * 1000);
  const inicio = new Date(fim.getTime() - 48 * 60 * 60 * 1000);
  for (const codigo of ['DCRS-00054', 'DCRS-00076']) {
    const caminho = '/hidrologia/historico?estacao=' + codigo +
      '&inicio=' + encodeURIComponent(horarioBrasil(inicio)) +
      '&fim=' + encodeURIComponent(horarioBrasil(fim)) + '&intervalo=HOUR_1';
    const resultado = await consultar(app, caminho).catch((err) => { avisos.push(codigo + ': ' + err.message); return null; });
    const itens = resultado?.dados?.items;
    if (Array.isArray(itens) && itens.length) fontes.push({
      fonte: 'Defesa Civil RS', tipo: 'série histórica hidrológica', estacao: codigo,
      intervalo: 'HOUR_1', totalDisponivel: resultado.dados.totalCount ?? null,
      registros: itens.slice(-60)
    });
  }
  if (Array.isArray(sensores) && sensores.length) fontes.push({
    fonte: 'Sensores físicos HydraSmart', tipo: 'leituras reais armazenadas',
    registros: sensores.slice(0, 100)
  });
  return { fontes, avisos, registrosConsultados: fontes.reduce((n, f) => n + f.registros.length, 0) };
}

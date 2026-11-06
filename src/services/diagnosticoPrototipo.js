/**
 * Diagnóstico determinístico do protótipo físico. Percentuais discretos de
 * eletrodos; extrapolação linear não é previsão hidrológica validada.
 * Não confundir as leituras da bancada com bueiros urbanos.
 */
export function diagnosticarPrototipo(leitura, agora = Date.now()) {
  const base = {
    status: 'sem_dados', natureza: 'experimental',
    taxaPctMin: null, deltaPct: null, janelaSegundos: null,
    tempoAte100Min: null, tempoAteCriticoMin: null,
    confiavel: false, tendencia: 'indeterminada', amostras: 0,
    motivo: 'Aguardando leituras físicas recentes dos eletrodos'
  };
  if (!leitura || !Number.isFinite(Number(leitura.timestamp)) ||
      Number(leitura.timestamp) > agora + 5000 || agora - Number(leitura.timestamp) > 30000 ||
      !Number.isFinite(Number(leitura.nivelPct))) return base;

  const nivel = Number(leitura.nivelPct);
  const pares = (leitura.historicoTimestamps || []).map((t, i) => ({
    t: Number(t), n: Number((leitura.historicoNiveis || [])[i])
  })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.n) && p.n >= 0 && p.n <= 100 &&
    p.t <= agora + 5000 && p.t >= agora - 120000)
    .sort((a, b) => a.t - b.t);
  // Retirar timestamps repetidos e exigir duração real entre amostras.
  const serie = pares.filter((p,i) => i === 0 || p.t > pares[i-1].t);
  const amostras = serie.length;
  if (nivel >= 100) return { ...base, status:'limite_atingido', tendencia:'limite_atingido',
    amostras, taxaPctMin:0, tempoAte100Min:0,
    motivo:'Contato superior atingido: nível máximo observado na régua' };
  if (amostras < 6 || serie.at(-1).t - serie[0].t < 15000) return {
    ...base, status:'insuficiente', amostras,
    motivo:'São necessárias pelo menos 6 leituras e 15 segundos de observação para tendência'
  };
  const janelaSegundos = (serie.at(-1).t - serie[0].t)/1000;
  const deltaPct = Number((serie.at(-1).n - serie[0].n).toFixed(2));
  const deltas = serie.slice(1).map((p,i) => p.n - serie[i].n);
  const subidas = deltas.filter(d=>d > 0.1).length;
  const quedas = deltas.filter(d=>d < -0.1).length;
  // Regressão linear sobre a janela de observação, sem utilizar a taxa de
  // apenas um salto de 16,7% entre dois eletrodos como previsão instantânea.
  const t0 = serie[0].t;
  const xs = serie.map(p => (p.t-t0)/60000);
  const xm = xs.reduce((a,b)=>a+b,0)/amostras;
  const ym = serie.reduce((a,p)=>a+p.n,0)/amostras;
  const num = serie.reduce((a,p,i)=>a+(xs[i]-xm)*(p.n-ym),0);
  const den = xs.reduce((a,x)=>a+(x-xm)**2,0);
  const taxa = den > 0 ? num/den : 0;
  const taxaPctMin = Number(taxa.toFixed(2));
  const tendencia = taxa > 0.3 && deltaPct > 0 ? 'subindo'
    : taxa < -0.3 && deltaPct < 0 ? 'descendo' : 'estavel';
  const confiavel = janelaSegundos >= 25 && amostras >= 10 &&
    subidas >= 2 && quedas === 0 && deltaPct >= 16 &&
    taxa >= 0.5 && taxa <= 180;
  const horizonte = alvo => {
    if (!confiavel || nivel >= alvo) return nivel >= alvo ? 0 : null;
    const minutos = (alvo-nivel)/taxa;
    return minutos >= 0 && minutos <= 60 ? Number(minutos.toFixed(1)) : null;
  };
  return {
    status: confiavel ? 'estimativa_experimental' : 'observacao',
    natureza:'experimental', nivelPct:nivel, taxaPctMin, deltaPct,
    janelaSegundos: Math.round(janelaSegundos), amostras, tendencia,
    confiavel, tempoAte100Min:horizonte(100),
    tempoAteCriticoMin:horizonte(80),
    motivo: confiavel
      ? 'Extrapolação linear experimental, baseada em subidas sucessivas da régua; pode mudar com a vazão da bomba.'
      : tendencia === 'estavel' ? 'Nível estável; não há base para estimar enchimento.'
      : tendencia === 'descendo' ? 'Nível baixando; não estimar tempo de enchimento.'
      : 'Subida detectada, mas ainda sem observações suficientes e estáveis para estimar tempo.'
  };
}

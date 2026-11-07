/**
 * Meteorologia oficial (Open-Meteo) para o município configurado (Porto Alegre-RS por padrão), com cache de 10 min.
 *
 * Regra: não somar rain_sum com precipitation_sum (a chuva já faz parte da precipitação).
 * Previsão não é apresentada como medição dos bueiros nem como dado do CEMADEN.
 */

import { CacheTtl, buscarJson } from './cacheTtl.js';

const WMO = {
  0: 'Céu Limpo', 1: 'Predominantemente Ensolarado', 2: 'Parcialmente Nublado', 3: 'Nublado / Encoberto',
  45: 'Nevoeiro / Névoa', 48: 'Nevoeiro com Deposição',
  51: 'Garoa Leve', 53: 'Garoa Moderada', 55: 'Garoa Intensa',
  61: 'Chuva Fraca', 63: 'Chuva Moderada', 65: 'Chuva Forte',
  71: 'Neve Fraca', 73: 'Neve Moderada', 75: 'Neve Forte', 77: 'Grãos de Neve',
  80: 'Pancadas de Chuva Leves', 81: 'Pancadas de Chuva Moderadas', 82: 'Pancadas de Chuva Violentas',
  85: 'Pancadas de Neve Leves', 86: 'Pancadas de Neve Fortes',
  95: 'Tempestade com Trovoadas', 96: 'Tempestade com Granizo Leve', 99: 'Tempestade Severa com Granizo'
};

export function descricaoWmo(code) {
  return WMO[code] ?? 'Condição Estável';
}

export function faseLunar(f) {
  if (f === null || f === undefined) return '--';
  if (f === 0 || f === 1) return 'Lua Nova 🌑';
  if (f < 0.25) return 'Crescente 🌒';
  if (f === 0.25) return 'Quarto Crescente 🌓';
  if (f < 0.5) return 'Gibosa Crescente 🌔';
  if (f === 0.5) return 'Lua Cheia 🌕';
  if (f < 0.75) return 'Gibosa Minguante 🌖';
  if (f === 0.75) return 'Quarto Minguante 🌗';
  return 'Minguante 🌘';
}

/** Hora local atual no formato da Open-Meteo ("YYYY-MM-DDTHH"). */
function horaLocalIso(timezone) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}`;
}

export function transformarRespostaOpenMeteo(data, municipio) {
  const cur = data.current ?? {};
  const hourly = data.hourly ?? {};
  const daily = data.daily ?? {};
  const em = (arr, i, padrao = null) => (Array.isArray(arr) ? arr[i] ?? padrao : padrao);

  const previsaoHoraria = [];
  if (Array.isArray(hourly.time)) {
    const agora = horaLocalIso(municipio.timezone);
    let inicio = hourly.time.findIndex((t) => t.startsWith(agora));
    if (inicio === -1) inicio = 0;
    for (let i = inicio; i < Math.min(hourly.time.length, inicio + 24); i++) {
      previsaoHoraria.push({
        horario: hourly.time[i],
        temperatura: em(hourly.temperature_2m, i),
        umidade: em(hourly.relative_humidity_2m, i),
        precipitacaoEstimadaMm: em(hourly.precipitation, i, 0),
        chuvaMm: em(hourly.rain, i, 0),
        probabilidadePct: em(hourly.precipitation_probability, i, 0),
        coberturaNuvensPct: em(hourly.cloud_cover, i, 0),
        velocidadeVentoKmh: em(hourly.wind_speed_10m, i, 0)
      });
    }
  }

  const previsaoDiaria = (daily.time ?? []).map((dia, d) => ({
    data: dia,
    tempMax: em(daily.temperature_2m_max, d),
    tempMin: em(daily.temperature_2m_min, d),
    precipitacaoTotalMm: em(daily.precipitation_sum, d, 0),
    chuvaMm: em(daily.rain_sum, d, 0),
    horasPrecipitacao: em(daily.precipitation_hours, d, 0),
    probabilidadeMaxPct: em(daily.precipitation_probability_max, d, 0),
    faseLunarTexto: faseLunar(em(daily.moon_phase, d))
  }));

  const primeira = previsaoHoraria[0];
  return {
    status: 'sucesso',
    origem: 'Open-Meteo API (modelos ECMWF & GFS)',
    municipio: municipio.nome,
    coordenadas: [municipio.latitude, municipio.longitude],
    fusoHorario: municipio.timezone,
    temperatura: cur.temperature_2m ?? null,
    umidadeRelativaPct: cur.relative_humidity_2m ?? null,
    precipitacaoObservadaMm: cur.precipitation ?? 0,
    chuvaAtualMm: cur.rain ?? 0,
    condicaoTempo: descricaoWmo(cur.weather_code),
    weatherCode: cur.weather_code ?? null,
    velocidadeVentoKmh: primeira?.velocidadeVentoKmh ?? null,
    coberturaNuvensPct: primeira?.coberturaNuvensPct ?? null,
    probabilidadeChuvaPct: primeira?.probabilidadePct ?? null,
    previsaoHoraria,
    previsaoDiaria,
    horarioObservacao: cur.time ?? null,
    horarioUltimaConsulta: new Date().toISOString(),
    erroMensagem: null
  };
}

export class WeatherService {
  constructor({ municipio, log, ttlMs = 10 * 60 * 1000 }) {
    this.municipio = municipio;
    this.log = log;
    this.cache = new CacheTtl(ttlMs);
  }

  async obter({ forcar = false } = {}) {
    try {
      return await this.cache.obter(() => this._consultar(), { forcar });
    } catch (err) {
      this.log.warn(`[clima] Open-Meteo indisponível: ${err.message}`);
      // Mantém o último dado bom, sinalizando que está desatualizado.
      if (this.cache.valor) return { ...this.cache.valor, status: 'desatualizado', erroMensagem: err.message };
      return {
        status: 'erro',
        origem: 'Open-Meteo API',
        municipio: this.municipio.nome,
        coordenadas: [this.municipio.latitude, this.municipio.longitude],
        temperatura: null,
        umidadeRelativaPct: null,
        precipitacaoObservadaMm: null,
        chuvaAtualMm: null,
        condicaoTempo: 'Indisponível no momento',
        probabilidadeChuvaPct: null,
        velocidadeVentoKmh: null,
        coberturaNuvensPct: null,
        previsaoHoraria: [],
        previsaoDiaria: [],
        horarioUltimaConsulta: new Date().toISOString(),
        erroMensagem: err.name === 'TimeoutError' ? 'Tempo limite esgotado ao contatar Open-Meteo' : err.message
      };
    }
  }

  async _consultar() {
    const { latitude, longitude, timezone } = this.municipio;
    const url = 'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${latitude}&longitude=${longitude}` +
      '&daily=temperature_2m_max,temperature_2m_min,rain_sum,precipitation_sum,precipitation_hours,precipitation_probability_max,moon_phase' +
      '&hourly=temperature_2m,relative_humidity_2m,precipitation,rain,precipitation_probability,cloud_cover,wind_speed_10m' +
      '&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code' +
      `&timezone=${encodeURIComponent(timezone)}`;

    const data = await buscarJson(url, { headers: { Accept: 'application/json' } });
    if (!data?.current) throw new Error('Resposta da Open-Meteo em formato inesperado');
    return transformarRespostaOpenMeteo(data, this.municipio);
  }
}

/**
 * Repositórios em memória — mesma interface de ./postgres.js.
 * Usados nos testes automatizados e como plano B em desenvolvimento quando o banco
 * não está disponível (os dados se perdem ao reiniciar a API).
 */

import { CALIBRACAO_PADRAO } from '../core/calibration.js';

const clonar = (o) => structuredClone(o);
const LIMITE_LEITURAS = 20_000;

export function criarRepositoriosMemoria() {
  let tabelaBueiros = clonar(Object.values(CALIBRACAO_PADRAO));
  const tabelaLeituras = [];
  const tabelaAlertas = [];
  let proximoAlertaId = 1;
  let proximaLeituraId = 1;

  const noPeriodo = (data, desde, ate) =>
    (!desde || data >= new Date(desde)) && (!ate || data <= new Date(ate));

  const bueiros = {
    async listar() {
      return clonar(tabelaBueiros);
    },
    async atualizarCalibracao(id, p) {
      const b = tabelaBueiros.find((x) => x.id === id);
      if (!b) return null;
      Object.assign(b, {
        alturaTotalCm: p.alturaTotalCm,
        distanciaCegaCm: p.distanciaCegaCm,
        volumeTotalMl: p.volumeTotalMl,
        limiteAtencaoPct: p.limiteAtencaoPct,
        limiteCriticoPct: p.limiteCriticoPct,
        atualizadoEm: new Date()
      });
      return clonar(b);
    },
    async definirCoordenadas(id, latitude, longitude) {
      const b = tabelaBueiros.find((x) => x.id === id);
      if (!b) return null;
      Object.assign(b, { latitude, longitude, atualizadoEm: new Date() });
      return clonar(b);
    },
    async restaurarPadroes() {
      tabelaBueiros = tabelaBueiros.map((b) => ({
        ...CALIBRACAO_PADRAO[b.id],
        latitude: b.latitude,
        longitude: b.longitude
      }));
      return clonar(tabelaBueiros);
    }
  };

  const leituras = {
    async inserir(l) {
      tabelaLeituras.push({ ...l, id: proximaLeituraId++, registradoEm: new Date(l.timestamp) });
      if (tabelaLeituras.length > LIMITE_LEITURAS) tabelaLeituras.shift();
    },
    async listar({ bueiroId, desde, ate, limite = 500, ordem = 'desc' } = {}) {
      const filtradas = tabelaLeituras
        .filter((l) => (!bueiroId || l.bueiroId === bueiroId) && noPeriodo(l.registradoEm, desde, ate))
        .sort((a, b) => (ordem === 'asc' ? a.registradoEm - b.registradoEm : b.registradoEm - a.registradoEm));
      return clonar(filtradas.slice(0, limite)).map(({ timestamp: _t, ...resto }) => resto);
    },
    async serie({ bueiroId, desde, ate, intervaloSegundos }) {
      const passo = intervaloSegundos * 1000;
      const baldes = new Map();
      for (const l of tabelaLeituras) {
        if ((bueiroId && l.bueiroId !== bueiroId) || !noPeriodo(l.registradoEm, desde, ate)) continue;
        const inicio = Math.floor(l.registradoEm.getTime() / passo) * passo;
        const chave = `${l.bueiroId}|${inicio}`;
        if (!baldes.has(chave)) baldes.set(chave, { bueiroId: l.bueiroId, inicio, niveis: [] });
        baldes.get(chave).niveis.push(l.nivelPct);
      }
      return [...baldes.values()]
        .sort((a, b) => a.inicio - b.inicio || a.bueiroId.localeCompare(b.bueiroId))
        .map((b) => ({
          bueiroId: b.bueiroId,
          inicio: new Date(b.inicio),
          nivelMedioPct: Math.round((b.niveis.reduce((s, n) => s + n, 0) / b.niveis.length) * 10) / 10,
          nivelMaximoPct: Math.max(...b.niveis),
          totalLeituras: b.niveis.length
        }));
    },

    async estatisticas({ desde, ate } = {}) {
      const grupos = new Map();
      for (const l of tabelaLeituras) {
        if (!noPeriodo(l.registradoEm, desde, ate)) continue;
        if (!grupos.has(l.bueiroId)) grupos.set(l.bueiroId, []);
        grupos.get(l.bueiroId).push(l);
      }
      return [...grupos.entries()].sort().map(([bueiroId, lista]) => {
        const niveis = lista.map((l) => l.nivelPct);
        const datas = lista.map((l) => l.registradoEm);
        return {
          bueiroId,
          total: lista.length,
          nivelMinimoPct: Math.min(...niveis),
          nivelMaximoPct: Math.max(...niveis),
          nivelMedioPct: Math.round((niveis.reduce((s, n) => s + n, 0) / niveis.length) * 10) / 10,
          primeiraLeitura: new Date(Math.min(...datas)),
          ultimaLeitura: new Date(Math.max(...datas))
        };
      });
    }
  };

  const alertas = {
    async abrir({ bueiroId, nivelPct, mensagem, simulado }) {
      const a = {
        id: proximoAlertaId++,
        bueiroId,
        nivelPctPico: nivelPct,
        mensagem,
        simulado,
        iniciadoEm: new Date(),
        encerradoEm: null,
        reconhecidoEm: null
      };
      tabelaAlertas.push(a);
      return clonar(a);
    },
    async atualizarPico(id, nivelPct) {
      const a = tabelaAlertas.find((x) => x.id === id);
      if (a) a.nivelPctPico = Math.max(a.nivelPctPico, nivelPct);
    },
    async encerrar(id) {
      const a = tabelaAlertas.find((x) => x.id === id && !x.encerradoEm);
      if (!a) return null;
      a.encerradoEm = new Date();
      return clonar(a);
    },
    async encerrarTodosAbertos() {
      tabelaAlertas.filter((a) => !a.encerradoEm).forEach((a) => { a.encerradoEm = new Date(); });
    },
    async reconhecer(id) {
      const a = tabelaAlertas.find((x) => x.id === id);
      if (!a) return null;
      a.reconhecidoEm ??= new Date();
      return clonar(a);
    },
    async listar({ apenasAtivos = false, incluirSimulados = false, limite = 100 } = {}) {
      return clonar(
        tabelaAlertas
          .filter((a) => (!apenasAtivos || !a.encerradoEm) && (incluirSimulados || !a.simulado))
          .sort((a, b) => b.iniciadoEm - a.iniciadoEm)
          .slice(0, limite)
      );
    }
  };

  const tabelaPush = new Map();
  const pushInscricoes = {
    async salvar(inscricao) {
      if (!tabelaPush.has(inscricao.endpoint) && tabelaPush.size >= 500) {
        throw new Error('Limite de dispositivos inscritos atingido');
      }
      tabelaPush.set(inscricao.endpoint, clonar(inscricao));
    },
    async listar() { return clonar([...tabelaPush.values()]); },
    async remover(endpoint) { tabelaPush.delete(endpoint); }
  };

  return {
    pushInscricoes,
    tipo: 'memoria',
    bueiros,
    leituras,
    alertas,
    async verificarSaude() {
      return true;
    },
    async fechar() {}
  };
}

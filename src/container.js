/**
 * Monta e conecta todos os serviços da aplicação (injeção de dependências manual).
 * Os testes usam a mesma função com repositórios em memória.
 */

import { TelemetryState } from './domain/telemetryState.js';
import { AlertService } from './services/alertService.js';
import { IngestService } from './services/ingestService.js';
import { Simulator } from './services/simulator.js';
import { WeatherService } from './services/weatherService.js';
import { CemadenService } from './services/cemadenService.js';
import { OsmService } from './services/osmService.js';
import { BocasLoboService } from './services/bocasLoboService.js';
import { ReportService } from './services/reportService.js';
import { SerialReader } from './serial/serialReader.js';
import { sanitizarParametros, normalizarBueiroId } from './core/calibration.js';
import { DataValidator } from './core/validator.js';

export async function criarContexto({ config, repositorios, log }) {
  const calibracoes = await repositorios.bueiros.listar();

  const estado = new TelemetryState({
    calibracoes,
    maxHistorico: config.historicoMemoriaAmostras,
    serialHabilitada: config.serial.habilitada
  });

  const alertas = new AlertService({ repositorios, log });
  await alertas.inicializar();

  const ingest = new IngestService({ estado, repositorios, alertas, log });
  const simulador = new Simulator({ estado, ingest, alertas, log });
  const serial = new SerialReader({ estado, ingest, config: config.serial, log });
  const clima = new WeatherService({ municipio: config.municipio, log });
  const cemaden = new CemadenService({ token: config.cemadenToken, email: config.cemadenEmail, senha: config.cemadenSenha, log });
  const osm = new OsmService({ log });
  const bocasLobo = new BocasLoboService({ log });
  const relatorios = new ReportService({ repositorios, estado });

  // Sinaliza bueiros sem leitura recente (vale para USB e para dispositivos HTTP).
  const timerLiveness = setInterval(
    () => estado.verificarLiveness(config.serial.timeoutDadosObsoletosMs),
    2000
  );
  timerLiveness.unref?.();

  const calibracao = {
    async atualizar(idBruto, parametros) {
      const id = normalizarBueiroId(idBruto);
      if (!id) return null;
      const novo = sanitizarParametros(estado.obterCalibracao(id), parametros);
      const salvo = await repositorios.bueiros.atualizarCalibracao(id, novo);
      estado.definirCalibracao(salvo);
      return salvo;
    },
    async definirCoordenadas(idBruto, latitude, longitude) {
      const id = normalizarBueiroId(idBruto);
      if (!id) return null;
      if (!DataValidator.validarCoordenadas([latitude, longitude])) {
        const erro = new Error('Coordenadas inválidas');
        erro.statusCode = 400;
        throw erro;
      }
      const arred = (v) => Math.round(Number(v) * 1e6) / 1e6;
      const salvo = await repositorios.bueiros.definirCoordenadas(id, arred(latitude), arred(longitude));
      estado.definirCalibracao(salvo);
      return salvo;
    },
    async removerCoordenadas(idBruto) {
      const id = normalizarBueiroId(idBruto);
      if (!id) return null;
      const salvo = await repositorios.bueiros.definirCoordenadas(id, null, null);
      estado.definirCalibracao(salvo);
      return salvo;
    },
    async restaurarPadroes() {
      const todos = await repositorios.bueiros.restaurarPadroes();
      todos.forEach((cfg) => estado.definirCalibracao(cfg));
      return todos;
    }
  };

  return {
    config,
    log,
    repositorios,
    estado,
    alertas,
    ingest,
    simulador,
    serial,
    clima,
    cemaden,
    osm,
    bocasLobo,
    relatorios,
    calibracao,

    snapshotCompleto() {
      return { ...estado.snapshot(), alertasAtivos: alertas.ativos() };
    },

    async encerrar() {
      clearInterval(timerLiveness);
      simulador.parar();
      await serial.encerrar();
      await repositorios.fechar();
    }
  };
}

/**
 * Leitura do Arduino pela porta USB, feita pelo servidor (não depende do navegador).
 *
 * - Lista as portas disponíveis e conecta na escolhida, ou procura sozinho uma placa
 *   Arduino/CH340/FTDI quando SERIAL_PORT=auto.
 * - Reconecta automaticamente se o cabo for desconectado e plugado de novo.
 * - Cada linha recebida passa pelo parser e segue para o IngestService.
 *
 * A biblioteca `serialport` é opcional: em servidores sem USB (ex.: VPS) basta
 * SERIAL_ENABLED=false e ela nem é carregada.
 */

import { parseLinhaSerial } from '../core/serialParser.js';
import { ORIGENS } from '../services/ingestService.js';

const FABRICANTES_CONHECIDOS = /arduino|wch|ch340|ch341|ftdi|silicon labs|cp210|usb-serial|usb serial/i;
const VENDOR_IDS_CONHECIDOS = new Set(['2341', '2a03', '1a86', '0403', '10c4']);

export class SerialReader {
  constructor({ estado, ingest, config, log }) {
    this.estado = estado;
    this.ingest = ingest;
    this.config = config;
    this.log = log;
    this.porta = null;
    this.modulo = null;
    this.desconexaoManual = false;
    this.timerReconexao = null;
  }

  async _carregarModulo() {
    if (this.modulo) return this.modulo;
    try {
      const [{ SerialPort }, { ReadlineParser }] = await Promise.all([
        import('serialport'),
        import('@serialport/parser-readline')
      ]);
      this.modulo = { SerialPort, ReadlineParser };
      return this.modulo;
    } catch (err) {
      throw new Error(`Biblioteca serialport indisponível neste servidor: ${err.message}`, { cause: err });
    }
  }

  async listarPortas() {
    const { SerialPort } = await this._carregarModulo();
    const portas = await SerialPort.list();
    return portas.map((p) => ({
      caminho: p.path,
      fabricante: p.manufacturer ?? null,
      vendorId: p.vendorId ?? null,
      productId: p.productId ?? null,
      provavelArduino: FABRICANTES_CONHECIDOS.test(p.manufacturer ?? '') ||
        VENDOR_IDS_CONHECIDOS.has(String(p.vendorId ?? '').toLowerCase())
    }));
  }

  async _detectarPorta() {
    const portas = await this.listarPortas();
    return (portas.find((p) => p.provavelArduino) ?? null)?.caminho ?? null;
  }

  async iniciar() {
    if (!this.config.habilitada) return;
    try {
      await this.conectar({ porta: this.config.porta, baudRate: this.config.baudRate });
    } catch (err) {
      this.log.warn(`[serial] ${err.message}`);
      this._agendarReconexao();
    }
  }

  async conectar({ porta = 'auto', baudRate = this.config.baudRate } = {}) {
    if (!this.config.habilitada) throw new Error('Leitura serial desativada neste servidor (SERIAL_ENABLED=false).');
    const { SerialPort, ReadlineParser } = await this._carregarModulo();

    await this.desconectar({ manual: false, silencioso: true });
    this.desconexaoManual = false;
    clearTimeout(this.timerReconexao);

    const caminho = !porta || porta === 'auto' ? await this._detectarPorta() : porta;
    if (!caminho) {
      this.estado.atualizarSerial({
        conectado: false,
        statusTexto: 'Nenhum Arduino encontrado nas portas USB',
        erroMensagem: 'Conecte o cabo USB do Arduino. O servidor tenta novamente sozinho a cada 5 s.'
      });
      throw new Error('Nenhuma porta serial de Arduino encontrada');
    }

    this.estado.atualizarSerial({ statusTexto: `Abrindo ${caminho}...`, erroMensagem: null });

    await new Promise((resolve, reject) => {
      const sp = new SerialPort({ path: caminho, baudRate: Number(baudRate) }, (err) => (err ? reject(err) : resolve()));
      this.porta = sp;
    }).catch((err) => {
      this.porta = null;
      const ocupada = /access denied|busy|acesso negado/i.test(err.message);
      this.estado.atualizarSerial({
        conectado: false,
        porta: caminho,
        statusTexto: 'Erro ao abrir a porta',
        erroMensagem: ocupada
          ? `Porta ${caminho} ocupada. Feche o Monitor Serial da IDE Arduino.`
          : err.message
      });
      throw err;
    });

    const parser = this.porta.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (linha) => {
      this.processarLinha(linha).catch((err) => this.log.error({ err }, '[serial] falha ao processar linha'));
    });

    this.porta.on('close', () => {
      this.porta = null;
      this.estado.atualizarSerial({ conectado: false, statusTexto: this.desconexaoManual ? 'Desconectado pelo operador' : 'Cabo USB desconectado' });
      if (!this.desconexaoManual) this._agendarReconexao();
    });
    this.porta.on('error', (err) => this.log.warn(`[serial] ${err.message}`));

    this.estado.atualizarSerial({
      conectado: true,
      porta: caminho,
      baudRate: Number(baudRate),
      statusTexto: `Conectado em ${caminho} @ ${baudRate} baud`,
      erroMensagem: null
    });
    this.log.info(`[serial] conectado em ${caminho} @ ${baudRate}`);
    return this.estado.serial;
  }

  async desconectar({ manual = true, silencioso = false } = {}) {
    if (manual) {
      this.desconexaoManual = true;
      clearTimeout(this.timerReconexao);
    }
    if (!this.porta) {
      if (manual && !silencioso) this.estado.atualizarSerial({ conectado: false, statusTexto: 'Desconectado pelo operador' });
      return;
    }
    const sp = this.porta;
    this.porta = null;
    await new Promise((resolve) => (sp.isOpen ? sp.close(() => resolve()) : resolve()));
  }

  _agendarReconexao() {
    if (!this.config.reconectarAutomaticamente || this.desconexaoManual) return;
    clearTimeout(this.timerReconexao);
    this.timerReconexao = setTimeout(async () => {
      try {
        await this.conectar({ porta: this.config.porta, baudRate: this.estado.serial.baudRate || this.config.baudRate });
      } catch {
        this._agendarReconexao();
      }
    }, 5000);
    this.timerReconexao.unref?.();
  }

  /**
   * Interpreta uma linha recebida e encaminha as leituras. Público para facilitar testes.
   */
  async processarLinha(linhaBruta) {
    const linha = String(linhaBruta).trim();
    if (!linha) return false;
    const resultado = parseLinhaSerial(linha);

    if (resultado.tipo === 'status' || resultado.tipo === 'erro_sensor') {
      this.estado.registrarMensagemSerial(linha, true);
      return true;
    }

    let algumaAceita = false;
    for (const l of resultado.leituras) {
      const r = await this.ingest.registrar({ ...l, origem: ORIGENS.ARDUINO_USB });
      if (r.aceita) algumaAceita = true;
    }
    this.estado.registrarMensagemSerial(linha, algumaAceita);
    return algumaAceita;
  }

  async encerrar() {
    await this.desconectar({ manual: true, silencioso: true });
  }
}

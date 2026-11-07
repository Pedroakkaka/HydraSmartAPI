/**
 * Ponte USB local -> HydraSmartAPI no Render.
 * Execução apenas no computador conectado ao Arduino:
 *   npm install
 *   HYDRASMART_API_URL=https://hydrasmartapi.onrender.com PROTOTYPE_INGEST_API_KEY=... node scripts/ponte-arduino-render.mjs
 * No PowerShell:
 *   $env:PROTOTYPE_INGEST_API_KEY="sua-chave"; node scripts/ponte-arduino-render.mjs
 * Autenticação na API é OBRIGATÓRIA. Não use credenciais no frontend.
 */
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { parseLinhaSerial } from '../src/core/serialParser.js';

const apiUrl = process.env.HYDRASMART_API_URL || 'https://hydrasmartapi.onrender.com';
const chave = process.env.PROTOTYPE_INGEST_API_KEY;
const portaSolicitada = process.env.SERIAL_PORT || 'auto';
const baudRate = Number(process.env.SERIAL_BAUD || 115200);
if (!chave || chave.length < 16) {
  console.error('Configure PROTOTYPE_INGEST_API_KEY com uma chave forte, igual à do Render (mínimo de 16 caracteres).');
  process.exit(1);
}
if (!/^https:\/\//i.test(apiUrl)) {
  console.error('HYDRASMART_API_URL deve ser HTTPS para não transmitir a chave em texto claro.');
  process.exit(1);
}
const destino = new URL('/api/v1/leituras/prototipo', apiUrl).toString();
const fabricantes = /arduino|wch|ch340|ch341|ftdi|cp210|silicon labs/i;
let portasConectadas = new Set();
let encerrando = false;
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));

async function detectar() {
  if (portaSolicitada !== 'auto') return portaSolicitada;
  const portas = await SerialPort.list();
  const preferida = portas.find(p => fabricantes.test([p.manufacturer,p.path,p.vendorId].join(' ')));
  if (!preferida) throw new Error('Arduino não encontrado; ajuste SERIAL_PORT=COM4 (por exemplo).');
  return preferida.path;
}

async function transmitir(leitura) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 10000);
  try {
    const resposta = await fetch(destino,{
      method:'POST',
      headers:{'content-type':'application/json','x-prototype-key':chave},
      // Régua de eletrodos envia nivelPct; sensor ultrassônico envia distanciaCm (a API exige só um dos dois).
      body:JSON.stringify(leitura.distanciaCm !== undefined
        ? {bueiroId:leitura.bueiroId,distanciaCm:leitura.distanciaCm,raw:leitura.raw ?? undefined}
        : {bueiroId:leitura.bueiroId,nivelPct:leitura.nivelPct,raw:leitura.raw ?? undefined}),
      signal:controlador.signal
    });
    if (!resposta.ok) {
      // Nunca imprimir credencial nem corpo completo da resposta.
      console.error('API recusou a leitura: HTTP ' + resposta.status + '. Verifique configuração da ponte no Render.');
      return;
    }
    console.log('Leitura experimental aceita: ' + leitura.bueiroId);
  } catch (erro) {
    console.error('Falha de rede na ponte: ' + (erro.name === 'AbortError' ? 'tempo esgotado' : erro.message));
  } finally { clearTimeout(timeout); }
}

async function conectar() {
  const caminho = await detectar();
  const porta = new SerialPort({ path:caminho,baudRate });
  portasConectadas.add(porta);
  console.log('Arduino conectado em ' + caminho + '. Encaminhando exclusivamente leituras físicas experimentais.');
  const parser = porta.pipe(new ReadlineParser({ delimiter:'\n' }));
  // Ordem e limitação de fila evitam sobrecarga na API por leituras muito rápidas.
  const fila = [];
  let processando = false;
  async function escoar() {
    if (processando) return;
    processando = true;
    while (fila.length && !encerrando && porta.isOpen) {
      const atual = fila.shift();
      await transmitir(atual);
      if (fila.length) await pausa(250);
    }
    processando = false;
  }
  parser.on('data', linha => {
    try {
      const resultado = parseLinhaSerial(String(linha).trim());
      for (const leitura of resultado.leituras || []) {
        if (!Number.isFinite(Number(leitura.distanciaCm)) && !Number.isFinite(Number(leitura.nivelPct))) continue;
        fila.push(leitura);
      }
      // Não acumular horas de leituras caso Render esteja offline.
      if (fila.length > 10) fila.splice(0,fila.length-10);
      void escoar();
    } catch (erro) { console.error('Linha serial inválida: ' + erro.message); }
  });
  await new Promise(resolve => {
    porta.once('close',resolve);
    porta.once('error',erro => { console.error('Erro de USB: ' + erro.message); resolve(); });
  });
  portasConectadas.delete(porta);
}
for (const sinal of ['SIGINT','SIGTERM']) process.on(sinal,()=>{
  encerrando=true;
  for (const porta of portasConectadas) if (porta.isOpen) porta.close();
});
while (!encerrando) {
  try { await conectar(); } catch (erro) { console.error(erro.message); }
  if (!encerrando) {console.log('Tentando reconectar USB em 5 segundos.');await pausa(5000);}
}

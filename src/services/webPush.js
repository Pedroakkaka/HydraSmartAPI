/**
 * Web Push (RFC 8291 + RFC 8292), sem serviços pagos e sem dados pessoais.
 * Entrega mensagens exclusivamente rotuladas como teste, por opt-in.
 * As chaves VAPID privadas ficam só no servidor.
 */
import { createECDH, createPrivateKey, createSign, createCipheriv, hkdfSync, randomBytes } from 'node:crypto';

const codificar = bytes => Buffer.from(bytes).toString('base64url');
const decodificar = value => Buffer.from(value, 'base64url');
const PUSH_HOSTS = new Set([
  'fcm.googleapis.com', 'android.googleapis.com',
  'updates.push.services.mozilla.com', 'push.services.mozilla.com',
  'web.push.apple.com', 'push.apple.com'
]);

export function validarInscricao(inscricao) {
  if (!inscricao || typeof inscricao !== 'object') return false;
  const { endpoint, keys } = inscricao;
  if (typeof endpoint !== 'string' || endpoint.length > 2048 ||
      !keys || typeof keys !== 'object') return false;
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !PUSH_HOSTS.has(hostname)) return false;
    const chavePublica = decodificar(keys.p256dh ?? '');
    const segredo = decodificar(keys.auth ?? '');
    return chavePublica.length === 65 && chavePublica[0] === 4 && segredo.length === 16;
  } catch { return false; }
}

export function configuracaoPushValida(config) {
  try {
    const publico = decodificar(config.vapidPublicKey);
    const privado = decodificar(config.vapidPrivateKey);
    return publico.length === 65 && publico[0] === 4 && privado.length === 32 &&
      /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.vapidSubject || '');
  } catch { return false; }
}

function chaveVapid(config) {
  const publico = decodificar(config.vapidPublicKey);
  return createPrivateKey({
    key: {
      kty:'EC', crv:'P-256',
      x: codificar(publico.subarray(1, 33)),
      y: codificar(publico.subarray(33, 65)),
      d: config.vapidPrivateKey
    },
    format:'jwk'
  });
}

export function criptografarMensagem(inscricao, mensagem) {
  const destino = decodificar(inscricao.keys.p256dh);
  const auth = decodificar(inscricao.keys.auth);
  const efemera = createECDH('prime256v1');
  efemera.generateKeys();
  const publica = efemera.getPublicKey();
  const compartilhado = efemera.computeSecret(destino);
  // RFC 8291: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" + ua + as, 32)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), destino, publica]);
  const ikm = Buffer.from(hkdfSync('sha256', compartilhado, auth, info, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cifrador = createCipheriv('aes-128-gcm', cek, nonce);
  const plano = Buffer.concat([Buffer.from(JSON.stringify(mensagem)), Buffer.from([2])]);
  const criptografado = Buffer.concat([cifrador.update(plano), cifrador.final(), cifrador.getAuthTag()]);
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(4096);
  return Buffer.concat([salt, tamanho, Buffer.from([publica.length]), publica, criptografado]);
}

function tokenVapid(endpoint, config) {
  const cabecalho = codificar(JSON.stringify({ typ:'JWT', alg:'ES256' }));
  const destino = new URL(endpoint);
  const aud = destino.origin;
  const corpo = codificar(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: config.vapidSubject
  }));
  const conteudo = cabecalho + '.' + corpo;
  const assinatura = createSign('SHA256');
  assinatura.update(conteudo);
  assinatura.end();
  const sig = assinatura.sign({ key: chaveVapid(config), dsaEncoding:'ieee-p1363' });
  return conteudo + '.' + codificar(sig);
}

export async function enviarPush(inscricao, mensagem, config, fetchImpl = fetch) {
  if (!configuracaoPushValida(config) || !validarInscricao(inscricao)) {
    throw new Error('Web Push não configurado ou inscrição inválida');
  }
  const corpo = criptografarMensagem(inscricao, mensagem);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resposta = await fetchImpl(inscricao.endpoint, {
      method:'POST',
      redirect:'error',
      signal: controller.signal,
      headers: {
        'Authorization': 'vapid t=' + tokenVapid(inscricao.endpoint, config) + ', k=' + config.vapidPublicKey,
        'TTL': '180',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(corpo.length),
        'Urgency': 'high'
      },
      body: corpo
    });
    return resposta.status;
  } finally {
    clearTimeout(timeout);
  }
}

export function criarWebPush({ config, repositorio, alertas, log }) {
  const ativo = configuracaoPushValida(config) && Boolean(repositorio);
  const fila = new Set();
  const avisar = async evento => {
    const a = evento?.alerta;
    if (!ativo || !a?.simulado ||
        !['disparado', 'nivel_alto_teste'].includes(evento?.acao) ||
        typeof a.mensagem !== 'string' ||
        !/^\[TESTE (PROTÓTIPO|SIMULAÇÃO)\]/.test(a.mensagem)) return;
    const digital = a.mensagem.startsWith('[TESTE SIMULAÇÃO]');
    const percentual = Number(a.nivelPctPico);
    const bueiro = a.bueiroId === 'bueiro_2' ? 'Bueiro 02' : 'Bueiro 01';
    const mensagem = {
      titulo: 'SIMULAÇÃO HYDRASMART — NÃO É EMERGÊNCIA',
      corpo: (digital ? 'CENÁRIO SIMULADO' : 'TESTE DO PROTÓTIPO') +
        ' · ' + bueiro +
        (Number.isFinite(percentual) ? ' · ' + percentual.toFixed(1) + '%' : '') +
        '. Não é uma emergência real. Nenhuma ação necessária.',
      tipo: 'simulacao', bueiroId: a.bueiroId,
      id: String(a.id ?? Date.now()), url: '/diagnostico'
    };
    const inscricoes = await repositorio.listar();
    const resultado = { inscritos: inscricoes.length, aceitosGateway: 0, recusadosGateway: 0, erros: 0 };
    await Promise.allSettled(inscricoes.map(async inscricao => {
      const chave = inscricao.endpoint + ':' + mensagem.id;
      if (fila.has(chave)) return;
      fila.add(chave);
      try {
        const status = await enviarPush(inscricao, mensagem, config);
        if (status === 404 || status === 410) {
          resultado.recusadosGateway++;
          await repositorio.remover(inscricao.endpoint);
        } else if (status >= 200 && status < 300) {
          resultado.aceitosGateway++;
        } else {
          resultado.recusadosGateway++;
          log?.warn?.({ status }, '[push] gateway recusou notificação de teste');
        }
      } catch (err) {
        resultado.erros++;
        log?.warn?.({ motivo: err.message }, '[push] falha de entrega de teste');
      } finally {
        fila.delete(chave);
      }
    }));
    return resultado;
  };
  const enviarTeste = () => avisar({
    acao:'nivel_alto_teste',
    alerta:{
      id:'teste-remoto-' + Date.now(),
      bueiroId:'bueiro_1',
      nivelPctPico:83.3,
      simulado:true,
      mensagem:'[TESTE SIMULAÇÃO] Envio remoto voluntário. NÃO É EMERGÊNCIA.'
    }
  });
  const aoAlerta = evento => { void avisar(evento).catch(err => log?.warn?.({ err }, '[push] erro')); };
  if (ativo) alertas.on('alerta', aoAlerta);
  return { ativo, enviarTeste, encerrar: () => alertas.off('alerta', aoAlerta) };
}

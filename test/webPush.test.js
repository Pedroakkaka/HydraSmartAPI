import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import {
  validarInscricao, configuracaoPushValida, criptografarMensagem, enviarPush
} from '../src/services/webPush.js';

const vapid = createECDH('prime256v1');
vapid.generateKeys();
const config = {
  vapidPublicKey: vapid.getPublicKey().toString('base64url'),
  vapidPrivateKey: vapid.getPrivateKey().toString('base64url'),
  vapidSubject:'mailto:hydrasmart@example.org'
};
const navegador = createECDH('prime256v1');
navegador.generateKeys();
const auth = randomBytes(16);
const inscricao = {
  endpoint:'https://fcm.googleapis.com/fcm/send/teste',
  keys:{ p256dh:navegador.getPublicKey().toString('base64url'), auth:auth.toString('base64url') }
};

test('Web Push só aceita endpoints HTTPS conhecidos e chaves válidas', () => {
  assert.equal(configuracaoPushValida(config), true);
  assert.equal(validarInscricao(inscricao), true);
  assert.equal(validarInscricao({...inscricao, endpoint:'http://127.0.0.1/'}), false);
  assert.equal(validarInscricao({...inscricao, endpoint:'https://example.com/push'}), false);
  assert.equal(validarInscricao({...inscricao, keys:{...inscricao.keys, auth:'invalid'}}), false);
});

test('conteúdo criptografado aes128gcm pode ser aberto pela chave do dispositivo', () => {
  const mensagem = { tipo:'simulacao', titulo:'SIMULAÇÃO — NÃO É EMERGÊNCIA', corpo:'Dado simulado.' };
  const payload = criptografarMensagem(inscricao,mensagem);
  const salt = payload.subarray(0,16);
  assert.equal(payload.readUInt32BE(16),4096);
  const idlen = payload[20];
  assert.equal(idlen,65);
  const chaveServidor = payload.subarray(21,21+idlen);
  const cifrado = payload.subarray(21+idlen);
  const segredo = navegador.computeSecret(chaveServidor);
  const info = Buffer.concat([
    Buffer.from('WebPush: info\0'), navegador.getPublicKey(), chaveServidor
  ]);
  const ikm = Buffer.from(hkdfSync('sha256',segredo,auth,info,32));
  const cek = Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
  const nonce = Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const decipher = createDecipheriv('aes-128-gcm',cek,nonce);
  decipher.setAuthTag(cifrado.subarray(-16));
  const plain = Buffer.concat([decipher.update(cifrado.subarray(0,-16)),decipher.final()]);
  assert.equal(plain.at(-1),2);
  assert.deepEqual(JSON.parse(plain.subarray(0,-1).toString()),mensagem);
});

test('envio VAPID identifica o servidor sem expor a chave privada',async()=>{
  const mensagens = [];
  const status = await enviarPush(inscricao,{tipo:'simulacao'},config,async(url,options)=>{
    mensagens.push({url,options});
    return {status:201};
  });
  assert.equal(status,201);
  assert.equal(mensagens.length,1);
  assert.equal(mensagens[0].options.redirect,'error');
  assert.match(mensagens[0].options.headers.Authorization,/^vapid t=/);
  assert.ok(!mensagens[0].options.headers.Authorization.includes(config.vapidPrivateKey));
  assert.equal(mensagens[0].options.headers['Content-Encoding'],'aes128gcm');
});

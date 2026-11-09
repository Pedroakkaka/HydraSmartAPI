import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { carregarConfig } from '../src/config.js';
import { criarRepositoriosMemoria } from '../src/repositories/memoria.js';
import { criarContexto } from '../src/container.js';
import { construirApp } from '../src/app.js';

const vapid = createECDH('prime256v1');
vapid.generateKeys();
const dispositivo = createECDH('prime256v1');
dispositivo.generateKeys();
const inscricao = {
  endpoint:'https://fcm.googleapis.com/fcm/send/test-device',
  keys:{
    p256dh:dispositivo.getPublicKey().toString('base64url'),
    auth:randomBytes(16).toString('base64url')
  }
};
const config = carregarConfig({
  NODE_ENV:'test', SERIAL_ENABLED:'false',
  VAPID_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'),
  VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url'),
  VAPID_SUBJECT:'mailto:hydrasmart@example.org'
});
const log = {info(){},warn(){},error(){},debug(){}};
const headers = {origin:'http://localhost:5173'};

test('inscrição Push não exige chave do operador, mas exige origem e chaves válidas',async()=>{
  const repositorios = criarRepositoriosMemoria();
  const ctx = await criarContexto({config,repositorios,log});
  const app = await construirApp(ctx);
  try {
    await app.ready();
    const publica = await app.inject('/api/v1/push/publica');
    assert.equal(publica.statusCode,200);
    assert.equal(publica.json().disponivel,true);
    assert.equal(publica.json().chavePublica,config.vapidPublicKey);

    const bloqueada = await app.inject({
      method:'POST',url:'/api/v1/push/inscrever',
      payload:inscricao,headers:{origin:'https://outro-site.example'}
    });
    assert.equal(bloqueada.statusCode,403);

    const aceita = await app.inject({
      method:'POST',url:'/api/v1/push/inscrever',
      payload:inscricao,headers
    });
    assert.equal(aceita.statusCode,201);
    const salvas = await repositorios.pushInscricoes.listar();
    assert.equal(salvas.length,1);
    assert.equal(salvas[0].endpoint,inscricao.endpoint);

    const enderecoLocal = await app.inject({
      method:'POST',url:'/api/v1/push/inscrever',
      payload:{...inscricao,endpoint:'http://localhost:4000/push'},headers
    });
    assert.equal(enderecoLocal.statusCode,400);

    const cancelada = await app.inject({
      method:'POST',url:'/api/v1/push/cancelar',
      payload:{endpoint:inscricao.endpoint},headers
    });
    assert.equal(cancelada.statusCode,200);
    assert.equal((await repositorios.pushInscricoes.listar()).length,0);
  } finally {
    await app.close();
    await ctx.encerrar();
  }
});

test('sem VAPID, servidor não confirma recebimento remoto de notificações',async()=>{
  const desativado = carregarConfig({NODE_ENV:'test',SERIAL_ENABLED:'false'});
  const ctx = await criarContexto({config:desativado,repositorios:criarRepositoriosMemoria(),log});
  const app = await construirApp(ctx);
  try {
    const estado = await app.inject('/api/v1/push/publica');
    assert.equal(estado.json().disponivel,false);
    const tentativa = await app.inject({
      method:'POST',url:'/api/v1/push/inscrever',payload:inscricao,headers
    });
    assert.equal(tentativa.statusCode,503);
  } finally {
    await app.close();
    await ctx.encerrar();
  }
});

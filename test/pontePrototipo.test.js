import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rotasLeituras from '../src/routes/leituras.js';
import { ORIGENS } from '../src/services/ingestService.js';

function criarApp(chave = 'chave-local-exclusiva-com-32-caracteres') {
  const app = Fastify();
  const recebidas = [];
  const ctx = {
    config: { prototypeIngestApiKey: chave, ingestApiKey:'', producao:true },
    ingest: { registrar: async dados => {
      recebidas.push(dados);
      return { aceita:true, leitura:{ bueiroId:dados.bueiroId } };
    } },
    repositorios: { leituras: { listar:async()=>[],serie:async()=>[] } }
  };
  app.register(rotasLeituras, { ctx, prefix:'/api/v1' });
  return {app,recebidas,chave};
}

test('ponte desativada sem chave no servidor, sem armazenar leituras', async t => {
  const {app,recebidas}=criarApp('');
  t.after(()=>app.close());
  const res=await app.inject({method:'POST',url:'/api/v1/leituras/prototipo',
    payload:{bueiroId:'bueiro_1',distanciaCm:22}});
  assert.equal(res.statusCode,503);
  assert.equal(recebidas.length,0);
});

test('credencial experimental errada nao alimenta sensores', async t => {
  const {app,recebidas}=criarApp();
  t.after(()=>app.close());
  const res=await app.inject({method:'POST',url:'/api/v1/leituras/prototipo',
    headers:{'x-prototype-key':'incorreta'},payload:{bueiroId:'bueiro_1',distanciaCm:22}});
  assert.equal(res.statusCode,401);
  assert.equal(recebidas.length,0);
});

test('ponte correta rotula origem Arduino USB e preserva isolamento', async t => {
  const {app,recebidas,chave}=criarApp();
  t.after(()=>app.close());
  const res=await app.inject({method:'POST',url:'/api/v1/leituras/prototipo',
    headers:{'x-prototype-key':chave},payload:{bueiroId:'bueiro_1',distanciaCm:22}});
  assert.equal(res.statusCode,201);
  assert.equal(res.json().canal,'prototipo');
  assert.equal(recebidas.length,1);
  assert.equal(recebidas[0].origem,ORIGENS.ARDUINO_USB);
});

test('rejeita corpo indevido na ponte', async t => {
  const {app,recebidas,chave}=criarApp();
  t.after(()=>app.close());
  const res=await app.inject({method:'POST',url:'/api/v1/leituras/prototipo',
    headers:{'x-prototype-key':chave},payload:{bueiroId:'bueiro_1',distanciaCm:-22}});
  assert.equal(res.statusCode,400);
  assert.equal(recebidas.length,0);
});

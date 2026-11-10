/**
 * Benchmark ISOLADO HydraSmart: API + WebSocket, sem Render, PostgreSQL,
 * Arduino, IA paga ou serviços meteorológicos externos.
 * Todos os requests são realizados contra Fastify em 127.0.0.1.
 */
import { performance } from 'node:perf_hooks';
import { setTimeout as dormir } from 'node:timers/promises';
import { carregarConfig } from '../src/config.js';
import { criarRepositoriosMemoria } from '../src/repositories/memoria.js';
import { criarContexto } from '../src/container.js';
import { construirApp } from '../src/app.js';

const NIVEIS = [10, 25, 50, 100, 200];
const ITERACOES = 8;
const TEMPO_LIMITE_MS = 12000;
const config = carregarConfig({
  NODE_ENV:'test', SERIAL_ENABLED:'false',
  OPERATOR_API_KEY:'chave-local-so-benchmark',
  DB_FALLBACK_MEMORIA:'true',
  ENABLE_PUBLIC_AI:'false', ENABLE_AUTOMATIC_AI:'false',
  ENABLE_AI_TEST:'false', CEMADEN_TOKEN:'', OPENAI_API_KEY:'',
  CLOUDFLARE_API_TOKEN:'', CORS_ORIGIN:'http://localhost:5173'
});
const log = { info(){},warn(){},error(){},debug(){} };
const p95 = a => a.length ? a[Math.min(a.length - 1, Math.ceil(a.length * .95)-1)] : null;
const percentil = (a,p) => a.length ? a[Math.min(a.length - 1, Math.ceil(a.length*p)-1)] : null;
const arred = n => Number(n.toFixed(1));

function resultado(latencias,erros,segundos) {
  const valores = [...latencias].sort((a,b)=>a-b);
  return {
    requisicoes:latencias.length, erros,
    taxaErrosPct:arred(erros*100/Math.max(latencias.length,1)),
    p50Ms:arred(percentil(valores,.50)),
    p95Ms:arred(p95(valores)),
    p99Ms:arred(percentil(valores,.99)),
    maxMs:arred(valores.at(-1)??0),
    rps:arred(latencias.length/segundos)
  };
}
async function medirHttp(base,usuarios) {
  const latencias=[];let erros=0;
  const inicio=performance.now();
  await Promise.all(Array.from({length:usuarios},async(_,u)=>{
    for(let i=0;i<ITERACOES;i++){
      const url=(u+i)%2===0?'/api/v1/health':'/api/v1/estado';
      const t=performance.now();
      try{
        const resposta=await fetch(base+url,{signal:AbortSignal.timeout(TEMPO_LIMITE_MS)});
        if(!resposta.ok) erros++;
        await resposta.arrayBuffer();
      }catch{erros++;}
      latencias.push(performance.now()-t);
    }
  }));
  return resultado(latencias,erros,(performance.now()-inicio)/1000);
}
async function abrirWs(url) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url);
    let fechado=false;
    const t=performance.now();
    const limite=setTimeout(()=>{if(!fechado){fechado=true;ws.close();reject(new Error('timeout WebSocket'));}},TEMPO_LIMITE_MS);
    ws.addEventListener('message',evento=>{
      try{
        const dados=JSON.parse(evento.data);
        if(dados.tipo==='estado' && !fechado){
          fechado=true;clearTimeout(limite);
          resolve({socket:ws,latencia:performance.now()-t});
        }
      }catch { /* mensagem não JSON, aguarda próximo evento válido */ }
    });
    ws.addEventListener('error',()=>{
      if(!fechado){fechado=true;clearTimeout(limite);reject(new Error('erro WebSocket'));}
    });
    ws.addEventListener('close',()=>{
      if(!fechado){fechado=true;clearTimeout(limite);reject(new Error('fechado sem estado'));}
    });
  });
}
async function medirWs(base,usuarios,ctx){
  const inicio=performance.now();
  const lotes=await Promise.allSettled(Array.from({length:usuarios},()=>abrirWs(base.replace(/^http/,'ws')+'/ws')));
  const validos=lotes.filter(x=>x.status==='fulfilled').map(x=>x.value);
  // Simulação de dois sensores no mesmo servidor, sem hardware e sem HTTP público.
  ctx.simulador.parar();
  const inicioEventos=performance.now();
  await ctx.simulador.iniciar('tempestade_transbordo');
  await dormir(350);
  const eventosMs=performance.now()-inicioEventos;
  await ctx.simulador.encerrar();
  for(const v of validos)v.socket.close();
  await dormir(75);
  return {
    conexoesSolicitadas:usuarios, conectadas:validos.length,
    falhas:usuarios-validos.length,
    p95ConexaoMs:arred(p95(validos.map(x=>x.latencia).sort((a,b)=>a-b))??0),
    cicloDoisBueirosMs:arred(eventosMs),
    duracaoSeg:arred((performance.now()-inicio)/1000)
  };
}

let ctx,app;
try{
  ctx=await criarContexto({config,repositorios:criarRepositoriosMemoria(),log});
  app=await construirApp(ctx);
  await app.listen({host:'127.0.0.1',port:0});
  const base=app.listeningOrigin;
  console.log('CARGA HYDRASMART — AMBIENTE ISOLADO, SEM TRÁFEGO DE PRODUÇÃO');
  console.log('Node',process.version,'| host', '127.0.0.1', '| db','memória', '| hardware','ausente');
  const resultados=[];
  for(const usuarios of NIVEIS){
    const http=await medirHttp(base,usuarios);
    const ws=await medirWs(base,usuarios,ctx);
    const memoriaMb=arred(process.memoryUsage().rss/1024/1024);
    const linha={usuariosSimultaneos:usuarios,http,websocket:ws,rssMb:memoriaMb};
    resultados.push(linha);
    console.log('RESULTADO_JSON',JSON.stringify(linha));
    if(http.erros>0||ws.falhas>0) console.warn('ATENÇÃO — erros nesta faixa',usuarios);
  }
  const res={tipo:'local_isolado',data:new Date().toISOString(),resultados};
  console.log('RELATORIO_COMPLETO_JSON',JSON.stringify(res));
  // Threshold: identificar qualquer erro. Não usar como atestado de capacidade em Render.
  if(resultados.some(x=>x.http.erros>0||x.websocket.falhas>0))process.exitCode=1;
}catch(err){console.error('FALHA_BENCHMARK',err.stack||err.message);process.exitCode=1;}
finally{await app?.close();await ctx?.encerrar();}

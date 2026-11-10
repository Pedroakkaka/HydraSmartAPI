# Relatório — teste de carga isolado HydraSmart

**Execução:** 10/11/2026, 14:15–14:16 UTC  
**GitHub Actions:** https://github.com/Pedroakkaka/HydraSmartAPI/actions/runs/42832279196  
**Escopo:** API Fastify local em 127.0.0.1, Node 22.23.4, GitHub Actions Ubuntu, banco em memória.  
**Produção Render/Vercel:** **não submetida à carga**, para proteger a disponibilidade do HydraSmart.  
**Sem** Arduino, PostgreSQL, chamadas de IA pagas ou serviços meteorológicos externos.

## Teste escalonado

Cada usuário virtual realizou 8 GETs, alternando `/api/v1/health` e `/api/v1/estado`. Foram abertos WebSockets paralelos em `/ws`, verificando não só o primeiro snapshot, mas também o **recebimento da atualização de B01 e B02** após o ciclo sintético.

| Usuários virtuais | GETs HTTP | Erros HTTP | P95 HTTP (ms) | WebSockets conectados | Receberam os dois bueiros | P95 da conexão WS (ms) | RSS (MB) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 80 | 0 | 32,6 | 10 | 10 | 11,4 | 100,0 |
| 25 | 200 | 0 | 38,6 | 25 | 25 | 7,5 | 112,1 |
| 50 | 400 | 0 | 72,7 | 50 | 50 | 17,5 | 131,6 |
| 100 | 800 | 0 | 143,5 | 100 | 100 | 18,2 | 144,3 |
| 200 | 1.600 | 0 | 235,5 | 200 | 200 | 35,9 | 170,4 |

Total do teste escalonado: **3.080 GETs HTTP, 0 erros; 385 conexões WebSocket abertas com sucesso e 385 clientes receberam um snapshot com B01 e B02**. As faixas de carga foram executadas sequencialmente, não somadas simultaneamente.

## Sustentação limitada

- 100 usuários virtuais em paralelo por 15,1 segundos, cada um consultando a cada ~0,5 segundo
- 3.000 requisições HTTP; **0 erros**
- 198,8 requisições/segundo; P50 1,4 ms, P95 **4,8 ms**, P99 34,8 ms; máximo 41,5 ms

## Interpretação e limites

**Aprovado:** nesse runner isolado e por esse tempo, a API suportou as cinco faixas testadas com erro HTTP zero e entrega WebSocket do estado de ambos os bueiros a todos os assinantes. A sustentação leve também passou.

**Não comprovado:** capacidade sustentada do servidor Render gratuito ou do site Vercel em produção, latência da internet móvel, disponibilidade por horas, concorrência com PostgreSQL real, consultas meteorológicas/IA, durabilidade de WebSocket ou entrega de Web Push em celulares reais. O teste não mede FPS/renderização da interface React em dispositivos.

P95 significa que 95% das requisições medidas terminaram no tempo indicado ou antes. O número de 200 **não representa limite máximo ou SLA de produção**.

## Próximos ensaios sugeridos

1. Ambiente de homologação no mesmo plano/tamanho do Render com PostgreSQL equivalente, por 5–15 minutos, mantendo limite de carga e monitoramento de CPU/memória.
2. Cenário de reconexão WS, perdas de rede e reativação de dispositivos em segundo plano.
3. Medir Web Push real por gateway e confirmações do service worker, sem confundir aceite no FCM com notificação visível.
4. Teste de interface móvel com 10–20 navegadores reais/simulados.

**Segurança:** não executar essas cargas diretamente no endereço público sem janela autorizada. Nenhuma mudança nesta branch executa deployment, merge ou altera banco real.

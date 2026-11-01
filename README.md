# HydraSmart API

> **Histórico de desenvolvimento:** veja [docs/REGISTRO_DESENVOLVIMENTO.md](docs/REGISTRO_DESENVOLVIMENTO.md) para o registro cronológico das alterações discutidas, decisões, commits, testes, publicações e pendências.


Back-end do **HydraSmart**, a plataforma de monitoramento de drenagem urbana e prevenção de alagamentos de Porto Alegre-RS.

A API lê os sensores do Arduino pela USB, calcula o nível de água de cada bueiro, grava o histórico no PostgreSQL, dispara alertas críticos e envia tudo em tempo real para o painel ([HydraSmartFront](https://github.com/Pedroakkaka/HydraSmartFront)).

| | |
|---|---|
| **Stack** | Node.js 20+ · Fastify 5 · PostgreSQL 16 · WebSocket · Docker |
| **Documentação interativa** | `http://localhost:3333/docs` (Swagger / OpenAPI) |
| **Tempo real** | `ws://localhost:3333/ws` |

## Arquitetura

```
 Arduino Uno (USB) ──► SerialReader ─┐
 Sensor em campo (HTTP + API key) ───┼─► IngestService ─► TelemetryState ──► WebSocket /ws ──► Painel React
 Simulador (modo demonstração) ──────┘        │                 │
                                              ▼                 ▼
                                        PostgreSQL         AlertService
                                    (leituras reais)   (abre/encerra alertas)

 Open-Meteo · CEMADEN · OpenStreetMap ──► serviços com cache ──► REST /api/v1/...
```

- **`src/core/`**: regras determinísticas puras, como a conversão distância → nível, a classificação de risco, as tendências e o parser serial. Sem acesso a banco ou rede, 100% testado.
- **`src/domain/telemetryState.js`**: estado ao vivo dos bueiros. É a fonte única da verdade que o painel recebe.
- **`src/services/`**: recebimento de leituras, alertas, simulador e integrações externas.
- **`src/repositories/`**: acesso ao PostgreSQL. A versão em memória, com a mesma interface, é usada nos testes e como reserva.
- **`src/routes/`**: endpoints REST validados por JSON Schema, que também geram o Swagger.

### Regras importantes

- Dados do **modo demonstração nunca são gravados no banco**. O histórico, os relatórios e os alertas oficiais contêm só leituras físicas reais.
- Se o PostgreSQL não responder **em desenvolvimento**, a API sobe com dados só em memória e avisa no log, para a apresentação não parar. Em produção ela não sobe sem banco.
- Se o cabo USB for desconectado, a API tenta reconectar sozinha a cada 5 s.

## Instalar em outro computador (notebook da feira)

Siga o passo a passo em **[docs/INSTALACAO.md](docs/INSTALACAO.md)**. Depois de instalar Git, Node.js e Docker Desktop, tudo se resolve com três atalhos na raiz deste repositório:

| Arquivo | Quando usar |
|---|---|
| `INSTALAR-HYDRASMART.bat` | Uma vez por computador. Baixa o painel, instala tudo, cria o banco e roda os testes |
| `INICIAR-HYDRASMART.bat` | Liga banco, API e painel e abre o navegador |
| `PARAR-HYDRASMART.bat` | Desliga tudo. Os dados ficam salvos |

## Como rodar manualmente (desenvolvimento)

Pré-requisitos: **Node.js 20+** e **Docker Desktop** aberto.

```powershell
# 1. Configuração (só na primeira vez)
copy .env.example .env
npm install

# 2. Banco de dados (PostgreSQL no Docker, porta 5433)
npm run db:up

# 3. API (cria as tabelas automaticamente na primeira execução)
npm run dev
```

Com o Arduino plugado e o **Monitor Serial da IDE Arduino fechado**, a API encontra a porta sozinha (`SERIAL_PORT=auto`). Se houver mais de uma placa, informe a porta no `.env`, por exemplo `SERIAL_PORT=COM4`.

> A API roda **fora do Docker** na máquina local porque o Docker Desktop no Windows não acessa portas USB. Só o banco fica no container.

### Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API com recarga automática ao editar o código |
| `npm start` | API sem recarga automática |
| `npm test` | Testes automatizados (núcleo, parser serial e rotas da API) |
| `npm run lint` | Verificação de qualidade do código (ESLint) |
| `npm run db:up` / `db:down` | Liga / desliga o PostgreSQL |
| `npm run db:migrate` | Aplica migrações pendentes manualmente |

## Endpoints principais (`/api/v1`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Saúde da API, do banco e da serial |
| GET | `/estado` | Estado ao vivo completo (o mesmo do WebSocket) |
| GET | `/bueiros` | Bueiros com calibração e última leitura |
| PUT | `/bueiros/:id/calibracao` | Altura, zona cega, volume e limiares |
| PUT / DELETE | `/bueiros/:id/coordenadas` | Confirma / remove a localização no mapa |
| GET | `/leituras` | Histórico do banco (`?bueiroId=&desde=&ate=&limite=`) |
| POST | `/leituras` | Recebe leitura de sensor em campo. Exige `X-API-Key` |
| GET | `/serial/portas` · POST `/serial/conectar` · `/serial/desconectar` | Controle da USB |
| POST | `/simulacao/iniciar` · `/pausar` · `/reiniciar` · `/encerrar` | Modo demonstração |
| GET | `/alertas` · POST `/alertas/:id/reconhecer` | Alertas críticos |
| GET | `/clima` · `/cemaden` · `/osm/drenos` · `/historico-oficial` | Fontes externas (com cache) |
| GET | `/relatorios/leituras.csv` · `/relatorios/auditoria.json` | Exportações |

Exemplo de envio por um sensor em campo (ESP32, gateway 4G etc.):

```bash
curl -X POST http://SEU-SERVIDOR/api/v1/leituras \
  -H "Content-Type: application/json" -H "X-API-Key: SUA_CHAVE" \
  -d '{"bueiroId": 1, "distanciaCm": 14.5}'
```

## Firmware do Arduino

O firmware está em [`firmware/hydrasmart_firmware.ino`](firmware/hydrasmart_firmware.ino). Ele envia uma linha JSON por sensor a cada segundo, em 115200 baud:

```json
{"bueiro":1,"dist_cm":14.5,"raw":145}
```

Pinagem: Bueiro 01 com TRIG em D9 e ECHO em D10. Bueiro 02 com TRIG em D6 e ECHO em D7. Os dois sensores usam 5V e GND.

## Banco de dados

| Tabela | Conteúdo |
|---|---|
| `bueiros` | Cadastro, calibração física e coordenadas |
| `leituras` | Toda leitura real (1 por segundo por sensor), indexada por bueiro e data |
| `alertas` | Alertas críticos com início, pico, fim e reconhecimento |
| `schema_migrations` | Controle das migrações aplicadas |

As migrações ficam em `src/db/migrations/` e rodam automaticamente ao iniciar a API. Para alterar o banco, crie um novo arquivo numerado, por exemplo `002_nova_coluna.sql`.

## Deploy em VPS

Veja [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md).

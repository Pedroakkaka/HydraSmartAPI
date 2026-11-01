# Deploy do HydraSmart em uma VPS

Este guia sobe o sistema completo, API + banco + painel, em um servidor Linux (Ubuntu 22.04/24.04) usando Docker.

```
Internet ──► :80/:443  nginx (HydraSmartFront) ──► /        painel React
                                              ├──► /api/*   ──┐
                                              └──► /ws      ──┴─► api:3333 (HydraSmartAPI) ──► db:5432 (PostgreSQL)
```

Os dois repositórios compartilham a rede Docker `hydrasmart`. Só o nginx fica exposto à internet. A API e o banco escutam apenas em `127.0.0.1`.

## 1. Preparar o servidor

```bash
# Docker + Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # saia e entre de novo na sessão

# Firewall: só SSH e web
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

## 2. API + banco

```bash
git clone https://github.com/Pedroakkaka/HydraSmartAPI.git
cd HydraSmartAPI
cp .env.example .env
nano .env
```

No `.env` da VPS, altere pelo menos:

```dotenv
NODE_ENV=production
POSTGRES_PASSWORD=<senha forte>
INGEST_API_KEY=<chave longa e aleatória>
CORS_ORIGIN=https://seu-dominio.com.br
GEMINI_API_KEY=<nova chave privada do Google AI Studio>
```

**Importante:** um segredo cadastrado em `Settings → Secrets and variables → Actions` no GitHub **não é automaticamente enviado à VPS**. Configure `GEMINI_API_KEY` no `.env` privado da VPS (ou no painel de variáveis da hospedagem). O `docker-compose.yml` repassa a variável para o container `api`; nunca publique o `.env` no repositório.

Depois suba os containers:

```bash
docker compose --profile completo up -d --build
docker compose ps                    # db e api devem aparecer como "healthy"
curl http://127.0.0.1:3333/api/v1/health
```

Na VPS, a leitura USB fica desligada (`SERIAL_ENABLED=false`). Os sensores em campo enviam os dados por `POST /api/v1/leituras` com o cabeçalho `X-API-Key`.

## 3. Painel (front-end)

```bash
cd ~
git clone https://github.com/Pedroakkaka/HydraSmartFront.git
cd HydraSmartFront
docker compose up -d --build
```

O painel fica disponível em `http://IP-DA-VPS`.

## 4. HTTPS com domínio próprio

Aponte o domínio (registro A) para o IP da VPS e gere o certificado. Uma opção simples é colocar o [Caddy](https://caddyserver.com/) na frente do nginx, ou usar o certbot. Os detalhes estão no README do HydraSmartFront.

## Operação

| Tarefa | Comando |
|---|---|
| Ver logs da API | `docker compose logs -f api` |
| Atualizar após `git pull` | `docker compose --profile completo up -d --build` |
| Backup do banco | `docker compose exec db pg_dump -U hydrasmart hydrasmart > backup_$(date +%F).sql` |
| Restaurar backup | `cat backup.sql \| docker compose exec -T db psql -U hydrasmart hydrasmart` |

## Antes de abrir para clientes

- [ ] **Autenticação de operadores** nas rotas que alteram dados (calibração, simulação, serial). Hoje elas são abertas. Isso é aceitável numa rede local de demonstração, mas não na internet.
- [ ] Backup automático diário do banco (cron + `pg_dump`).
- [ ] Política de retenção das leituras. Com 1 leitura/s por sensor são cerca de 170 mil linhas/dia: considere agregar por minuto após 30 dias.
- [ ] Monitoramento: `GET /api/v1/health` em um serviço como UptimeRobot.

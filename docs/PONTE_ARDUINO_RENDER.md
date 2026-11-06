# Ponte Arduino USB → HydraSmart no Render

## Por que existe esta ponte?

O Render executa a API em um servidor remoto. Um Arduino conectado à porta USB de um notebook **não aparece automaticamente** nas portas seriais desse servidor. A ponte deve ser executada no **próprio computador conectado ao Arduino** para encaminhar apenas leituras físicas experimentais por HTTPS.

Fluxo: **Arduino → USB do notebook → ponte Node.js → rota autenticada da API no Render → canal `prototipo` → WebSocket → celular autorizado**.

Esta ponte **não é um simulador**, **não envia para a Defesa Civil**, **não altera o banco** e **não converte dados do protótipo em medições de campo**.

## Configuração única e segura

1. Gere uma chave aleatória forte (idealmente pelo menos 32 caracteres). **Não a coloque no frontend, GitHub, prints, chats públicos ou arquivos versionados.**
2. No painel seguro do serviço HydraSmartAPI do Render, configure a variável de ambiente `PROTOTYPE_INGEST_API_KEY` com essa chave. O Render faz novo deploy quando necessário.
3. No computador que ficará conectado ao Arduino, instale Node.js 22+ e baixe o repositório da API. Rode `npm install` para instalar também o pacote **opcional** `serialport`. Não execute `npm ci --omit=optional` na máquina da bancada.
4. Feche o **Monitor Serial** da IDE Arduino (ele não pode disputar a mesma porta USB).
5. Execute a ponte com a mesma chave e a porta correta.

### Exemplo no Windows PowerShell

```powershell
cd HydraSmartAPI
npm install
$env:HYDRASMART_API_URL = "https://hydrasmartapi.onrender.com"
$env:PROTOTYPE_INGEST_API_KEY = "<COLE_A_CHAVE_AQUI_LOCALMENTE>"
$env:SERIAL_PORT = "COM4"  # ou "auto" para detectar
$env:SERIAL_BAUD = "115200"
node scripts/ponte-arduino-render.mjs
```

**Atenção:** o exemplo acima contém apenas um *placeholder*. Não existem chaves embutidas no repositório.

## Comportamento esperado

- A ponte mostra **“Arduino conectado”** e, ao receber linhas válidas, **“Leitura experimental aceita”**.
- O navegador mostra **Projeto físico · Experimental** com leituras recentes e válidas, se houver dados.
- Um celular que já autorizou notificações recebe automaticamente a mensagem **“TESTE DO SISTEMA — NÃO É EMERGÊNCIA”** ao ingressar na faixa de atenção ou crítico.
- Limiares padrão: **50% atenção**, **80% crítico**, sujeitos à calibração por sensor.
- As leituras são experimentais e **não podem ser interpretadas como situação real de alagamento**.
- **O celular deve permanecer com o site aberto e com conexão ativa.** Não há Web Push com site fechado nesta etapa.
- Sem Arduino, notebook/ponte desligados, credencial ausente, conexão interrompida ou permissão negada, a entrega não é garantida.

## Validação controlada

1. Use somente a bancada de demonstração e confirme que o destino é `https://hydrasmartapi.onrender.com`.
2. Abra o HydraSmart em um celular e autorize as notificações pelo pequeno sino no cabeçalho (**ação única do participante**).
3. Confirme no notebook que a ponte está recebendo leituras reais; não digite nenhuma medição fictícia no site público.
4. Varie **fisicamente** o nível até passar pelas faixas normal → atenção → crítico → normal, observando o aviso no celular.
5. Confirme que os avisos possuem o prefixo de teste e não repetem a cada medição dentro da mesma faixa.
6. Desconecte o USB e observe o reconhecimento de perda de conexão e reconexão.
7. Registre evidências: horário, leitura, percentual, status da ponte, status da API e notificação recebida.

**Critério de aceite:** pelo menos um aparelho Android e, quando disponível, um iPhone compatível devem ser ensaiados. Marque como **validado em campo** somente após documentar a entrega efetiva; código commitado ou `HTTP 201` na API não comprovam notificação recebida.

## Diagnóstico rápido

| Sintoma | Verificação |
| --- | --- |
| Erro de chave / HTTP 503 | Configurar `PROTOTYPE_INGEST_API_KEY` no Render |
| HTTP 401 | A chave local não corresponde à definida no Render |
| Nenhuma porta encontrada | `SERIAL_PORT=COMx`, driver USB, cabo e Monitor Serial fechado |
| Sem leituras | Firmware deve emitir linhas legíveis pelo parser `src/core/serialParser.js` |
| Dados no painel, sem notificação | Permissão do navegador, site aberto, WebSocket e faixa de nível |
| Render temporariamente indisponível | Conferir deploy, logs e reconexão; a ponte mantém fila curta |

## Segurança

- Endpoint exclusivo: `POST /api/v1/leituras/prototipo`, exigindo cabeçalho `X-Prototype-Key`.
- A rota **falha fechada** quando `PROTOTYPE_INGEST_API_KEY` está ausente.
- A credencial é exclusiva da ponte; **não** deve ser reutilizada como chave de operador ou de sensor de campo.
- A API registra o pacote como origem `Arduino USB` no canal `prototipo`, sem gravá-lo como leitura operacional de campo.
- Não atribuir a essa implementação a propriedade de emissão de alertas públicos ou oficiais.

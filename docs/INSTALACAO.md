# Como instalar o HydraSmart em outro computador

> 📄 **Versão para imprimir:** [Guia-Instalacao-HydraSmart.pdf](Guia-Instalacao-HydraSmart.pdf). Ela é gerada a partir de `docs/fonte/guia-instalacao.html`: abra o HTML no Chrome, pressione Ctrl+P e escolha Salvar como PDF.

Este guia prepara qualquer notebook com Windows 10 ou 11 para rodar o HydraSmart completo: banco de dados, API, painel e leitura do Arduino. Depois da preparação, ligar o sistema é **um clique duplo**.

> Faça a instalação **com antecedência e com internet**. No dia da feira só é preciso ligar o sistema.

---

## O que o notebook precisa ter

| Item | Mínimo |
|---|---|
| Sistema | Windows 10 (22H2) ou Windows 11, 64 bits |
| Memória | 8 GB de RAM (o Docker usa cerca de 2 GB) |
| Espaço livre | 10 GB |
| Virtualização | Ativada na BIOS (quase todos os notebooks já vêm assim) |
| Porta USB | Para o cabo do Arduino |

Para conferir a virtualização, abra o **Gerenciador de Tarefas**, vá em **Desempenho → CPU** e veja se "Virtualização" mostra **Habilitado**.

---

## Passo 1 — Instalar os programas (só uma vez)

Instale nesta ordem, sempre aceitando as opções padrão:

1. **Git**: https://git-scm.com/download/win
2. **Node.js (versão LTS)**: https://nodejs.org
3. **Docker Desktop**: https://www.docker.com/products/docker-desktop
   - Na instalação, deixe marcado **"Use WSL 2"**.
   - **Reinicie o computador** quando ele pedir.
   - Abra o Docker Desktop uma vez, aceite os termos e espere aparecer **"Engine running"** no canto inferior esquerdo. Pode pular o login: não é necessário.
   - Recomendado: em *Settings → General*, marque **"Start Docker Desktop when you sign in"**.
4. **Driver do Arduino**, só se o Arduino for um modelo compatível com chip CH340 (os mais baratos): http://www.wch-ic.com/downloads/CH341SER_EXE.html

> Se o Docker reclamar de WSL, abra o **PowerShell como administrador**, rode `wsl --update` e reinicie.

---

## Passo 2 — Baixar o projeto

1. Crie a pasta `C:\HydraSmart`.
2. Clique com o botão direito dentro dela e escolha **"Abrir no Terminal"**, ou abra o PowerShell e digite `cd C:\HydraSmart`.
3. Rode:

```powershell
git clone https://github.com/Pedroakkaka/HydraSmartAPI.git
```

Se o GitHub pedir login, entre com uma conta que tenha acesso aos repositórios. O painel (HydraSmartFront) é baixado sozinho no próximo passo.

---

## Passo 3 — Instalar o sistema

Abra `C:\HydraSmart\HydraSmartAPI` e dê **dois cliques** em:

```
INSTALAR-HYDRASMART.bat
```

O instalador faz tudo sozinho, em 1 a 5 minutos conforme a internet:

- confere se Node, Git e Docker estão instalados;
- baixa o painel (HydraSmartFront) ao lado da API;
- cria o arquivo de configuração `.env`;
- instala as dependências;
- liga o banco de dados e cria as tabelas;
- gera o painel otimizado;
- roda os testes automáticos.

No final deve aparecer **"Instalação concluída!"**.

> Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**.

A estrutura final fica assim:

```
C:\HydraSmart\
├── HydraSmartAPI\      ← servidor, banco e scripts (.bat)
└── HydraSmartFront\    ← painel
```

---

## Passo 4 — Ligar o sistema

1. Ligue o **Arduino** no USB.
2. Feche a **IDE do Arduino**, se estiver aberta. Ela prende a porta USB.
3. Dê **dois cliques** em `INICIAR-HYDRASMART.bat`.

Em cerca de 30 segundos:

- duas janelas ficam abertas: **"HydraSmart API"** e **"HydraSmart Painel"**. **Não feche essas duas.**
- o navegador abre sozinho em **http://localhost:4173**.
- o servidor encontra o Arduino automaticamente. O indicador no menu lateral fica verde.

Na primeira vez, o Firewall do Windows pode pedir permissão para o **Node.js**. Marque **Redes privadas** e clique em **Permitir**. Isso é necessário para mostrar o painel em outro aparelho.

### Chave do operador

Ações que alteram o sistema pedem a **chave do operador**: conectar o Arduino, salvar a calibração e ligar ou desligar a simulação. O painel pede a chave uma vez e a reutiliza até a página ser recarregada.

- A chave é criada automaticamente pelo instalador e aparece na janela do `INICIAR` e do `INSTALAR`.
- Ela também fica no arquivo `HydraSmartAPI\.env`, na linha `OPERATOR_API_KEY`.
- Para trocar a chave, apague o valor dessa linha e rode o `INICIAR` de novo: uma nova é gerada.

### Mostrar o painel numa TV, tablet ou celular

A janela do `INICIAR` mostra um endereço como `http://192.168.0.15:4173`. Abra esse endereço em qualquer aparelho **conectado à mesma rede Wi-Fi**. Todos atualizam em tempo real ao mesmo tempo.

## Passo 5 — Desligar

Dê **dois cliques** em `PARAR-HYDRASMART.bat`. As leituras gravadas ficam salvas no banco.

---

## Checklist do dia da feira

- [ ] Notebook carregado e na tomada. **Desative a suspensão** em *Configurações → Sistema → Energia*.
- [ ] Abrir o Docker Desktop e esperar "Engine running". Se a opção de iniciar com o Windows estiver marcada, ele abre sozinho.
- [ ] Plugar o Arduino, com a IDE do Arduino fechada.
- [ ] `INICIAR-HYDRASMART.bat`.
- [ ] Anotar a **chave do operador** que aparece na janela. O painel vai pedi-la.
- [ ] Abrir a página **Diagnóstico** e conferir o autodiagnóstico: API, tempo real, banco e Arduino devem estar em ✔.
- [ ] Testar o som da sirene (Diagnóstico → **Testar sirene**). O navegador só libera som depois do primeiro clique na página.
- [ ] **Plano B**: se o Arduino falhar, clique em **Modo Real → Trocar** no menu lateral. O modo demonstração simula os cenários de chuva e alagamento sem gravar nada no histórico.

### Sem internet no local?

| Funciona sem internet | Precisa de internet |
|---|---|
| Leitura do Arduino, níveis e alertas | Mapa (imagens do OpenStreetMap) |
| Banco de dados, histórico e relatórios | Clima (Open-Meteo) |
| Gráficos | CEMADEN |
| Modo demonstração | Fontes do texto (o painel usa uma fonte padrão do Windows no lugar) |

Dica: o roteador do celular resolve. Ligue o notebook nele antes de iniciar o sistema.

---

## Atualizar para a versão mais nova

Com o sistema desligado, abra o PowerShell em `C:\HydraSmart` e rode:

```powershell
cd HydraSmartAPI;   git pull;   cd ..
cd HydraSmartFront; git pull;   cd ..
```

Depois rode `INSTALAR-HYDRASMART.bat` de novo. Ele mantém o `.env` e os dados do banco.

---

## Gravar o firmware no Arduino (só se for uma placa nova)

1. Instale a **Arduino IDE**: https://www.arduino.cc/en/software
2. Abra `HydraSmartAPI\firmware\hydrasmart_firmware.ino`.
3. Em **Ferramentas → Placa**, escolha **Arduino Uno**. Em **Ferramentas → Porta**, escolha a porta COM do Arduino.
4. Clique em **Carregar** (seta →).
5. **Feche a IDE** antes de iniciar o HydraSmart.

Ligação dos sensores HC-SR04: Bueiro 01 com TRIG em D9 e ECHO em D10. Bueiro 02 com TRIG em D6 e ECHO em D7. VCC no 5V e GND no GND.

---

## Problemas comuns

| Sintoma | Solução |
|---|---|
| "Node.js não encontrado" logo após instalar | Feche e abra a janela de novo, ou reinicie o PC |
| Docker Desktop não abre ou fica em "Starting" | Confira a virtualização na BIOS. Rode `wsl --update` no PowerShell como administrador e reinicie |
| "porta ocupada" ao iniciar o banco | Outro programa usa a porta 5433. No `.env`, troque `DB_PORT=5434` e a porta em `DATABASE_URL` para `5434` |
| Arduino não é encontrado | Feche a IDE do Arduino. Troque o cabo, pois alguns cabos só carregam e não transmitem dados. Instale o driver CH340. Se houver mais de uma placa, defina `SERIAL_PORT=COM4` (a porta certa) no `.env` |
| Bueiros "Desatualizado" | O Arduino parou de enviar dados. Confira o cabo. A API reconecta sozinha a cada 5 segundos |
| "Chave de operador necessária" ou "inválida" | Use a chave que aparece na janela do `INICIAR`, ou a linha `OPERATOR_API_KEY` do arquivo `HydraSmartAPI\.env` |
| "Operações administrativas desabilitadas" | O `.env` está sem `OPERATOR_API_KEY`. Rode o `INICIAR-HYDRASMART.bat` de novo: ele cria a chave sozinho. Se a API já estiver rodando, rode o `PARAR` antes |
| Painel mostra "Servidor indisponível" | A janela "HydraSmart API" foi fechada ou mostra um erro. Rode `PARAR` e depois `INICIAR` |
| Outro aparelho não abre o painel | Os dois precisam estar no mesmo Wi-Fi, e o Firewall precisa permitir o Node.js em "Redes privadas" |
| Banco aparece como "memória" no Diagnóstico | O Docker não estava ligado quando a API subiu. Os dados não serão salvos. Abra o Docker, rode `PARAR` e depois `INICIAR` |

Para ver o funcionamento interno, a documentação técnica da API fica em **http://localhost:3333/docs**.

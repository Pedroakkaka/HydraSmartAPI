# Como instalar o HydraSmart em outro computador

> 📄 **Versão para imprimir:** [Guia-Instalacao-HydraSmart.pdf](Guia-Instalacao-HydraSmart.pdf). Ela é gerada a partir de `docs/fonte/guia-instalacao.html`: abra o HTML no Chrome, pressione Ctrl+P e escolha Salvar como PDF.

Este guia prepara qualquer notebook com Windows 10 ou 11 para rodar o HydraSmart completo:

- banco de dados;
- API;
- painel de Porto Alegre-RS;
- leitura do protótipo físico (Arduino Uno com duas réguas de eletrodos).

Depois da preparação, ligar o sistema é **um clique duplo**.

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
   - Abra o Docker Desktop uma vez, aceite os termos e espere aparecer **"Engine running"** no canto inferior esquerdo. O login não é necessário.
   - Recomendado: em *Settings → General*, marque **"Start Docker Desktop when you sign in"**.
4. **Driver do Arduino**, só se a placa for compatível com o chip CH340 (os modelos mais baratos): http://www.wch-ic.com/downloads/CH341SER_EXE.html

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
- cria o arquivo de configuração `.env` e a **chave do operador**;
- instala as dependências;
- liga o banco de dados e cria as tabelas;
- gera o painel otimizado;
- roda os testes automáticos.

No final deve aparecer **"Instalação concluída!"**, junto com a chave do operador.

> Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**.

A estrutura final fica assim:

```
C:\HydraSmart\
├── HydraSmartAPI\      ← servidor, banco, firmware e atalhos (.bat)
└── HydraSmartFront\    ← painel
```

---

## Passo 4 — Preparar o protótipo físico

O protótipo tem **duas réguas de eletrodos**, uma por bueiro. Cada régua tem 6 contatos (pontas de jumper) em alturas diferentes. Quando a água encosta num contato, ele passa a "molhado", e o nível é a fração de contatos molhados: 3 de 6 = 50%.

| Bueiro | Pinos do Arduino (contato de baixo → de cima) | Tipo de leitura |
|---|---|---|
| **B01** | A0, A1, A2, A3, A4, A5 | Analógica (mais sensível) |
| **B02** | D7, D6, D5, D4, D3, D2 | Digital |

- **Fio de referência:** em cada compartimento, um fio ligado ao **GND do Arduino** precisa chegar ao fundo, abaixo do contato mais baixo. O ideal é um fio desencapado que suba ao longo de toda a régua, perto de todas as pontas.
- **Água com sal:** use água de torneira com **uma pitada de sal**, de preferência medida (cerca de ½ colher de chá por litro). Sem sal, os pinos digitais do B02 só detectam o contato de baixo. Água destilada não funciona.
- **Água salgada corrói as pontas dos contatos.** Troque a água ao fim de cada dia de uso.
- **Bombas:** nunca ligue bombas ou baterias aos pinos do Arduino. O firmware não aciona bomba nenhuma.

### Gravar o firmware (placa nova ou com outro programa)

1. Instale a **Arduino IDE**: https://www.arduino.cc/en/software
2. Abra `HydraSmartAPI\firmware\hydrasmart_reguas\hydrasmart_reguas.ino`.
3. Em **Ferramentas → Placa**, escolha **Arduino Uno**. Em **Ferramentas → Porta**, escolha a porta COM do Arduino.
4. Clique em **Carregar** (seta →).
5. Para conferir, abra o **Monitor Serial** em **115200**. Devem aparecer linhas como `{"bueiro":1,"nivel_pct":50.0,...}`.
6. **Feche a IDE** antes de iniciar o HydraSmart.

> Se a régua não detectar a água, grave o programa `firmware\diagnostico_eletrodos\diagnostico_eletrodos.ino`. Ele mostra no Monitor Serial o valor de cada contato, com a régua seca e com ela molhada.

---

## Passo 5 — Ligar o sistema

1. Ligue o **Arduino** no USB.
2. Feche a **IDE do Arduino**, se estiver aberta. Ela prende a porta USB.
3. Dê **dois cliques** em `INICIAR-HYDRASMART.bat`.

Em cerca de 30 segundos:

- duas janelas ficam abertas: **"HydraSmart API"** e **"HydraSmart Painel"**. **Não feche essas duas.**
- o navegador abre sozinho em **http://localhost:4173**;
- o **servidor** encontra o Arduino sozinho e passa a ler as réguas;
- a janela do `INICIAR` mostra a **chave do operador**.

Na primeira vez, o Firewall do Windows pode pedir permissão para o **Node.js**. Marque **Redes privadas** e clique em **Permitir**. Isso é necessário para mostrar o painel em outro aparelho.

### Ver as leituras do protótipo no painel

O painel abre em **"Análise com dados reais"** (estações oficiais e clima). Para ver as réguas:

1. No menu lateral, clique no botão de modo, na parte de baixo (**Trocar**).
2. Escolha **Projeto físico**.
3. Digite a **chave do operador** e confirme.

A faixa amarela "MODO PROTÓTIPO EXPERIMENTAL" indica que as leituras vêm da bancada, e não de sensores de campo.

> Na instalação local, **quem lê a USB é o servidor**. O cartão "Conexão USB do Arduino" do painel ("Selecionar porta Arduino") serve para quando a API está na nuvem. Aqui ele mostraria erro de porta ocupada, então não precisa ser usado.

### Chave do operador

A chave é pedida em ações que alteram o sistema, como trocar a fonte do painel e iniciar ou encerrar a simulação. O painel pede uma vez e reutiliza até a página ser recarregada.

- Ela aparece na janela do `INICIAR` e do `INSTALAR`.
- Ela também fica no arquivo `HydraSmartAPI\.env`, na linha `OPERATOR_API_KEY`.
- Para trocar a chave, apague o valor dessa linha e rode o `INICIAR` de novo: uma nova é gerada.

### Mostrar o painel numa TV, tablet ou celular

A janela do `INICIAR` mostra um endereço como `http://192.168.0.15:4173`. Abra esse endereço em qualquer aparelho **conectado à mesma rede Wi-Fi**. Todos atualizam em tempo real ao mesmo tempo.

## Passo 6 — Desligar

Dê **dois cliques** em `PARAR-HYDRASMART.bat`. Os dados gravados ficam salvos no banco.

---

## Checklist do dia da feira

- [ ] Notebook carregado e na tomada. **Desative a suspensão** em *Configurações → Sistema → Energia*.
- [ ] Abrir o Docker Desktop e esperar "Engine running". Se a opção de iniciar com o Windows estiver marcada, ele abre sozinho.
- [ ] Água nova com sal nos compartimentos e réguas no lugar.
- [ ] Plugar o Arduino, com a IDE do Arduino fechada.
- [ ] `INICIAR-HYDRASMART.bat` e anotar a **chave do operador** que aparece na janela.
- [ ] No painel, trocar para **Projeto físico** e conferir B01 e B02 mudando quando a água sobe e desce.
- [ ] Abrir **Diagnóstico** e conferir a "Saúde do monitoramento" e os níveis por bueiro.
- [ ] Se for mostrar os avisos no celular, tocar em **Ativar avisos** no aparelho. O navegador pede autorização uma vez.
- [ ] **Plano B**: se o Arduino falhar, vá em **Bueiros e sensores → Iniciar simulação de teste**. A simulação gera níveis sintéticos e não grava nada no histórico.

### Sem internet no local?

| Funciona sem internet | Precisa de internet |
|---|---|
| Leitura das réguas, níveis e alertas do protótipo | Mapa (imagens do OpenStreetMap e bocas de lobo da Prefeitura) |
| Banco de dados e histórico | Clima (Open-Meteo) |
| Gráficos e diagnóstico | Estações da Defesa Civil RS e CEMADEN |
| Simulação de teste | Análise com IA e fontes do texto |

Dica: o roteador do celular resolve. Ligue o notebook nele antes de iniciar o sistema.

---

## Atualizar para a versão mais nova

Com o sistema desligado, abra o PowerShell em `C:\HydraSmart` e rode:

```powershell
cd HydraSmartAPI;   git pull;   cd ..
cd HydraSmartFront; git pull;   cd ..
```

Depois rode `INSTALAR-HYDRASMART.bat` de novo. Ele mantém o `.env` e os dados do banco. Se o firmware mudou, grave-o de novo (Passo 4).

---

## Problemas comuns

| Sintoma | Solução |
|---|---|
| "Node.js não encontrado" logo após instalar | Feche e abra a janela de novo, ou reinicie o PC |
| Docker Desktop não abre ou fica em "Starting" | Confira a virtualização na BIOS. Rode `wsl --update` no PowerShell como administrador e reinicie |
| "porta ocupada" ao iniciar o banco | Outro programa usa a porta 5433. No `.env`, troque `DB_PORT=5434` e a porta em `DATABASE_URL` para `5434` |
| Arduino não é encontrado | Feche a IDE do Arduino. Troque o cabo, porque alguns só carregam e não transmitem dados. Instale o driver CH340. Com mais de uma placa, defina `SERIAL_PORT=COM4` (a porta certa) no `.env` |
| A porta do Arduino mudou (COM6 → COM7) | Normal ao reconectar o cabo. O servidor procura a placa sozinho |
| Nível sempre em 0% | Confira se o firmware `hydrasmart_reguas` está gravado (Monitor Serial em 115200) e se o fio de GND está na água |
| B02 só detecta o contato de baixo | Falta sal na água, ou o fio de GND não sobe ao longo da régua |
| "CONTATOS_INCONSISTENTES" | Um contato de cima está molhado e um de baixo não. Confira a ordem dos fios (B02: D7 embaixo, D2 em cima) e se algum jumper encosta no GND fora da água |
| "Chave de operador necessária" ou "inválida" | Use a chave que aparece na janela do `INICIAR`, ou a linha `OPERATOR_API_KEY` do arquivo `HydraSmartAPI\.env` |
| "Operações administrativas desabilitadas" | O `.env` está sem `OPERATOR_API_KEY`. Rode `PARAR` e depois `INICIAR`: o `INICIAR` cria a chave sozinho |
| Painel mostra "Servidor indisponível" | A janela "HydraSmart API" foi fechada ou mostra um erro. Rode `PARAR` e depois `INICIAR` |
| Outro aparelho não abre o painel | Os dois precisam estar no mesmo Wi-Fi, e o Firewall precisa permitir o Node.js em "Redes privadas" |
| Banco aparece como "memória" | O Docker não estava ligado quando a API subiu, e os dados não serão salvos. Abra o Docker, rode `PARAR` e depois `INICIAR` |

Para ver o funcionamento interno, a documentação técnica da API fica em **http://localhost:3333/docs**.

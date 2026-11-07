# Registro técnico de evolução da API — HydraSmart

> **Complemento do [diário geral de desenvolvimento](https://github.com/Pedroakkaka/HydraSmartFront/blob/fix/audit-round-1/docs/REGISTRO_DESENVOLVIMENTO.md).**
>
> Consolidado em **01/11/2026** · Branch **`fix/audit-round-1`** · Repositório **HydraSmartAPI**.
>
> Este documento registra mudanças do backend discutidas durante o ciclo de desenvolvimento. **Commits não equivalem a deploy no Render.** Não há confirmação de que o servidor público execute o HEAD desta branch.

## 1. Arquitetura e proteção da procedência

O fluxo físico e as simulações têm tratamentos diferentes:

- **`IngestService`** recebe leituras de Arduino USB, dispositivos HTTP de campo e simulador legado.
- **`TelemetryState`** armazena canais independentes `prototipo`, `campo` e `demonstracao`. Dados de estação hidrológica oficial são outra fonte, não sensores de bueiro.
- **`AlertService`** classifica os níveis por limiares calibráveis e distingue alertas de campo daqueles rotulados como ensaios.
- **`/ws`** distribui alterações e eventos de alerta aos navegadores conectados.

A interface visível foi reorganizada em **Projeto físico** e **Análise com dados reais**, mas o backend ainda contém rotas legadas de simulação. Não tratar isso como uma remoção completa do subsistema legado.

## 2. Alterações registradas neste ciclo

| Tema | Arquivo(s) | Comportamento | Estado |
| --- | --- | --- | --- |
| IA a cada 30 segundos | `src/routes/ia.js` | Reconsulta fontes; calcula hash do conteúdo e evita nova geração textual sem mudança nos dados; erros têm intervalo de retentativa maior | Commitado; Render não verificado |
| Alerta experimental de atenção | `src/services/alertService.js` | Detecta entrada do canal `prototipo` na faixa `atencao`, emite `nivel_alto_teste` com mensagem “NÃO É EMERGÊNCIA”; não repete a cada leitura na mesma faixa | Commitado; hardware pendente |
| Alertas críticos | `src/services/alertService.js` | Mantém a lógica anterior de abrir e encerrar alertas ao cruzar o limite crítico, rotulando experimentos separadamente | Preservado; validar |
| Receptor local da Defesa Civil simulada | `src/services/simuladorDefesaCivil.js`, `src/container.js`, `src/routes/operacao.js` | Registra recibos internos rotulados sem SMS, e-mail, Cell Broadcast ou acionamento oficial | Commitado; rota/Render não verificados em produção |
| Remoção do disparo manual coletivo | `src/routes/operacao.js` | Endpoint opcional criado durante testes foi removido; foco no acionamento automático por sensores | Commitado |
| Testes automatizados | `test/alertaNivelAltoPrototipo.test.js`, `test/simuladorDefesaCivil.test.js` | Exercitam não repetição de alertas, origem experimental e recibos sem envio externo | Arquivos commitados; execução completa em ambiente produtivo não confirmada |

## 3. Regras experimentais de alerta

- Padrões de `RiskRules`: **atenção a partir de 50%** e **crítico a partir de 80%**, sujeitos a configurações de calibração de cada bueiro.
- Eventos de atenção do protótipo são exclusivamente didáticos; os eventos críticos existentes continuam separados por origem.
- Não transformar leituras de campo ou registros históricos em um “teste do protótipo”.
- A notificação móvel é uma responsabilidade do frontend e da permissão do navegador; emitir um evento na API não significa confirmar seu recebimento no aparelho.
- Não enviar avisos experimentais à Defesa Civil oficial.

## 4. Registro de commits selecionados

- `75ea1288` — `feat(alerts): automatically emit safe one-time test when physical sensor enters high-water attention band`.
- `fec91e00` — `test(alerts): verify automatic high-level prototype notices, deduplication and field isolation`.
- `5ed1f823` — `refactor(notifications): remove manual collective test endpoint, keep automatic sensor alerts only`.

Outras alterações e decisões de frontend estão detalhadas no [diário principal](https://github.com/Pedroakkaka/HydraSmartFront/blob/fix/audit-round-1/docs/REGISTRO_DESENVOLVIMENTO.md).

## 5. Pendências de integração

1. Verificar qual commit e branch o Render efetivamente executa e confirmar o deploy das mudanças da API.
2. Executar testes de unidade e integração com `npm test`; validar o schema do evento WebSocket `nivel_alto_teste`.
3. Testar uma sequência física de leituras, com níveis abaixo de atenção, atenção, crítico e retorno ao normal.
4. Verificar funcionamento da API com perda de conexão, reconexão e reinicialização de processo.
5. Confirmar que o receptor local apresenta recibos apenas de testes de fato gerados; não confundir “recebido no servidor” com “recebido no celular”.
6. Manter registro de todas as novas alterações, seus commits, testes executados e versões implantadas.

## 6. Modelo para futuras entradas

### AAAA-MM-DD — Título da alteração

- **Motivação:** problema observado ou solicitação.
- **Arquivos/commit:** caminhos e SHA.
- **Comportamento:** o que mudou efetivamente.
- **Teste:** comandos e resultados observados (não presumidos).
- **Deploy:** serviço, branch, commit e status verificado.
- **Limitações:** pendências e comportamento ainda não comprovado.

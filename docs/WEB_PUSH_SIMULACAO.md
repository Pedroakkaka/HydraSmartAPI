# HydraSmart — notificações remotas de simulação (Web Push)

Esta funcionalidade permite que celulares inscritos recebam notificações **SIMULAÇÃO — NÃO É EMERGÊNCIA**, independentemente de a tela estar em "Dados reais" ou "Projeto físico", inclusive com o site fechado nos dispositivos que suportam Web Push.

## O que é necessário

1. Backend e frontend desta feature publicados; o backend precisa de PostgreSQL persistente.
2. Definir, **somente no Render**, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT=mailto:contato@dominio-valido`. Não incluir segredos no frontend nem no Git. Use um par gerado em conjunto; não substitua o par após aparelhos se inscreverem sem considerar re-inscrição.
3. Confirmar que o endpoint `GET /api/v1/push/publica` retorna `{"disponivel":true,...}`. Se `false`, o servidor não tem configuração válida.
4. Abrir `https://hydrasmart-monitor.vercel.app/` em cada celular, autorizar notificações e aguardar confirmação de **Push ativo**. O site envia a inscrição técnica pelo `POST /api/v1/push/inscrever`.
5. Com Arduino físico: **a ponte autenticada** `POST /api/v1/leituras/prototipo` precisa estar enviando leituras à API pública. Apenas USB local não notifica outros aparelhos.
6. Com simulação digital: iniciar cenário pela API/painel; o backend emite eventos rotulados `[TESTE SIMULAÇÃO]` ao entrar em atenção ou crítico. Ambos usam o mesmo mecanismo Web Push.
7. Verificar nos aparelhos com a tela em **Análise com dados reais**. O push é independente da seleção da fonte na interface; os gráficos reais continuam separados.
8. Conferir que a notificação identifica bueiro, percentual e a mensagem **NÃO É EMERGÊNCIA REAL**. Reduzir para normal antes de repetir o teste.

## Teste no Android e iPhone

- Android: permita notificações do navegador e do site; não silencie o aplicativo.
- iPhone: use Safari > Compartilhar > Adicionar à Tela de Início; abra o HydraSmart instalado e conceda a permissão. Web Push em iOS depende do suporte do sistema/navegador e de o web app estar instalado.
- O backend pode confirmar que o serviço de push aceitou o envio (HTTP 2xx), mas **não consegue garantir** que o sistema operacional mostrou a notificação. Restrições de bateria, rede e plataforma ainda podem interferir.

## Segurança e privacidade

- A inscrição é voluntária por dispositivo, revogável pelo botão de avisos do site.
- O servidor armazena somente `endpoint`, chave pública de assinatura de payload e segredo de autenticação fornecidos pelo navegador. Não há número de telefone nem disparo por SMS ou Defesa Civil.
- O envio é criptografado (RFC 8291) e autenticado via VAPID (RFC 8292).
- Só eventos `simulado=true` com prefixo `[TESTE PROTÓTIPO]` ou `[TESTE SIMULAÇÃO]` podem disparar os avisos. Leituras de campo não disparam o canal de teste.
- Inscrições inválidas, inativas (HTTP 404/410) ou com endpoints fora de serviços de push permitidos não são mantidas.
- Endpoint `POST /api/v1/push/inscrever` limita origem e taxa; o backend impõe limite de inscrições.
- Não relatar "entregue no celular" apenas com sucesso HTTP. O status exibido confirma **inscrição** e/ou **aceite no serviço push**, não a visualização pelo usuário.

## Comandos de verificação

Na API: `npm test`, `npm run lint`. No frontend: `npm test`, `npm run lint`, `npm run build`.

Documentar a execução dos testes, o commit publicado em Render e Vercel, e o ensaio com pelo menos um Android/iPhone antes de considerar a integração concluída.

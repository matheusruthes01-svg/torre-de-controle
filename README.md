# Torre de Controle

Central de gestão de tráfego pago (Google Ads + Meta Ads) para a carteira de contas.
Concentra status das contas, saldo e verba, métricas diárias, tarefas, registro de
otimizações e análise por IA num painel só.

## Stack
- Frontend: HTML/JS puro (sem build), Supabase JS via CDN
- Backend: Supabase (Postgres + Auth)
- IA: função serverless em `api/analyze.js`, usando o SDK da Anthropic

## Estrutura
```
index.html        -> o painel inteiro (interface + lógica)
api/analyze.js    -> função serverless que chama a API da Anthropic (respostas em streaming)
schema.sql        -> schema do banco; pode rodar quantas vezes quiser
package.json      -> só a dependência do SDK da Anthropic (a Vercel instala sozinha)
```

## Configuração
1. Rodar `schema.sql` no SQL Editor do projeto Supabase. O script é idempotente:
   pode rodar de novo a qualquer momento que ele só cria o que falta.
2. Criar o usuário de login em Authentication > Users no Supabase.
3. As credenciais do Supabase (Project URL + anon key) estão embutidas no topo do
   `index.html`, nas constantes `SUPABASE_URL` e `SUPABASE_ANON_KEY`. Se trocar de
   projeto Supabase, atualizar essas duas linhas.
4. Para habilitar a análise por IA: Vercel > Settings > Environment Variables >
   adicionar `ANTHROPIC_API_KEY`, depois fazer um redeploy.
5. Para proteger o site com senha: Vercel > Settings > Deployment Protection >
   Password Protection.

## O que o painel faz

**Radar automático.** Um motor de regras lê as métricas e levanta sozinho o que
precisa de atenção, sem depender de você marcar status na mão:
- conta gastando sem converter (suspeita de tracking quebrado)
- CPA disparando contra a média das semanas anteriores
- entrega despencando (quase sempre saldo ou limite de orçamento)
- gasto acima da verba combinada
- conversão poluída (muitas conversões por clique, típico de evento errado)
- saldo do Pix acabando
- métricas ou otimizações desatualizadas
- lançamento agregado (total de mês jogado num dia só, que distorce toda média)

Cada alerta pode ser marcado como visto e some até o dia seguinte.

**Autonomia de saldo.** Desconta o gasto real já lançado desde a leitura do saldo e
só projeta pelo ritmo dos últimos 7 dias os dias que ainda não têm lançamento.

**Lançamento em lote.** Cola as linhas direto do relatório do Google Ads ou do Meta,
confere e importa vários dias de uma vez. Aceita tabulação, ponto e vírgula ou
espaços, datas em `dd/mm/aaaa`, `dd/mm` e `aaaa-mm-dd`, e números em formato
brasileiro (`R$ 1.234,56`). Relançar um dia que já existe corrige o valor em vez
de duplicar.

**Análise por IA.** Três botões: leitura da carteira inteira com as prioridades do
dia, análise técnica de uma conta, e relatório pronto para mandar ao cliente (em
linguagem de dono de negócio, sem jargão de mídia).

**Tarefas recorrentes.** Tarefa marcada para repetir gera a próxima ocorrência
sozinha ao ser concluída.

**Backup.** O botão Backup baixa um JSON com contas, métricas, tarefas, registros
e recargas.

## Atalhos
- `1` a `6` trocam de aba
- `/` vai para as contas e foca a busca
- `Esc` fecha o modal aberto

## Deploy
Conectado ao GitHub: qualquer `git push` na branch principal publica automaticamente.
Se o `/api/analyze` responder 404 no site publicado, o projeto da Vercel não está
conectado ao repositório (Settings > Git > Connect Git Repository) e está servindo
um upload manual antigo, sem as funções serverless.

# Torre de Controle

Painel de gestão de tráfego pago (Google Ads + Meta Ads) para a carteira de contas.

## Stack
- Frontend: HTML/JS puro (sem build), Supabase JS via CDN
- Backend: Supabase (Postgres + Auth)
- IA: função serverless em `api/analyze.js` (precisa da env var `ANTHROPIC_API_KEY` na Vercel pra funcionar)

## Estrutura
```
index.html       -> o site inteiro (UI + lógica)
api/analyze.js    -> função serverless que chama a API da Anthropic pra análise por IA
schema.sql        -> schema do banco (rodar uma vez no SQL Editor do Supabase)
```

## Configuração
1. Rodar `schema.sql` no SQL Editor do projeto Supabase
2. Criar usuário de login em Authentication > Users no Supabase
3. As credenciais do Supabase (URL + anon key) já estão embutidas no topo do `index.html`,
   dentro das constantes SUPABASE_URL e SUPABASE_ANON_KEY. Se trocar de projeto Supabase,
   atualizar essas duas linhas.
4. Pra habilitar a análise por IA: Vercel > Settings > Environment Variables >
   adicionar ANTHROPIC_API_KEY, depois fazer um redeploy.
5. Pra proteger o site com senha: Vercel > Settings > Deployment Protection >
   Password Protection.

## Deploy
Conectado ao GitHub, qualquer `git push` na branch principal publica automaticamente.

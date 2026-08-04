-- Torre de Controle — schema do banco de dados (Supabase / Postgres)
--
-- Como usar: no seu projeto Supabase, vá em SQL Editor > New query, cole este
-- arquivo inteiro e clique em Run.
--
-- Este script é idempotente: pode ser rodado quantas vezes quiser, tanto num
-- banco vazio quanto num banco que já tem dados. Ele cria o que falta e não
-- apaga nada.

create extension if not exists "pgcrypto";

-- ========== CONTAS ==========
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  cliente text not null,
  carteira text not null default 'Direto',      -- 'Digital Xpert' | 'Direto'
  nicho text,
  praca text,
  conta_id text,                                 -- ID da conta Google Ads
  meta_conta_id text,                             -- ID da conta Meta Ads
  plataformas text[] not null default '{}',       -- ['google','meta']
  status text not null default 'setup',           -- critico|atencao|setup|ativo|standby
  status_google text,                             -- ativa|pausada|limitada|aprendizado|suspensa|sem_config
  status_meta text,
  prioridade text not null default 'media',       -- alta|media|baixa
  acao text,
  notas text,
  forma text,                                     -- pix|cartao
  verba_diaria numeric,                           -- verba diária do Google Ads
  saldo numeric,
  saldo_data date,
  dia_pgto int,
  valor_pgto numeric,
  cpa_alvo numeric,
  inicio date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Colunas novas da v2 (não existiam na primeira versão do schema)
alter table accounts add column if not exists verba_meta numeric;      -- verba diária do Meta Ads
alter table accounts add column if not exists cpa_alvo_meta numeric;   -- CPA alvo específico do Meta

-- ========== MÉTRICAS DIÁRIAS ==========
create table if not exists metrics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  data date not null,
  plat text not null,                             -- google|meta
  invest numeric not null default 0,
  impr int not null default 0,
  cliques int not null default 0,
  conv numeric not null default 0,
  obs text,
  created_at timestamptz not null default now()
);
create index if not exists metrics_account_idx on metrics(account_id, data desc);

-- Um lançamento por conta/dia/plataforma. Relançar o mesmo dia agora corrige o
-- valor em vez de duplicar. Antes de criar o índice, remove duplicatas
-- eventuais mantendo o lançamento mais recente de cada combinação.
delete from metrics m
  using metrics outra
  where m.account_id = outra.account_id
    and m.data = outra.data
    and m.plat = outra.plat
    and (m.created_at, m.id) < (outra.created_at, outra.id);
create unique index if not exists metrics_unico_idx on metrics(account_id, data, plat);

-- ========== TAREFAS ==========
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete set null,
  descricao text not null,
  prazo date,
  prioridade text not null default 'media',
  done boolean not null default false,
  done_em date,
  criada_em date not null default current_date
);
-- Rotinas: ao concluir uma tarefa com 'repetir', o painel cria a próxima sozinho.
alter table tasks add column if not exists repetir text;  -- null|diaria|semanal|quinzenal|mensal
create index if not exists tasks_pend_idx on tasks(done, prazo);

-- ========== LOG DE OTIMIZAÇÕES ==========
create table if not exists opt_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  data date not null,
  texto text not null,
  created_at timestamptz not null default now()
);
create index if not exists opt_log_account_idx on opt_log(account_id, data desc);

-- ========== RECARGAS (PIX) ==========
create table if not exists recargas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  data date not null,
  valor numeric,
  created_at timestamptz not null default now()
);
create index if not exists recargas_account_idx on recargas(account_id, data desc);

-- ========== AVISOS MARCADOS COMO "OK" (por dia) ==========
create table if not exists avisos_resolvidos (
  chave text not null,
  data date not null,
  primary key (chave, data)
);
-- Limpeza: avisos com mais de 30 dias não servem mais pra nada.
delete from avisos_resolvidos where data < current_date - 30;

-- ========== updated_at automático em accounts ==========
create or replace function toca_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists accounts_updated_at on accounts;
create trigger accounts_updated_at before update on accounts
  for each row execute function toca_updated_at();

-- ========== RLS: só usuário autenticado lê/escreve ==========
alter table accounts enable row level security;
alter table metrics enable row level security;
alter table tasks enable row level security;
alter table opt_log enable row level security;
alter table recargas enable row level security;
alter table avisos_resolvidos enable row level security;

-- As policies são recriadas do zero pra o script poder rodar de novo sem erro.
drop policy if exists "auth full access" on accounts;
create policy "auth full access" on accounts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth full access" on metrics;
create policy "auth full access" on metrics
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth full access" on tasks;
create policy "auth full access" on tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth full access" on opt_log;
create policy "auth full access" on opt_log
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth full access" on recargas;
create policy "auth full access" on recargas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth full access" on avisos_resolvidos;
create policy "auth full access" on avisos_resolvidos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Depois de rodar este script:
-- 1. Vá em Authentication > Users > Add user e crie o seu login (email + senha)
-- 2. As credenciais do projeto (Project URL + anon public key) ficam no topo do
--    index.html, nas constantes SUPABASE_URL e SUPABASE_ANON_KEY
-- 3. NUNCA coloque a service_role key no index.html — essa fica só no Supabase

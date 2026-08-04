-- Torre de Controle — schema do banco de dados (Supabase / Postgres)
-- Como usar: no seu projeto Supabase, vá em SQL Editor > New query,
-- cole este arquivo inteiro e clique em Run. Cria as 5 tabelas,
-- ativa RLS (Row Level Security) e libera acesso só pra quem estiver
-- autenticado (ou seja, só você, depois de logar).

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
  verba_diaria numeric,
  saldo numeric,
  saldo_data date,
  dia_pgto int,
  valor_pgto numeric,
  cpa_alvo numeric,
  inicio date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- ========== LOG DE OTIMIZAÇÕES ==========
create table if not exists opt_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  data date not null,
  texto text not null,
  created_at timestamptz not null default now()
);

-- ========== RECARGAS (PIX) ==========
create table if not exists recargas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  data date not null,
  valor numeric,
  created_at timestamptz not null default now()
);

-- ========== AVISOS MARCADOS COMO "OK" (por dia) ==========
create table if not exists avisos_resolvidos (
  chave text not null,
  data date not null,
  primary key (chave, data)
);

-- ========== RLS: só usuário autenticado lê/escreve ==========
alter table accounts enable row level security;
alter table metrics enable row level security;
alter table tasks enable row level security;
alter table opt_log enable row level security;
alter table recargas enable row level security;
alter table avisos_resolvidos enable row level security;

create policy "auth full access" on accounts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth full access" on metrics
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth full access" on tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth full access" on opt_log
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth full access" on recargas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth full access" on avisos_resolvidos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Depois de rodar este script:
-- 1. Vá em Authentication > Users > Add user e crie o seu login (email + senha)
-- 2. Me mande a Project URL e a anon public key (Project Settings > API)
-- 3. NÃO me mande a service_role key — essa fica só no Supabase

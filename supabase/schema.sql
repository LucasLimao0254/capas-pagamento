-- Capas de Pagamento — banco compartilhado no Supabase.
-- Como usar: painel do Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
-- Pode rodar de novo sem perder dados (só cria o que falta).

-- ============ Processos ============
create table if not exists public.processos (
  id              uuid primary key default gen_random_uuid(),
  criado_em       timestamptz not null default now(),
  criado_por      uuid default auth.uid() references auth.users(id) on delete set null,
  criado_por_nome text,
  credor          text not null default '',
  empenho         text not null default '',
  valor           numeric(14,2),
  iss_valor       numeric(14,2),
  irrf_valor      numeric(14,2),
  valor_liquido   numeric(14,2),
  mes             text not null default '',
  referente       text not null default 'N/D',
  nota            text not null default '',
  duvida          text not null default '',
  duvida_campos   text[] not null default '{}',
  diarias         boolean not null default false,
  status          text not null default 'recebido'
                  check (status in ('recebido','pendente_pagamento','pendente_certidao','pago','devolvido')),
  status_em       timestamptz not null default now(),
  status_por_nome text,
  leitura         text not null default 'ok' check (leitura in ('lendo','ok','erro')),
  leitura_erro    text not null default '',
  foto_path       text,
  foto_hash       text,
  alterado_em     timestamptz not null default now(),
  alterado_por_nome text
);
create index if not exists processos_criado_em_idx on public.processos (criado_em desc);
create index if not exists processos_foto_hash_idx on public.processos (foto_hash);

-- Histórico de status (quem mudou, de quê para quê, quando)
create table if not exists public.status_historico (
  id          bigint generated always as identity primary key,
  processo_id uuid not null references public.processos(id) on delete cascade,
  de          text,
  para        text not null,
  em          timestamptz not null default now(),
  por         uuid default auth.uid(),
  por_nome    text
);
create index if not exists status_historico_proc_idx on public.status_historico (processo_id, em);

-- Nome de quem está logado: o "nome" salvo no perfil, ou o e-mail.
create or replace function public.nome_usuario() returns text
language sql stable as $$
  select coalesce(nullif(auth.jwt() -> 'user_metadata' ->> 'nome', ''), auth.jwt() ->> 'email', 'sistema')
$$;

create or replace function public.processos_antes() returns trigger
language plpgsql as $$
begin
  -- Alterações feitas pelo servidor (leitura da foto) não têm usuário: mantêm os nomes de quem fez.
  if auth.uid() is null then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then new.status_em := now(); end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_por_nome := public.nome_usuario();
    new.status_por_nome := public.nome_usuario();
  elsif new.status is distinct from old.status then
    new.status_em := now();
    new.status_por_nome := public.nome_usuario();
  end if;
  new.alterado_em := now();
  new.alterado_por_nome := public.nome_usuario();
  return new;
end $$;

create or replace function public.processos_depois() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into status_historico (processo_id, de, para, por_nome) values (new.id, null, new.status, new.status_por_nome);
  elsif new.status is distinct from old.status then
    insert into status_historico (processo_id, de, para, por_nome) values (new.id, old.status, new.status, new.status_por_nome);
  end if;
  return null;
end $$;

drop trigger if exists processos_antes on public.processos;
create trigger processos_antes before insert or update on public.processos
  for each row execute function public.processos_antes();
drop trigger if exists processos_depois on public.processos;
create trigger processos_depois after insert or update on public.processos
  for each row execute function public.processos_depois();

-- ============ Acesso: todo usuário logado pode tudo; quem não está logado, nada ============
-- Liberações explícitas: funcionam mesmo com "Automatically expose new tables" desligado.
grant usage on schema public to authenticated;
revoke all on public.processos, public.status_historico from anon;
grant select, insert, update, delete on public.processos to authenticated;
grant select on public.status_historico to authenticated;
grant execute on function public.nome_usuario() to authenticated;

alter table public.processos enable row level security;
alter table public.status_historico enable row level security;

drop policy if exists "logados leem" on public.processos;
drop policy if exists "logados criam" on public.processos;
drop policy if exists "logados alteram" on public.processos;
drop policy if exists "logados excluem" on public.processos;
create policy "logados leem"    on public.processos for select to authenticated using (true);
create policy "logados criam"   on public.processos for insert to authenticated with check (true);
create policy "logados alteram" on public.processos for update to authenticated using (true) with check (true);
create policy "logados excluem" on public.processos for delete to authenticated using (true);

drop policy if exists "logados leem" on public.status_historico;
create policy "logados leem" on public.status_historico for select to authenticated using (true);

-- Atualização em tempo real nos aparelhos
do $$ begin
  alter publication supabase_realtime add table public.processos;
exception when duplicate_object then null; end $$;

-- ============ Fotos das capas (privadas, só para logados) ============
insert into storage.buckets (id, name, public) values ('capas', 'capas', false)
  on conflict (id) do nothing;

drop policy if exists "capas: logados leem" on storage.objects;
drop policy if exists "capas: logados enviam" on storage.objects;
drop policy if exists "capas: logados excluem" on storage.objects;
create policy "capas: logados leem"    on storage.objects for select to authenticated using (bucket_id = 'capas');
create policy "capas: logados enviam"  on storage.objects for insert to authenticated with check (bucket_id = 'capas');
create policy "capas: logados excluem" on storage.objects for delete to authenticated using (bucket_id = 'capas');

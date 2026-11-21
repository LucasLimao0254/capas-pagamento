-- Capas de Pagamento — banco compartilhado no Supabase.
-- Como usar: painel do Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
-- Pode rodar de novo sem perder dados: cria o que falta e atualiza bancos de versões anteriores.

-- ===================================================================================
-- Fluxo do processo (9 etapas). Setor responsável = quem pode mexer no processo.
--   montagem            1. Montagem (capa)                       compras
--   controle            2. No Controle Interno                   controle
--   enc_contabilidade   3. Encaminhado à Contabilidade           controle (registra pela Contabilidade)
--   contabilidade       4. Recebido pela Contabilidade           controle (registra pela Contabilidade)
--   correcao            5. Devolvido ao Compras p/ correção      compras
--   controle_corrigido  6. No Controle (corrigido)               controle
--   pagamento           7. Encaminhado p/ pagamento              controle (registra pelo Financeiro)
--   pos_pagamento       8. No Controle após pagamento            controle
--   concluido           9. Encaminhado à Contabilidade (final)   — (fim)
-- ===================================================================================

-- ============ Perfis (nome, setor, administrador) ============
create table if not exists public.perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  email     text,
  nome      text not null default '',
  setor     text check (setor in ('compras', 'controle')),
  admin     boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Todo usuário novo ganha um perfil (sem setor: só visualiza até o administrador definir).
create or replace function public.novo_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists novo_perfil on auth.users;
create trigger novo_perfil after insert on auth.users for each row execute function public.novo_perfil();
insert into public.perfis (id, email) select id, email from auth.users on conflict (id) do nothing;
-- Nome que já estava salvo na versão anterior
update public.perfis p set nome = u.raw_user_meta_data ->> 'nome'
  from auth.users u where u.id = p.id and p.nome = '' and coalesce(u.raw_user_meta_data ->> 'nome', '') <> '';
-- Primeiro administrador: a conta mais antiga do projeto (quem criou o projeto), se ainda não houver nenhum.
update public.perfis set admin = true
  where id = (select id from auth.users order by created_at limit 1)
    and not exists (select 1 from public.perfis where admin);

create or replace function public.meu_setor() returns text
language sql stable security definer set search_path = public as $$
  select setor from perfis where id = auth.uid()
$$;
create or replace function public.sou_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select admin from perfis where id = auth.uid()), false)
$$;
create or replace function public.setor_responsavel(etapa text) returns text
language sql immutable as $$
  select case when etapa in ('montagem', 'correcao') then 'compras'
              when etapa = 'concluido' then null
              else 'controle' end
$$;
create or replace function public.pode_mexer(etapa text) returns boolean
language sql stable as $$
  select public.sou_admin() or (public.meu_setor() is not null and public.meu_setor() = public.setor_responsavel(etapa))
$$;

-- Nome de quem está logado: nome do perfil, nome antigo do cadastro, ou e-mail.
create or replace function public.nome_usuario() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif((select nome from perfis where id = auth.uid()), ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'nome', ''),
    auth.jwt() ->> 'email', 'sistema')
$$;

-- Só o administrador muda setor/administrador; cada um pode mudar o próprio nome.
create or replace function public.perfis_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor / servidor
  if (new.setor is distinct from old.setor or new.admin is distinct from old.admin or new.email is distinct from old.email)
     and not public.sou_admin() then
    raise exception 'Só o administrador pode mudar setores.';
  end if;
  if old.admin and not new.admin and not exists (select 1 from perfis where admin and id <> old.id) then
    raise exception 'Precisa haver pelo menos um administrador.';
  end if;
  return new;
end $$;
drop trigger if exists perfis_antes on public.perfis;
create trigger perfis_antes before update on public.perfis for each row execute function public.perfis_antes();

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
  status          text not null default 'montagem',
  status_em       timestamptz not null default now(),
  status_por_nome text,
  leitura         text not null default 'ok' check (leitura in ('lendo','ok','erro')),
  leitura_erro    text not null default '',
  foto_path       text,
  foto_hash       text,
  alterado_em     timestamptz not null default now(),
  alterado_por_nome text
);
alter table public.processos add column if not exists pago_em date;
alter table public.processos add column if not exists iss_recolhido_em date;
alter table public.processos add column if not exists irrf_recolhido_em date;
create index if not exists processos_criado_em_idx on public.processos (criado_em desc);
create index if not exists processos_foto_hash_idx on public.processos (foto_hash);

-- Converte os status da versão anterior para as etapas
alter table public.processos drop constraint if exists processos_status_check;
alter table public.processos disable trigger user;
update public.processos set status = case status
    when 'recebido'           then 'montagem'
    when 'pendente_certidao'  then 'controle'
    when 'pendente_pagamento' then 'pagamento'
    when 'pago'               then 'pos_pagamento'
    when 'devolvido'          then 'correcao'
    else status end
  where status in ('recebido','pendente_certidao','pendente_pagamento','pago','devolvido');
update public.processos set pago_em = status_em::date where status = 'pos_pagamento' and pago_em is null;
alter table public.processos enable trigger user;
alter table public.processos alter column status set default 'montagem';
alter table public.processos add constraint processos_status_check check (status in
  ('montagem','controle','enc_contabilidade','contabilidade','correcao','controle_corrigido','pagamento','pos_pagamento','concluido'));

-- Histórico de etapas (quem moveu, de onde para onde, quando, observação)
create table if not exists public.status_historico (
  id          bigint generated always as identity primary key,
  processo_id uuid not null references public.processos(id) on delete cascade,
  de          text,
  para        text not null,
  em          timestamptz not null default now(),
  por         uuid default auth.uid(),
  por_nome    text
);
alter table public.status_historico add column if not exists obs text not null default '';
update public.status_historico set
  de = case de when 'recebido' then 'montagem' when 'pendente_certidao' then 'controle' when 'pendente_pagamento' then 'pagamento' when 'pago' then 'pos_pagamento' when 'devolvido' then 'correcao' else de end,
  para = case para when 'recebido' then 'montagem' when 'pendente_certidao' then 'controle' when 'pendente_pagamento' then 'pagamento' when 'pago' then 'pos_pagamento' when 'devolvido' then 'correcao' else para end
  where de in ('recebido','pendente_certidao','pendente_pagamento','pago','devolvido') or para in ('recebido','pendente_certidao','pendente_pagamento','pago','devolvido');
create index if not exists status_historico_proc_idx on public.status_historico (processo_id, em);

-- ============ Regras automáticas ============
create or replace function public.processos_antes() returns trigger
language plpgsql as $$
declare movendo boolean := coalesce(current_setting('app.movendo', true), '') = 'sim';
begin
  -- Servidor (leitura da foto) e SQL Editor: sem usuário, sem travas; mantêm os nomes de quem fez.
  if auth.uid() is null then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then new.status_em := now(); end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and not movendo and (
       new.status is distinct from old.status or new.pago_em is distinct from old.pago_em
       or new.iss_recolhido_em is distinct from old.iss_recolhido_em or new.irrf_recolhido_em is distinct from old.irrf_recolhido_em) then
    raise exception 'Use os botões de etapa para mover o processo.';
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
declare obs text := coalesce(current_setting('app.obs', true), '');
begin
  if tg_op = 'INSERT' then
    insert into status_historico (processo_id, de, para, por, por_nome, obs) values (new.id, null, new.status, auth.uid(), new.status_por_nome, '');
  elsif new.status is distinct from old.status then
    insert into status_historico (processo_id, de, para, por, por_nome, obs) values (new.id, old.status, new.status, auth.uid(), new.status_por_nome, obs);
  end if;
  return null;
end $$;

drop trigger if exists processos_antes on public.processos;
create trigger processos_antes before insert or update on public.processos
  for each row execute function public.processos_antes();
drop trigger if exists processos_depois on public.processos;
create trigger processos_depois after insert or update on public.processos
  for each row execute function public.processos_depois();

-- ============ Movimentos (os botões de etapa do app) ============
create or replace function public.transicao_ok(de text, para text) returns boolean
language sql immutable as $$
  select (de, para) in (
    ('montagem', 'controle'),
    ('controle', 'enc_contabilidade'), ('controle', 'correcao'),
    ('controle_corrigido', 'enc_contabilidade'), ('controle_corrigido', 'correcao'),
    ('enc_contabilidade', 'contabilidade'),
    ('contabilidade', 'pagamento'),
    ('correcao', 'controle_corrigido'),
    ('pagamento', 'pos_pagamento'),
    ('pos_pagamento', 'concluido'))
$$;

create or replace function public.mover_processo(p_id uuid, p_para text, p_obs text default '', p_pago_em date default null)
returns public.processos
language plpgsql security definer set search_path = public as $$
declare atual text; r processos;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  select status into atual from processos where id = p_id for update;
  if atual is null then raise exception 'Processo não encontrado.'; end if;
  if not transicao_ok(atual, p_para) then raise exception 'Este passo não é possível a partir da etapa atual.'; end if;
  if not pode_mexer(atual) then raise exception 'Este processo não está com o seu setor.'; end if;
  if p_para = 'correcao' and coalesce(trim(p_obs), '') = '' then raise exception 'Informe o motivo da devolução.'; end if;
  if p_para = 'pos_pagamento' and p_pago_em is null then raise exception 'Informe a data do pagamento.'; end if;
  if (select leitura from processos where id = p_id) <> 'ok' then raise exception 'Termine a leitura/correção da capa antes de encaminhar.'; end if;
  perform set_config('app.movendo', 'sim', true);
  perform set_config('app.obs', coalesce(trim(p_obs), ''), true);
  update processos set status = p_para,
    pago_em = case when p_para = 'pos_pagamento' then p_pago_em else pago_em end
    where id = p_id returning * into r;
  perform set_config('app.movendo', '', true);
  perform set_config('app.obs', '', true);
  return r;
end $$;

-- Desfaz o último passo (para corrigir um clique errado). Só quem fez o passo (setor) ou o administrador.
create or replace function public.desfazer_movimento(p_id uuid) returns public.processos
language plpgsql security definer set search_path = public as $$
declare atual text; ult status_historico; r processos;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  select status into atual from processos where id = p_id for update;
  select * into ult from status_historico where processo_id = p_id order by id desc limit 1;
  if ult.id is null or ult.de is null or ult.para <> atual then raise exception 'Não há passo para desfazer.'; end if;
  if not pode_mexer(ult.de) then raise exception 'Só o setor que fez o passo pode desfazê-lo.'; end if;
  perform set_config('app.movendo', 'sim', true);
  perform set_config('app.obs', 'Desfeito: volta para a etapa anterior', true);
  update processos set status = ult.de,
    pago_em = case when atual = 'pos_pagamento' then null else pago_em end
    where id = p_id returning * into r;
  perform set_config('app.movendo', '', true);
  perform set_config('app.obs', '', true);
  return r;
end $$;

-- Marca (ou desmarca) o recolhimento do ISS ou do IRRF retido. Só o Controle ou o administrador.
create or replace function public.marcar_recolhido(p_id uuid, p_imposto text, p_data date) returns public.processos
language plpgsql security definer set search_path = public as $$
declare r processos;
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if not (sou_admin() or meu_setor() = 'controle') then raise exception 'Só o Controle Interno marca recolhimentos.'; end if;
  if p_imposto not in ('iss', 'irrf') then raise exception 'Imposto inválido.'; end if;
  if (select pago_em from processos where id = p_id) is null then raise exception 'O processo ainda não foi pago.'; end if;
  perform set_config('app.movendo', 'sim', true);
  if p_imposto = 'iss' then update processos set iss_recolhido_em = p_data where id = p_id returning * into r;
  else update processos set irrf_recolhido_em = p_data where id = p_id returning * into r; end if;
  perform set_config('app.movendo', '', true);
  return r;
end $$;

-- ============ Acesso ============
-- Todos os logados veem tudo; só mexe quem é do setor responsável pela etapa (ou o administrador).
grant usage on schema public to authenticated;
revoke all on public.processos, public.status_historico, public.perfis from anon;
grant select, insert, update, delete on public.processos to authenticated;
grant select on public.status_historico to authenticated;
grant select, update on public.perfis to authenticated;
do $$ begin
  grant all on public.processos, public.status_historico, public.perfis to service_role; -- servidor (leitura das fotos)
exception when undefined_object then null; end $$;
revoke execute on function public.mover_processo(uuid, text, text, date), public.desfazer_movimento(uuid), public.marcar_recolhido(uuid, text, date) from public, anon;
grant execute on function public.nome_usuario(), public.meu_setor(), public.sou_admin(), public.setor_responsavel(text), public.pode_mexer(text), public.transicao_ok(text, text),
  public.mover_processo(uuid, text, text, date), public.desfazer_movimento(uuid), public.marcar_recolhido(uuid, text, date) to authenticated;

alter table public.processos enable row level security;
alter table public.status_historico enable row level security;
alter table public.perfis enable row level security;

drop policy if exists "logados leem" on public.processos;
drop policy if exists "logados criam" on public.processos;
drop policy if exists "logados alteram" on public.processos;
drop policy if exists "logados excluem" on public.processos;
drop policy if exists "compras cria" on public.processos;
drop policy if exists "setor altera" on public.processos;
drop policy if exists "setor exclui" on public.processos;
create policy "logados leem" on public.processos for select to authenticated using (true);
-- Processo novo nasce na Montagem e é criado pelo Compras (o administrador pode importar em qualquer etapa).
create policy "compras cria"  on public.processos for insert to authenticated
  with check (public.sou_admin() or (public.meu_setor() = 'compras' and status = 'montagem'));
create policy "setor altera" on public.processos for update to authenticated
  using (public.pode_mexer(status)) with check (true);
create policy "setor exclui" on public.processos for delete to authenticated using (public.pode_mexer(status));

drop policy if exists "logados leem" on public.status_historico;
create policy "logados leem" on public.status_historico for select to authenticated using (true);

drop policy if exists "logados leem" on public.perfis;
drop policy if exists "proprio ou admin altera" on public.perfis;
create policy "logados leem" on public.perfis for select to authenticated using (true);
create policy "proprio ou admin altera" on public.perfis for update to authenticated
  using (id = auth.uid() or public.sou_admin()) with check (id = auth.uid() or public.sou_admin());

-- Atualização em tempo real nos aparelhos
do $$ begin alter publication supabase_realtime add table public.processos; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.perfis; exception when duplicate_object then null; end $$;

-- ============ Fotos das capas (privadas, só para logados) ============
insert into storage.buckets (id, name, public) values ('capas', 'capas', false)
  on conflict (id) do nothing;

drop policy if exists "capas: logados leem" on storage.objects;
drop policy if exists "capas: logados enviam" on storage.objects;
drop policy if exists "capas: logados excluem" on storage.objects;
create policy "capas: logados leem"    on storage.objects for select to authenticated using (bucket_id = 'capas');
create policy "capas: logados enviam"  on storage.objects for insert to authenticated with check (bucket_id = 'capas');
create policy "capas: logados excluem" on storage.objects for delete to authenticated using (bucket_id = 'capas');

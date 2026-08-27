-- Synapse production schema for Supabase/Postgres
-- Run in a new project and disable public sign-ups.
create extension if not exists pgcrypto;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  role text not null check (role in ('admin', 'prompt_engineer', 'tester', 'viewer')),
  full_name text not null check (char_length(trim(full_name)) between 2 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, name)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$'),
  created_from_branch_id uuid references public.branches(id) on delete set null,
  head_commit_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (prompt_id, name)
);

create table public.commits (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  parent_commit_id uuid references public.commits(id) on delete set null,
  author_id uuid not null references public.profiles(id),
  message text not null check (char_length(trim(message)) between 1 and 240),
  content text not null check (char_length(content) between 1 and 100000),
  created_at timestamptz not null default now()
);

alter table public.branches add constraint fk_head_commit
  foreign key (head_commit_id) references public.commits(id) on delete set null;

create table public.variables (
  id uuid primary key default gen_random_uuid(),
  commit_id uuid not null references public.commits(id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  default_value text,
  description text,
  unique (commit_id, key)
);

create table public.test_runs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  commit_a_id uuid not null references public.commits(id),
  commit_b_id uuid not null references public.commits(id),
  provider_a text not null,
  provider_b text not null,
  model_a text not null,
  model_b text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output_a text,
  output_b text,
  verdict text not null check (verdict in ('commit', 'discard', 'pending')) default 'pending',
  tested_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index prompts_team_idx on public.prompts(team_id, created_at desc);
create index branches_prompt_idx on public.branches(prompt_id);
create index commits_branch_idx on public.commits(branch_id, created_at desc);
create index test_runs_team_idx on public.test_runs(team_id, created_at desc);
create index audit_logs_team_idx on public.audit_logs(team_id, created_at desc);

-- Only server-generated invitations carry trusted app_metadata. The trigger
-- creates a profile when an invited user is added to Supabase Auth.
create or replace function public.handle_invited_user()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  invited_team uuid;
  invited_role text;
  invited_name text;
begin
  if not (new.raw_app_meta_data ? 'team_id') then return new; end if;
  invited_team := (new.raw_app_meta_data ->> 'team_id')::uuid;
  invited_role := new.raw_app_meta_data ->> 'role';
  invited_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  if invited_role not in ('admin', 'prompt_engineer', 'tester', 'viewer') then
    raise exception 'Invalid Synapse role';
  end if;
  insert into public.profiles (id, team_id, role, full_name)
  values (new.id, invited_team, invited_role, invited_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_invited_user_created on auth.users;
create trigger on_invited_user_created after insert on auth.users
  for each row execute procedure public.handle_invited_user();

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.prompts enable row level security;
alter table public.branches enable row level security;
alter table public.commits enable row level security;
alter table public.variables enable row level security;
alter table public.test_runs enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_team_id()
returns uuid language sql security definer stable set search_path = public
as $$ select team_id from public.profiles where id = auth.uid() $$;

create policy "members view own team" on public.teams for select
  using (id = public.current_team_id());
create policy "members view team profiles" on public.profiles for select
  using (team_id = public.current_team_id());
create policy "members view team prompts" on public.prompts for select
  using (team_id = public.current_team_id());
create policy "members view team branches" on public.branches for select using (exists (
  select 1 from public.prompts p where p.id = prompt_id and p.team_id = public.current_team_id()
));
create policy "members view team commits" on public.commits for select using (exists (
  select 1 from public.branches b join public.prompts p on p.id = b.prompt_id
  where b.id = branch_id and p.team_id = public.current_team_id()
));
create policy "members view team variables" on public.variables for select using (exists (
  select 1 from public.commits c join public.branches b on b.id = c.branch_id
  join public.prompts p on p.id = b.prompt_id
  where c.id = commit_id and p.team_id = public.current_team_id()
));
create policy "members view team tests" on public.test_runs for select
  using (team_id = public.current_team_id());
create policy "members view team audit" on public.audit_logs for select
  using (team_id = public.current_team_id());

revoke all on function public.handle_invited_user() from public;
grant execute on function public.current_team_id() to authenticated;

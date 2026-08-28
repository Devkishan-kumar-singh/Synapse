-- Run once in Supabase SQL Editor on an existing Synapse database.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.prompts(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_team_created_idx
  on public.chat_messages(team_id, created_at desc);
create index if not exists chat_messages_project_created_idx
  on public.chat_messages(project_id, created_at desc);

alter table public.chat_messages enable row level security;

drop policy if exists "members view team chat" on public.chat_messages;
create policy "members view team chat" on public.chat_messages for select
  using (team_id = public.current_team_id());

do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception
  when duplicate_object then null;
end $$;

-- =============================================================================
-- Initial schema for Socius Career v0.1
-- -----------------------------------------------------------------------------
-- What: Creates the core tables for the "self-analysis chat -> automatic
--       episode extraction -> personal history page" flow:
--         profiles, chat_sessions, chat_messages, episodes, user_traits
-- Why:  These tables back the v0.1 product loop — a user chats in
--       chat_sessions/chat_messages, the AI extracts STAR-structured
--       episodes (with an embedding for future semantic search/matching),
--       and aggregates traits (strengths/values/interests) in user_traits.
--       RLS is enabled everywhere so every user can only ever see/modify
--       their own data, since this schema is queried directly from the
--       browser via the Supabase client (see apps/web/lib/supabase).
-- =============================================================================

-- pgvector is required for the `episodes.embedding` column.
create extension if not exists vector with schema extensions;

-- -----------------------------------------------------------------------------
-- Shared trigger: keep `updated_at` current on every row update.
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- 1. profiles — per-user extended info, 1:1 with auth.users
-- =============================================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  university text,
  grad_year integer,
  plan text not null default 'free' check (plan in ('free', 'pro', 'premium')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles: delete own"
  on public.profiles for delete
  using (auth.uid() = id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profiles row whenever a new auth.users row is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 2. chat_sessions — a self-analysis / company-analysis / interview session
-- =============================================================================
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null default 'self_analysis'
    check (mode in ('self_analysis', 'company_analysis', 'interview_practice')),
  title text,
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chat_sessions_user_id_created_at_idx
  on public.chat_sessions (user_id, created_at desc);

alter table public.chat_sessions enable row level security;

create policy "chat_sessions: select own"
  on public.chat_sessions for select
  using (auth.uid() = user_id);

create policy "chat_sessions: insert own"
  on public.chat_sessions for insert
  with check (auth.uid() = user_id);

create policy "chat_sessions: update own"
  on public.chat_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "chat_sessions: delete own"
  on public.chat_sessions for delete
  using (auth.uid() = user_id);

create trigger chat_sessions_set_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 3. chat_messages — individual turns within a chat_session
-- =============================================================================
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  tokens integer,
  created_at timestamptz not null default now()
);

create index chat_messages_session_id_created_at_idx
  on public.chat_messages (session_id, created_at);

alter table public.chat_messages enable row level security;

-- chat_messages has no user_id column; ownership is derived from the
-- parent chat_sessions row.
create policy "chat_messages: select own"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_sessions
      where chat_sessions.id = chat_messages.session_id
        and chat_sessions.user_id = auth.uid()
    )
  );

create policy "chat_messages: insert own"
  on public.chat_messages for insert
  with check (
    exists (
      select 1 from public.chat_sessions
      where chat_sessions.id = chat_messages.session_id
        and chat_sessions.user_id = auth.uid()
    )
  );

create policy "chat_messages: update own"
  on public.chat_messages for update
  using (
    exists (
      select 1 from public.chat_sessions
      where chat_sessions.id = chat_messages.session_id
        and chat_sessions.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_sessions
      where chat_sessions.id = chat_messages.session_id
        and chat_sessions.user_id = auth.uid()
    )
  );

create policy "chat_messages: delete own"
  on public.chat_messages for delete
  using (
    exists (
      select 1 from public.chat_sessions
      where chat_sessions.id = chat_messages.session_id
        and chat_sessions.user_id = auth.uid()
    )
  );

-- =============================================================================
-- 4. episodes — STAR-structured personal-history episodes extracted from chat
-- =============================================================================
create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_session_id uuid references public.chat_sessions (id) on delete set null,
  period text,
  title text not null,
  situation text,
  task text,
  action text,
  result text,
  learning text,
  emotions text[] not null default '{}',
  tags text[] not null default '{}',
  embedding extensions.vector(768),
  is_user_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index episodes_user_id_idx on public.episodes (user_id);

-- ivfflat requires a distance operator class; cosine distance matches
-- typical text-embedding similarity search usage.
create index episodes_embedding_idx
  on public.episodes using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

alter table public.episodes enable row level security;

create policy "episodes: select own"
  on public.episodes for select
  using (auth.uid() = user_id);

create policy "episodes: insert own"
  on public.episodes for insert
  with check (auth.uid() = user_id);

create policy "episodes: update own"
  on public.episodes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "episodes: delete own"
  on public.episodes for delete
  using (auth.uid() = user_id);

create trigger episodes_set_updated_at
  before update on public.episodes
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 5. user_traits — aggregated strengths / values / interests per user
-- =============================================================================
create table public.user_traits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  strengths jsonb not null default '[]',
  values jsonb not null default '[]',
  interests jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

alter table public.user_traits enable row level security;

create policy "user_traits: select own"
  on public.user_traits for select
  using (auth.uid() = user_id);

create policy "user_traits: insert own"
  on public.user_traits for insert
  with check (auth.uid() = user_id);

create policy "user_traits: update own"
  on public.user_traits for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_traits: delete own"
  on public.user_traits for delete
  using (auth.uid() = user_id);

create trigger user_traits_set_updated_at
  before update on public.user_traits
  for each row execute function public.set_updated_at();

-- ============================================================
-- PhotoRank – Full Supabase Setup v3
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ── Core tables ───────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id           uuid references auth.users on delete cascade primary key,
  username     text    not null,
  photo_url    text    not null,
  elo_score    integer not null default 1000,
  vote_count   integer not null default 0,
  opted_out    boolean not null default false,
  invite_code  text unique,
  invited_by   uuid references public.profiles(id),
  invite_count integer not null default 0,
  bio          text,
  created_at   timestamptz not null default now()
);

create table if not exists public.votes (
  id         uuid primary key default gen_random_uuid(),
  voter_id   uuid references public.profiles(id) on delete cascade not null,
  winner_id  uuid references public.profiles(id) on delete cascade not null,
  loser_id   uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique(voter_id, winner_id, loser_id)   -- prevent exact duplicate votes
);

create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid references auth.users on delete cascade not null,
  reported_user_id uuid references public.profiles(id) on delete cascade not null,
  reason           text not null default 'other',
  resolved         boolean not null default false,
  created_at       timestamptz not null default now()
);

create table if not exists public.admins (
  id uuid references auth.users on delete cascade primary key
);

-- ── ELO history (snapshot after every vote) ───────────────────────────────

create table if not exists public.elo_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade not null,
  elo_score  integer not null,
  recorded_at timestamptz not null default now()
);

-- ── Categories ────────────────────────────────────────────────────────────

create table if not exists public.categories (
  id   uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists public.profile_categories (
  profile_id  uuid references public.profiles(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  primary key (profile_id, category_id)
);

-- Seed default categories
insert into public.categories (name) values
  ('Student'),('Athlete'),('Artist'),('Gamer'),('Musician'),
  ('Traveler'),('Foodie'),('Fitness'),('Tech'),('Fashion')
on conflict (name) do nothing;

-- ── Indexes ───────────────────────────────────────────────────────────────

create index if not exists votes_voter_idx    on public.votes(voter_id);
create index if not exists votes_winner_idx   on public.votes(winner_id);
create index if not exists votes_loser_idx    on public.votes(loser_id);
create index if not exists votes_created_idx  on public.votes(created_at desc);
create index if not exists profiles_elo_idx   on public.profiles(elo_score desc);
create index if not exists profiles_opted_idx on public.profiles(opted_out);
create index if not exists elo_hist_user_idx  on public.elo_history(user_id, recorded_at desc);

-- ── Row Level Security ────────────────────────────────────────────────────

alter table public.profiles          enable row level security;
alter table public.votes             enable row level security;
alter table public.reports           enable row level security;
alter table public.admins            enable row level security;
alter table public.elo_history       enable row level security;
alter table public.categories        enable row level security;
alter table public.profile_categories enable row level security;

-- Drop old policies before recreating
do $$ declare r record;
begin for r in (select policyname, tablename from pg_policies where schemaname='public') loop
  execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
end loop; end $$;

-- profiles
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_update_elo" on public.profiles for update using (auth.role() = 'authenticated');
create policy "profiles_delete" on public.profiles for delete using (
  auth.uid() = id or exists (select 1 from public.admins where id = auth.uid())
);

-- votes
create policy "votes_insert" on public.votes for insert with check (auth.uid() = voter_id);
create policy "votes_select" on public.votes for select using (
  auth.uid() = voter_id or auth.uid() = winner_id or auth.uid() = loser_id
  or exists (select 1 from public.admins where id = auth.uid())
);

-- reports
create policy "reports_insert" on public.reports for insert with check (auth.uid() = reporter_id);
create policy "reports_select" on public.reports for select using (
  exists (select 1 from public.admins where id = auth.uid())
);
create policy "reports_update" on public.reports for update using (
  exists (select 1 from public.admins where id = auth.uid())
);

-- admins
create policy "admins_select" on public.admins for select using (auth.uid() = id);

-- elo_history
create policy "elo_history_select" on public.elo_history for select using (true);
create policy "elo_history_insert" on public.elo_history for insert with check (auth.role() = 'authenticated');

-- categories
create policy "categories_select" on public.categories for select using (true);

-- profile_categories
create policy "pc_select" on public.profile_categories for select using (true);
create policy "pc_insert" on public.profile_categories for insert with check (auth.uid() = profile_id);
create policy "pc_delete" on public.profile_categories for delete using (auth.uid() = profile_id);

-- ── Realtime ──────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.votes;
alter publication supabase_realtime add table public.profiles;

-- ── Make yourself an admin ────────────────────────────────────────────────
-- insert into public.admins (id) values ('your-uuid-here');

-- ── Helper: record ELO snapshot (call from app after each vote) ───────────
-- Or add a Postgres trigger:
create or replace function record_elo_snapshot()
returns trigger language plpgsql as $$
begin
  if old.elo_score is distinct from new.elo_score then
    insert into public.elo_history (user_id, elo_score) values (new.id, new.elo_score);
  end if;
  return new;
end;
$$;

drop trigger if exists elo_snapshot_trigger on public.profiles;
create trigger elo_snapshot_trigger
  after update on public.profiles
  for each row execute function record_elo_snapshot();

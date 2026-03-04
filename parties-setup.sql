-- ── Maroon Match: Party tables ──────────────────────────────────────────────

create table if not exists public.parties (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  host        text not null,
  date        date not null,
  location    text,
  category    text not null default 'other',   -- 'frat' | 'rso' | 'dorm' | 'other'
  creator_id  uuid references public.profiles(id) on delete set null,
  cover_url   text,
  total_votes integer not null default 0,
  photo_count integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.party_photos (
  id          uuid primary key default gen_random_uuid(),
  party_id    uuid references public.parties(id) on delete cascade not null,
  uploader_id uuid references public.profiles(id) on delete set null,
  photo_url   text not null,
  caption     text,
  votes       integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.party_photo_votes (
  id       uuid primary key default gen_random_uuid(),
  voter_id uuid references public.profiles(id) on delete cascade not null,
  photo_id uuid references public.party_photos(id) on delete cascade not null,
  unique(voter_id, photo_id)
);

-- Indexes
create index if not exists parties_votes_idx      on public.parties(total_votes desc);
create index if not exists parties_date_idx       on public.parties(date desc);
create index if not exists party_photos_party_idx on public.party_photos(party_id, votes desc);
create index if not exists party_photos_date_idx  on public.party_photos(created_at desc);

-- RLS
alter table public.parties         enable row level security;
alter table public.party_photos    enable row level security;
alter table public.party_photo_votes enable row level security;

create policy "parties_select"   on public.parties for select using (true);
create policy "parties_insert"   on public.parties for insert with check (auth.role() = 'authenticated');
create policy "parties_update"   on public.parties for update using (auth.role() = 'authenticated');
create policy "parties_delete"   on public.parties for delete using (
  auth.uid() = creator_id or exists (select 1 from public.admins where id = auth.uid())
);

create policy "party_photos_select" on public.party_photos for select using (true);
create policy "party_photos_insert" on public.party_photos for insert with check (auth.role() = 'authenticated');
create policy "party_photos_delete" on public.party_photos for delete using (
  auth.uid() = uploader_id or exists (select 1 from public.admins where id = auth.uid())
);

create policy "ppv_select" on public.party_photo_votes for select using (auth.uid() = voter_id);
create policy "ppv_insert" on public.party_photo_votes for insert with check (auth.uid() = voter_id);
create policy "ppv_delete" on public.party_photo_votes for delete using (auth.uid() = voter_id);

-- Realtime
alter publication supabase_realtime add table public.party_photos;
alter publication supabase_realtime add table public.party_photo_votes;

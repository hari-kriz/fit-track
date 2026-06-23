-- Run this once in the Supabase dashboard:
--   SQL Editor  ->  New query  ->  paste  ->  Run
--
-- Creates the table the dashboard reads/writes, one row per day.

create table if not exists public.entries (
  date       date primary key,
  weight     numeric,
  steps      integer,
  steps2     integer,
  protein    boolean default false,
  gym        boolean default false,
  breakfast  boolean default false,
  lunch      boolean default false,
  dinner     boolean default false,
  sleep      boolean default false,
  updated_at timestamptz default now()
);

-- Row Level Security: required so the publishable (anon) key can be used safely.
alter table public.entries enable row level security;

-- NOTE: these policies let anyone holding the anon key read/write the table.
-- Fine for a personal tracker on a private repo. Add Supabase Auth later to lock it down.
drop policy if exists "anon read"   on public.entries;
drop policy if exists "anon write"  on public.entries;
drop policy if exists "anon modify" on public.entries;
drop policy if exists "anon delete" on public.entries;

create policy "anon read"   on public.entries for select to anon using (true);
create policy "anon write"  on public.entries for insert to anon with check (true);
create policy "anon modify" on public.entries for update to anon using (true) with check (true);
create policy "anon delete" on public.entries for delete to anon using (true);

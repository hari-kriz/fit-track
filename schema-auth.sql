-- Run this in Supabase: SQL Editor -> New query -> paste -> Run.
-- Locks the entries table to each authenticated user (your login).

-- 1) Add an owner column linked to the auth user.
alter table public.entries
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 2) Remove pre-auth rows (they have no owner). Your data is still in the
--    browser's localStorage and re-syncs to your account on first login.
delete from public.entries where user_id is null;

-- 3) Make ownership required and default to the current user.
alter table public.entries alter column user_id set default auth.uid();
alter table public.entries alter column user_id set not null;

-- 4) One row per user per day.
alter table public.entries drop constraint entries_pkey;
alter table public.entries add primary key (user_id, date);

-- 5) Drop the old open policies.
drop policy if exists "anon read"   on public.entries;
drop policy if exists "anon write"  on public.entries;
drop policy if exists "anon modify" on public.entries;
drop policy if exists "anon delete" on public.entries;

-- 6) Per-user policies: a user can only touch their own rows.
drop policy if exists "own read"   on public.entries;
drop policy if exists "own write"  on public.entries;
drop policy if exists "own modify" on public.entries;
drop policy if exists "own delete" on public.entries;

create policy "own read"   on public.entries for select to authenticated using (auth.uid() = user_id);
create policy "own write"  on public.entries for insert to authenticated with check (auth.uid() = user_id);
create policy "own modify" on public.entries for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own delete" on public.entries for delete to authenticated using (auth.uid() = user_id);

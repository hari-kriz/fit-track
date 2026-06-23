-- Run this in Supabase: SQL Editor -> New query -> paste -> Run.
-- Converts the table to ONE shared dataset: everyone signed in can READ,
-- but only the owner account can WRITE.

-- 1) Drop ALL existing policies first (they may depend on user_id).
drop policy if exists "own read"     on public.entries;
drop policy if exists "own write"    on public.entries;
drop policy if exists "own modify"   on public.entries;
drop policy if exists "own delete"   on public.entries;
drop policy if exists "anon read"    on public.entries;
drop policy if exists "anon write"   on public.entries;
drop policy if exists "anon modify"  on public.entries;
drop policy if exists "anon delete"  on public.entries;
drop policy if exists "auth read"    on public.entries;
drop policy if exists "auth write"   on public.entries;
drop policy if exists "auth modify"  on public.entries;
drop policy if exists "auth delete"  on public.entries;
drop policy if exists "owner write"  on public.entries;
drop policy if exists "owner modify" on public.entries;
drop policy if exists "owner delete" on public.entries;

-- 2) Drop the composite (user_id, date) primary key if present.
alter table public.entries drop constraint if exists entries_pkey;

-- 3) De-duplicate by date (keep one row per day).
delete from public.entries a
using public.entries b
where a.date = b.date
  and a.ctid < b.ctid;

-- 4) Remove the ownership column and make date the primary key again.
alter table public.entries drop column if exists user_id;
alter table public.entries add primary key (date);

-- 5) READ for any authenticated user.
create policy "auth read" on public.entries
  for select to authenticated using (true);

-- 6) WRITE only for the owner account.
create policy "owner write" on public.entries
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'harikrizdata@gmail.com');

create policy "owner modify" on public.entries
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'harikrizdata@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'harikrizdata@gmail.com');

create policy "owner delete" on public.entries
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'harikrizdata@gmail.com');

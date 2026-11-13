create table if not exists public.stagehub_saved_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stage_id text not null check (char_length(stage_id) between 1 and 128 and stage_id ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz not null default now(),
  unique (user_id, stage_id)
);

alter table public.stagehub_saved_listings enable row level security;
grant select, insert, update, delete on public.stagehub_saved_listings to authenticated;
create policy stagehub_saved_listings_select_own on public.stagehub_saved_listings for select to authenticated using ((select auth.uid()) = user_id);
create policy stagehub_saved_listings_insert_own on public.stagehub_saved_listings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy stagehub_saved_listings_update_own on public.stagehub_saved_listings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy stagehub_saved_listings_delete_own on public.stagehub_saved_listings for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.stagehub_student_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stage_id text not null check (char_length(stage_id) between 1 and 128 and stage_id ~ '^[A-Za-z0-9_-]+$'),
  status text not null default 'saved' check (status in ('saved','applied','interview','offer','rejected','withdrawn')),
  notes text not null default '' check (char_length(notes) <= 2000),
  applied_at date,
  confirmation_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, stage_id)
);

alter table public.stagehub_student_applications enable row level security;
grant select, insert, update, delete on public.stagehub_student_applications to authenticated;
create policy stagehub_student_applications_select_own on public.stagehub_student_applications for select to authenticated using ((select auth.uid()) = user_id);
create policy stagehub_student_applications_insert_own on public.stagehub_student_applications for insert to authenticated with check ((select auth.uid()) = user_id);
create policy stagehub_student_applications_update_own on public.stagehub_student_applications for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy stagehub_student_applications_delete_own on public.stagehub_student_applications for delete to authenticated using ((select auth.uid()) = user_id);

create index stagehub_saved_listings_user_created_idx on public.stagehub_saved_listings (user_id, created_at desc);
create index stagehub_student_applications_user_updated_idx on public.stagehub_student_applications (user_id, updated_at desc);

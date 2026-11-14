-- No existing account is enrolled, approved as staff, or shared by this migration.
create schema if not exists stagehub_private;
revoke all on schema stagehub_private from public, anon;
grant usage on schema stagehub_private to authenticated;

create function stagehub_private.school_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u join auth.identities i on i.user_id = u.id
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
      and lower(u.email) like '%@novacollege.nl'
      and i.provider = 'azure' and lower(i.identity_data->>'email') = lower(u.email)
      and i.identity_data->>'email_verified' = 'true'
  );
$$;
revoke all on function stagehub_private.school_member() from public, anon;
grant execute on function stagehub_private.school_member() to authenticated;

-- Only a trusted database administrator/service can approve or deactivate staff.
create table public.stagehub_school_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 120),
  email text not null check (lower(email) like '%@novacollege.nl'),
  active boolean not null default false,
  approved_at timestamptz not null default now()
);
alter table public.stagehub_school_staff enable row level security;
revoke all on public.stagehub_school_staff from anon, authenticated;
grant select on public.stagehub_school_staff to authenticated;
create policy staff_directory on public.stagehub_school_staff for select to authenticated
using (active and (select stagehub_private.school_member()));

create table public.stagehub_teacher_access (
  student_id uuid not null references auth.users(id) on delete cascade,
  teacher_id uuid not null references public.stagehub_school_staff(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, teacher_id),
  check (student_id <> teacher_id)
);
create index stagehub_teacher_access_teacher_idx on public.stagehub_teacher_access(teacher_id);
alter table public.stagehub_teacher_access enable row level security;
revoke all on public.stagehub_teacher_access from anon, authenticated;
grant select, insert, delete on public.stagehub_teacher_access to authenticated;
create policy consent_read_own on public.stagehub_teacher_access for select to authenticated
using (student_id = (select auth.uid()));
create policy consent_grant_own on public.stagehub_teacher_access for insert to authenticated
with check (student_id = (select auth.uid()) and (select stagehub_private.school_member())
  and exists (select 1 from public.stagehub_school_staff t where t.user_id = teacher_id and t.active));
-- Revocation remains available even after a school account/address changes.
create policy consent_revoke_own on public.stagehub_teacher_access for delete to authenticated
using (student_id = (select auth.uid()));

create function stagehub_private.school_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('school_member', stagehub_private.school_member(),
    'approved_teacher', stagehub_private.school_member() and exists (
      select 1 from public.stagehub_school_staff t join auth.users u on u.id=t.user_id
      where t.user_id=(select auth.uid()) and t.active and lower(t.email)=lower(u.email)
    ));
$$;
revoke all on function stagehub_private.school_access() from public, anon;
grant execute on function stagehub_private.school_access() to authenticated;
create function public.stagehub_school_access() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select stagehub_private.school_access();
$$;
revoke all on function public.stagehub_school_access() from public, anon;
grant execute on function public.stagehub_school_access() to authenticated;

-- A guarded projection is necessary: granting teachers SELECT on applications
-- or profiles would also expose notes, message bodies, snapshots and CV paths.
create function stagehub_private.teacher_progress() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (stagehub_private.school_access()->>'approved_teacher')::boolean then
    raise exception 'Approved school teacher required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(student_row) from (
    select g.student_id, coalesce(nullif(p.display_name,''),u.email) as student_name,
      u.email as student_email, g.created_at as shared_since,
      coalesce((select jsonb_agg(a_row) from (
        select a.stage_id,a.status,a.applied_at,a.updated_at
        from public.stagehub_student_applications a where a.user_id=g.student_id
        order by a.updated_at desc limit 500
      ) a_row),'[]'::jsonb) as applications
    from public.stagehub_teacher_access g
    join auth.users u on u.id=g.student_id
    left join public.stagehub_profiles p on p.id=g.student_id
    where g.teacher_id=(select auth.uid()) and u.email_confirmed_at is not null
      and lower(u.email) like '%@novacollege.nl'
      and exists (select 1 from auth.identities i where i.user_id=u.id
        and i.provider='azure' and lower(i.identity_data->>'email')=lower(u.email)
        and i.identity_data->>'email_verified'='true')
    order by g.created_at desc limit 500
  ) student_row),'[]'::jsonb);
end;
$$;
revoke all on function stagehub_private.teacher_progress() from public, anon;
grant execute on function stagehub_private.teacher_progress() to authenticated;
create function public.stagehub_teacher_progress() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select stagehub_private.teacher_progress();
$$;
revoke all on function public.stagehub_teacher_progress() from public, anon;
grant execute on function public.stagehub_teacher_progress() to authenticated;

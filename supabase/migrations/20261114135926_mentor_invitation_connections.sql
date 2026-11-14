-- Independent mentoring: invitation codes identify a recipient; only a student's
-- explicit second action creates access. No school role is inferred or granted.
create table public.stagehub_mentors (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(length(display_name) between 1 and 120),
 invite_code text not null unique default replace(gen_random_uuid()::text,'-',''),
 expires_at timestamptz not null default now()+interval '30 days',
 created_at timestamptz not null default now()
);
alter table public.stagehub_mentors enable row level security;
revoke all on public.stagehub_mentors from public,anon,authenticated;
grant select on public.stagehub_mentors to authenticated;
create policy mentor_read_own on public.stagehub_mentors for select to authenticated
 using(user_id=(select auth.uid()));
create table public.stagehub_mentor_grants (
 student_id uuid not null references auth.users(id) on delete cascade,
 mentor_id uuid not null references public.stagehub_mentors(user_id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(student_id,mentor_id), check(student_id<>mentor_id)
);
create index stagehub_mentor_grants_mentor_idx on public.stagehub_mentor_grants(mentor_id);
alter table public.stagehub_mentor_grants enable row level security;
revoke all on public.stagehub_mentor_grants from public,anon,authenticated;
grant select,delete on public.stagehub_mentor_grants to authenticated;
create policy mentor_grants_read_own on public.stagehub_mentor_grants for select to authenticated
 using(student_id=(select auth.uid()));
create policy mentor_grants_delete_own on public.stagehub_mentor_grants for delete to authenticated
 using(student_id=(select auth.uid()));

create function stagehub_private.confirmed_account() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=(select auth.uid())
   and email_confirmed_at is not null and email is not null and is_anonymous is not true);
$$;

create function stagehub_private.mentor_create(mentor_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not stagehub_private.confirmed_account() then
  raise exception 'Bevestig eerst je e-mailadres.' using errcode='42501'; end if;
 if mentor_name is null or length(trim(mentor_name)) not between 1 and 120 then
  raise exception 'Vul je naam in (maximaal 120 tekens).'; end if;
 insert into public.stagehub_mentors(user_id,display_name) values(auth.uid(),trim(mentor_name))
 on conflict(user_id) do nothing;
 select to_jsonb(m) into result from public.stagehub_mentors m where user_id=auth.uid();
 return result;
end;
$$;
create function stagehub_private.mentor_rotate() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not stagehub_private.confirmed_account() then raise exception 'Bevestig eerst je e-mailadres.' using errcode='42501'; end if;
 update public.stagehub_mentors set invite_code=replace(gen_random_uuid()::text,'-',''),
 expires_at=now()+interval '30 days' where user_id=auth.uid() returning to_jsonb(stagehub_mentors.*) into result;
 if result is null then raise exception 'Maak eerst een begeleidersprofiel.'; end if;
 return result;
end;
$$;
create function stagehub_private.mentor_lookup(code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not stagehub_private.confirmed_account() then raise exception 'Bevestig eerst je e-mailadres.' using errcode='42501'; end if;
 if code is null or code !~ '^[a-f0-9]{32}$' then raise exception 'Code ongeldig of verlopen.'; end if;
 select jsonb_build_object('mentor_id',m.user_id,'display_name',m.display_name,'email',u.email)
 into result from public.stagehub_mentors m join auth.users u on u.id=m.user_id
 where m.invite_code=code and m.expires_at>now() and u.email_confirmed_at is not null
 and m.user_id<>auth.uid() and u.is_anonymous is not true;
 if result is null then raise exception 'Code ongeldig of verlopen.'; end if;
 return result;
end;
$$;
create function stagehub_private.mentor_connect(code text,expected_mentor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare recipient jsonb;
begin
 -- Lock code through grant creation to serialize concurrent code rotation.
 perform 1 from public.stagehub_mentors where invite_code=code for share;
 recipient:=stagehub_private.mentor_lookup(code);
 if expected_mentor is null or (recipient->>'mentor_id')::uuid<>expected_mentor then
  raise exception 'Controleer de begeleider opnieuw.'; end if;
 insert into public.stagehub_mentor_grants(student_id,mentor_id) values(auth.uid(),expected_mentor)
 on conflict do nothing;
 return recipient;
end;
$$;
create function stagehub_private.mentor_connections() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('mentor_id',m.user_id,'display_name',m.display_name,
 'email',u.email,'created_at',g.created_at)),'[]'::jsonb)
 from public.stagehub_mentor_grants g join public.stagehub_mentors m on m.user_id=g.mentor_id
 join auth.users u on u.id=m.user_id where g.student_id=(select auth.uid());
$$;
create function stagehub_private.mentor_progress() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not stagehub_private.confirmed_account() or not exists(select 1 from public.stagehub_mentors where user_id=auth.uid()) then
  raise exception 'Maak eerst een begeleidersprofiel met een bevestigd account.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(student_row) from (
  select g.student_id,coalesce(nullif(p.display_name,''),u.email) as student_name,
   u.email as student_email,g.created_at as shared_since,
   coalesce((select jsonb_agg(a_row) from (
    select a.stage_id,a.status,a.applied_at,a.updated_at from public.stagehub_student_applications a
    where a.user_id=g.student_id order by a.updated_at desc limit 500
   ) a_row),'[]'::jsonb) as applications
  from public.stagehub_mentor_grants g join auth.users u on u.id=g.student_id
  left join public.stagehub_profiles p on p.id=g.student_id
  where g.mentor_id=auth.uid() and u.email_confirmed_at is not null
  order by g.created_at desc limit 500
 ) student_row),'[]'::jsonb);
end;
$$;

-- Private definer functions perform authenticated checks and safe projections;
-- exposed functions are invokers, with no anonymous execution.
revoke all on function stagehub_private.confirmed_account() from public,anon;
revoke all on function stagehub_private.mentor_create(text) from public,anon;
revoke all on function stagehub_private.mentor_rotate() from public,anon;
revoke all on function stagehub_private.mentor_lookup(text) from public,anon;
revoke all on function stagehub_private.mentor_connect(text,uuid) from public,anon;
revoke all on function stagehub_private.mentor_connections() from public,anon;
revoke all on function stagehub_private.mentor_progress() from public,anon;
grant execute on function stagehub_private.confirmed_account(),stagehub_private.mentor_create(text),
 stagehub_private.mentor_rotate(),stagehub_private.mentor_lookup(text),stagehub_private.mentor_connect(text,uuid),
 stagehub_private.mentor_connections(),stagehub_private.mentor_progress() to authenticated;
create function public.stagehub_mentor_create(mentor_name text) returns jsonb language sql security invoker set search_path='' as $$ select stagehub_private.mentor_create(mentor_name); $$;
create function public.stagehub_mentor_rotate() returns jsonb language sql security invoker set search_path='' as $$ select stagehub_private.mentor_rotate(); $$;
create function public.stagehub_mentor_lookup(code text) returns jsonb language sql stable security invoker set search_path='' as $$ select stagehub_private.mentor_lookup(code); $$;
create function public.stagehub_mentor_connect(code text,expected_mentor uuid) returns jsonb language sql security invoker set search_path='' as $$ select stagehub_private.mentor_connect(code,expected_mentor); $$;
create function public.stagehub_mentor_connections() returns jsonb language sql stable security invoker set search_path='' as $$ select stagehub_private.mentor_connections(); $$;
create function public.stagehub_mentor_progress() returns jsonb language sql stable security invoker set search_path='' as $$ select stagehub_private.mentor_progress(); $$;
revoke all on function public.stagehub_mentor_create(text),public.stagehub_mentor_rotate(),public.stagehub_mentor_lookup(text),
 public.stagehub_mentor_connect(text,uuid),public.stagehub_mentor_connections(),public.stagehub_mentor_progress() from public,anon;
grant execute on function public.stagehub_mentor_create(text),public.stagehub_mentor_rotate(),public.stagehub_mentor_lookup(text),
 public.stagehub_mentor_connect(text,uuid),public.stagehub_mentor_connections(),public.stagehub_mentor_progress() to authenticated;

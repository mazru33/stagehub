-- Run as database administrator. Synthetic fixtures and all changes roll back.
begin;
select set_config('stagehub.test_student',gen_random_uuid()::text,true),
       set_config('stagehub.test_teacher',gen_random_uuid()::text,true),
       set_config('stagehub.test_other',gen_random_uuid()::text,true);
do $$
declare sid uuid:=current_setting('stagehub.test_student')::uuid;
        tid uuid:=current_setting('stagehub.test_teacher')::uuid;
        oid uuid:=current_setting('stagehub.test_other')::uuid;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role)
  select id, id::text||'@novacollege.nl',now(),'{"provider":"azure","providers":["azure"]}'::jsonb,'{}'::jsonb,'authenticated','authenticated'
  from unnest(array[sid,tid,oid]) id;
  insert into auth.identities(id,user_id,provider_id,provider,identity_data)
  select gen_random_uuid(),id,id::text,'azure',jsonb_build_object('sub',id::text,'email',id::text||'@novacollege.nl','email_verified',true)
  from unnest(array[sid,tid,oid]) id;
  insert into public.stagehub_school_staff(user_id,display_name,email,active)
  values(tid,'Synthetic teacher',tid::text||'@novacollege.nl',true);
  insert into public.stagehub_student_applications(user_id,stage_id,status,notes,application_message)
  values(sid,'synthetic-school-test','applied','PRIVATE NOTE','PRIVATE MESSAGE');
  if has_function_privilege('anon','public.stagehub_teacher_progress()','execute')
    or has_table_privilege('anon','public.stagehub_teacher_access','select') then
    raise exception 'Anonymous access must be denied';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_student'),true);
do $$
begin
  if not (public.stagehub_school_access()->>'school_member')::boolean
    or (public.stagehub_school_access()->>'approved_teacher')::boolean then
    raise exception 'Student membership or role incorrect';
  end if;
  insert into public.stagehub_teacher_access(student_id,teacher_id)
  values(auth.uid(),current_setting('stagehub.test_teacher')::uuid);
  begin
    insert into public.stagehub_school_staff(user_id,display_name,email,active)
    values(auth.uid(),'Forged teacher',auth.uid()::text||'@novacollege.nl',true);
    raise exception 'Self-approval unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.stagehub_teacher_access set teacher_id=auth.uid();
    raise exception 'Consent reassignment unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_other'),true);
do $$
begin
  if exists(select 1 from public.stagehub_teacher_access) then raise exception 'Other student can read consent'; end if;
  begin
    insert into public.stagehub_teacher_access(student_id,teacher_id)
    values(current_setting('stagehub.test_student')::uuid,current_setting('stagehub.test_teacher')::uuid);
    raise exception 'Forged consent unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stagehub_teacher_progress();
    raise exception 'Unapproved teacher unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_teacher'),true);
do $$
declare result jsonb; app jsonb;
begin
  result:=public.stagehub_teacher_progress();
  if jsonb_array_length(result)<>1 then raise exception 'Approved teacher cannot see consenting student'; end if;
  app:=result->0->'applications'->0;
  if app->>'status'<>'applied' or app->>'stage_id'<>'synthetic-school-test'
    or (select count(*) from jsonb_object_keys(app))<>4
    or (select count(*) from jsonb_object_keys(result->0))<>5 then
    raise exception 'Progress projection is incorrect or exposes extra fields';
  end if;
  if exists(select 1 from public.stagehub_student_applications where user_id=current_setting('stagehub.test_student')::uuid)
    or exists(select 1 from public.stagehub_profiles where id=current_setting('stagehub.test_student')::uuid) then
    raise exception 'Teacher can read private applications or profile';
  end if;
  if (select count(*) from public.stagehub_student_applications where notes='PRIVATE NOTE')<>0 then
    raise exception 'Private notes exposed';
  end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_student'),true);
delete from public.stagehub_teacher_access where student_id=auth.uid();
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_teacher'),true);
do $$ begin
  if public.stagehub_teacher_progress()<>'[]'::jsonb then raise exception 'Revocation did not take effect'; end if;
end $$;
reset role;
update public.stagehub_school_staff set active=false where user_id=current_setting('stagehub.test_teacher')::uuid;
set local role authenticated;
do $$ begin
  begin
    perform public.stagehub_teacher_progress();
    raise exception 'Deactivated teacher unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- User-editable metadata must never grant school membership or staff access.
delete from auth.identities where user_id=current_setting('stagehub.test_other')::uuid;
update auth.users set raw_user_meta_data='{"role":"teacher","email_verified":true,"provider":"azure"}'::jsonb
where id=current_setting('stagehub.test_other')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_other'),true);
do $$ begin
  if (public.stagehub_school_access()->>'school_member')::boolean then raise exception 'Mutable metadata grants school membership'; end if;
end $$;
reset role;
rollback;
select 'PASS: consent, isolation, minimal projection, role approval, revocation, deactivation, metadata forgery; fixtures rolled back' as verification;

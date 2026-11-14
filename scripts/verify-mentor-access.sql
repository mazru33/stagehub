-- Synthetic email/password users, no Microsoft identities, no emails sent.
begin;
select set_config('stagehub.test_student',gen_random_uuid()::text,true),
 set_config('stagehub.test_mentor',gen_random_uuid()::text,true),
 set_config('stagehub.test_other',gen_random_uuid()::text,true),
 set_config('stagehub.test_unconfirmed',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role)
select id,id::text||'@example.invalid',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,'authenticated','authenticated'
from unnest(array[current_setting('stagehub.test_student')::uuid,current_setting('stagehub.test_mentor')::uuid,current_setting('stagehub.test_other')::uuid]) id;
insert into auth.users(id,email,aud,role) values(current_setting('stagehub.test_unconfirmed')::uuid,'unconfirmed-'||gen_random_uuid()::text||'@example.invalid','authenticated','authenticated');
insert into public.stagehub_student_applications(user_id,stage_id,status,notes,application_message)
values(current_setting('stagehub.test_student')::uuid,'mentor-fixture','interview','SECRET NOTE','SECRET MESSAGE');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_unconfirmed'),true);
do $$ begin
 begin
  perform public.stagehub_mentor_create('Unconfirmed');raise exception 'Unconfirmed account accepted';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_mentor'),true);
select set_config('stagehub.test_code',public.stagehub_mentor_create('Synthetic mentor')->>'invite_code',true);
do $$ begin
 if public.stagehub_mentor_progress()<>'[]'::jsonb then raise exception 'Default access not empty';end if;
 if length(current_setting('stagehub.test_code'))<>32 then raise exception 'Code entropy/format wrong';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_other'),true);
select public.stagehub_mentor_create('Unrelated mentor');
do $$ begin
 if exists(select 1 from public.stagehub_mentors where user_id=current_setting('stagehub.test_mentor')::uuid) then raise exception 'Other mentor code exposed';end if;
 if public.stagehub_mentor_progress()<>'[]'::jsonb then raise exception 'Unrelated mentor sees data';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_student'),true);
do $$ declare recipient jsonb;begin
 recipient:=public.stagehub_mentor_lookup(current_setting('stagehub.test_code'));
 if recipient->>'display_name'<>'Synthetic mentor' or (select count(*) from jsonb_object_keys(recipient))<>3 then raise exception 'Unsafe/wrong preview';end if;
 if public.stagehub_mentor_connections()<>'[]'::jsonb then raise exception 'Preview created consent';end if;
 begin
  insert into public.stagehub_mentor_grants(student_id,mentor_id) values(auth.uid(),current_setting('stagehub.test_mentor')::uuid);
  raise exception 'Direct grant insert bypassed code';
 exception when insufficient_privilege then null;end;
 begin
  perform public.stagehub_mentor_connect(current_setting('stagehub.test_code'),current_setting('stagehub.test_other')::uuid);
  raise exception 'Wrong preview identity accepted';
 exception when raise_exception then if sqlerrm='Wrong preview identity accepted' then raise;end if;end;
 perform public.stagehub_mentor_connect(current_setting('stagehub.test_code'),current_setting('stagehub.test_mentor')::uuid);
 if jsonb_array_length(public.stagehub_mentor_connections())<>1 then raise exception 'Student connection missing';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_mentor'),true);
do $$ declare result jsonb;begin
 result:=public.stagehub_mentor_progress();
 if jsonb_array_length(result)<>1 or result->0->'applications'->0->>'status'<>'interview'
 or (select count(*) from jsonb_object_keys(result->0->'applications'->0))<>4
 or (select count(*) from jsonb_object_keys(result->0))<>5 then raise exception 'Progress wrong or extra private fields';end if;
 if exists(select 1 from public.stagehub_student_applications where user_id=current_setting('stagehub.test_student')::uuid)
 or exists(select 1 from public.stagehub_profiles where id=current_setting('stagehub.test_student')::uuid) then raise exception 'Private records exposed';end if;
 perform public.stagehub_mentor_rotate();
 if jsonb_array_length(public.stagehub_mentor_progress())<>1 then raise exception 'Rotation unexpectedly removed consent';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_student'),true);
do $$ begin
 begin
  perform public.stagehub_mentor_lookup(current_setting('stagehub.test_code'));raise exception 'Rotated code still works';
 exception when raise_exception then if sqlerrm='Rotated code still works' then raise;end if;end;
end $$;
delete from public.stagehub_mentor_grants where student_id=auth.uid();
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_mentor'),true);
do $$ begin
 if public.stagehub_mentor_progress()<>'[]'::jsonb then raise exception 'Revocation failed';end if;
end $$;
reset role;
update public.stagehub_mentors set expires_at=now()-interval '1 second' where user_id=current_setting('stagehub.test_mentor')::uuid;
select set_config('stagehub.test_code',(select invite_code from public.stagehub_mentors where user_id=current_setting('stagehub.test_mentor')::uuid),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('stagehub.test_student'),true);
do $$ begin
 begin
  perform public.stagehub_mentor_lookup(current_setting('stagehub.test_code'));raise exception 'Expired code still works';
 exception when raise_exception then if sqlerrm='Expired code still works' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.stagehub_mentor_progress()','execute')
 or has_function_privilege('anon','public.stagehub_mentor_lookup(text)','execute') then raise exception 'Anonymous access allowed';end if;
end $$;
rollback;
select 'PASS: ordinary accounts, verified email, private invitation, preview without consent, explicit connection, isolation, minimal fields, rotation, expiry, revocation; fixtures rolled back' as verification;

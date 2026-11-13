alter table public.stagehub_profiles
  add column if not exists phone text,
  add column if not exists cv_path text,
  add column if not exists cv_filename text,
  add column if not exists cv_uploaded_at timestamptz;

alter table public.stagehub_student_applications
  add column if not exists application_message text not null default '',
  add column if not exists employer_email text,
  add column if not exists delivery_method text not null default 'manual',
  add column if not exists delivery_status text not null default 'not_sent',
  add column if not exists submitted_at timestamptz,
  add column if not exists provider_message_id text,
  add column if not exists applicant_snapshot jsonb not null default '{}'::jsonb;

alter table public.stagehub_student_applications
  drop constraint if exists stagehub_student_applications_delivery_method_check,
  add constraint stagehub_student_applications_delivery_method_check
    check (delivery_method in ('manual', 'email', 'external')),
  drop constraint if exists stagehub_student_applications_delivery_status_check,
  add constraint stagehub_student_applications_delivery_status_check
    check (delivery_status in ('not_sent', 'pending', 'sent', 'failed')),
  drop constraint if exists stagehub_student_applications_message_length_check,
  add constraint stagehub_student_applications_message_length_check
    check (char_length(application_message) <= 5000);

create index if not exists stagehub_student_applications_delivery_idx
  on public.stagehub_student_applications (user_id, submitted_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stagehub-student-cvs', 'stagehub-student-cvs', false, 5242880, array['application/pdf']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists stagehub_cv_select_own on storage.objects;
create policy stagehub_cv_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'stagehub-student-cvs' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists stagehub_cv_insert_own on storage.objects;
create policy stagehub_cv_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stagehub-student-cvs' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists stagehub_cv_update_own on storage.objects;
create policy stagehub_cv_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'stagehub-student-cvs' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'stagehub-student-cvs' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists stagehub_cv_delete_own on storage.objects;
create policy stagehub_cv_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'stagehub-student-cvs' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- Firebase Auth remains the identity authority. These tables are server-only
-- mirrors keyed by Firebase UID; they deliberately do not reference auth.users.
create table if not exists public.stagehub_firebase_users (
  firebase_uid text primary key check (char_length(firebase_uid) between 1 and 128),
  email text,
  display_name text not null default '',
  email_verified boolean not null default false,
  disabled boolean not null default false,
  auth_created_at timestamptz,
  last_sign_in_at timestamptz,
  synced_at timestamptz not null default now()
);

comment on table public.stagehub_firebase_users is
  'Firebase Auth account metadata mirrored by authenticated StageHub Cloud Functions; no passwords or credentials are stored.';

create table if not exists public.stagehub_firebase_profiles (
  firebase_uid text primary key check (char_length(firebase_uid) between 1 and 128),
  email text,
  display_name text not null default '',
  school text,
  study_level text,
  city text,
  interests text[] not null default '{}',
  future_goal text,
  preferred_role text,
  about_me text,
  skills text[] not null default '{}',
  preferred_city text,
  travel_radius_km integer check (travel_radius_km is null or travel_radius_km between 0 and 500),
  availability_date date,
  work_preference text check (work_preference is null or work_preference in ('maakt niet uit', 'op locatie', 'hybride', 'remote')),
  linkedin_url text,
  portfolio_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

comment on table public.stagehub_firebase_profiles is
  'StageHub student profile mirror keyed by Firebase Auth UID; access is server-only through Cloud Functions.';

alter table public.stagehub_firebase_users enable row level security;
alter table public.stagehub_firebase_profiles enable row level security;

revoke all on table public.stagehub_firebase_users from public, anon, authenticated;
revoke all on table public.stagehub_firebase_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.stagehub_firebase_users to service_role;
grant select, insert, update, delete on table public.stagehub_firebase_profiles to service_role;

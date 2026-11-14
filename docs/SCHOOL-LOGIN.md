# Nova College school login and teacher guidance

Implemented: Microsoft OAuth entry point, student-selected per-teacher grants,
immediate database revocation, and a read-only teacher dashboard. No existing
student is shared and no teacher is automatically approved. School sign-in is
disabled until Nova College IT completes the configuration below.

## Nova College IT setup (required before enabling)

1. Register StageHUB in Nova College's Microsoft Entra tenant, using **accounts in
   this organizational directory only**. Confirm the tenant ID with school IT.
2. Add this **Web** redirect URI:
   `https://zimkbskeoskvezrbitjh.supabase.co/auth/v1/callback`.
3. Configure the optional `email` and `xms_edov` claims according to
   [Supabase's Microsoft guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-azure).
   Check consent requirements and school approval before rollout.
4. In Supabase Authentication → Providers → Azure, enter the app's client ID and
   secret **directly in Supabase**, enable Azure, and set the tenant URL to
   `https://login.microsoftonline.com/<Nova-tenant-ID>`. Do not use `common`.
   Keep secrets out of chat, Git, HTML and Vercel public environment variables.
   Record the secret expiry and arrange rotation.
5. Configure the Supabase Auth site URL as
   `https://stagehub-mohammed-almazrouas-projects.vercel.app` and allow redirects to
   `https://stagehub-mohammed-almazrouas-projects.vercel.app/login.html**`
   and `https://stagehub-nine.vercel.app/login.html**` if that alias is used.
   Preserve existing signup/password recovery redirect entries. For local tests,
   add only the chosen localhost login URL separately; avoid broad wildcard hosts.
6. After configuration, set `schoolSignInEnabled: true` in
   `public/js/firebase-config.js`, deploy, and complete real student and teacher
   sign-in tests. Test cancellation and denied consent. The application requests
   only `email`; Microsoft may display standard OpenID scopes as well.
7. Verify the returned Azure identity has a verified email matching the confirmed
   auth account email and ending exactly in `@novacollege.nl`. The database denies
   sharing otherwise. If Microsoft uses a different school domain or lacks the
   verification claim, resolve it with IT; do not loosen validation blindly.

Existing email/password users should use the same verified school email to avoid
separate accounts. Confirm Supabase identity-linking behavior with a test account
before migrating real users. Do not promise automatic merging or transfer data
between accounts without verifying ownership of both.

## Approving teachers

A school email or a client-side role is never enough. After a teacher signs in
with Microsoft, a trusted administrator must independently confirm their staff
identity and school email. In Supabase SQL editor, insert their **verified auth
user UUID**, actual name and exact auth email into `stagehub_school_staff` with
`active=true`. Verify the UUID/email in Authentication first; never approve an
unverified request. This table is not writable by students or teachers.

```sql
-- Replace placeholders only after independent school staff verification.
insert into public.stagehub_school_staff(user_id,display_name,email,active)
values ('<verified-auth-user-uuid>','<verified-name>','<verified-school-email>',true);
-- To remove staff access immediately:
update public.stagehub_school_staff set active=false
where user_id='<verified-auth-user-uuid>';
```

Staff directory names and school emails are visible to verified school members
so students can select the right person. Obtain staff agreement for that listing.
No bulk staff approval or automatic numeric-address role detection is implemented.

## Privacy and behavior

Students explicitly select each approved teacher and confirm sharing. They share
their name, school email, all current and future tracked stages, status and dates
until revoked. All grants are absent by default. Revoking does not affect the
student's own tracker. It remains possible after losing school membership.

Teachers cannot edit student records or read CVs, private notes, application
messages, delivery metadata, profile details or saved-only favorites. The public
RPC wraps a private, guarded projection; existing owner-only policies on profiles
and applications are unchanged. Privileged functions have fixed search paths and
no anonymous execution. Current staff approval and grants are checked from the
database each request, independent of mutable user metadata or cached JWT roles.

The dashboard refreshes every 30 seconds, clears results on failures and when
hidden, and stores no teacher data in localStorage. Revocation blocks subsequent
server requests immediately; it cannot retract information already viewed,
received in an in-flight response, copied or saved. Maximum 500 shared students
and 500 tracked applications per student. Statuses are student-reported and do
not prove an email was sent or received. CV/mailto/.eml flows remain unchanged.

Verify consent and security in an admin connection using
`scripts/verify-school-access.sql`; it uses synthetic users and rolls everything
back. Complete actual Microsoft sign-in, consent grant/revoke and two-account
browser checks with school IT before announcing the feature as operational.

## Verification on 14 November 2026

- Database migration applied to StageHUB; synthetic transaction tests passed and
  rolled back, including unapproved staff, forged consent, private-record access,
  minimal field projection, immediate revocation, deactivation and metadata forgery.
- Anonymous REST requests to both new RPCs return HTTP 401. Azure provider settings
  currently report `enabled=false`; school OAuth has not been tested end to end.
- Full build and existing 12 automated tests passed, plus application/CV draft
  verification over all 9,988 listings. Browser checks cover desktop and 390px
  login/teacher guest states, no horizontal overflow and no console errors.
- Security advisors found no missing RLS or unsafe search-path warnings on this
  feature. The new tables produce GraphQL **schema discoverability** notices,
  because authenticated SELECT is required; row data remains protected by RLS.
- Existing unrelated `chats`, `conversations` and `messages` tables lack RLS.
  Their ownership/application requirements must be reviewed before changing them;
  this work does not grant school teachers access to those tables. See
  [the RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
  Other pre-existing advisories include `pg_net` in public, legacy deny-all Firebase
  tables and disabled leaked-password protection. These are not fixed by school
  sign-in. Resolve the chat table exposure before a wider school rollout.

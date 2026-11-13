# Firestore prototype security review

This review describes the assumptions used by `firestore.rules`. Treat the rules as a prototype and review them before opening the site to a broad audience.

## Data model and access assumptions

- `stages/{stageId}`: admin- or Cloud Functions-managed listings. Visitors can read only documents whose `status` is `published`.
- `stagehub_profiles/{uid}`: private student profile keyed by Firebase Auth UID. The owner can read and edit an allowlisted set of bounded fields; admin authority comes from the verified `admin: true` custom claim.
- `stagehub_saved_stages/{uid__stageId}`: private saved listing record, deterministic ID, owner read/write.
- `stagehub_applications/{uid__stageId}`: private student-owned progress tracker, deterministic ID, allowlisted status, bounded notes, immutable owner/stage/creation fields.
- `importRuns/{runId}` and `stagehub_import_locks/{source}`: trusted Cloud Functions/Admin SDK writes only; import history reads require the verified admin claim.
- No company-account collection, public student profiles, user-to-user messaging, or file storage is implemented in this version.

## Attack review

| Attempt | Expected outcome under the prototype rules |
| --- | --- |
| Unauthenticated query for unpublished stages | Denied. Public stage queries must prove `status == 'published'`; other reads require the verified admin claim. |
| User A reads or changes User B's profile, saved item, or application | Denied by the document path/owner checks. |
| Owner updates profile/application with oversized strings or unknown fields | Denied by bounded string checks, domain validators, and `keys().hasOnly(...)`. Lists have item-count limits; individual list-item lengths are not yet enforced. |
| User changes `user_id`, stage ID, or deterministic record ID | Denied by owner checks, deterministic-ID validation, and update affected-key allowlists. |
| User sets `admin: true` in a profile | Denied because profile schema rejects the field; authorization reads only the Authentication custom claim. |
| User adds arbitrary extra fields | Denied by `keys().hasOnly(...)` for owner-writable profile, saved, and application records. |
| User writes a saved item or application for a missing/unpublished stage | Denied by the stage-existence and published-status check. |
| User changes an application to a known status and edits notes | Allowed for their own tracker record; this is the intended student-managed tracking behavior, not an employer-managed application workflow. |
| Query omits the public `published` constraint | Denied by Firestore's per-document rule evaluation; the client adapter adds that constraint for public stage reads. |
| Client reads/writes import history or locks | Denied; Cloud Functions use the Admin SDK. |
| A listing disappears from one feed snapshot | No automatic deletion or archival is performed. Listings change status only through an explicit source-backed status signal or admin action. |
| Stagemarkt import starts without permission | Starting the scraper requires the affirmative server-side `STAGEMARKT_IMPORT_AUTHORIZED` secret, verified Firebase admin claim, App Check, and in-session confirmation. A one-minute worker processes only an active server-created job. |

## Validation limits

Run `npm run check` for JavaScript syntax checks. Firestore rule compilation, emulator permission tests, registration/login/reset flows, CRUD, feed import behavior and production connectivity must be verified against the enabled project and Emulator Suite before launch. The Stagemarkt import gate should remain off unless the written permission covers collection, storage, and display in StageHub.

Before launch, verify all access patterns against the exact app queries and test the attack cases above in the Emulator Suite. In particular, add per-item validation for profile list fields and consider whether application status transitions should be restricted for the product's intended workflow.

## Supabase profile mirror

`stagehub_firebase_users` and `stagehub_firebase_profiles` are separate from legacy Supabase Auth tables because Firebase UIDs are not Supabase Auth UUIDs. Both mirror tables have RLS enabled, no client policies, and privileges revoked from `public`, `anon`, and `authenticated`; only Cloud Functions with the server-side Supabase key can write them. Never expose `SUPABASE_API_KEY` in browser code. The callable functions verify Firebase Auth and App Check, and the backfill additionally requires the Firebase admin custom claim.

The connected Supabase project also has a pre-existing critical finding: RLS is disabled on `public.conversations`, `public.chats`, and `public.messages`. These tables can be exposed through the public API. Do not simply enable RLS without first defining policies for the intended message and chat access patterns, because that would break legitimate clients. Review and remediate before launch: https://supabase.com/docs/guides/database/postgres/row-level-security.

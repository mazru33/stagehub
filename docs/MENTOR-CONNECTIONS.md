# Begeleiden zonder schoolkoppeling

This is the active, independent option. Microsoft/Entra registration is not needed.
Use ordinary StageHub email/password accounts and confirm their email addresses.

1. Teacher opens `/teacher.html`, signs in and creates a mentor profile with their
   real name. A private 32-character invitation code appears, valid for 30 days.
2. Teacher gives that code directly to their students using their normal channel.
   StageHub does not send invitations automatically.
3. Student opens Mijn StageHub → Hulp van je docent of begeleider, pastes the code
   and checks the name and confirmed email. The code lookup shares no student data.
4. Student explicitly confirms consent to that recipient. Only then can the
   teacher read that student's name, email, tracked stages, statuses and dates.
5. Student can revoke each connection. New teacher requests immediately exclude
   that student; the page refreshes every 30 seconds and clears on failure/hidden.
   Already viewed, copied or in-flight data cannot be recalled.

Profiles are **self-registered, not school-verified**. Confirming an email proves
control of an address, not employment or teacher status. Students must receive the
code directly from a known teacher and check the recipient. Anyone with a confirmed
account can create a mentor profile, but this grants no student access on its own.

Codes use a randomly generated UUID (122 random bits), cannot be listed by other
accounts, and are not placed in URLs or localStorage. Code rotation invalidates the
old invitation while preserving existing explicit grants. Expired codes cannot
create new connections. A code alone never authenticates a viewer or retrieves
student progress. Requests require a signed-in, email-confirmed account.

There is no public mentor directory. Only the owner can select their mentor row;
connections can only be created by the authenticated student through the guarded
RPC, with the invitation and expected recipient UUID. Direct INSERT/UPDATE is
denied. Revocation is student-owner DELETE, even if confirmation later changes.
Private SQL functions have fixed search paths and restricted execution; public
wrappers are security invokers. Existing owner-only profile/application/CV policies
remain unchanged. No CVs, messages, private notes, delivery details or favorites
are included. Progress is self-reported, not proof of email delivery.

School OAuth and approved-school-teacher APIs remain prepared separately. No school
grants existed at this change. The active UI now uses independent invitations.
Limits remain 500 students and 500 applications per student; no export is provided.
There is no teacher identity verification or institution administration portal.

## Validation

`scripts/verify-mentor-access.sql` runs synthetic email-only users in a transaction
and rolls everything back. Verified: unconfirmed denial, empty-by-default access,
private invitation isolation, preview creates no consent, expected-recipient check,
direct insert denial, minimal progress projection, private record isolation, code
rotation, expiry and immediate revocation. No real accounts are enrolled or shared
by the migration/tests. `npm run build` includes the existing application/CV tests.

Real-account sign-in and mailbox confirmation need users to complete the normal
authentication flow. Browser checks do not substitute for a two-person pilot.
Existing unrelated chat-table RLS advisories listed in SCHOOL-LOGIN.md remain.

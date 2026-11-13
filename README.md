# StageHUB

Static website served from public/; Supabase supplies authentication, profiles, private PDF CV storage, saved listings and application tracking.

## Local use

Run npm run check then npm run serve. Set PORT to an unused port (for example 5057) if 5000 is occupied. No dependency installation is needed for the static site or checks. firebase-admin is used only by maintenance scripts.

## Vercel

Import the repository into Vercel using framework Other, repository root as Root Directory, output public, build command npm run check and an empty install command. vercel.json records these settings. Only public/ is served; Firebase and Supabase functions are not deployed by Vercel. The configured browser publishable key is public; never place service-role credentials in public/.

Connect the GitHub repository to Vercel and use main as Production Branch. Pushes to main then deploy automatically; other branches get previews. Local edits require a reviewed commit and push before deployment. GitHub integration is pending until repository access is available.

Add the exact Vercel production origin plus /dashboard.html and /login.html to Supabase Auth redirect allowlists, and select the canonical production Site URL. Email confirmation and password reset can redirect to the previous Firebase origin until this is configured.

## Student-controlled applications

All 9,988 catalogue listings expose Solliciteer. Signed-in students can edit the recipient, subject and full message, reuse their private saved PDF CV, download the CV or an .eml draft, and manually record an application. Only 32 addresses are supplied by the source contact catalogue (snapshot 29 October 2026); they are not independently reverified as current. Other recipients start blank, with instructions to check the original vacancy or ask the employer. Original-vacancy links remain available for external applications. No employer addresses are generated.

The stage detail flow never invokes backend email delivery. mailto cannot attach a CV; students attach it manually. The .eml draft includes the saved PDF and X-Unsent: 1, but email-client support varies. Students must send themselves; manual tracking does not verify delivery. PDF upload remains in the dashboard, limited to 5 MB.

Existing legacy email Edge Functions remain in the source for reference and are not deployed or invoked by this application form. Existing Supabase RLS and storage configuration are unchanged.

## Verification

Syntax checks pass. Rendering checks cover every catalogue listing, including blank-recipient fallbacks. mailto Unicode encoding and MIME PDF attachment round-trip pass. Live account login, private CV upload/download and application writes require an authorized test account; real email client draft handling needs manual testing in Outlook/Gmail/mobile.

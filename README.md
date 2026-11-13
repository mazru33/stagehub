# StageHUB

Static website served from public/; Supabase supplies authentication, profiles, private PDF CV storage, saved listings and application tracking.

## Local use

Run npm run check then npm run serve. Set PORT to an unused port (for example 5057) if 5000 is occupied. No dependency installation is needed for the static site or checks. firebase-admin is used only by maintenance scripts.

## Vercel

Repository: https://github.com/mazru33/stagehub (main).

Production: https://stagehub-mohammed-almazrouas-projects.vercel.app

Vercel project: stagehub, team mohammed-almazrouas-projects. Framework Other, repository root as Root Directory, output public, build command npm run check && npm test and an empty install command. vercel.json records these settings. Only public/ is served; Firebase and Supabase functions are not deployed by Vercel. The configured browser publishable key is public; never place service-role credentials in public/.

The repository is connected to Vercel. Pushes to main deploy automatically; other branches get previews. Local edits require a reviewed commit and push before deployment. The Nova-College/Stagehub repository contains an earlier copy; it is not the deployment source because Vercel Hobby rejects private organization repositories.

Supabase follow-up: add https://stagehub-mohammed-almazrouas-projects.vercel.app/dashboard.html and https://stagehub-mohammed-almazrouas-projects.vercel.app/login.html to the Auth redirect allowlist, and select the canonical production Site URL. This setting has not been verified or changed. Email confirmation and password reset can redirect to the previous Firebase origin until configured.

## Student-controlled applications

All 9,988 catalogue listings expose Solliciteer. Signed-in students can edit the recipient, subject and full message, reuse their private saved PDF CV, download the CV or an .eml draft, and manually record an application. Only 32 addresses are supplied by the source contact catalogue (snapshot 29 October 2026); they are not independently reverified as current. Other recipients start blank, with instructions to check the original vacancy or ask the employer. Original-vacancy links remain available for external applications. No employer addresses are generated.

The stage detail flow never invokes backend email delivery. mailto cannot attach a CV; students attach it manually. The .eml draft includes the saved PDF and X-Unsent: 1, but email-client support varies. Students must send themselves; manual tracking does not verify delivery. PDF upload remains in the dashboard, limited to 5 MB.

Existing legacy email Edge Functions remain in the source for reference and are not deployed or invoked by this application form. Existing Supabase RLS and storage configuration are unchanged.

## Verification

Run npm run check and npm test. Rendering checks cover every catalogue listing, including blank-recipient fallbacks. mailto Unicode encoding, folded Unicode subject headers and MIME PDF attachment round-trip pass. Browser checks cover listing navigation, guest fallback, login return links and a 390px mobile viewport. Live account login, private CV upload/download and application writes require an authorized test account; real email client draft handling needs manual testing in Outlook/Gmail/mobile.

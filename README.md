# StageHUB

Production: https://stagehub-mohammed-almazrouas-projects.vercel.app
Repository: https://github.com/mazru33/stagehub (`main`)

## Run and publish

Use Node 22 or later. Run `npm run build` for syntax checks, application/contact tests and generated catalogue assets. Run `npm run serve` for local use; set `PORT=5057` if 5000 is occupied. The frontend build needs no dependency installation. `firebase-admin` is used only by legacy maintenance scripts.

Vercel project `stagehub`, team `mohammed-almazrouas-projects`, serves `public/`, skips installation and runs `npm run build`. Pushes to `main` publish automatically after checks pass. Local edits require a commit and push. Preview branches retain Vercel authentication protection. The private Nova-College/Stagehub copy is not linked because Vercel Hobby does not support private organization repositories.

## Stagemarkt contacts

The search API omits the email fields displayed on vacancy pages. The importer now reads the public `education-detail?id=...` response for each exact vacancy ID. If the detail API fails, it also checks the matching vacancy in the public page payload. It never collects unrelated footer or navigation emails. It prefers the vacancy contact email, retains the separately published general company email, and records the source URL, contact type and check date. It never constructs addresses from company names or reuses another vacancy's contact.

On 13 November 2026 all 9,988 existing catalogue listings were checked: **9,661** had published contact emails; **327** source records failed after retries. No records were left unchecked. Those source errors are not proof that a vacancy has closed, so the website warns students and retains the original-vacancy route. Publication on Stagemarkt does not verify mailbox delivery or guarantee that a place is still open. Current coverage is recorded in `public/data/contact-import-status.json`.

- `npm run catalog:enrich`: enrich the current catalogue and rebuild application contacts. Successful checks are cached for seven days; failed records are retried.
- `node scripts/enrich-stagemarkt-contacts.mjs --refresh`: recheck every listing, then run `npm run catalog:application-contacts`.
- `npm run catalog:refresh`: refresh accessible search results, then enrich their contacts.
- `npm run catalog:assets`: regenerate the search summaries and grouped full-detail files used by the browser.

The enrichment process uses at most four workers, delays requests, respects Retry-After, uses timeouts and retries, and resumes from the ignored `.scratch/stagemarkt-detail-contacts.jsonl` checkpoint. `--limit=N`, `--concurrency=N`, `--delay=MS` and `--dry-run` are available. `--html-fallback-only` retries failed records using only the public page payload. A dry run writes checkpoints but leaves public files unchanged. `--limit=0` republishes the cached results without source requests. Only public source contact fields are imported; no credentials are needed. Contact fetching is a maintenance command and does not run on each Vercel build.

The existing search catalogue covers the first ten accessible source pages. Stagemarkt reports a larger total, but its public search endpoint returns empty results beyond that boundary. The website does not claim to contain every Stagemarkt vacancy.

Canonical data and application contacts are committed. Search summaries and 257 detail groups are generated during build and ignored by Git. A detail page fetches one small group instead of the entire catalogue. Search, the homepage, StageMatch and saved-stage relations use the same data.

## Student applications

The application page has three steps: check the prefilled employer address, choose a PDF CV (maximum 5 MB), and personalize the email. Guests can prepare a draft without an account. A newly chosen CV stays in memory on that page; it is not uploaded or persisted. Signed-in students can reuse the private CV saved through their profile. Text drafts remain in sessionStorage in the current tab; after leaving or refreshing, a local CV must be selected again.

`mailto:` opens the student's configured mail program with recipient, subject and message. It cannot attach a file; students attach the CV themselves. An `.eml` draft includes the selected local or saved PDF, UTF-8 content and X-Unsent: 1. Compatibility varies by email client. Copying the message is also available. Students send themselves; StageHUB does not send application emails or infer delivery. Application tracking requires login and an explicit manual confirmation. Existing backend email functions remain in the source but are not invoked by this flow.

Supabase continues to supply authentication, profiles, private PDF storage and tracking. No schema or RLS changes were made. The browser publishable key is public; service-role credentials must never be put in `public/`.

Supabase follow-up: the production `/login.html` and `/dashboard.html` Auth redirect allowlist entries and canonical Site URL remain unverified. Email confirmation or password reset can still redirect to the previous Firebase origin until configured.

## Verification and limits

`npm test` checks every listing's signed-in and guest application form, blank-recipient fallbacks, source contact parsing and identity matching, unsafe URLs, Unicode mailto/MIME headers, saved/local CV attachment bytes and CV-fetch failures. Generated detail lookups were checked against all 9,988 source records. Browser checks cover real contact prefills, source-error guidance, draft persistence, matching, search navigation and a 390px mobile layout.

The browser approval gate declined the automated CV file selection and .eml download tests; no alternate file-transfer route was attempted. Browser upload/download, real mail-client handling, authenticated private CV storage and application writes still need manual account testing. No test application email was sent.

## Student experience refresh — 14 November 2026

The shared visual style in `public/design.css` adds warmer colours, clearer typography, touch-sized controls and responsive navigation. The homepage has an original SVG illustration, category shortcuts, varied featured companies, privacy/application FAQs and a three-step personal starter plan. The starter plan stores only its three manual checkbox states in localStorage on the current device; it does not sync to an account, send email or verify application progress.

Search supports shareable `q`, `city`, `level`, `category` and `email=1` query parameters, removable filter chips and returning from an internship without losing the filters. Secondary stage-card actions remain available under “Contact & meer opties”. Extra profile fields are grouped into optional disclosures; CV upload and basic profile fields remain directly accessible.

Verification includes starter-plan persistence, category shortcuts, filter round-trips, mobile menu and Escape-key behaviour, stage-card disclosures and application-page widths at 320px and 390px. Existing contact and MIME attachment checks continue to run during the build. Authenticated profile writes and actual mail-client behaviour retain the manual testing limits described above.

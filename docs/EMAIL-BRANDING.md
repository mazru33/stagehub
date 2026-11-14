# StageHUB signup email

Template: `supabase/templates/confirmation.html`

Subject: **Welkom bij StageHUB — bevestig je e-mailadres**

Status: applied to hosted Supabase Confirm signup on 14 November 2026. Reloaded
the dashboard and verified the StageHUB subject, branded preview, one Token and two
ConfirmationURL placeholders; the original default body is absent. Desktop and
390px previews were checked. Custom SMTP is OFF, so the sender remains the built-in
Supabase sender. No sender address was changed and no delivery test was sent.
Existing received emails do not change; request a fresh confirmation to check delivery.

In the hosted Supabase project, open Authentication → Email → Templates →
Confirm signup and paste the HTML template and subject. Saving files in Git or
deploying the Vercel website does **not** update hosted Auth email templates.

The template preserves Supabase's `{{ .Token }}` and `{{ .ConfirmationURL }}`.
The existing website confirms through the link; the code is included for flows
that ask for it. No new OTP entry screen, token lifetime or auth behavior is
introduced. The automatic email is in Dutch, uses table layout and inline styles,
and loads no remote images, fonts, scripts or tracking pixels. Rounded corners
may render square in older Outlook clients; the content and action still work.

Set sender display name to **StageHUB** only in the project's existing verified
SMTP provider configuration. A branded From email address requires a domain the
owner actually controls, verification with the email provider, and the provider's
SPF/DKIM DNS records (plus an appropriate DMARC policy). Do not invent an address,
claim ownership of stagehub.nl, or put SMTP credentials in source code or chat.
Keep the existing working sender until a verified replacement is configured.
See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

The browser preview uses an obviously synthetic code and inert confirmation URL.
It checks layout, not delivery. After applying in Supabase, an account owner should
request a confirmation email and verify the actual mailbox sender, rendering and
confirmation link. No test email is automatically sent to an unapproved recipient.

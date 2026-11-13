const allowedOrigins = new Set([
  'https://stagehub.nl', 'https://www.stagehub.nl',
  'https://stagehub-777cd.web.app', 'https://stagehub-777cd.firebaseapp.com',
  'http://localhost:5000', 'http://127.0.0.1:5000'
]);
const cors = { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
const json = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), { status, headers: { ...cors, ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}), 'Content-Type': 'application/json' } });
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) } });
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin not allowed.' }, 403, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);
  const authorization = request.headers.get('authorization') || '';
  const apiKey = request.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!authorization.startsWith('Bearer ') || !apiKey) return json({ error: 'Sign in to StageHub before requesting an email.' }, 401, origin);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400, origin); }
  const stageId = String(body.stageId || '');
  const title = String(body.title || '').trim().slice(0, 300);
  const company = String(body.company || '').trim().slice(0, 200);
  let stageUrl: URL;
  try { stageUrl = new URL(String(body.stageUrl || '')); } catch { return json({ error: 'Stage link is invalid.' }, 400, origin); }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(stageId) || !title || stageUrl.protocol !== 'https:') return json({ error: 'Stage details are invalid.' }, 400, origin);

  let user: { id?: string; email?: string; user_metadata?: { display_name?: string } } | null = null;
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { authorization, apikey: apiKey } });
    if (response.ok) user = await response.json();
  } catch { return json({ error: 'Could not verify your StageHub account.' }, 502, origin); }
  if (!user?.id || !user.email) return json({ error: 'Your StageHub account needs a valid email address.' }, 401, origin);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('STAGEHUB_EMAIL_FROM');
  if (!resendKey || !from) return json({ error: 'Email delivery is not configured yet. Ask the StageHub administrator to configure the sender.' }, 503, origin);
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#172923"><p>Hoi ${escapeHtml(user.user_metadata?.display_name || '')},</p><h1 style="color:#1d4f43">Je sollicitatie staat in StageHub</h1><p>Je hebt aangegeven dat je hebt gesolliciteerd op deze stage:</p><div style="padding:18px;background:#f3f6f0;border-radius:12px"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(company)}</div><p>Je kunt je voortgang terugvinden op je Mijn StageHub-profiel. Vergeet niet je sollicitatie ook via de vacaturepagina bij het leerbedrijf in te dienen als je dat nog niet hebt gedaan.</p><p><a href="${escapeHtml(stageUrl.href)}" style="color:#1d4f43">Bekijk de originele vacature</a></p><p style="color:#69756f;font-size:13px">Je ontvangt dit bericht omdat je de sollicitatie zelf hebt geregistreerd met je StageHub-account.</p></div>`;
  const text = `Je sollicitatie staat in StageHub\n\n${title}\n${company}\n\nJe hebt aangegeven dat je hebt gesolliciteerd. Dien je sollicitatie ook via het leerbedrijf in als je dat nog niet hebt gedaan.\n\nOriginele vacature: ${stageUrl.href}`;
  const idempotencyKey = `stagehub-application-${user.id}-${stageId}`.slice(0, 256);
  try {
    const sent = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ from, to: [user.email], subject: `Je sollicitatie staat in StageHub: ${title}`, html, text }) });
    const result = await sent.json().catch(() => ({}));
    if (!sent.ok) return json({ error: 'Email provider rejected the confirmation.' }, 502, origin);
    return json({ sent: true, emailId: result.id || null }, 200, origin);
  } catch { return json({ error: 'Email could not be delivered right now.' }, 502, origin); }
});

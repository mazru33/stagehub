import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://stagehub.nl', 'https://www.stagehub.nl',
  'https://stagehub-777cd.web.app', 'https://stagehub-777cd.firebaseapp.com',
  'http://localhost:5000', 'http://127.0.0.1:5000'
]);
const cors = { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
const json = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), { status, headers: { ...cors, ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}), 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400, origin = '') => json({ error: message }, status, origin);
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const validEmail = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const encodeBase64 = (bytes: Uint8Array) => { let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); };

let contactCache: { expires: number; values: Map<string, { email: string; title: string; company: string; source_url: string }> } | null = null;
async function getApprovedApplicationContacts() {
  if (contactCache && contactCache.expires > Date.now()) return contactCache.values;
  const response = await fetch('https://stagehub-777cd.web.app/data/application-contacts.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Published application contact registry is unavailable.');
  const payload = await response.json();
  if (!Array.isArray(payload.contacts)) throw new Error('Application contact registry has an invalid format.');
  const values = new Map<string, { email: string; title: string; company: string; source_url: string }>();
  for (const contact of payload.contacts) {
    let isOfficialStageUrl = false;
    try { isOfficialStageUrl = new URL(String(contact.source_url || '')).hostname === 'stagemarkt.nl'; } catch { /* Ignore malformed registry records. */ }
    if (typeof contact.id === 'string' && validEmail(contact.email) && typeof contact.title === 'string' && isOfficialStageUrl) {
      values.set(contact.id, { email: contact.email, title: contact.title, company: String(contact.company || ''), source_url: contact.source_url });
    }
  }
  contactCache = { values, expires: Date.now() + 5 * 60 * 1000 };
  return values;
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) } });
  if (origin && !allowedOrigins.has(origin)) return fail('Origin not allowed.', 403, origin);
  if (request.method !== 'POST') return fail('Method not allowed.', 405, origin);

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!token || !supabaseUrl || !serviceKey) return fail('Log in om via StageHub te solliciteren.', 401, origin);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await db.auth.getUser(token);
  const user = authData.user;
  if (authError || !user?.id || !user.email) return fail('Je sessie is verlopen. Log opnieuw in.', 401, origin);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail('Ongeldige aanvraag.', 400, origin); }
  const stageId = String(body.stageId || '');
  const message = String(body.message || '').trim();
  const includeCv = body.includeCv === true;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(stageId) || message.length < 20 || message.length > 5000 || body.consent !== true) return fail('Controleer je bericht en bevestig toestemming voor het delen van je gegevens.', 400, origin);

  let contact: { email: string; title: string; company: string; source_url: string } | undefined;
  try { contact = (await getApprovedApplicationContacts()).get(stageId); }
  catch { return fail('De lijst met toegestane sollicitatieadressen kon niet worden gecontroleerd. Probeer het later opnieuw.', 503, origin); }
  if (!contact) return fail('Voor deze vacature is geen goedgekeurd direct sollicitatieadres beschikbaar. Gebruik de sollicitatieroute in de vacature.', 422, origin);

  const { data: profile, error: profileError } = await db.from('stagehub_profiles')
    .select('id,display_name,email,phone,school,study_level,city,skills,about_me,linkedin_url,portfolio_url,cv_path,cv_filename')
    .eq('id', user.id).maybeSingle();
  if (profileError) return fail('Je studentenprofiel kon niet worden geladen.', 502, origin);
  if (!profile?.display_name || !profile?.school || !profile?.study_level) return fail('Vul eerst je naam, opleiding en opleidingsniveau aan in je profiel.', 422, origin);
  if (includeCv && !profile.cv_path) return fail('Er staat nog geen cv in je profiel. Upload eerst een PDF-cv of verstuur zonder bijlage.', 422, origin);

  const { count: sentToday, error: countError } = await db.from('stagehub_student_applications')
    .select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('delivery_method', 'email')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (countError) return fail('De aanvraaglimiet kon niet worden gecontroleerd.', 502, origin);
  if ((sentToday || 0) >= 10) return fail('Je hebt het maximum van 10 StageHub-sollicitaties per 24 uur bereikt.', 429, origin);

  const { data: existing, error: existingError } = await db.from('stagehub_student_applications')
    .select('id,status,delivery_status,submitted_at,notes,applied_at').eq('user_id', user.id).eq('stage_id', stageId).maybeSingle();
  if (existingError) return fail('Je sollicitatiegeschiedenis kon niet worden gecontroleerd.', 502, origin);
  if (existing?.delivery_status === 'sent' && existing.submitted_at) return json({ success: true, alreadySent: true }, 200, origin);

  const snapshot = {
    display_name: profile.display_name, email: user.email, phone: profile.phone || '',
    school: profile.school, study_level: profile.study_level, city: profile.city || '',
    skills: Array.isArray(profile.skills) ? profile.skills : [], about_me: profile.about_me || '',
    linkedin_url: profile.linkedin_url || '', portfolio_url: profile.portfolio_url || ''
  };
  const now = new Date().toISOString();
  const appPayload = {
    user_id: user.id, stage_id: stageId, status: existing?.status || 'saved', notes: existing?.notes || '',
    applied_at: existing?.applied_at || null, application_message: message,
    employer_email: contact.email, delivery_method: 'email', delivery_status: 'pending',
    applicant_snapshot: snapshot, updated_at: now
  };
  const reserve = existing
    ? await db.from('stagehub_student_applications').update(appPayload).eq('id', existing.id).select('id').single()
    : await db.from('stagehub_student_applications').insert(appPayload).select('id').single();
  if (reserve.error || !reserve.data) return fail('Je sollicitatie kon niet worden klaargezet. Ververs de pagina en probeer opnieuw.', 409, origin);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('STAGEHUB_EMAIL_FROM');
  if (!resendKey || !from) {
    await db.from('stagehub_student_applications').update({ delivery_status: 'failed', updated_at: new Date().toISOString() }).eq('id', reserve.data.id);
    return fail('Verzenden per e-mail is nog niet geconfigureerd. Je profiel en conceptaanvraag zijn wel bewaard.', 503, origin);
  }

  const attachmentList: Array<{ filename: string; content: string; content_type: string }> = [];
  if (includeCv && profile.cv_path) {
    if (!String(profile.cv_path).startsWith(`${user.id}/`)) return fail('Het cv-pad van je profiel is ongeldig.', 403, origin);
    const { data: cv, error: cvError } = await db.storage.from('stagehub-student-cvs').download(profile.cv_path);
    if (cvError || !cv) return fail('Je cv kon niet uit je privéprofiel worden opgehaald.', 422, origin);
    if (cv.size > 5 * 1024 * 1024) return fail('Je cv is groter dan de toegestane 5 MB.', 413, origin);
    attachmentList.push({ filename: String(profile.cv_filename || 'cv.pdf').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120), content: encodeBase64(new Uint8Array(await cv.arrayBuffer())), content_type: 'application/pdf' });
  }

  const fields = [
    ['Naam', snapshot.display_name], ['E-mail', snapshot.email], ['Telefoon', snapshot.phone],
    ['School/opleiding', snapshot.school], ['Niveau', snapshot.study_level], ['Woonplaats', snapshot.city]
  ].filter(([, value]) => value).map(([label, value]) => `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</p>`).join('');
  const profileExtras = [
    snapshot.skills.length ? `<p><b>Vaardigheden:</b> ${escapeHtml(snapshot.skills.join(', '))}</p>` : '',
    snapshot.about_me ? `<p><b>Over de student:</b><br>${escapeHtml(snapshot.about_me).replace(/\n/g, '<br>')}</p>` : '',
    snapshot.linkedin_url ? `<p><b>LinkedIn:</b> ${escapeHtml(snapshot.linkedin_url)}</p>` : '',
    snapshot.portfolio_url ? `<p><b>Portfolio:</b> ${escapeHtml(snapshot.portfolio_url)}</p>` : ''
  ].join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;color:#172923"><h1>Sollicitatie via StageHub</h1><h2>${escapeHtml(contact.title)}</h2><p>${escapeHtml(contact.company)}</p><hr>${fields}${profileExtras}<h3>Bericht van de student</h3><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>${includeCv ? '<p>Het cv is als PDF bijgevoegd.</p>' : ''}<p style="color:#68756c;font-size:13px">Verzonden met toestemming van de student via StageHub. Vacature: <a href="${escapeHtml(contact.source_url)}">${escapeHtml(contact.source_url)}</a></p></div>`;
  const text = `Sollicitatie via StageHub\n\n${contact.title} — ${contact.company}\n\nNaam: ${snapshot.display_name}\nE-mail: ${snapshot.email}\nTelefoon: ${snapshot.phone}\nOpleiding: ${snapshot.school} (${snapshot.study_level})\nWoonplaats: ${snapshot.city}\n\nBericht:\n${message}\n\nOriginele vacature: ${contact.source_url}`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json', 'Idempotency-Key': `stagehub-direct-application-${user.id}-${stageId}`.slice(0, 256) },
      body: JSON.stringify({ from, to: [contact.email], cc: [user.email], reply_to: user.email, subject: `Sollicitatie via StageHub: ${contact.title}`, html, text, ...(attachmentList.length ? { attachments: attachmentList } : {}) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await db.from('stagehub_student_applications').update({ delivery_status: 'failed', updated_at: new Date().toISOString() }).eq('id', reserve.data.id);
      return fail('De e-mailprovider kon je sollicitatie niet afleveren. Controleer je profiel en probeer het later opnieuw.', 502, origin);
    }
    const submittedAt = new Date().toISOString();
    const { error: saveError } = await db.from('stagehub_student_applications').update({
      status: 'applied', applied_at: submittedAt.slice(0, 10), submitted_at: submittedAt,
      delivery_status: 'sent', provider_message_id: result.id || null, updated_at: submittedAt
    }).eq('id', reserve.data.id);
    if (saveError) return fail('De e-mail is verstuurd, maar de voortgang kon niet worden bijgewerkt. De kopie staat in je e-mail.', 502, origin);
    return json({ success: true, sent: true, email: user.email }, 200, origin);
  } catch {
    await db.from('stagehub_student_applications').update({ delivery_status: 'failed', updated_at: new Date().toISOString() }).eq('id', reserve.data.id);
    return fail('Er is een netwerkfout opgetreden bij het versturen. Probeer het later opnieuw.', 502, origin);
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://stagehub.nl', 'https://www.stagehub.nl',
  'https://stagehub-777cd.web.app', 'https://stagehub-777cd.firebaseapp.com',
  'http://localhost:5000', 'http://127.0.0.1:5000'
]);
const cors = { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
const json = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), { status, headers: { ...cors, ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}), 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400, origin = '') => json({ error: message }, status, origin);

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) } });
  if (origin && !allowedOrigins.has(origin)) return fail('Origin not allowed.', 403, origin);
  if (request.method !== 'POST') return fail('Method not allowed.', 405, origin);

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!token || !supabaseUrl || !serviceKey) return fail('Sign in as an administrator.', 401, origin);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) return fail('Your session is invalid or expired.', 401, origin);
  if (authData.user.app_metadata?.role !== 'admin') return fail('Administrator access is required.', 403, origin);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail('Invalid request body.', 400, origin); }
  const action = String(body.action || '');

  if (action === 'list_users') {
    const page = Math.max(1, Number.parseInt(String(body.pageToken || '1'), 10) || 1);
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 50 });
    if (error) return fail('Could not load user accounts.', 502, origin);
    const ids = data.users.map(user => user.id);
    const { data: profiles } = ids.length ? await db.from('stagehub_profiles').select('id,display_name').in('id', ids) : { data: [] };
    const names = new Map((profiles || []).map(profile => [profile.id, profile.display_name]));
    const users = data.users.map(user => ({
      uid: user.id, email: user.email || '', displayName: names.get(user.id) || user.user_metadata?.display_name || '',
      disabled: Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now()),
      admin: user.app_metadata?.role === 'admin', createdAt: user.created_at || null, lastSignInAt: user.last_sign_in_at || null
    }));
    return json({ users, nextPageToken: users.length === 50 ? String(page + 1) : null }, 200, origin);
  }

  if (action === 'set_user_disabled') {
    const uid = String(body.uid || '');
    if (!/^[0-9a-f-]{36}$/i.test(uid) || typeof body.disabled !== 'boolean') return fail('User or disabled value is invalid.', 400, origin);
    if (uid === authData.user.id) return fail('You cannot disable your own administrator account.', 400, origin);
    const { data: target, error: targetError } = await db.auth.admin.getUserById(uid);
    if (targetError || !target.user) return fail('User account was not found.', 404, origin);
    if (target.user.app_metadata?.role === 'admin') return fail('Administrator accounts cannot be disabled here.', 403, origin);
    const { error } = await db.auth.admin.updateUserById(uid, { ban_duration: body.disabled ? '876000h' : 'none' });
    if (error) return fail('Could not update the user account.', 502, origin);
    return json({ success: true }, 200, origin);
  }

  if (action === 'list_applications') {
    const page = Math.max(1, Number.parseInt(String(body.pageToken || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(body.pageSize) || 50));
    const from = (page - 1) * pageSize;
    const { data: applications, error } = await db.from('stagehub_student_applications').select('id,user_id,stage_id,status,updated_at,applied_at').order('updated_at', { ascending: false }).range(from, from + pageSize - 1);
    if (error) return fail('Could not load student progress.', 502, origin);
    const ids = [...new Set((applications || []).map(row => row.user_id))];
    const { data: profiles } = ids.length ? await db.from('stagehub_profiles').select('id,email').in('id', ids) : { data: [] };
    const emails = new Map((profiles || []).map(profile => [profile.id, profile.email]));
    const rows = (applications || []).map(row => ({ ...row, email: emails.get(row.user_id) || '' }));
    return json({ applications: rows, nextPageToken: rows.length === pageSize ? String(page + 1) : null }, 200, origin);
  }

  if (action === 'set_application_status') {
    const id = String(body.id || '');
    const status = String(body.status || '');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !['saved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'].includes(status)) return fail('Application or status is invalid.', 400, origin);
    const { error } = await db.from('stagehub_student_applications').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return fail('Could not update student progress.', 502, origin);
    return json({ success: true }, 200, origin);
  }

  if (action === 'system_status') {
    const { error } = await db.from('stagehub_profiles').select('id', { head: true, count: 'exact' });
    return json({ status: error ? 'Degraded' : 'Operational', firestore: 'Firebase Hosting stage catalog', authentication: 'Supabase Auth', region: 'eu-west-1', checked_at: new Date().toISOString() }, 200, origin);
  }
  return fail('Unknown administrator action.', 400, origin);
});

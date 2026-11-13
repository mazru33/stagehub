import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { firebaseConfig } from './firebase-config.js';
import { getStageById } from './stage-catalog.js';

const supabase = createClient(firebaseConfig.supabaseUrl, firebaseConfig.supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const tableNames = {
  stagehub_saved_stages: 'stagehub_saved_listings',
  stagehub_applications: 'stagehub_student_applications'
};
const shapedUser = user => user ? {
  id: user.id,
  uid: user.id,
  email: user.email || null,
  email_confirmed_at: user.email_confirmed_at || null,
  user_metadata: user.user_metadata || {},
  app_metadata: user.app_metadata || {}
} : null;
const errorShape = error => error ? { name: error.name || 'Error', message: error.message || String(error), code: error.code || 'unknown', context: error.context } : null;

const authFacade = {
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    return { data: { user: shapedUser(data?.user) }, error: errorShape(error) };
  },
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    const session = data?.session ? { ...data.session, user: shapedUser(data.session.user) } : null;
    return { data: { session }, error: errorShape(error) };
  },
  onAuthStateChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session ? { ...session, user: shapedUser(session.user) } : null);
    });
    return { data: { subscription: data.subscription } };
  },
  async signOut() {
    const { error } = await supabase.auth.signOut();
    return { error: errorShape(error) };
  },
  async signUp({ email, password, options = {} }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: options.data || {}, emailRedirectTo: options.emailRedirectTo || `${location.origin}/dashboard.html` }
    });
    return { data: data ? { user: shapedUser(data.user), session: data.session ? { ...data.session, user: shapedUser(data.session.user) } : null } : null, error: errorShape(error) };
  },
  async signInWithPassword({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data: data ? { user: shapedUser(data.user), session: { ...data.session, user: shapedUser(data.session.user) } } : null, error: errorShape(error) };
  },
  async resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/login.html?mode=reset` });
    return { error: errorShape(error) };
  },
  async updatePassword(password) {
    const { data, error } = await supabase.auth.updateUser({ password });
    return { data: shapedUser(data?.user), error: errorShape(error) };
  }
};

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.physicalTable = tableNames[table] || table;
    this.action = 'select';
    this.columns = '*';
    this.filters = [];
    this.orders = [];
    this.limitCount = null;
    this.rangeValue = null;
    this.orFilters = [];
    this.containsFilters = [];
    this.payload = null;
    this.options = {};
    this.singleMode = null;
  }
  select(columns = '*') { this.action = 'select'; this.columns = columns; return this; }
  eq(field, value) { this.filters.push({ method: 'eq', field, value }); return this; }
  ilike(field, pattern) { this.filters.push({ method: 'ilike', field, value: pattern }); return this; }
  contains(field, value) { this.containsFilters.push({ field, value }); return this; }
  startAfter() { return this; }
  or(expression) { this.orFilters.push(String(expression || '')); return this; }
  order(field, options = {}) { this.orders.push({ field, ascending: options.ascending !== false }); return this; }
  limit(value) { this.limitCount = Number(value); return this; }
  range(from, to) { this.rangeValue = [Number(from), Number(to)]; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  single() { this.singleMode = 'single'; return this; }
  insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
  upsert(payload, options = {}) { this.action = 'upsert'; this.payload = payload; this.options = options || {}; return this; }
  update(payload) { this.action = 'update'; this.payload = payload; return this; }
  delete() { this.action = 'delete'; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async attachRelations(rows) {
    if (!this.columns.includes('stages(*)')) return rows;
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const attached = await Promise.all(list.map(async row => ({ ...row, stages: row.stage_id ? await getStageById(row.stage_id).catch(() => null) : null })));
    return Array.isArray(rows) ? attached : attached[0] || null;
  }
  async execute() {
    try {
      const table = supabase.from(this.physicalTable);
      let query;
      if (this.action === 'select') {
        const columns = this.columns.replace(/,?\s*stages\(\*\)/g, '') || '*';
        query = table.select(columns, { count: 'exact' });
      } else if (this.action === 'insert') query = table.insert(this.payload).select('*');
      else if (this.action === 'upsert') {
        const payload = ['stagehub_profiles','stagehub_student_applications','stages'].includes(this.physicalTable)
          ? (Array.isArray(this.payload) ? this.payload.map(row => ({ ...row, updated_at: row.updated_at || new Date().toISOString() })) : { ...(this.payload || {}), updated_at: this.payload?.updated_at || new Date().toISOString() })
          : this.payload;
        query = table.upsert(payload, { onConflict: this.options.onConflict, ignoreDuplicates: this.options.ignoreDuplicates }).select('*');
      }
      else if (this.action === 'update') query = table.update({ ...(this.payload || {}), updated_at: new Date().toISOString() }).select('*');
      else if (this.action === 'delete') query = table.delete().select('*');
      else return { data: null, error: { message: 'Unsupported database operation.' } };

      for (const filter of this.filters) query = query[filter.method](filter.field, filter.value);
      for (const filter of this.containsFilters) query = query.contains(filter.field, filter.value);
      for (const expression of this.orFilters) query = query.or(expression);
      for (const order of this.orders) query = query.order(order.field, { ascending: order.ascending });
      if (this.rangeValue) query = query.range(this.rangeValue[0], this.rangeValue[1]);
      else if (Number.isFinite(this.limitCount)) query = query.limit(Math.max(0, this.limitCount));
      if (this.singleMode === 'maybe') query = query.maybeSingle();
      if (this.singleMode === 'single') query = query.single();

      let { data, error, count } = await query;
      if (!error && this.columns.includes('stages(*)') && data) data = await this.attachRelations(data);
      return { data, error: errorShape(error), count };
    } catch (error) { return { data: null, error: errorShape(error) }; }
  }
}

const adminActions = {
  adminListUsers: 'list_users',
  adminSetUserDisabled: 'set_user_disabled',
  adminListApplications: 'list_applications',
  adminSetApplicationStatus: 'set_application_status',
  adminSystemStatus: 'system_status'
};

async function invokeFunction(name, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { data: null, error: { message: 'Meld je aan om deze actie uit te voeren.' } };
  const isAdminAction = Boolean(adminActions[name]);
  const functionName = isAdminAction ? 'stagehub-admin' : name;
  const body = isAdminAction ? { ...(options.body || {}), action: adminActions[name] } : (options.body || {});
  try {
    const response = await fetch(`${firebaseConfig.supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: firebaseConfig.supabasePublishableKey, authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { data: null, error: { message: data.error || data.message || `Request failed (${response.status}).`, context: { body: data } } };
    return { data, error: null };
  } catch (error) { return { data: null, error: errorShape(error) }; }
}

export async function sendApplicationConfirmation({ stage, stageId }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Log in om je sollicitatie te bevestigen.');
  const response = await fetch(`${firebaseConfig.supabaseUrl}/functions/v1/send-application-confirmation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: firebaseConfig.supabasePublishableKey, authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ stageId, title: stage.title, company: stage.company || '', stageUrl: stage.application_url || stage.source_url || '' })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Bevestigingsmail kon niet worden verstuurd.');
  return result;
}

export const backend = {
  auth: authFacade,
  from(table) { return new QueryBuilder(table); },
  functions: { invoke: invokeFunction },
  storage: {
    async uploadCv(userId, file) {
      const path = `${userId}/${crypto.randomUUID()}.pdf`;
      const { data, error } = await supabase.storage.from('stagehub-student-cvs').upload(path, file, { upsert: true, contentType: 'application/pdf', cacheControl: '3600' });
      return { data, error: errorShape(error) };
    },
    async removeCv(path) {
      if (!path) return { error: null };
      const { error } = await supabase.storage.from('stagehub-student-cvs').remove([path]);
      return { error: errorShape(error) };
    },
    async createCvUrl(path) {
      const { data, error } = await supabase.storage.from('stagehub-student-cvs').createSignedUrl(path, 60);
      return { data, error: errorShape(error) };
    }
  },
  sendApplicationConfirmation
};

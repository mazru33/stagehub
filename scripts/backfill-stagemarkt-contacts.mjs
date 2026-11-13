// The production catalogue is static and backed by Supabase for student data.
// Keep the previous entry point working without Firebase CLI credentials.
await import('./enrich-stagemarkt-contacts.mjs');
await import('./build-application-contacts.mjs');

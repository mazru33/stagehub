import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run set-admin -- admin@example.com');
  process.exit(1);
}
let projectId = process.env.FIREBASE_PROJECT_ID || '';
try {
  const config = JSON.parse(await readFile(resolve('.firebaserc'), 'utf8'));
  projectId ||= config.projects?.default || '';
} catch { /* .firebaserc is optional if FIREBASE_PROJECT_ID is set */ }
if (!projectId || projectId === 'YOUR_PROJECT_ID') {
  console.error('Set FIREBASE_PROJECT_ID or configure .firebaserc with your Firebase project ID.');
  process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
console.log(`Admin claim set for ${email}. Sign out and back in to refresh the ID token.`);

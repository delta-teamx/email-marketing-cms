#!/usr/bin/env node
/**
 * One-time helper: obtain a Google OAuth refresh token for the calendar
 * owner's Gmail account. The refresh token goes into the API's
 * GOOGLE_REFRESH_TOKEN env var (on Render) and never expires as long as the
 * OAuth app is published "In production".
 *
 * Prerequisites (Google Cloud Console — console.cloud.google.com):
 *   1. Create a project (e.g. "Implenix").
 *   2. APIs & Services → Library → enable "Google Calendar API".
 *   3. APIs & Services → OAuth consent screen: External, fill app name +
 *      support email, add the calendar scope, then PUBLISH the app
 *      ("In production"). Publishing without Google verification is fine for
 *      your own account — you'll just click through an "unverified app"
 *      warning once. (If you leave it in "Testing", the refresh token
 *      expires after 7 days — do not leave it in Testing.)
 *   4. APIs & Services → Credentials → Create credentials → OAuth client ID
 *      → Application type "Desktop app". Copy the client ID and secret.
 *
 * Run:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs
 *
 * A browser URL is printed. Open it, sign in with the calendar owner's
 * Gmail, and approve. If you run this on the same machine as your browser,
 * the token is captured automatically; otherwise the browser will fail to
 * load 127.0.0.1 after approval — just copy the full URL from the address
 * bar and paste it back into this terminal.
 */
import http from 'node:http';
import { createInterface } from 'node:readline/promises';
import { google } from 'googleapis';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.');
  process.exit(1);
}

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/calendar'],
});

console.log('\n1. Open this URL in a browser signed into the calendar owner account:\n');
console.log(authUrl + '\n');
console.log(
  '2. Approve access. If the browser then shows a "can\'t connect" page,\n' +
    '   copy the FULL address-bar URL and paste it below.\n',
);

function extractCode(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return u.searchParams.get('code');
  } catch {
    return trimmed; // raw code pasted directly
  }
}

const codePromise = new Promise((resolve) => {
  // Path A: local capture server (works when run on the same machine).
  const server = http
    .createServer((req, res) => {
      const code = new URL(req.url, REDIRECT).searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<p>Authorized — you can close this tab and return to the terminal.</p>');
      if (code) {
        server.close();
        resolve(code);
      }
    })
    .listen(PORT, '127.0.0.1')
    .on('error', () => {
      /* port busy — manual paste still works */
    });

  // Path B: manual paste of the redirect URL (works from any machine).
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste the redirect URL (or code) here: ').then((answer) => {
    const code = extractCode(answer);
    if (code) {
      rl.close();
      server.close(() => {});
      resolve(code);
    }
  });
});

const code = await codePromise;
const { tokens } = await oauth2.getToken(code);
if (!tokens.refresh_token) {
  console.error(
    '\nNo refresh token returned. Remove the app\'s prior access at\n' +
      'https://myaccount.google.com/permissions and run this again.',
  );
  process.exit(1);
}
console.log('\nAdd these to the API environment (Render → Environment):\n');
console.log('GOOGLE_CLIENT_ID=' + clientId);
console.log('GOOGLE_CLIENT_SECRET=' + clientSecret);
console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
console.log('GOOGLE_CALENDAR_ID=primary\n');
process.exit(0);

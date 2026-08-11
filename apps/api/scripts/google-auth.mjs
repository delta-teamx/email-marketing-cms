#!/usr/bin/env node
/**
 * One-time helper: obtain a Google OAuth refresh token for the calendar
 * owner's personal Gmail account.
 *
 * 1. In Google Cloud Console create a project, enable the Google Calendar API,
 *    and create an OAuth client ID of type "Desktop app".
 * 2. Run: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs
 * 3. Open the printed URL in a browser logged into the calendar owner account,
 *    approve, and paste the code back into the terminal.
 * 4. Put the printed refresh token into the API's GOOGLE_REFRESH_TOKEN env var.
 */
import { createInterface } from 'node:readline/promises';
import { google } from 'googleapis';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
const url = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/calendar'],
});

console.log('\nOpen this URL in the calendar owner account:\n\n' + url + '\n');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('Paste the authorization code: ')).trim();
rl.close();

const { tokens } = await oauth2.getToken(code);
console.log('\nGOOGLE_REFRESH_TOKEN=' + tokens.refresh_token + '\n');

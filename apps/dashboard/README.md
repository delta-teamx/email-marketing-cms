# @implenix/dashboard

The Implenix operations dashboard for **marketing.implenix.net** — a React +
Vite single-page app for the v2 booking-centric funnel. Contacts book intro
calls (from the public site or from here), automated follow-up emails fire
around each meeting, replies land in an approval inbox, contracts (BAA /
service agreement) are e-signed, and payments are tracked per client.

Pages: Dashboard (site + funnel + email analytics), Appointments (book, mark
showed/no-show, cancel), Contacts (search, CSV import, detail + timeline),
Follow-ups (the automated email sequence editor), Contracts (templates + sent
contracts), Payments (manual ledger), Inbox (reply triage), Suppression.

Ordinary reads/writes go straight to Supabase under row-level security;
privileged actions (booking, outcomes, test sends, sending contracts,
reminders, inbox replies, stats) go through the Implenix API with the user's
Supabase access token.

## Local development

From the monorepo root:

```bash
npm install
cp apps/dashboard/.env.example apps/dashboard/.env   # then fill in real values
npm run dev -w apps/dashboard                        # http://localhost:5174
```

Other scripts (run with `-w apps/dashboard`): `build`, `preview`, `typecheck`.

## Environment variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key — safe for the browser, RLS enforces access |
| `VITE_API_URL` | Base URL of the Implenix API on Render (no trailing slash) |

The v2 schema and RLS policies live in
`supabase/migrations/0004_v2_booking_funnel.sql` and
`0005_contracts_payments.sql`. A workspace is auto-provisioned for every new
auth user by a DB trigger (with a seeded follow-up sequence and contract
templates), so sign-up needs no extra setup.

## Deploying to Netlify

This is a monorepo, so configure the Netlify site as:

- **Base directory:** `apps/dashboard` (this makes Netlify pick up the
  `netlify.toml` in this folder)
- **Build command:** `cd ../.. && npm install && npm run build -w apps/dashboard`
- **Publish directory:** `dist`

Add the three `VITE_*` environment variables in the Netlify UI. The
`netlify.toml` includes the SPA redirect (`/* → /index.html 200`) so deep links
like `/contacts/:id` survive hard refreshes.

## DNS

Point `marketing.implenix.net` at Netlify:

1. In Netlify → Domain settings, add `marketing.implenix.net` as a custom domain.
2. At the DNS provider for `implenix.net`, add a `CNAME` record:
   `marketing` → `<your-site-name>.netlify.app`
3. Netlify provisions the TLS certificate automatically once the record resolves.

Also make sure the API's CORS allowlist includes `https://marketing.implenix.net`.

# Implenix Platform

Two products in one monorepo:

| App | Domain | Stack | Hosting |
|---|---|---|---|
| `apps/landing` | **implenix.net** | Astro (static) | Netlify |
| `apps/dashboard` | **marketing.implenix.net** | React + Vite SPA | Netlify |
| `apps/api` | **api.implenix.net** | Fastify + BullMQ workers | Render |
| `supabase/` | — | Postgres schema + RLS | Supabase |

**implenix.net** — landing site for Implenix, a US medical billing agency for
practitioners: services, FAQ, legal pages (privacy / terms / HIPAA notice),
and a fully custom Google Calendar booking flow (no Calendly/Zoom) that reads
free/busy from the owner's personal Gmail calendar and creates events with
Google Meet links.

**marketing.implenix.net** — multi-campaign AI email marketing dashboard.
Campaign owners provide all copy (sequence steps with A/B variants + reply
templates per category); AI agents send, receive, classify, reply, and book
meetings automatically — with a GHL-style pipeline, funnel analytics, an
Approval Inbox, warm-up ramps, and instant DNC/unsubscribe suppression.

See [PLAN.md](./PLAN.md) for the full product spec and each app's README for
its own setup.

## Local development

```bash
npm install                # installs all workspaces

npm run dev:api            # Fastify API on :8080 (needs .env + local Redis)
npm run dev:landing        # Astro on :4321
npm run dev:dashboard      # Vite on :5173

npm run build              # build/typecheck everything
```

Copy each app's `.env.example` and fill it in. The API needs Redis locally:
`docker run -p 6379:6379 redis`.

## Deployment runbook

### 1. Supabase
1. Create a project; run `supabase/migrations/*.sql` in order (SQL editor or
   `supabase db push`).
2. Enable email/password auth. Every new user gets a workspace automatically
   (DB trigger).
3. Collect: project URL, anon key (dashboard), service-role key (API).

### 2. Render (API)
- Key Value (Redis) instance → `REDIS_URL`.
- Web Service: build `npm install`, start `npm run start -w apps/api`, env
  vars from `apps/api/.env.example`.
- Custom domain `api.implenix.net`.

### 3. Netlify (two sites, one repo)
- Site 1: base directory `apps/landing`, publish `dist`,
  env `PUBLIC_API_URL=https://api.implenix.net` → domain `implenix.net`.
- Site 2: base directory `apps/dashboard`, publish `dist`,
  env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_API_URL=https://api.implenix.net` → domain `marketing.implenix.net`.

### 4. Resend (outreach domains)
For each of **e.implenix.net**, **m.implenix.net**, **s.implenix.net**:
1. Add as a Resend domain; add the SPF + DKIM (and DMARC) records; verify.
2. Enable inbound receiving (MX per Resend instructions) so replies come back
   as `email.received` webhooks.

Then create one webhook endpoint → `https://api.implenix.net/api/webhooks/resend`
(delivered, opened, clicked, bounced, complained, received) and set its
signing secret as `RESEND_WEBHOOK_SECRET`.

### 5. Google Calendar (personal Gmail)
Run `node apps/api/scripts/google-auth.mjs` once to mint a refresh token for
the calendar owner's Gmail account (instructions inside the script), then set
the `GOOGLE_*` env vars on Render.

### 6. DNS summary (implenix.net zone)
| Record | Type | Points to |
|---|---|---|
| `implenix.net` | A/ALIAS | Netlify site 1 |
| `marketing` | CNAME | Netlify site 2 |
| `api` | CNAME | Render web service |
| `e`, `m`, `s` | MX + TXT (SPF/DKIM/DMARC) | Resend (sending + inbound) |

## Compliance built in

- CAN-SPAM footer (postal address **1879 NW 8th St, Miami, FL 33125**) +
  signed one-click unsubscribe (RFC 8058) on every outreach email.
- Unsubscribes, DNC replies, complaints, and hard bounces suppress instantly,
  workspace-wide; suppressed emails are skipped at import and re-checked at
  send time.
- Warm-up ramps, daily caps, business-hours send windows, and human-like
  send jitter protect the sending domains.
- AI agents only ever send the campaign owner's own templates — they never
  write marketing copy.

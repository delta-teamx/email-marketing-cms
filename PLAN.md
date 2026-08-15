# Implenix — Build Plan v3 (final scope)

> **v3 (2026-08):** No cold email, no dialer. The platform is a
> **booking-and-follow-up machine**: the marketing site converts visitors into
> booked Google Meet calls; the dashboard runs everything after the booking —
> automated follow-up emails, reply triage, e-signed contracts (BAA), and
> client payment tracking, with full-funnel analytics.

## Products

### 1. implenix.net (Astro, Netlify) — LIVE logic
- Marketing site (brand palette from client logo), legal pages, full SEO.
- **Custom scheduling flow** (Calendly-style, no third-party embed):
  date → real free slots from the owner's Google Calendar (10am–2pm & 3pm–6pm
  ET, Mon–Fri) → intake form (**name, phone, email, practice type, patient
  flow**, optional notes) → event with Google Meet link + invite.
- First-party analytics beacons (pageviews + booking started/completed,
  UTM capture, no cookies).

### 2. marketing.implenix.net (React SPA, Netlify) — the operations dashboard
- **Dashboard/analytics**: site funnel (visitors → booking started → booked →
  showed → negotiating → closed won), email open/click rates per follow-up
  step, contract statuses, payment totals.
- **Appointments**: upcoming/past, book-from-dashboard (same slot engine +
  intake form), outcome buttons (Showed / No-show / Cancel).
- **Contacts**: searchable CRM-lite with stages, CSV import, per-contact
  timeline (emails + appointments).
- **Follow-ups (the sequence tool)**: editable, workspace-level steps —
  confirmation (instant), reminders **T-24h / T-12h / T-3h / T-10min**,
  after-showed follow-up, after-no-show rebook. Merge tags, enable toggles,
  offsets, test-send. Edits apply to all future sends automatically.
- **Contracts**: templates (seeded **HIPAA BAA** + service agreement, editable)
  → send tokenized signing link → public review page → typed-name ESIGN
  signature → signed copy emailed to both sides, status tracking
  (sent/viewed/signed), reminders. Service agreement signed ⇒ contact becomes
  a client (closed won).
- **Payments**: manual ledger per client — amount, period, due date,
  due/paid/overdue/waived, one-click payment reminder emails, totals.
- **Inbox**: every inbound reply is classified by Claude (interested /
  neutral / not interested / DNC / OOO / wrong person + reschedule intent),
  DNC honored instantly, everything else queued for a human reply.
- **Suppression list**: unsubscribes, DNC, bounces, complaints — global stop.

### 3. API (Fastify + BullMQ on Render)
Booking engine (Google Calendar free/busy + Meet), follow-up scheduler
(delayed jobs keyed per appointment; cancellation removes pending sends;
rendering happens at send time so edits apply), Resend send + webhooks
(delivery/opens/clicks/bounces/inbound), contract signing pages, payment
reminders, analytics rollups, signed one-click unsubscribe.

## External services

| Service | Status |
|---|---|
| Supabase (`implenix-platform`, us-east-1) | **LIVE** — migrations 0001–0005 applied |
| Google Calendar (owner Gmail OAuth) | **LIVE** — tested end-to-end |
| Netlify ×2 | pending |
| Render (API + Redis) | pending |
| Resend | pending — **one** domain (`mail.implenix.net`), transactional only (fully within Resend policy) |

## Email is transactional-only
Confirmations, meeting reminders, post-meeting follow-ups, contract links,
payment reminders — all triggered by a relationship the recipient started.
CAN-SPAM footer (1879 NW 8th St, Miami, FL 33125) + one-click unsubscribe on
every send regardless. No cold outreach from this system.

## Go-live remaining
1. Netlify: two sites (base dirs `apps/landing`, `apps/dashboard`).
2. Render: Redis + web service, env vars (Supabase service key, Resend key,
   Anthropic key, Google OAuth values, MAIL_FROM).
3. DNS: implenix.net → Netlify, `marketing` → Netlify, `api` → Render,
   `mail` → Resend (SPF/DKIM/DMARC + inbound MX).
4. Resend webhook → `https://api.implenix.net/api/webhooks/resend`.
5. Smoke test: signup → book test call → confirmation + reminders → outcome →
   contract sign → payment record.

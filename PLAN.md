# Implenix — Build Plan

Two products, one platform:

1. **implenix.net** — Marketing landing site for Implenix, a US medical billing agency for practitioners (claims submission, denial prevention/management, faster reimbursements). Includes a **custom Google Calendar booking flow** (no Calendly/Zoom embeds).
2. **marketing.implenix.net** — A general-purpose, multi-campaign **AI email marketing dashboard**. AI agents send emails, receive replies, classify them, respond using **human-provided copy** (no AI-generated copy), and book appointments — with a GHL-style pipeline and analytics. Medical billing outreach is just the first campaign; the tool is business-category agnostic (local business web design, AI receptionist services, etc.).

---

## 1. Confirmed stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend hosting | **Netlify** | Both sites |
| Backend hosting | **Render** | API + background workers |
| Database / Auth | **Supabase** | Postgres, Supabase Auth, RLS, Storage |
| Email delivery | **Resend** (premium) | Outbound sending + webhooks + inbound receiving |
| AI | **Claude API** | Reply classification, intent detection, template selection, scheduling negotiation |
| Calendar | **Google Calendar API** | Custom booking UI on our page; events created directly on the Implenix Workspace calendar (Google Meet link, not Zoom) |

### Repo layout (monorepo, this repo)

```
email-marketing-cms/
├── apps/
│   ├── landing/        # implenix.net — Astro (static, best SEO) → Netlify
│   ├── dashboard/      # marketing.implenix.net — React + Vite SPA → Netlify
│   └── api/            # Node.js (TypeScript, Fastify) + BullMQ workers → Render
├── packages/
│   └── shared/         # Shared types, validation schemas, constants
├── supabase/
│   └── migrations/     # SQL migrations (schema below)
└── PLAN.md
```

- **Landing = Astro**: fully static output, perfect Lighthouse/SEO scores, trivial to host on Netlify. The booking widget is a small React island that talks to the API.
- **Dashboard = React SPA**: authenticated app, SEO irrelevant, fastest to build.
- **API on Render = Fastify + BullMQ + Render Key-Value (Redis)**: BullMQ gives us the scheduled/throttled send queues, retry logic, and warm-up ramps that an email engine needs. Cron-style repeatable jobs handle sequence steps.

---

## 2. Product 1 — implenix.net landing site

### Pages

| Page | Content |
|---|---|
| `/` (Home) | Hero: "Stop losing revenue to claim denials." Services (claims submission, denial management, AR follow-up, credentialing, patient billing support), how-it-works, trust/stats section, FAQ, CTA → Book an appointment |
| `/book` | Custom booking flow (below) — also embedded as a section/modal on Home |
| `/privacy-policy` | Legal |
| `/terms-of-service` | Legal |
| `/hipaa-notice` (recommended 3rd legal page) | Medical billing clients will expect a HIPAA/BAA statement |

Copy: we draft the site copy (denial-prevention angle, "get paid on time, every time"); client provides the **logo** and brand colors when ready — the site ships with a clean placeholder wordmark until then.

### On-page SEO

- Semantic HTML, one `h1` per page, meta title/description per page targeting "medical billing services for practitioners", "denial management", etc.
- OpenGraph + Twitter cards, `sitemap.xml`, `robots.txt`, canonical URLs
- JSON-LD structured data: `Organization`, `ProfessionalService`, `FAQPage`
- Core Web Vitals: static Astro output + optimized images → green scores out of the box

### Custom Google Calendar booking (no Calendly, no Zoom)

Flow on `/book`:

1. Widget fetches available slots from our API: `GET /api/booking/slots?date=...`
2. API checks the Implenix Google Calendar **free/busy** via Google Calendar API (service account with domain-wide delegation on their Workspace, or OAuth refresh token for the calendar owner — decided during setup based on whether they have Google Workspace or plain Gmail).
3. Business rules applied server-side: working hours, buffer time, min-notice, max-per-day, timezone handling (visitor's local TZ shown).
4. Visitor picks a slot → fills form (name, practice name, specialty, phone, email, notes).
5. `POST /api/booking` → creates the Google Calendar event with the visitor as attendee + **Google Meet link auto-attached**, stores the booking in Supabase, sends confirmation email via Resend (branded, with reschedule/cancel links).
6. Reminder email 24h before (BullMQ delayed job).

This same booking engine is **reused by the AI agents** in Product 2 to book appointments from email conversations — build once, use twice.

---

## 3. Product 2 — marketing.implenix.net dashboard

### Core concept

A workspace can run **multiple campaigns**, each fully self-contained:

- Its own **audience** (imported leads), **sending identity** (from-name, from-address, sending domain), **schedule & daily limits**, **copy library**, **AI agent config**, and **pipeline**.
- Example campaigns: "Medical billing — US practitioners", "Web design — US local businesses", "AI receptionist — dental offices".

### Campaign copy library (human-provided — agents never write copy)

Per campaign, the owner uploads/edits:

- **Sequence steps**: Step 1 initial email, Step 2 follow-up (+N days), Step 3 breakup, etc. Each step: subject line(s) + body variant(s) for A/B rotation, with merge tags (`{{first_name}}`, `{{practice_name}}`, …).
- **Reply templates by category**: `interested`, `neutral / question`, `not_interested`, `dnc`, plus `out_of_office` and `wrong_person` handling rules.
- Agents **select and merge-fill** templates; they are explicitly forbidden from free-writing email bodies. (Optional per-campaign toggle later: allow light AI personalization of a template's opening line — off by default.)

### AI agent loop (the "no manual work" engine)

```
Outbound worker (BullMQ, per campaign):
  respects daily cap + warm-up ramp + business-hours window + timezone
  picks next lead → renders step copy with merge tags → sends via Resend
  → logs message, advances lead to "Contacted"

Resend webhooks → API:
  delivered / opened / clicked / bounced / complained → event log + lead status
  hard bounce or complaint → suppress + remove from sequence

Inbound (Resend inbound routing on the sending domain) → API:
  1. Thread-match reply to lead + campaign
  2. STOP sequence for that lead immediately
  3. Claude classifies reply → interested | neutral | not_interested | dnc | ooo | wrong_person
     (+ extracted data: proposed times, questions asked, referral contact)
  4. Action per classification:
     - interested → reply with campaign's "interested" template; if meeting intent
       detected → agent proposes real slots from Google Calendar free/busy →
       on confirmation, books the event (reuses landing-page booking engine)
       → pipeline: "Meeting Booked"
     - neutral/question → "neutral" template → pipeline: "Replied — Nurturing"
     - not_interested → polite close template → pipeline: "Not Interested"
     - dnc → suppression list (global, permanent), confirmation of removal → "DNC"
     - ooo → snooze and re-queue after return date
     - wrong_person → close out (referral capture later)
  5. Every agent action written to an audit log (input, classification,
     confidence, template used, output)
```

### Layers of checking (human-in-the-loop, per campaign)

- **Mode switch per campaign**: `Full-auto` / `Review-first` (agent drafts the reply from the template, queues it in an **Approval Inbox**; one click to send or edit).
- **Confidence threshold**: below X% classification confidence → always route to Approval Inbox regardless of mode.
- **Always-manual categories** (configurable): e.g. auto-handle everything except `interested` replies, which a human approves.
- Full **audit trail** view: every email in/out, every classification, every booking.

### Pipeline (GHL-style)

Default stages per campaign (customizable):

`New → Contacted → Opened → Replied → Interested → Meeting Booked → Negotiating → Sale Closed` — plus terminal lanes: `Not Interested`, `DNC`, `Bounced/Bad Email`.

- Kanban board view with drag-and-drop (manual override always allowed) + list view with filters.
- Leads move automatically as events/classifications occur.

### Analytics

Per campaign and cross-campaign: sent, delivered, open rate, click rate, reply rate, positive-reply rate, meetings booked, closes — as a **funnel view** ("sent 1,000 → 400 opened → 32 replied → 9 interested → 4 meetings → 1 closed") plus per-variant A/B stats (which subject/body wins), and per-step performance, so you can see exactly where to optimize.

### Supabase schema (core tables)

```
workspaces, workspace_members (Supabase Auth users)
campaigns              (workspace_id, name, status, mode, daily_cap, warmup config,
                        sending_domain, from_name, from_email, schedule window, tz)
sequence_steps         (campaign_id, step_no, delay_days)
copy_variants          (step_id, subject, body, weight)         -- A/B rotation
reply_templates        (campaign_id, category, subject, body)
leads                  (campaign_id, email, first/last name, company, custom_fields
                        jsonb, stage, sequence position, next_send_at)
messages               (lead_id, direction, resend_id, thread key, step/template ref,
                        subject, body, status, timestamps)
email_events           (message_id, type: delivered|open|click|bounce|complaint, ts)
agent_actions          (message_id, classification, confidence, extracted jsonb,
                        template_used, action_taken, approved_by, ts)  -- audit log
pipeline_stages        (campaign_id, name, order, is_terminal)
appointments           (lead_id | booking-form source, google_event_id, starts_at,
                        meet_link, status)
suppression_list       (workspace_id nullable = global, email, reason, ts)
```

RLS on everything by workspace; API uses service role, dashboard reads via user JWT where safe.

---

## 4. Build phases

**Phase 1 — Landing site (ship first, it's the company's front door)**
Astro site: all pages + copy + SEO + legal pages. Booking API (Google Calendar free/busy + event creation + confirmation email). Deploy: Netlify (implenix.net) + Render (API) + DNS. *Placeholder logo until client's logo arrives.*

**Phase 2 — Dashboard foundation**
Supabase schema + RLS + Auth (login). Campaign CRUD, copy library editor (steps, variants, reply templates), CSV lead import with validation/dedupe/suppression check, pipeline board.

**Phase 3 — Sending engine**
Resend domain setup flow (SPF/DKIM/DMARC verification status surfaced in UI), BullMQ send scheduler with daily caps + warm-up ramp + send-window, merge-tag rendering, open/click tracking, webhook ingestion, bounce/complaint suppression, live analytics.

**Phase 4 — Inbound + AI agents**
Resend inbound routing, thread matching, sequence auto-stop on reply, Claude classification, template auto-replies, DNC handling, Approval Inbox + confidence thresholds + audit log.

**Phase 5 — Booking agent + polish**
Meeting-intent detection → slot proposal → booking via the shared calendar engine, reminders, funnel/A-B analytics views, cross-campaign overview, close-out reporting.

Each phase is independently shippable; Phase 1 has no dependency on the dashboard at all.

---

## 5. Risks & decisions to confirm

1. **Cold outreach on Resend** ⚠️ — Resend's acceptable-use policy is strict about unsolicited cold email; accounts get suspended for high complaint rates. Mitigations we'll build in regardless (separate sending domains — e.g. `implenixmail.com`, never the root domain; warm-up ramps; low daily caps per mailbox; mandatory unsubscribe link + one-click List-Unsubscribe header; instant DNC/suppression). **Confirm**: volume expectations per campaign, and whether the premium plan/discussion with Resend covers this use. If Resend proves restrictive, the send layer is isolated behind one interface so a cold-email-friendly SMTP provider can be swapped in without touching the rest.
2. **CAN-SPAM compliance** — physical postal address in footer, truthful subject lines, working opt-out honored within 10 days. Built into the send pipeline, not optional.
3. **Google Calendar auth model** — does Implenix use Google Workspace (→ service account with domain-wide delegation) or a plain Gmail account (→ OAuth refresh token)? Needed before Phase 1 booking work.
4. **Assets needed from client**: logo + brand colors, company postal address (legal pages + CAN-SPAM footer), the sending domain(s) to purchase, campaign copy for the first medical-billing campaign.
5. **Claude API key** — under whose account, and monthly budget for classification volume (cheap: Haiku-class model handles classification well at ~fractions of a cent per reply).

---

## 6. What "done" looks like

- implenix.net live on Netlify: fast, SEO-clean, with working custom Google Calendar booking and confirmation/reminder emails.
- marketing.implenix.net live: log in → create a campaign → paste your copy → import leads → enable the agent → watch the pipeline fill and the funnel report where to optimize — with zero manual sending, replying, or booking unless you switch a campaign to Review-first mode.

# Implenix — Build Plan v2 (Cold-Calling Pivot)

> **v2 pivot (2026-08):** Cold outreach moves from email to **cold calling by a
> human SDR** using a built-in Twilio dialer. Email (Resend) is now used only
> for the post-call funnel: booking confirmations, a reminder ladder, and
> post-meeting follow-ups/contracts — all transactional or relationship email,
> fully within Resend's terms. The multi-campaign cold-email machinery
> (sequences, A/B variants, warm-up, sending subdomains) is removed.

Two products, one platform:

1. **implenix.net** — marketing site + custom Google Calendar booking (LIVE
   logic, unchanged in this pivot).
2. **marketing.implenix.net** — the SDR cockpit: dialer, call queue, pipeline,
   appointment booking, and automated follow-up email — replacing the old
   campaign dashboard.

## 1. What changes

### Removed (from v1)
- Multi-campaign system (campaigns, per-campaign copy, A/B variants)
- Cold-email sequence engine, send scheduler, warm-up ramps, daily caps
- The three outreach subdomains (e/m/s.implenix.net) — one sending domain
  (e.g. `mail.implenix.net`) is enough for transactional mail
- Resend inbound cold-reply classification as the primary agent loop

### Kept (already built / wired)
- Landing site + custom Google Calendar booking engine (**Google OAuth is
  already live and tested** — slots 10am–2pm & 3pm–6pm ET, Meet links)
- Supabase project (schema gets a v2 migration), auth, workspaces
- Dashboard shell (auth, layout), pipeline board, CSV import, suppression list
- Resend integration + templates system (repurposed for follow-ups)
- Reminder job infrastructure (extended to a 4-step ladder)
- AI reply handling survives in a smaller role: replies to follow-up emails
  (reschedules, questions) are classified and routed/queued as before

### Added (new build)
- **Twilio browser dialer** in the dashboard (Voice JS SDK softphone)
- **Call queue + call screen + dispositions** driving the pipeline
- **Email-capture → instant booking flow** on the call screen
- **Reminder ladder**: 24 h → 12 h → 3 h → 10 min before each meeting
- **Post-meeting follow-ups**: agent-sent templates (incl. contract email)

## 2. The new funnel

```
CSV import (doctor name, practice, address, phone(s), license number)
        │
        ▼
Call queue — SDR works leads in the browser dialer (click-to-call)
        │  disposition after every call
        ├─ No answer / voicemail → auto re-queue (retry after N days, max M tries)
        ├─ Callback scheduled   → re-queue at the promised time
        ├─ Not interested       → terminal
        ├─ DNC                  → suppression (email + phone), terminal
        └─ Interested
              │  SDR enters the doctor's email + picks a slot live on the call
              ▼
        Meeting booked on Google Calendar (Meet link, invite to doctor)
              │  instant confirmation email (doctor's info + Meet link)
              ▼
        Reminder ladder: T-24h → T-12h → T-3h → T-10min
              │
              ▼
        Meeting happens → SDR marks outcome
              ├─ Showed → agent sends follow-up / contract email → Negotiating
              └─ No-show → agent sends "sorry we missed you" + rebook link
              ▼
        Sale closed
```

### Pipeline stages (v2)
`New → Calling → Callback → Interested → Meeting Booked → Showed →
Negotiating → Sale Closed` + terminal lanes: `No Answer (exhausted)`,
`Not Interested`, `DNC`, `Bad Number`.

## 3. Dialer design (Twilio)

- **Browser softphone**: Twilio Voice JS SDK in the dashboard. The API issues
  short-lived Access Tokens (Voice grant); calls go out through a TwiML App
  from the purchased Twilio number. SDR needs only a headset and Chrome.
- **Call screen**: lead card (name, practice, address, license number,
  phones), dial/hangup/mute/keypad, notes field, disposition buttons, and the
  booking widget (same engine as the landing page) for live slot picking.
- **Queue logic**: next-lead auto-advance; no-answer retry policy
  (default: retry after 2 business days, max 4 attempts → "No Answer
  (exhausted)"); callbacks surface at their scheduled time.
- **Call logging**: every call recorded as a row (Twilio SID, duration,
  disposition, notes, SDR user) via status callbacks — feeds reporting:
  dials/day, connect rate, interest rate, meetings/100 dials.
- **No call recording by default.** Florida (and 10 other states) require
  all-party consent; recording stays off unless explicitly enabled later
  with a consent script.
- **Numbers**: start with one Twilio local US number (~$1.15/mo + ~$0.014/min
  outbound). More numbers/local presence later if connect rates warrant.

## 4. Email's new job (Resend — compliant)

Workspace-level **follow-up templates** (human-written, agent-sent; merge
tags as before):

| Template | Trigger | Timing |
|---|---|---|
| Booking confirmation | Meeting booked from call screen (or landing page) | instant |
| Reminder 24h / 12h / 3h / 10min | Scheduled from `starts_at` | T-24h, T-12h, T-3h, T-10m |
| Post-meeting follow-up | SDR marks "Showed" | instant |
| Contract email | SDR clicks "Send contract" | on demand |
| No-show / rebook | SDR marks "No-show" | instant |

- Reminder ladder = BullMQ delayed jobs keyed per appointment; cancelled
  bookings cancel their pending reminders. Reminders inside the ladder that
  are already in the past at booking time are skipped.
- Inbound replies to these emails still hit the classification agent —
  reschedule requests and questions are drafted from templates and queued
  (or auto-sent per the same confidence rules).
- One verified sending domain: `mail.implenix.net`. No warm-up needed at
  transactional volumes.

## 5. Data model changes (migration v2)

- `leads` → workspace-level (drop `campaign_id`): add `phones text[]`,
  `address`, `license_number`, `practice_type`, `call_attempts`,
  `next_call_at`, `assigned_to`; keep suppression/status.
- New `calls`: lead_id, sdr user_id, twilio_sid, from/to numbers, started_at,
  duration_secs, disposition, notes.
- `pipeline_stages` → workspace-level with the v2 stage set.
- `followup_templates` (replaces campaign reply/sequence copy): key
  (confirmation, reminder_24h, reminder_12h, reminder_3h, reminder_10m,
  post_meeting, contract, no_show), subject, body.
- `appointments` unchanged + `reminder ladder` job keys + `outcome`
  (showed / no_show) column.
- Drop: `campaigns`, `sequence_steps`, `copy_variants`, `reply_templates`
  (folded into followup_templates), campaign-scoped columns elsewhere.
- Suppression list covers **emails and phone numbers** (DNC on either).

## 6. Dashboard v2 (SDR cockpit)

- **Dialer** (new home page): queue, call screen, dispositions, live booking
- **Pipeline**: kanban with v2 stages (kept, re-pointed)
- **Leads**: CSV import mapped to the doctor fields (kept, extended)
- **Appointments**: upcoming meetings, reminder status, outcome buttons,
  send-contract action
- **Templates**: follow-up copy editor (kept, simplified)
- **Approval Inbox**: agent drafts for inbound replies (kept)
- **Reports**: call + funnel metrics (dials → connects → interested →
  booked → showed → closed)

## 7. External services after the pivot

| Service | Status |
|---|---|
| Supabase | LIVE — needs v2 migration |
| Google Calendar | LIVE — tested, no changes |
| Netlify ×2 | pending (unchanged plan) |
| Render | pending (unchanged plan) |
| Resend | one domain, transactional only — policy risk gone |
| **Twilio** | **new**: account, Account SID + Auth Token (or API key), one US number, TwiML App |

## 8. Compliance notes (calling)

- B2B calls to medical practices: keep an internal phone DNC list (honored
  automatically by the dialer queue) and honor verbal opt-outs immediately.
- No recording without all-party consent (off by default).
- Emails remain transactional/relationship — CAN-SPAM footer + unsubscribe
  stay on everything anyway.

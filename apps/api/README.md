# @implenix/api

Fastify API + BullMQ workers powering the Implenix platform: the landing-page
booking engine, the outreach send engine, Resend webhooks/inbound, and the
AI reply agent. Deployed on **Render** (one Web Service; workers run in the
same process).

## Run locally

```bash
cp .env.example .env   # fill in values
npm install            # from repo root
npm run dev -w apps/api
```

Requires a Redis instance (`REDIS_URL`) — locally: `docker run -p 6379:6379 redis`.

## What runs inside

| Piece | Purpose |
|---|---|
| `routes/booking.ts` | Public slots + booking endpoints for the landing widget; creates Google Calendar events with Meet links, sends confirmations, schedules 24h reminders |
| `routes/webhooks.ts` | Resend webhook: delivery/open/click/bounce/complaint events, plus inbound replies (`email.received`) with thread matching |
| `routes/unsubscribe.ts` | Signed one-click unsubscribe (RFC 8058) → suppression list |
| `routes/campaigns.ts` | Activate/pause (stamps warm-up start), test-send, funnel/A-B stats |
| `routes/agentActions.ts` | Approval Inbox: approve (send, optionally edited) / reject queued agent replies |
| `queues/scheduler.ts` | 1-minute tick: enqueues due leads per active campaign, honoring send window, send days, daily cap, and warm-up ramp, with human-like jitter |
| `engine/sendEngine.ts` | Renders human-provided copy (weighted A/B variant pick, merge tags), appends CAN-SPAM footer + unsubscribe, threads follow-ups, advances the sequence |
| `agent/replyAgent.ts` | Claude classification → acts with the campaign owner's templates only; books meetings via Google Calendar; DNC suppression; approval gating |

## Agent guarantees

- Agents **never write marketing copy** — replies always come from the
  campaign's `reply_templates`. The only generated text is the mechanical
  booking confirmation sentence after a successful calendar booking.
- A campaign in `review_first` mode, a classification under the campaign's
  `confidence_threshold`, or a category outside its `auto_categories` always
  lands in the Approval Inbox instead of auto-sending.
- DNC replies, unsubscribes, complaints, and hard bounces suppress
  immediately — even when the reply itself is queued for approval.

## Deploy on Render

1. Create a **Key Value** (Redis) instance → `REDIS_URL`.
2. Create a **Web Service** from this repo: root directory `.`, build command
   `npm install`, start command `npm run start -w apps/api`.
3. Set every var from `.env.example`.
4. Point `api.implenix.net` (CNAME) at the Render service and set
   `API_PUBLIC_URL=https://api.implenix.net`.

## Resend setup (per sending subdomain: e/m/s.implenix.net)

1. Add each subdomain as a domain in Resend and add its SPF/DKIM/DMARC DNS
   records; verify.
2. Enable inbound receiving (MX records per Resend's instructions) so replies
   to `*@e.implenix.net` etc. arrive as `email.received` webhooks.
3. Create one webhook endpoint → `POST {API_PUBLIC_URL}/api/webhooks/resend`
   subscribed to delivered/opened/clicked/bounced/complained/received; put its
   signing secret in `RESEND_WEBHOOK_SECRET`.

## Google Calendar (personal Gmail)

Run `node scripts/google-auth.mjs` once (see comments inside) to mint the
refresh token for the calendar owner's account, then set the `GOOGLE_*` vars.

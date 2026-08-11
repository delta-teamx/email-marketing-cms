import { DateTime } from 'luxon';
import { db } from '../db.js';
import { sendQueue, defaultJobOpts } from './queues.js';

interface CampaignRow {
  id: string;
  workspace_id: string;
  timezone: string;
  send_window_start: number;
  send_window_end: number;
  send_days: number[];
  daily_cap: number;
  warmup_enabled: boolean;
  warmup_start: number;
  warmup_increment: number;
  warmup_started_at: string | null;
}

/** Today's effective cap, honoring the warm-up ramp. */
export function effectiveDailyCap(c: CampaignRow, now: DateTime): number {
  if (!c.warmup_enabled || !c.warmup_started_at) return c.daily_cap;
  const started = DateTime.fromISO(c.warmup_started_at, { zone: c.timezone }).startOf('day');
  const days = Math.max(0, Math.floor(now.setZone(c.timezone).startOf('day').diff(started, 'days').days));
  return Math.min(c.daily_cap, c.warmup_start + days * c.warmup_increment);
}

/**
 * Runs every minute. For each active campaign inside its send window, counts
 * what was already sent today, and enqueues due leads up to the remaining
 * daily budget — staggered with human-looking jitter.
 */
export async function runSchedulerTick(): Promise<void> {
  const { data: campaigns } = await db
    .from('campaigns')
    .select(
      'id, workspace_id, timezone, send_window_start, send_window_end, send_days, daily_cap, warmup_enabled, warmup_start, warmup_increment, warmup_started_at',
    )
    .eq('status', 'active');

  for (const c of (campaigns ?? []) as CampaignRow[]) {
    const now = DateTime.now().setZone(c.timezone);
    if (!c.send_days.includes(now.weekday)) continue;
    if (now.hour < c.send_window_start || now.hour >= c.send_window_end) continue;

    const dayStartUtc = now.startOf('day').toUTC().toISO()!;
    const { count: sentToday } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .eq('direction', 'outbound')
      .gte('created_at', dayStartUtc);

    const remaining = effectiveDailyCap(c, now) - (sentToday ?? 0);
    if (remaining <= 0) continue;

    // Only take what fits in roughly the next few minutes; the next tick
    // picks up the rest, which keeps sends spread across the window.
    const batch = Math.min(remaining, 5);
    const nowUtcIso = DateTime.utc().toISO()!;
    const { data: leads } = await db
      .from('leads')
      .select('id, current_step, next_send_at, snoozed_until')
      .eq('campaign_id', c.id)
      .eq('status', 'active')
      .or(`next_send_at.is.null,next_send_at.lte.${nowUtcIso}`)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowUtcIso}`)
      .order('next_send_at', { ascending: true, nullsFirst: false })
      .limit(batch);

    for (const [i, lead] of (leads ?? []).entries()) {
      await sendQueue.add(
        'send-sequence-email',
        { leadId: lead.id },
        {
          ...defaultJobOpts,
          // jobId dedupes across ticks until the step advances
          jobId: `lead:${lead.id}:step:${(lead.current_step ?? 0) + 1}`,
          delay: i * (20_000 + Math.floor(Math.random() * 40_000)),
        },
      );
    }
  }
}

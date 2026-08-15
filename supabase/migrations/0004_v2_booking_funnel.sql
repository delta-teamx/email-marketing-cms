-- v2 pivot: booking-centric follow-up funnel.
-- Drops the cold-email campaign model; adds contacts, follow-up steps,
-- appointment outcomes, and site analytics.

-- ---------------------------------------------------------------------------
-- Drop v1 campaign machinery (DB is pre-launch; no data preserved)
-- ---------------------------------------------------------------------------

drop function if exists campaign_stats(uuid);
drop table if exists agent_actions cascade;
drop table if exists email_events cascade;
drop table if exists messages cascade;
drop table if exists appointments cascade;
drop table if exists leads cascade;
drop table if exists copy_variants cascade;
drop table if exists sequence_steps cascade;
drop table if exists reply_templates cascade;
drop table if exists pipeline_stages cascade;
drop table if exists campaigns cascade;
drop type if exists campaign_status;
drop type if exists campaign_mode;
drop type if exists lead_status;
drop type if exists template_category;

create type contact_stage as enum (
  'new', 'booked', 'showed', 'negotiating', 'closed_won',
  'no_show', 'cancelled', 'not_interested', 'dnc'
);
create type followup_trigger as enum (
  'confirmation', 'before_meeting', 'after_showed', 'after_no_show'
);
create type appointment_outcome as enum ('pending', 'showed', 'no_show', 'cancelled');

-- ---------------------------------------------------------------------------
-- Contacts (doctors / practices)
-- ---------------------------------------------------------------------------

create table contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  phone text,
  practice_type text,
  patient_flow text,             -- e.g. "100-300 patients/month"
  timezone text,
  source text not null default 'manual',  -- landing | dashboard | csv
  stage contact_stage not null default 'new',
  notes text,
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create index on contacts (workspace_id, stage);
create index on contacts (email);

create trigger contacts_touch before update on contacts
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Appointments (v2: linked to contacts, with outcome)
-- ---------------------------------------------------------------------------

create table appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  source text not null default 'landing',  -- landing | dashboard
  google_event_id text,
  meet_link text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  attendee jsonb not null default '{}',
  outcome appointment_outcome not null default 'pending',
  cancel_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

create index on appointments (workspace_id, starts_at);
create index on appointments (contact_id);

-- ---------------------------------------------------------------------------
-- Follow-up sequence steps (the editable "sequence tool")
-- ---------------------------------------------------------------------------

create table followup_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  trigger followup_trigger not null,
  -- before_meeting: minutes BEFORE start time; after_*: minutes AFTER the
  -- outcome is recorded; confirmation: ignored (sends immediately).
  offset_minutes integer not null default 0 check (offset_minutes >= 0),
  subject text not null,
  body text not null,            -- plain text with {{merge_tags}}
  enabled boolean not null default true,
  position integer not null default 1,
  created_at timestamptz not null default now()
);

create index on followup_steps (workspace_id, trigger);

-- Default follow-up sequence for every new workspace.
create or replace function seed_followup_steps()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into followup_steps (workspace_id, trigger, offset_minutes, subject, body, position) values
    (new.id, 'confirmation', 0,
     'Confirmed: your Implenix intro call — {{meeting_time}}',
     'Hi {{first_name}},' || E'\n\n' ||
     'Your call with Implenix is confirmed.' || E'\n\n' ||
     'When: {{meeting_time}}' || E'\n' ||
     'Google Meet: {{meet_link}}' || E'\n\n' ||
     'A calendar invite has been sent to this address. If you need to reschedule, just reply to this email.' || E'\n\n' ||
     'Talk soon,' || E'\n' || 'The Implenix team', 1),
    (new.id, 'before_meeting', 1440,
     'Tomorrow: your Implenix call — {{meeting_time}}',
     'Hi {{first_name}},' || E'\n\n' ||
     'A quick reminder about your call with Implenix tomorrow.' || E'\n\n' ||
     'When: {{meeting_time}}' || E'\n' ||
     'Google Meet: {{meet_link}}' || E'\n\n' ||
     'See you then,' || E'\n' || 'The Implenix team', 1),
    (new.id, 'before_meeting', 720,
     'Today: your Implenix call — {{meeting_time}}',
     'Hi {{first_name}},' || E'\n\n' ||
     'Your Implenix call is coming up today.' || E'\n\n' ||
     'When: {{meeting_time}}' || E'\n' ||
     'Google Meet: {{meet_link}}' || E'\n\n' ||
     'See you soon,' || E'\n' || 'The Implenix team', 2),
    (new.id, 'before_meeting', 180,
     'In 3 hours: your Implenix call',
     'Hi {{first_name}},' || E'\n\n' ||
     'Your call with Implenix starts in about 3 hours.' || E'\n\n' ||
     'When: {{meeting_time}}' || E'\n' ||
     'Google Meet: {{meet_link}}' || E'\n\n' ||
     'The Implenix team', 3),
    (new.id, 'before_meeting', 10,
     'Starting soon: your Implenix call',
     'Hi {{first_name}},' || E'\n\n' ||
     'Your call starts in 10 minutes. Join here when you''re ready:' || E'\n\n' ||
     '{{meet_link}}' || E'\n\n' ||
     'The Implenix team', 4),
    (new.id, 'after_showed', 60,
     'Great speaking with you, {{first_name}}',
     'Hi {{first_name}},' || E'\n\n' ||
     'Thank you for taking the time today. As discussed, we''ll follow up with the next steps for {{practice_type}} billing.' || E'\n\n' ||
     'If any questions come up in the meantime, just reply to this email.' || E'\n\n' ||
     'Best,' || E'\n' || 'The Implenix team', 1),
    (new.id, 'after_no_show', 30,
     'Sorry we missed you — shall we rebook?',
     'Hi {{first_name}},' || E'\n\n' ||
     'Looks like today didn''t work out — no problem at all.' || E'\n\n' ||
     'You can grab a new time that suits you here: {{booking_link}}' || E'\n\n' ||
     'Best,' || E'\n' || 'The Implenix team', 1);
  return new;
end;
$$;

create trigger on_workspace_created_seed_followups
  after insert on workspaces
  for each row execute function seed_followup_steps();

revoke execute on function seed_followup_steps() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Messages & email events (v2: contact-scoped)
-- ---------------------------------------------------------------------------

create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  followup_step_id uuid references followup_steps(id) on delete set null,
  direction message_direction not null,
  resend_id text,
  smtp_message_id text,
  in_reply_to text,
  from_email text not null,
  to_email text not null,
  subject text,
  body_text text,
  body_html text,
  status text not null default 'queued',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index on messages (workspace_id, created_at);
create index on messages (contact_id, created_at);
create index on messages (resend_id);
create index on messages (smtp_message_id);

create table email_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  message_id uuid references messages(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create index on email_events (workspace_id, event_type, occurred_at);
create index on email_events (message_id);

-- ---------------------------------------------------------------------------
-- Agent actions (inbound reply triage — approval inbox)
-- ---------------------------------------------------------------------------

create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  inbound_message_id uuid references messages(id) on delete set null,
  classification reply_category not null,
  confidence numeric(4,3) not null,
  extracted jsonb not null default '{}',
  draft_subject text,
  draft_body text,
  action text not null,
  status agent_action_status not null default 'pending',
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index on agent_actions (workspace_id, status, created_at);

-- ---------------------------------------------------------------------------
-- Site analytics (first-party, no cookies)
-- ---------------------------------------------------------------------------

create table site_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null default 'pageview',  -- pageview | booking_started | booking_completed
  page text not null,
  referrer text,
  utm jsonb not null default '{}',
  visitor_hash text,             -- daily-rotating anonymous hash (no PII)
  occurred_at timestamptz not null default now()
);

create index on site_events (event_type, occurred_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table contacts enable row level security;
alter table appointments enable row level security;
alter table followup_steps enable row level security;
alter table messages enable row level security;
alter table email_events enable row level security;
alter table agent_actions enable row level security;
alter table site_events enable row level security;  -- no user policies: API only

create policy "members full access contacts" on contacts
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy "members full access appointments" on appointments
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy "members full access followup_steps" on followup_steps
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy "members read messages" on messages
  for select using (is_workspace_member(workspace_id));

create policy "members read email_events" on email_events
  for select using (is_workspace_member(workspace_id));

create policy "members read agent_actions" on agent_actions
  for select using (is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Funnel stats
-- ---------------------------------------------------------------------------

create or replace function funnel_stats(ws uuid, since timestamptz)
returns jsonb
language sql stable
set search_path = public
as $$
select jsonb_build_object(
  'site', jsonb_build_object(
    'pageviews',        (select count(*) from site_events where event_type = 'pageview' and occurred_at >= since),
    'visitors',         (select count(distinct visitor_hash) from site_events where event_type = 'pageview' and occurred_at >= since),
    'booking_started',  (select count(*) from site_events where event_type = 'booking_started' and occurred_at >= since),
    'booking_completed',(select count(*) from site_events where event_type = 'booking_completed' and occurred_at >= since)
  ),
  'funnel', jsonb_build_object(
    'contacts',    (select count(*) from contacts where workspace_id = ws and created_at >= since),
    'booked',      (select count(*) from appointments where workspace_id = ws and created_at >= since),
    'upcoming',    (select count(*) from appointments where workspace_id = ws and outcome = 'pending' and starts_at >= now()),
    'showed',      (select count(*) from appointments where workspace_id = ws and outcome = 'showed' and created_at >= since),
    'no_show',     (select count(*) from appointments where workspace_id = ws and outcome = 'no_show' and created_at >= since),
    'cancelled',   (select count(*) from appointments where workspace_id = ws and outcome = 'cancelled' and created_at >= since),
    'negotiating', (select count(*) from contacts where workspace_id = ws and stage = 'negotiating'),
    'closed_won',  (select count(*) from contacts where workspace_id = ws and stage = 'closed_won')
  ),
  'email', coalesce((
    select jsonb_agg(row_to_json(t) order by t.trigger, t.position)
    from (
      select f.id as step_id, f.trigger, f.position, f.subject,
             count(m.id) as sent,
             count(distinct eo.message_id) as opened,
             count(distinct ec.message_id) as clicked
      from followup_steps f
      left join messages m on m.followup_step_id = f.id and m.created_at >= since
      left join email_events eo on eo.message_id = m.id and eo.event_type = 'opened'
      left join email_events ec on ec.message_id = m.id and ec.event_type = 'clicked'
      where f.workspace_id = ws
      group by f.id, f.trigger, f.position, f.subject
    ) t
  ), '[]'::jsonb)
);
$$;

revoke execute on function funnel_stats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function funnel_stats(uuid, timestamptz) to service_role;

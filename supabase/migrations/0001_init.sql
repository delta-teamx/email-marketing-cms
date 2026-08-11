-- Implenix marketing platform — initial schema
-- Postgres 15 / Supabase

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type campaign_status as enum ('draft', 'active', 'paused', 'archived');
create type campaign_mode as enum ('full_auto', 'review_first');
create type lead_status as enum ('active', 'paused', 'finished', 'suppressed');
create type message_direction as enum ('outbound', 'inbound');
create type reply_category as enum ('interested', 'neutral', 'not_interested', 'dnc', 'out_of_office', 'wrong_person');
create type template_category as enum ('interested', 'neutral', 'not_interested', 'dnc');
create type agent_action_status as enum ('pending', 'completed', 'rejected');
create type appointment_source as enum ('landing', 'agent');
create type appointment_status as enum ('confirmed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Workspaces & membership
-- ---------------------------------------------------------------------------

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function is_workspace_member(ws uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

-- Auto-provision a workspace for every new auth user.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
begin
  insert into workspaces (name)
  values (coalesce(split_part(new.email, '@', 1), 'My workspace'))
  returning id into ws;
  insert into workspace_members (workspace_id, user_id, role)
  values (ws, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  status campaign_status not null default 'draft',
  mode campaign_mode not null default 'review_first',

  -- Sending identity. Outreach is restricted to the dedicated subdomains.
  sending_domain text not null default 'e.implenix.net'
    check (sending_domain in ('e.implenix.net', 'm.implenix.net', 's.implenix.net')),
  from_name text not null default 'Implenix',
  from_local_part text not null default 'hello',  -- hello@e.implenix.net

  -- Schedule & throttling
  timezone text not null default 'America/New_York',
  send_window_start smallint not null default 9  check (send_window_start between 0 and 23),
  send_window_end   smallint not null default 17 check (send_window_end between 1 and 24),
  send_days smallint[] not null default '{1,2,3,4,5}', -- ISO weekday, 1 = Monday
  daily_cap integer not null default 50 check (daily_cap > 0),
  warmup_enabled boolean not null default true,
  warmup_start integer not null default 10,
  warmup_increment integer not null default 5,
  warmup_started_at date,

  -- Agent config
  confidence_threshold numeric(3,2) not null default 0.75,
  -- Categories the agent may handle without human approval when mode = full_auto
  auto_categories reply_category[] not null
    default '{neutral,not_interested,dnc,out_of_office,wrong_person}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on campaigns (workspace_id);

-- ---------------------------------------------------------------------------
-- Sequence copy (human-provided; agents never write copy)
-- ---------------------------------------------------------------------------

create table sequence_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_no integer not null check (step_no >= 1),
  delay_days integer not null default 3 check (delay_days >= 0),
  unique (campaign_id, step_no)
);

create table copy_variants (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references sequence_steps(id) on delete cascade,
  label text not null default 'A',
  subject text not null,
  body text not null,           -- plain text with {{merge_tags}}
  weight integer not null default 1 check (weight >= 1),
  enabled boolean not null default true
);

create index on copy_variants (step_id);

create table reply_templates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  category template_category not null,
  body text not null,
  unique (campaign_id, category)
);

-- ---------------------------------------------------------------------------
-- Pipeline
-- ---------------------------------------------------------------------------

create table pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  key text not null,
  name text not null,
  position integer not null,
  is_terminal boolean not null default false,
  unique (campaign_id, key)
);

create or replace function seed_pipeline_stages()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into pipeline_stages (campaign_id, key, name, position, is_terminal) values
    (new.id, 'new',            'New',                 1,  false),
    (new.id, 'contacted',      'Contacted',           2,  false),
    (new.id, 'opened',         'Opened',              3,  false),
    (new.id, 'replied',        'Replied',             4,  false),
    (new.id, 'interested',     'Interested',          5,  false),
    (new.id, 'meeting_booked', 'Meeting Booked',      6,  false),
    (new.id, 'negotiating',    'Negotiating',         7,  false),
    (new.id, 'sale_closed',    'Sale Closed',         8,  true),
    (new.id, 'not_interested', 'Not Interested',      9,  true),
    (new.id, 'dnc',            'DNC',                 10, true),
    (new.id, 'bounced',        'Bounced / Bad Email', 11, true);
  return new;
end;
$$;

create trigger on_campaign_created
  after insert on campaigns
  for each row execute function seed_pipeline_stages();

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  company text,
  title text,
  phone text,
  custom_fields jsonb not null default '{}',

  stage_key text not null default 'new',
  status lead_status not null default 'active',
  current_step integer not null default 0,     -- last sequence step sent
  next_send_at timestamptz,                    -- null once sequence finished/stopped
  snoozed_until timestamptz,                   -- OOO handling
  last_replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create index on leads (campaign_id, status, next_send_at);
create index on leads (workspace_id);
create index on leads (email);

-- ---------------------------------------------------------------------------
-- Messages & events
-- ---------------------------------------------------------------------------

create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  direction message_direction not null,
  resend_id text,                -- Resend message id (outbound)
  smtp_message_id text,          -- RFC 5322 Message-ID header
  in_reply_to text,
  step_no integer,
  variant_id uuid references copy_variants(id) on delete set null,
  template_category template_category,
  from_email text not null,
  to_email text not null,
  subject text,
  body_text text,
  body_html text,
  status text not null default 'queued', -- queued|sent|delivered|bounced|received
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index on messages (lead_id, created_at);
create index on messages (campaign_id, direction, created_at);
create index on messages (resend_id);
create index on messages (smtp_message_id);

create table email_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  message_id uuid references messages(id) on delete cascade,
  event_type text not null,      -- delivered|opened|clicked|bounced|complained
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create index on email_events (campaign_id, event_type, occurred_at);
create index on email_events (message_id);

-- ---------------------------------------------------------------------------
-- Agent actions (audit log + approval inbox)
-- ---------------------------------------------------------------------------

create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  inbound_message_id uuid references messages(id) on delete set null,

  classification reply_category not null,
  confidence numeric(4,3) not null,
  extracted jsonb not null default '{}',   -- proposed_times, summary, ooo_return_date…

  template_category template_category,
  draft_subject text,
  draft_body text,

  action text not null,   -- auto_replied|queued_for_approval|approved_sent|rejected|suppressed|booked_meeting|snoozed|closed
  status agent_action_status not null default 'completed',
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index on agent_actions (campaign_id, status, created_at);
create index on agent_actions (workspace_id, status);

-- ---------------------------------------------------------------------------
-- Appointments (landing-page bookings + agent bookings)
-- ---------------------------------------------------------------------------

create table appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade, -- null for landing-page bookings
  campaign_id uuid references campaigns(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  source appointment_source not null,
  google_event_id text,
  meet_link text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  attendee jsonb not null default '{}',    -- name, email, phone, practice, specialty, notes, timezone
  status appointment_status not null default 'confirmed',
  cancel_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

create index on appointments (starts_at);
create index on appointments (workspace_id);

-- ---------------------------------------------------------------------------
-- Suppression / DNC
-- ---------------------------------------------------------------------------

create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade, -- null = global
  email text not null,
  reason text not null,          -- unsubscribe|dnc_reply|hard_bounce|complaint|manual
  created_at timestamptz not null default now()
);

create unique index suppression_unique on suppression_list (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), email);
create index on suppression_list (email);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table campaigns enable row level security;
alter table sequence_steps enable row level security;
alter table copy_variants enable row level security;
alter table reply_templates enable row level security;
alter table pipeline_stages enable row level security;
alter table leads enable row level security;
alter table messages enable row level security;
alter table email_events enable row level security;
alter table agent_actions enable row level security;
alter table appointments enable row level security;
alter table suppression_list enable row level security;

create policy "members read workspace" on workspaces
  for select using (is_workspace_member(id));

create policy "members read own membership" on workspace_members
  for select using (user_id = auth.uid());

create policy "members full access campaigns" on campaigns
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy "members full access sequence_steps" on sequence_steps
  for all using (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)));

create policy "members full access copy_variants" on copy_variants
  for all using (exists (
    select 1 from sequence_steps s join campaigns c on c.id = s.campaign_id
    where s.id = step_id and is_workspace_member(c.workspace_id)))
  with check (exists (
    select 1 from sequence_steps s join campaigns c on c.id = s.campaign_id
    where s.id = step_id and is_workspace_member(c.workspace_id)));

create policy "members full access reply_templates" on reply_templates
  for all using (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)));

create policy "members read pipeline_stages" on pipeline_stages
  for select using (exists (select 1 from campaigns c where c.id = campaign_id and is_workspace_member(c.workspace_id)));

create policy "members full access leads" on leads
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy "members read messages" on messages
  for select using (is_workspace_member(workspace_id));

create policy "members read email_events" on email_events
  for select using (is_workspace_member(workspace_id));

create policy "members read agent_actions" on agent_actions
  for select using (is_workspace_member(workspace_id));

create policy "members read appointments" on appointments
  for select using (workspace_id is not null and is_workspace_member(workspace_id));

create policy "members manage suppression" on suppression_list
  for all using (workspace_id is not null and is_workspace_member(workspace_id))
  with check (workspace_id is not null and is_workspace_member(workspace_id));

-- The API (service role) bypasses RLS for the send engine, webhooks, and agent.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger campaigns_touch before update on campaigns
  for each row execute function touch_updated_at();
create trigger leads_touch before update on leads
  for each row execute function touch_updated_at();

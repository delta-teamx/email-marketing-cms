-- Campaign analytics rollup, called by the API (service role) via RPC.

create or replace function campaign_stats(cid uuid)
returns jsonb
language sql stable
set search_path = public
as $$
select jsonb_build_object(
  'funnel', jsonb_build_object(
    'leads',     (select count(*) from leads where campaign_id = cid),
    'contacted', (select count(distinct lead_id) from messages where campaign_id = cid and direction = 'outbound'),
    'sent',      (select count(*) from messages where campaign_id = cid and direction = 'outbound'),
    'delivered', (select count(distinct message_id) from email_events where campaign_id = cid and event_type = 'delivered'),
    'opened',    (select count(distinct message_id) from email_events where campaign_id = cid and event_type = 'opened'),
    'clicked',   (select count(distinct message_id) from email_events where campaign_id = cid and event_type = 'clicked'),
    'replied',   (select count(distinct lead_id) from messages where campaign_id = cid and direction = 'inbound'),
    'interested',(select count(*) from leads where campaign_id = cid and stage_key in ('interested','meeting_booked','negotiating','sale_closed')),
    'meetings',  (select count(*) from leads where campaign_id = cid and stage_key in ('meeting_booked','negotiating','sale_closed')),
    'closed',    (select count(*) from leads where campaign_id = cid and stage_key = 'sale_closed')
  ),
  'byStep', coalesce((
    select jsonb_agg(row_to_json(t) order by t.step_no)
    from (
      select m.step_no,
             count(m.id) as sent,
             count(distinct eo.message_id) as opened,
             count(distinct mi.lead_id) as replied
      from messages m
      left join email_events eo on eo.message_id = m.id and eo.event_type = 'opened'
      left join messages mi on mi.lead_id = m.lead_id and mi.direction = 'inbound' and mi.created_at > m.created_at
      where m.campaign_id = cid and m.direction = 'outbound' and m.step_no is not null
      group by m.step_no
    ) t
  ), '[]'::jsonb),
  'byVariant', coalesce((
    select jsonb_agg(row_to_json(t) order by t.step_no, t.label)
    from (
      select v.id as variant_id, v.label, s.step_no,
             count(m.id) as sent,
             count(distinct eo.message_id) as opened,
             count(distinct mi.lead_id) as replied
      from copy_variants v
      join sequence_steps s on s.id = v.step_id
      left join messages m on m.variant_id = v.id
      left join email_events eo on eo.message_id = m.id and eo.event_type = 'opened'
      left join messages mi on mi.lead_id = m.lead_id and mi.direction = 'inbound' and mi.created_at > m.created_at
      where s.campaign_id = cid
      group by v.id, v.label, s.step_no
    ) t
  ), '[]'::jsonb)
);
$$;

-- Only the service role (API) may call this; it enforces workspace access itself.
revoke execute on function campaign_stats(uuid) from public;
revoke execute on function campaign_stats(uuid) from anon;
revoke execute on function campaign_stats(uuid) from authenticated;
grant execute on function campaign_stats(uuid) to service_role;

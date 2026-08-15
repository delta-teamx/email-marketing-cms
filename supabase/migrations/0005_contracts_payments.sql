-- Contracts (BAA / service agreements with click-to-sign) and
-- practitioner payment tracking.

create type contract_status as enum ('draft', 'sent', 'viewed', 'signed', 'declined', 'voided');
create type payment_status as enum ('due', 'paid', 'overdue', 'waived');

-- ---------------------------------------------------------------------------
-- Contract templates (editable; seeded with a standard BAA)
-- ---------------------------------------------------------------------------

create table contract_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null default 'baa',       -- baa | service_agreement | other
  title text not null,
  body text not null,                     -- markdown-ish text with {{merge_tags}}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on contract_templates (workspace_id);
create trigger contract_templates_touch before update on contract_templates
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Contracts sent to practitioners
-- ---------------------------------------------------------------------------

create table contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  template_id uuid references contract_templates(id) on delete set null,
  kind text not null default 'baa',
  title text not null,
  body_snapshot text not null,            -- rendered body at send time (immutable record)
  status contract_status not null default 'draft',
  sign_token text not null default encode(gen_random_bytes(24), 'hex'),
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  signer_name text,
  signer_title text,
  signer_ip text,
  declined_reason text,
  created_at timestamptz not null default now()
);

create unique index contracts_sign_token on contracts (sign_token);
create index on contracts (workspace_id, status);
create index on contracts (contact_id);

-- ---------------------------------------------------------------------------
-- Payments (manual ledger per client)
-- ---------------------------------------------------------------------------

create table payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  period text,                            -- e.g. "2026-09" for monthly billing
  description text,
  status payment_status not null default 'due',
  due_date date,
  paid_at timestamptz,
  method text,                            -- ach | check | card | wire | other
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on payments (workspace_id, status, due_date);
create index on payments (contact_id);
create trigger payments_touch before update on payments
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seed a standard BAA template for every new workspace
-- ---------------------------------------------------------------------------

create or replace function seed_contract_templates()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into contract_templates (workspace_id, kind, title, body) values
  (new.id, 'baa', 'Business Associate Agreement (HIPAA)',
'BUSINESS ASSOCIATE AGREEMENT

This Business Associate Agreement ("Agreement") is entered into as of {{effective_date}} ("Effective Date") by and between:

Covered Entity: {{practice_name}}, with its principal place of business at {{practice_address}} ("Covered Entity"), and

Business Associate: Implenix, 1879 NW 8th St, Miami, FL 33125 ("Business Associate").

RECITALS

Covered Entity wishes to engage Business Associate to provide medical billing and revenue cycle management services, and in connection with such services Business Associate may create, receive, maintain, or transmit Protected Health Information ("PHI") on behalf of Covered Entity. The parties enter into this Agreement to comply with the Health Insurance Portability and Accountability Act of 1996 ("HIPAA"), the HITECH Act, and their implementing regulations (45 CFR Parts 160 and 164).

1. DEFINITIONS
Terms used but not otherwise defined in this Agreement shall have the meanings given to them in HIPAA.

2. PERMITTED USES AND DISCLOSURES
Business Associate may use or disclose PHI only as necessary to perform the billing and revenue cycle services described in the underlying service arrangement, as required by law, or as otherwise permitted by this Agreement. Business Associate shall apply the minimum-necessary standard to all uses and disclosures of PHI.

3. SAFEGUARDS
Business Associate shall implement administrative, physical, and technical safeguards that reasonably and appropriately protect the confidentiality, integrity, and availability of PHI, in accordance with the HIPAA Security Rule.

4. REPORTING
Business Associate shall report to Covered Entity any use or disclosure of PHI not permitted by this Agreement, any Security Incident, and any Breach of Unsecured PHI without unreasonable delay and in no case later than thirty (30) days after discovery.

5. SUBCONTRACTORS
Business Associate shall ensure that any subcontractor that creates, receives, maintains, or transmits PHI on behalf of Business Associate agrees in writing to restrictions and conditions at least as stringent as those that apply to Business Associate under this Agreement.

6. ACCESS, AMENDMENT, AND ACCOUNTING
Business Associate shall make PHI available to Covered Entity as necessary to satisfy Covered Entity''s obligations under 45 CFR 164.524 (access), 164.526 (amendment), and 164.528 (accounting of disclosures).

7. GOVERNMENT ACCESS
Business Associate shall make its internal practices, books, and records relating to the use and disclosure of PHI available to the Secretary of Health and Human Services for purposes of determining compliance with HIPAA.

8. TERM AND TERMINATION
This Agreement is effective as of the Effective Date and shall terminate when all PHI is destroyed or returned to Covered Entity. Covered Entity may terminate this Agreement if Business Associate materially breaches it and fails to cure within thirty (30) days of written notice. Upon termination, Business Associate shall return or destroy all PHI, or, where return or destruction is infeasible, extend the protections of this Agreement to such PHI for as long as it is retained.

9. MISCELLANEOUS
This Agreement shall be interpreted to permit compliance with HIPAA. Any ambiguity shall be resolved in favor of a meaning that complies with HIPAA. This Agreement is governed by the laws of the State of Florida, without regard to conflict-of-law principles.

AGREED AND ACCEPTED

Covered Entity: {{practice_name}}
Signer: {{signer_name}}, {{signer_title}}

Business Associate: Implenix'),
  (new.id, 'service_agreement', 'Billing Services Agreement',
'BILLING SERVICES AGREEMENT

This Billing Services Agreement is entered into as of {{effective_date}} between Implenix, 1879 NW 8th St, Miami, FL 33125 ("Implenix"), and {{practice_name}}, {{practice_address}} ("Client").

1. SERVICES. Implenix will provide medical billing and revenue cycle management services including claims submission, denial management, accounts receivable follow-up, payment posting, and related reporting.

2. FEES. Client shall pay Implenix the fee set forth in the accompanying proposal, invoiced monthly as a percentage of monthly collections. [Customize this section with the agreed rate before sending.]

3. TERM. This Agreement begins on the Effective Date and continues month to month until terminated by either party with thirty (30) days'' written notice.

4. HIPAA. The parties'' Business Associate Agreement is incorporated by reference.

5. CONFIDENTIALITY. Each party shall protect the other party''s confidential information with no less than reasonable care.

AGREED AND ACCEPTED

Client: {{practice_name}}
Signer: {{signer_name}}, {{signer_title}}

Implenix');
  return new;
end;
$$;

create trigger on_workspace_created_seed_contracts
  after insert on workspaces
  for each row execute function seed_contract_templates();

revoke execute on function seed_contract_templates() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table contract_templates enable row level security;
alter table contracts enable row level security;
alter table payments enable row level security;

create policy "members full access contract_templates" on contract_templates
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy "members read contracts" on contracts
  for select using (is_workspace_member(workspace_id));

create policy "members full access payments" on payments
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

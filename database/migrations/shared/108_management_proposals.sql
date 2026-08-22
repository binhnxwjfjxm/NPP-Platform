CREATE TABLE IF NOT EXISTS shared.management_proposals (
  id text PRIMARY KEY,
  installation_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('company', 'mcp')),
  domain text NOT NULL CHECK (domain IN ('commercial', 'customer-debt', 'operations', 'mcp')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  entity_type text NOT NULL CHECK (length(btrim(entity_type)) BETWEEN 1 AND 96),
  entity_id text NOT NULL CHECK (length(btrim(entity_id)) BETWEEN 1 AND 240),
  entity_label text NOT NULL CHECK (length(btrim(entity_label)) BETWEEN 1 AND 240),
  impact text NOT NULL CHECK (length(btrim(impact)) BETWEEN 1 AND 1000),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 4000),
  rule_text text NOT NULL CHECK (length(btrim(rule_text)) BETWEEN 1 AND 1000),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'needs-info', 'approved', 'rejected')),
  requester_actor_id text NOT NULL,
  requester_employee_id text,
  requester_name text NOT NULL CHECK (length(btrim(requester_name)) BETWEEN 1 AND 240),
  decision_note text,
  decided_by_actor_id text,
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT management_proposals_installation_id_unique UNIQUE (installation_id, id)
);

CREATE INDEX IF NOT EXISTS management_proposals_installation_status_idx
  ON shared.management_proposals (installation_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS management_proposals_installation_domain_idx
  ON shared.management_proposals (installation_id, domain, updated_at DESC);
CREATE INDEX IF NOT EXISTS management_proposals_entity_idx
  ON shared.management_proposals (installation_id, source, domain, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS shared.management_proposal_events (
  id text PRIMARY KEY,
  installation_id text NOT NULL,
  proposal_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('submitted', 'decision', 'resubmitted')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('pending', 'needs-info', 'approved', 'rejected')),
  to_status text NOT NULL CHECK (to_status IN ('pending', 'needs-info', 'approved', 'rejected')),
  actor_id text NOT NULL,
  employee_id text,
  actor_label text NOT NULL CHECK (length(btrim(actor_label)) BETWEEN 1 AND 240),
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT management_proposal_events_proposal_fk
    FOREIGN KEY (installation_id, proposal_id)
    REFERENCES shared.management_proposals (installation_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS management_proposal_events_history_idx
  ON shared.management_proposal_events (installation_id, proposal_id, occurred_at ASC, id ASC);

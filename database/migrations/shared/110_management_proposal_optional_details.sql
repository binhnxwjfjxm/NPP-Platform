-- Management Proposal UX hardening: only title/content are mandatory business input.
-- Keep optional metadata as non-null strings for backward-compatible readers, but allow empty values.

ALTER TABLE shared.management_proposals
  DROP CONSTRAINT IF EXISTS management_proposals_entity_id_check,
  DROP CONSTRAINT IF EXISTS management_proposals_entity_label_check,
  DROP CONSTRAINT IF EXISTS management_proposals_impact_check,
  DROP CONSTRAINT IF EXISTS management_proposals_reason_check,
  DROP CONSTRAINT IF EXISTS management_proposals_rule_text_check;

ALTER TABLE shared.management_proposals
  ALTER COLUMN entity_id SET DEFAULT '',
  ALTER COLUMN entity_label SET DEFAULT '',
  ALTER COLUMN impact SET DEFAULT '',
  ALTER COLUMN reason SET DEFAULT '',
  ALTER COLUMN rule_text SET DEFAULT '';

ALTER TABLE shared.management_proposals
  ADD CONSTRAINT management_proposals_entity_id_check
    CHECK (length(btrim(entity_id)) <= 240),
  ADD CONSTRAINT management_proposals_entity_label_check
    CHECK (length(btrim(entity_label)) <= 240),
  ADD CONSTRAINT management_proposals_impact_check
    CHECK (length(btrim(impact)) <= 1000),
  ADD CONSTRAINT management_proposals_reason_check
    CHECK (length(btrim(reason)) <= 4000),
  ADD CONSTRAINT management_proposals_rule_text_check
    CHECK (length(btrim(rule_text)) <= 1000);

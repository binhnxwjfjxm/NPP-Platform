-- MCP report-settings installation repair.
-- Production audit on 2026-08-17 confirmed the active MCP installation is
-- `npp-hung-phat`, while the exact legacy report-settings snapshot remains
-- under `mcp-plan-prod` (7 groups / 53 items). This migration copies only that
-- canonical snapshot into the active installation. It does not move or delete
-- the legacy snapshot and does not touch routes, sessions, customers or visits.
--
-- Snapshot SHA-256: 90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b
-- Source installation: mcp-plan-prod
-- Target installation: npp-hung-phat

DO $$
DECLARE
  v_source_group_count integer;
  v_source_item_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_source_group_count
  FROM mcp.mcp_report_setting_groups
  WHERE installation_id = 'mcp-plan-prod'
    AND raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b';

  SELECT count(*)::integer
  INTO v_source_item_count
  FROM mcp.mcp_report_settings AS source_item
  JOIN mcp.mcp_report_setting_groups AS source_group
    ON source_group.id = source_item.group_id
   AND source_group.installation_id = source_item.installation_id
  WHERE source_item.installation_id = 'mcp-plan-prod'
    AND source_group.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b'
    AND source_item.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b';

  IF v_source_group_count <> 7 OR v_source_item_count <> 53 THEN
    RAISE EXCEPTION 'mcp_report_settings_installation_repair_source_mismatch: groups=%, items=%',
      v_source_group_count,
      v_source_item_count;
  END IF;
END
$$;

INSERT INTO mcp.mcp_report_setting_groups (
  installation_id,
  group_key,
  group_name,
  description,
  sort_order,
  active,
  raw_payload,
  created_at,
  updated_at
)
SELECT
  'npp-hung-phat',
  source_group.group_key,
  source_group.group_name,
  source_group.description,
  source_group.sort_order,
  source_group.active,
  source_group.raw_payload,
  source_group.created_at,
  source_group.updated_at
FROM mcp.mcp_report_setting_groups AS source_group
WHERE source_group.installation_id = 'mcp-plan-prod'
  AND source_group.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b'
ON CONFLICT (installation_id, group_key) DO NOTHING;

INSERT INTO mcp.mcp_report_settings (
  installation_id,
  group_id,
  setting_key,
  setting_name,
  value,
  value_type,
  options,
  required,
  sort_order,
  active,
  raw_payload,
  created_at,
  updated_at
)
SELECT
  'npp-hung-phat',
  target_group.id,
  source_item.setting_key,
  source_item.setting_name,
  source_item.value,
  source_item.value_type,
  source_item.options,
  source_item.required,
  source_item.sort_order,
  source_item.active,
  source_item.raw_payload,
  source_item.created_at,
  source_item.updated_at
FROM mcp.mcp_report_settings AS source_item
JOIN mcp.mcp_report_setting_groups AS source_group
  ON source_group.id = source_item.group_id
 AND source_group.installation_id = source_item.installation_id
JOIN mcp.mcp_report_setting_groups AS target_group
  ON target_group.installation_id = 'npp-hung-phat'
 AND target_group.group_key = source_group.group_key
WHERE source_item.installation_id = 'mcp-plan-prod'
  AND source_group.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b'
  AND source_item.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b'
ON CONFLICT (installation_id, group_id, setting_key) DO NOTHING;

DO $$
DECLARE
  v_missing_group_count integer;
  v_missing_item_count integer;
  v_source_group_count integer;
  v_source_item_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_missing_group_count
  FROM mcp.mcp_report_setting_groups AS source_group
  LEFT JOIN mcp.mcp_report_setting_groups AS target_group
    ON target_group.installation_id = 'npp-hung-phat'
   AND target_group.group_key = source_group.group_key
  WHERE source_group.installation_id = 'mcp-plan-prod'
    AND source_group.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b'
    AND target_group.id IS NULL;

  SELECT count(*)::integer
  INTO v_missing_item_count
  FROM mcp.mcp_report_settings AS source_item
  JOIN mcp.mcp_report_setting_groups AS source_group
    ON source_group.id = source_item.group_id
   AND source_group.installation_id = source_item.installation_id
  JOIN mcp.mcp_report_setting_groups AS target_group
    ON target_group.installation_id = 'npp-hung-phat'
   AND target_group.group_key = source_group.group_key
  LEFT JOIN mcp.mcp_report_settings AS target_item
    ON target_item.installation_id = 'npp-hung-phat'
   AND target_item.group_id = target_group.id
   AND target_item.setting_key = source_item.setting_key
  WHERE source_item.installation_id = 'mcp-plan-prod'
    AND source_group.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b'
    AND source_item.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b'
    AND target_item.id IS NULL;

  SELECT count(*)::integer
  INTO v_source_group_count
  FROM mcp.mcp_report_setting_groups
  WHERE installation_id = 'mcp-plan-prod'
    AND raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b';

  SELECT count(*)::integer
  INTO v_source_item_count
  FROM mcp.mcp_report_settings AS source_item
  JOIN mcp.mcp_report_setting_groups AS source_group
    ON source_group.id = source_item.group_id
   AND source_group.installation_id = source_item.installation_id
  WHERE source_item.installation_id = 'mcp-plan-prod'
    AND source_group.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b'
    AND source_item.raw_payload->>'legacy_snapshot_sha256' = '90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b';

  IF v_missing_group_count <> 0 OR v_missing_item_count <> 0 THEN
    RAISE EXCEPTION 'mcp_report_settings_installation_repair_target_incomplete: groups=%, items=%',
      v_missing_group_count,
      v_missing_item_count;
  END IF;

  IF v_source_group_count <> 7 OR v_source_item_count <> 53 THEN
    RAISE EXCEPTION 'mcp_report_settings_installation_repair_source_changed: groups=%, items=%',
      v_source_group_count,
      v_source_item_count;
  END IF;
END
$$;

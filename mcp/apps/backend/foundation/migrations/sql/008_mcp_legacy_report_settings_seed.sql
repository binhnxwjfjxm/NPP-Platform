-- MCP legacy report settings snapshot
-- Source: supabase:noiadkpkvdohljgopgfb
-- Snapshot SHA-256: 90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b
-- Exact source counts: 7 groups, 53 items (52 active, 1 inactive).
-- This migration preserves legacy IDs, keys, labels, values, ordering, statuses,
-- timestamps and metadata. It does not delete operator-created settings.

ALTER TABLE mcp.mcp_report_settings
  DROP CONSTRAINT IF EXISTS mcp_report_settings_key_unique;

CREATE UNIQUE INDEX IF NOT EXISTS mcp_report_settings_group_key_unique
  ON mcp.mcp_report_settings (installation_id, group_id, setting_key);

WITH source_groups (
  installation_id,
  legacy_id,
  group_key,
  group_name,
  description,
  sort_order,
  active,
  raw_payload,
  created_at,
  updated_at
) AS (
  VALUES
    ('mcp-plan-prod', 'msg_0687516286014cc5b77cf667b6c9f349', 'market_competitors', 'Đối thủ', 'Danh sách đối thủ tick nhanh khi báo cáo thị trường', 10, TRUE, '{"section":"competitor","group_type":"market_report","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msg_a3770c16340342fd9eead4d43462c777', 'used_syrup', 'SP đang dùng · Siro', 'Brand siro khách đang dùng', 20, TRUE, '{"section":"used_product","category":"Siro","group_type":"market_report","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msg_d89e10313bed4fc0a478ea1754ab5644', 'used_smoothie', 'SP đang dùng · Sinh tố', 'Brand sinh tố khách đang dùng', 30, TRUE, '{"section":"used_product","category":"Sinh tố","group_type":"market_report","legacy_group_id":"msg_d89e10313bed4fc0a478ea1754ab5644","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msg_dff8c8f0d2c24a58b956a4009be701ed', 'used_tea', 'SP đang dùng · Trà', 'Nhóm trà khách đang dùng', 40, TRUE, '{"section":"used_product","category":"Trà","group_type":"market_report","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msg_cbba014940bd4cc88815282bc39b8481', 'used_milk', 'SP đang dùng · Sữa', 'Sữa, bột sữa, kem béo khách đang dùng', 50, TRUE, '{"section":"used_product","category":"Sữa","group_type":"market_report","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msg_ec6628edbaa4462bb1725c69cfd40ea7', 'used_topping', 'SP đang dùng · Topping', 'Topping khách đang dùng', 60, TRUE, '{"section":"used_product","category":"Topping","group_type":"market_report","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msg_96f0ec629d074cf7a44cf60dbc0d25c3', 'report_fields', 'Field báo cáo', 'Các field nhập nhanh trong form báo cáo', 90, TRUE, '{"section":"fields","group_type":"market_report","legacy_group_id":"msg_96f0ec629d074cf7a44cf60dbc0d25c3","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz)
)
INSERT INTO mcp.mcp_report_setting_groups (
  id,
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
  legacy_id,
  installation_id,
  group_key,
  group_name,
  description,
  sort_order,
  active,
  raw_payload,
  created_at,
  updated_at
FROM source_groups
ON CONFLICT (installation_id, group_key) DO UPDATE
SET
  group_name = EXCLUDED.group_name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active,
  raw_payload = EXCLUDED.raw_payload,
  created_at = LEAST(mcp.mcp_report_setting_groups.created_at, EXCLUDED.created_at),
  updated_at = GREATEST(mcp.mcp_report_setting_groups.updated_at, EXCLUDED.updated_at);

WITH source_items (
  installation_id,
  legacy_id,
  group_key,
  setting_key,
  setting_name,
  setting_value,
  sort_order,
  active,
  raw_payload,
  created_at,
  updated_at
) AS (
  VALUES
    ('mcp-plan-prod', 'msi_b8403488cc42492c9895f96db4229964', 'market_competitors', 'hoa_vinh', 'Hoa Vinh', 'Long An', 0, TRUE, '{"category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_b8403488cc42492c9895f96db4229964","legacy_item_key":"hoa_vinh","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-15T16:28:39.460798+00:00'::timestamptz, '2026-07-15T16:28:39.460798+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_a1a9a74ae0134809ae3e5f33d9d1e57e', 'market_competitors', 'kho_nguyen_lieu', 'kho BT', 'kho Bến Tre', 0, TRUE, '{"foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_30f57733-de01-43e7-a405-a414c77124bf","receivedAt":"2026-07-19T00:28:51.481Z","idempotencyKey":"report-setting-item.patch:5b7fa1c4-cd4c-4bfc-8ae9-baa6b7b931dd","installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_a1a9a74ae0134809ae3e5f33d9d1e57e","legacy_item_key":"kho_nguyen_lieu","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-11T13:32:15.659536+00:00'::timestamptz, '2026-07-19T00:28:51.766353+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_20d7c2018e6747d5938955879635d1ac', 'market_competitors', 'ly_coi', 'Ly Cối', 'Đồng Tháp-DL của HP', 0, TRUE, '{"foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_e3354202-b555-4439-962d-d1511a172989","receivedAt":"2026-07-17T01:22:54.635Z","idempotencyKey":null,"installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_20d7c2018e6747d5938955879635d1ac","legacy_item_key":"ly_coi","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-16T03:04:27.751345+00:00'::timestamptz, '2026-07-17T01:22:55.302508+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_899690ec424342d08286d4ec574e71d1', 'market_competitors', 'moca', 'Moca', 'Gò Công', 0, TRUE, '{"foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_f664e3ee-150d-4ce3-b586-fc101142085d","receivedAt":"2026-07-17T01:22:36.213Z","idempotencyKey":null,"installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_899690ec424342d08286d4ec574e71d1","legacy_item_key":"moca","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-17T01:22:36.782097+00:00'::timestamptz, '2026-07-17T01:22:36.782097+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_acde3dc5cb3441e89032e9bc2da851dc', 'market_competitors', 'my_chi', 'Mỹ Chi', 'Long An', 0, TRUE, '{"category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_acde3dc5cb3441e89032e9bc2da851dc","legacy_item_key":"my_chi","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-15T16:28:54.451686+00:00'::timestamptz, '2026-07-15T16:28:54.451686+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_fb001c5df5584269bafbde06cd3bb703', 'market_competitors', 'thu_huong', 'Thu Hương', 'Thu Hương', 10, TRUE, '{"kind":"competitor","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_fb001c5df5584269bafbde06cd3bb703","legacy_item_key":"thu_huong","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_c66fe4d16d2b4eb282cc2293bdad897b', 'market_competitors', 'dai_ly_gan_nha', '336', 'Đại lý gần nhà', 20, TRUE, '{"kind":"competitor","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_c66fe4d16d2b4eb282cc2293bdad897b","legacy_item_key":"dai_ly_gan_nha","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-11T13:31:59.154+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_510fce37ca3449799610523c502eca5f', 'market_competitors', 'nguon_cho', 'Nguồn chợ / nguồn khác', 'Nguồn chợ / nguồn khác', 30, TRUE, '{"kind":"competitor","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_510fce37ca3449799610523c502eca5f","legacy_item_key":"nguon_cho","legacy_group_id":"msg_0687516286014cc5b77cf667b6c9f349","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_736e0e7a23714eb394f45d876eed6183', 'used_syrup', 'mama', 'Chang Thai', 'Chang Thai', 10, TRUE, '{"kind":"used_product","foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_750c4a73-c067-4972-b14f-a0b74a357d75","receivedAt":"2026-07-19T03:57:06.511Z","idempotencyKey":"report-setting-item.patch:685e8b86-9368-4fba-a216-b9cf0f5a170c","installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":"Siro","brand_name":"Mama","product_id":null,"legacy_item_id":"msi_736e0e7a23714eb394f45d876eed6183","legacy_item_key":"mama","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-19T03:57:06.64293+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_siro_mama', 'used_syrup', 'used_siro_mama', 'Mama', 'Mama', 10, TRUE, '{"source":"mcp_report_brand_chip","category":"Siro","brand_name":"Mama","product_id":null,"legacy_item_id":"used_siro_mama","legacy_item_key":"used_siro_mama","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_a8cfdb3069fc4a45be0ea5e72aa1cfb0', 'used_syrup', 'golden_farm', 'Golden Farm', 'Golden Farm', 20, TRUE, '{"kind":"used_product","category":"Siro","brand_name":"Golden Farm","product_id":null,"legacy_item_id":"msi_a8cfdb3069fc4a45be0ea5e72aa1cfb0","legacy_item_key":"golden_farm","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_siro_golden_farm', 'used_syrup', 'used_siro_golden_farm', 'Golden Farm', 'Golden Farm', 20, FALSE, '{"source":"mcp_report_brand_chip","foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_e163236b-be16-4cc7-9390-dce4bea414eb","receivedAt":"2026-07-19T04:01:45.800Z","idempotencyKey":"report-setting-item.patch:c875cabe-2b18-4733-8e1f-d77437da9061","installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":"Siro","brand_name":"Golden Farm","product_id":null,"legacy_item_id":"used_siro_golden_farm","legacy_item_key":"used_siro_golden_farm","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-19T04:01:46.061115+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_siro_vina', 'used_syrup', 'used_siro_vina', 'Dingfong', 'Ding Fong', 30, TRUE, '{"source":"mcp_report_brand_chip","foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_3868cbae-a36d-445c-9dd1-721210340bad","receivedAt":"2026-07-19T03:57:25.719Z","idempotencyKey":"report-setting-item.patch:162ca111-9672-4c63-97c5-ea142f2d1531","installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":"Siro","brand_name":"Vina","product_id":null,"legacy_item_id":"used_siro_vina","legacy_item_key":"used_siro_vina","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-19T03:57:25.992084+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_3c612dbc5bf04e8ab26fc02c817de294', 'used_syrup', 'vina', 'Vina', 'Vina', 30, TRUE, '{"kind":"used_product","category":"Siro","brand_name":"Vina","product_id":null,"legacy_item_id":"msi_3c612dbc5bf04e8ab26fc02c817de294","legacy_item_key":"vina","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_siro_torani', 'used_syrup', 'used_siro_torani', 'Em Bé', 'Em Bé', 40, TRUE, '{"source":"mcp_report_brand_chip","foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_be95c270-b78f-42a0-8bf3-5cf704c136bf","receivedAt":"2026-07-19T03:57:53.403Z","idempotencyKey":"report-setting-item.patch:433b3d6d-2562-4b69-a638-0695b4a2ca32","installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":"Siro","brand_name":"Torani","product_id":null,"legacy_item_id":"used_siro_torani","legacy_item_key":"used_siro_torani","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-19T03:57:53.684736+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_a53e533da51548f9961502fcdf4ab4f8', 'used_syrup', 'torani', 'Torani', 'Torani', 40, TRUE, '{"kind":"used_product","category":"Siro","brand_name":"Torani","product_id":null,"legacy_item_id":"msi_a53e533da51548f9961502fcdf4ab4f8","legacy_item_key":"torani","legacy_group_id":"msg_a3770c16340342fd9eead4d43462c777","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_fd8bd80c97c94689800b2c1b2da70abd', 'used_smoothie', 'berrino', 'Berrino', 'Berrino', 10, TRUE, '{"kind":"used_product","category":"Sinh tố","brand_name":"Berrino","product_id":null,"legacy_item_id":"msi_fd8bd80c97c94689800b2c1b2da70abd","legacy_item_key":"berrino","legacy_group_id":"msg_d89e10313bed4fc0a478ea1754ab5644","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_sinh_to_berrino', 'used_smoothie', 'used_sinh_to_berrino', 'Boudo', 'Boudo', 10, TRUE, '{"source":"mcp_report_brand_chip","foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_6e88e8ae-e415-4a19-8b7a-573ed8cb620b","receivedAt":"2026-07-19T03:58:40.349Z","idempotencyKey":"report-setting-item.patch:4ee98ed8-a931-4712-bc93-793cd98cb76f","installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":"Sinh tố","brand_name":"Berrino","product_id":null,"legacy_item_id":"used_sinh_to_berrino","legacy_item_key":"used_sinh_to_berrino","legacy_group_id":"msg_d89e10313bed4fc0a478ea1754ab5644","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-19T03:58:40.96254+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_sinh_to_gold_golden_farm', 'used_smoothie', 'used_sinh_to_gold_golden_farm', 'Gold / Golden Farm', 'Gold / Golden Farm', 20, TRUE, '{"source":"mcp_report_brand_chip","category":"Sinh tố","brand_name":"Gold / Golden Farm","product_id":null,"legacy_item_id":"used_sinh_to_gold_golden_farm","legacy_item_key":"used_sinh_to_gold_golden_farm","legacy_group_id":"msg_d89e10313bed4fc0a478ea1754ab5644","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_4094d628855a4905a5b2e7bd09dd70e9', 'used_smoothie', 'gold', 'Gold / Golden Farm', 'Gold / Golden Farm', 20, TRUE, '{"kind":"used_product","category":"Sinh tố","brand_name":"Gold","product_id":null,"legacy_item_id":"msi_4094d628855a4905a5b2e7bd09dd70e9","legacy_item_key":"gold","legacy_group_id":"msg_d89e10313bed4fc0a478ea1754ab5644","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_sinh_to_vina', 'used_smoothie', 'used_sinh_to_vina', 'Vina', 'Vina', 30, TRUE, '{"source":"mcp_report_brand_chip","category":"Sinh tố","brand_name":"Vina","product_id":null,"legacy_item_id":"used_sinh_to_vina","legacy_item_key":"used_sinh_to_vina","legacy_group_id":"msg_d89e10313bed4fc0a478ea1754ab5644","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_90edb28bceba425391bb91ab4363aa31', 'used_smoothie', 'vina', 'Vina', 'Vina', 30, TRUE, '{"kind":"used_product","category":"Sinh tố","brand_name":"Vina","product_id":null,"legacy_item_id":"msi_90edb28bceba425391bb91ab4363aa31","legacy_item_key":"vina","legacy_group_id":"msg_d89e10313bed4fc0a478ea1754ab5644","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_tra_ona', 'used_tea', 'used_tra_ona', 'Ona', 'Ona', 10, TRUE, '{"source":"mcp_report_brand_chip","category":"Trà","brand_name":"Ona","product_id":null,"legacy_item_id":"used_tra_ona","legacy_item_key":"used_tra_ona","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_2f34e249cd864180a025ceb42b3e2d8f', 'used_tea', 'tra_den', 'Trà đen số 09', 'Trà đen', 10, TRUE, '{"kind":"used_product","foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_e4f6d163-4d83-4170-9c19-92eb172e0ff1","receivedAt":"2026-07-19T03:59:13.624Z","idempotencyKey":"report-setting-item.patch:e4cc05f6-2907-4de3-b96c-b2111da7e9fc","installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":"Trà","brand_name":null,"product_id":null,"legacy_item_id":"msi_2f34e249cd864180a025ceb42b3e2d8f","legacy_item_key":"tra_den","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-19T03:59:13.881447+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_tra_loc_phat', 'used_tea', 'used_tra_loc_phat', 'Lộc Phát', 'Lộc Phát', 20, TRUE, '{"source":"mcp_report_brand_chip","category":"Trà","brand_name":"Lộc Phát","product_id":null,"legacy_item_id":"used_tra_loc_phat","legacy_item_key":"used_tra_loc_phat","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_302403bb024e4660ac44c49d1358a09e', 'used_tea', 'tra_lai', 'Trà lài', 'Trà lài', 20, TRUE, '{"kind":"used_product","category":"Trà","brand_name":null,"product_id":null,"legacy_item_id":"msi_302403bb024e4660ac44c49d1358a09e","legacy_item_key":"tra_lai","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_tra_novia', 'used_tea', 'used_tra_novia', 'Novia', 'Novia', 30, TRUE, '{"source":"mcp_report_brand_chip","category":"Trà","brand_name":"Novia","product_id":null,"legacy_item_id":"used_tra_novia","legacy_item_key":"used_tra_novia","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_7f5610a9f48049218939f39c39db08ff', 'used_tea', 'tra_olong', 'Trà ô long', 'Trà ô long', 30, TRUE, '{"kind":"used_product","category":"Trà","brand_name":null,"product_id":null,"legacy_item_id":"msi_7f5610a9f48049218939f39c39db08ff","legacy_item_key":"tra_olong","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_tra_phuc_long', 'used_tea', 'used_tra_phuc_long', 'Phúc Long', 'Phúc Long', 40, TRUE, '{"source":"mcp_report_brand_chip","category":"Trà","brand_name":"Phúc Long","product_id":null,"legacy_item_id":"used_tra_phuc_long","legacy_item_key":"used_tra_phuc_long","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_tra_hoang_gia', 'used_tea', 'used_tra_hoang_gia', 'Hoàng Gia', 'Hoàng Gia', 50, TRUE, '{"source":"mcp_report_brand_chip","category":"Trà","brand_name":"Hoàng Gia","product_id":null,"legacy_item_id":"used_tra_hoang_gia","legacy_item_key":"used_tra_hoang_gia","legacy_group_id":"msg_dff8c8f0d2c24a58b956a4009be701ed","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_0105d3e6172647e4830ed720ee2de1a9', 'used_milk', 'bot_sua', 'Bột sữa', 'Bột sữa', 10, TRUE, '{"kind":"used_product","category":"Sữa","brand_name":null,"product_id":null,"legacy_item_id":"msi_0105d3e6172647e4830ed720ee2de1a9","legacy_item_key":"bot_sua","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_sua_frima', 'used_milk', 'used_sua_frima', 'Frima', 'Frima', 10, TRUE, '{"source":"mcp_report_brand_chip","category":"Sữa","brand_name":"Frima","product_id":null,"legacy_item_id":"used_sua_frima","legacy_item_key":"used_sua_frima","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_sua_b_one', 'used_milk', 'used_sua_b_one', 'B One', 'B One', 20, TRUE, '{"source":"mcp_report_brand_chip","category":"Sữa","brand_name":"B One","product_id":null,"legacy_item_id":"used_sua_b_one","legacy_item_key":"used_sua_b_one","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_39599b0c5de14aa8a5b9fcfc0fc44807', 'used_milk', 'sua_dac', 'Sữa đặc', 'Sữa đặc', 20, TRUE, '{"kind":"used_product","category":"Sữa","brand_name":null,"product_id":null,"legacy_item_id":"msi_39599b0c5de14aa8a5b9fcfc0fc44807","legacy_item_key":"sua_dac","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_sua_hp', 'used_milk', 'used_sua_hp', 'HP', 'HP', 30, TRUE, '{"source":"mcp_report_brand_chip","category":"Sữa","brand_name":"HP","product_id":null,"legacy_item_id":"used_sua_hp","legacy_item_key":"used_sua_hp","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_89ab4d8c1ccc46a385cba354b1d7bf04', 'used_milk', 'kem_beo', 'Kem béo', 'Kem béo', 30, TRUE, '{"kind":"used_product","category":"Sữa","brand_name":null,"product_id":null,"legacy_item_id":"msi_89ab4d8c1ccc46a385cba354b1d7bf04","legacy_item_key":"kem_beo","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_sua_kievit', 'used_milk', 'used_sua_kievit', 'Kievit', 'Kievit', 40, TRUE, '{"source":"mcp_report_brand_chip","category":"Sữa","brand_name":"Kievit","product_id":null,"legacy_item_id":"used_sua_kievit","legacy_item_key":"used_sua_kievit","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_sua_indo_mafac', 'used_milk', 'used_sua_indo_mafac', 'Indo Mafac', 'Indo Mafac', 50, TRUE, '{"source":"mcp_report_brand_chip","category":"Sữa","brand_name":"Indo Mafac","product_id":null,"legacy_item_id":"used_sua_indo_mafac","legacy_item_key":"used_sua_indo_mafac","legacy_group_id":"msg_cbba014940bd4cc88815282bc39b8481","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_topping_bibi', 'used_topping', 'used_topping_bibi', 'Bibi', 'Bibi', 10, TRUE, '{"source":"mcp_report_brand_chip","category":"Topping","brand_name":"Bibi","product_id":null,"legacy_item_id":"used_topping_bibi","legacy_item_key":"used_topping_bibi","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_e9b03d3c36a548c7b28c9e4d2dc59ad4', 'used_topping', 'tran_chau', 'Zion', 'Zion', 10, TRUE, '{"kind":"used_product","foundation_context":{"actorId":"service:mcp-plan:mcp-v1","nppCode":"MCP-PLAN","actorType":"service","requestId":"req_a71eda06-54e6-44a4-a7c9-046bb6463c6f","receivedAt":"2026-07-19T04:00:29.113Z","idempotencyKey":"report-setting-item.patch:22bb2f78-adeb-4347-ba97-d6ac3df29e45","installationId":"mcp-plan-prod","actorAuthentication":"backend-token"},"category":"Topping","brand_name":null,"product_id":null,"legacy_item_id":"msi_e9b03d3c36a548c7b28c9e4d2dc59ad4","legacy_item_key":"tran_chau","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-19T04:00:29.462173+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_topping_douxian', 'used_topping', 'used_topping_douxian', 'Douxian', 'Douxian', 20, TRUE, '{"source":"mcp_report_brand_chip","category":"Topping","brand_name":"Douxian","product_id":null,"legacy_item_id":"used_topping_douxian","legacy_item_key":"used_topping_douxian","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_1f75ba024c4a49cfad3cc08f6bb93486', 'used_topping', 'thach', 'Thạch', 'Thạch', 20, TRUE, '{"kind":"used_product","category":"Topping","brand_name":null,"product_id":null,"legacy_item_id":"msi_1f75ba024c4a49cfad3cc08f6bb93486","legacy_item_key":"thach","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_topping_ok', 'used_topping', 'used_topping_ok', 'Ok', 'Ok', 30, TRUE, '{"source":"mcp_report_brand_chip","category":"Topping","brand_name":"Ok","product_id":null,"legacy_item_id":"used_topping_ok","legacy_item_key":"used_topping_ok","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_77a7f8a9eb5f46c380c6f89b0f370bc3', 'used_topping', 'pudding', 'Pudding', 'Pudding', 30, TRUE, '{"kind":"used_product","category":"Topping","brand_name":null,"product_id":null,"legacy_item_id":"msi_77a7f8a9eb5f46c380c6f89b0f370bc3","legacy_item_key":"pudding","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_1f2fc1fb47f44efc959a1e810c09f6fb', 'used_topping', 'flan', 'Flan', 'Flan', 40, TRUE, '{"kind":"used_product","category":"Topping","brand_name":null,"product_id":null,"legacy_item_id":"msi_1f2fc1fb47f44efc959a1e810c09f6fb","legacy_item_key":"flan","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'used_topping_sea', 'used_topping', 'used_topping_sea', 'Sea', 'Sea', 40, TRUE, '{"source":"mcp_report_brand_chip","category":"Topping","brand_name":"Sea","product_id":null,"legacy_item_id":"used_topping_sea","legacy_item_key":"used_topping_sea","legacy_group_id":"msg_ec6628edbaa4462bb1725c69cfd40ea7","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-07T01:34:02.305423+00:00'::timestamptz, '2026-07-07T01:34:02.305423+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_25cf4595a12140d19a6f938f16ac4593', 'report_fields', 'price', 'Giá bán / giá đối thủ', 'price', 10, TRUE, '{"field":"priceSummary","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_25cf4595a12140d19a6f938f16ac4593","legacy_item_key":"price","legacy_group_id":"msg_96f0ec629d074cf7a44cf60dbc0d25c3","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_b91a077bc21b4ee2ba5dcc288116956b', 'report_fields', 'display', 'Trưng bày', 'display', 20, TRUE, '{"field":"displaySummary","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_b91a077bc21b4ee2ba5dcc288116956b","legacy_item_key":"display","legacy_group_id":"msg_96f0ec629d074cf7a44cf60dbc0d25c3","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_72572945d2524f10a4d3ec324508f35f', 'report_fields', 'stock', 'Tồn kho', 'stock', 30, TRUE, '{"field":"stockSummary","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_72572945d2524f10a4d3ec324508f35f","legacy_item_key":"stock","legacy_group_id":"msg_96f0ec629d074cf7a44cf60dbc0d25c3","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_fd31114891ea4116b85c2429fac10a4e', 'report_fields', 'demand', 'Nhu cầu', 'demand', 40, TRUE, '{"field":"demandSummary","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_fd31114891ea4116b85c2429fac10a4e","legacy_item_key":"demand","legacy_group_id":"msg_96f0ec629d074cf7a44cf60dbc0d25c3","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_7e9dcc0aa72e4d2fb01e16a5ce8fc73a', 'report_fields', 'opportunity', 'Cơ hội', 'opportunity', 50, TRUE, '{"field":"opportunitySummary","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_7e9dcc0aa72e4d2fb01e16a5ce8fc73a","legacy_item_key":"opportunity","legacy_group_id":"msg_96f0ec629d074cf7a44cf60dbc0d25c3","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_bfc7c4d435bd4fd388508ba019685415', 'report_fields', 'risk', 'Rủi ro', 'risk', 60, TRUE, '{"field":"riskSummary","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_bfc7c4d435bd4fd388508ba019685415","legacy_item_key":"risk","legacy_group_id":"msg_96f0ec629d074cf7a44cf60dbc0d25c3","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz),
    ('mcp-plan-prod', 'msi_3987f4301f4447f6886ae0bfbf51e033', 'report_fields', 'next_action', 'Next action', 'next_action', 70, TRUE, '{"field":"nextAction","category":null,"brand_name":null,"product_id":null,"legacy_item_id":"msi_3987f4301f4447f6886ae0bfbf51e033","legacy_item_key":"next_action","legacy_group_id":"msg_96f0ec629d074cf7a44cf60dbc0d25c3","legacy_source":"supabase:noiadkpkvdohljgopgfb","legacy_snapshot_sha256":"90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"}'::jsonb, '2026-07-05T13:35:26.099971+00:00'::timestamptz, '2026-07-05T13:35:26.099971+00:00'::timestamptz)
)
INSERT INTO mcp.mcp_report_settings (
  id,
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
  source_items.legacy_id,
  source_items.installation_id,
  target_group.id,
  source_items.setting_key,
  source_items.setting_name,
  to_jsonb(source_items.setting_value),
  'text',
  '[]'::jsonb,
  FALSE,
  source_items.sort_order,
  source_items.active,
  source_items.raw_payload,
  source_items.created_at,
  source_items.updated_at
FROM source_items
JOIN mcp.mcp_report_setting_groups target_group
  ON target_group.installation_id = source_items.installation_id
 AND target_group.group_key = source_items.group_key
ON CONFLICT (installation_id, group_id, setting_key) DO UPDATE
SET
  setting_name = EXCLUDED.setting_name,
  value = EXCLUDED.value,
  value_type = EXCLUDED.value_type,
  options = EXCLUDED.options,
  required = EXCLUDED.required,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active,
  raw_payload = EXCLUDED.raw_payload,
  created_at = LEAST(mcp.mcp_report_settings.created_at, EXCLUDED.created_at),
  updated_at = GREATEST(mcp.mcp_report_settings.updated_at, EXCLUDED.updated_at);

DO $$
DECLARE
  v_group_count integer;
  v_item_count integer;
  v_active_item_count integer;
  v_inactive_item_count integer;
  v_orphan_count integer;
BEGIN
  SELECT count(*) INTO v_group_count
  FROM mcp.mcp_report_setting_groups
  WHERE installation_id = 'mcp-plan-prod'
    AND id = ANY (ARRAY[
      'msg_0687516286014cc5b77cf667b6c9f349',
      'msg_a3770c16340342fd9eead4d43462c777',
      'msg_d89e10313bed4fc0a478ea1754ab5644',
      'msg_dff8c8f0d2c24a58b956a4009be701ed',
      'msg_cbba014940bd4cc88815282bc39b8481',
      'msg_ec6628edbaa4462bb1725c69cfd40ea7',
      'msg_96f0ec629d074cf7a44cf60dbc0d25c3'
    ]);

  SELECT
    count(*),
    count(*) FILTER (WHERE active),
    count(*) FILTER (WHERE NOT active)
  INTO v_item_count, v_active_item_count, v_inactive_item_count
  FROM mcp.mcp_report_settings
  WHERE installation_id = 'mcp-plan-prod'
    AND id = ANY (ARRAY[
      'msi_b8403488cc42492c9895f96db4229964',
      'msi_a1a9a74ae0134809ae3e5f33d9d1e57e',
      'msi_20d7c2018e6747d5938955879635d1ac',
      'msi_899690ec424342d08286d4ec574e71d1',
      'msi_acde3dc5cb3441e89032e9bc2da851dc',
      'msi_fb001c5df5584269bafbde06cd3bb703',
      'msi_c66fe4d16d2b4eb282cc2293bdad897b',
      'msi_510fce37ca3449799610523c502eca5f',
      'msi_736e0e7a23714eb394f45d876eed6183',
      'used_siro_mama',
      'msi_a8cfdb3069fc4a45be0ea5e72aa1cfb0',
      'used_siro_golden_farm',
      'used_siro_vina',
      'msi_3c612dbc5bf04e8ab26fc02c817de294',
      'used_siro_torani',
      'msi_a53e533da51548f9961502fcdf4ab4f8',
      'msi_fd8bd80c97c94689800b2c1b2da70abd',
      'used_sinh_to_berrino',
      'used_sinh_to_gold_golden_farm',
      'msi_4094d628855a4905a5b2e7bd09dd70e9',
      'used_sinh_to_vina',
      'msi_90edb28bceba425391bb91ab4363aa31',
      'used_tra_ona',
      'msi_2f34e249cd864180a025ceb42b3e2d8f',
      'used_tra_loc_phat',
      'msi_302403bb024e4660ac44c49d1358a09e',
      'used_tra_novia',
      'msi_7f5610a9f48049218939f39c39db08ff',
      'used_tra_phuc_long',
      'used_tra_hoang_gia',
      'msi_0105d3e6172647e4830ed720ee2de1a9',
      'used_sua_frima',
      'used_sua_b_one',
      'msi_39599b0c5de14aa8a5b9fcfc0fc44807',
      'used_sua_hp',
      'msi_89ab4d8c1ccc46a385cba354b1d7bf04',
      'used_sua_kievit',
      'used_sua_indo_mafac',
      'used_topping_bibi',
      'msi_e9b03d3c36a548c7b28c9e4d2dc59ad4',
      'used_topping_douxian',
      'msi_1f75ba024c4a49cfad3cc08f6bb93486',
      'used_topping_ok',
      'msi_77a7f8a9eb5f46c380c6f89b0f370bc3',
      'msi_1f2fc1fb47f44efc959a1e810c09f6fb',
      'used_topping_sea',
      'msi_25cf4595a12140d19a6f938f16ac4593',
      'msi_b91a077bc21b4ee2ba5dcc288116956b',
      'msi_72572945d2524f10a4d3ec324508f35f',
      'msi_fd31114891ea4116b85c2429fac10a4e',
      'msi_7e9dcc0aa72e4d2fb01e16a5ce8fc73a',
      'msi_bfc7c4d435bd4fd388508ba019685415',
      'msi_3987f4301f4447f6886ae0bfbf51e033'
    ]);

  SELECT count(*) INTO v_orphan_count
  FROM mcp.mcp_report_settings item
  LEFT JOIN mcp.mcp_report_setting_groups setting_group
    ON setting_group.id = item.group_id
   AND setting_group.installation_id = item.installation_id
  WHERE item.installation_id = 'mcp-plan-prod'
    AND item.id = ANY (ARRAY[
      'msi_b8403488cc42492c9895f96db4229964',
      'msi_a1a9a74ae0134809ae3e5f33d9d1e57e',
      'msi_20d7c2018e6747d5938955879635d1ac',
      'msi_899690ec424342d08286d4ec574e71d1',
      'msi_acde3dc5cb3441e89032e9bc2da851dc',
      'msi_fb001c5df5584269bafbde06cd3bb703',
      'msi_c66fe4d16d2b4eb282cc2293bdad897b',
      'msi_510fce37ca3449799610523c502eca5f',
      'msi_736e0e7a23714eb394f45d876eed6183',
      'used_siro_mama',
      'msi_a8cfdb3069fc4a45be0ea5e72aa1cfb0',
      'used_siro_golden_farm',
      'used_siro_vina',
      'msi_3c612dbc5bf04e8ab26fc02c817de294',
      'used_siro_torani',
      'msi_a53e533da51548f9961502fcdf4ab4f8',
      'msi_fd8bd80c97c94689800b2c1b2da70abd',
      'used_sinh_to_berrino',
      'used_sinh_to_gold_golden_farm',
      'msi_4094d628855a4905a5b2e7bd09dd70e9',
      'used_sinh_to_vina',
      'msi_90edb28bceba425391bb91ab4363aa31',
      'used_tra_ona',
      'msi_2f34e249cd864180a025ceb42b3e2d8f',
      'used_tra_loc_phat',
      'msi_302403bb024e4660ac44c49d1358a09e',
      'used_tra_novia',
      'msi_7f5610a9f48049218939f39c39db08ff',
      'used_tra_phuc_long',
      'used_tra_hoang_gia',
      'msi_0105d3e6172647e4830ed720ee2de1a9',
      'used_sua_frima',
      'used_sua_b_one',
      'msi_39599b0c5de14aa8a5b9fcfc0fc44807',
      'used_sua_hp',
      'msi_89ab4d8c1ccc46a385cba354b1d7bf04',
      'used_sua_kievit',
      'used_sua_indo_mafac',
      'used_topping_bibi',
      'msi_e9b03d3c36a548c7b28c9e4d2dc59ad4',
      'used_topping_douxian',
      'msi_1f75ba024c4a49cfad3cc08f6bb93486',
      'used_topping_ok',
      'msi_77a7f8a9eb5f46c380c6f89b0f370bc3',
      'msi_1f2fc1fb47f44efc959a1e810c09f6fb',
      'used_topping_sea',
      'msi_25cf4595a12140d19a6f938f16ac4593',
      'msi_b91a077bc21b4ee2ba5dcc288116956b',
      'msi_72572945d2524f10a4d3ec324508f35f',
      'msi_fd31114891ea4116b85c2429fac10a4e',
      'msi_7e9dcc0aa72e4d2fb01e16a5ce8fc73a',
      'msi_bfc7c4d435bd4fd388508ba019685415',
      'msi_3987f4301f4447f6886ae0bfbf51e033'
    ])
    AND setting_group.id IS NULL;

  IF v_group_count <> 7 THEN
    RAISE EXCEPTION 'mcp_legacy_report_settings_group_count_mismatch:%', v_group_count;
  END IF;
  IF v_item_count <> 53 THEN
    RAISE EXCEPTION 'mcp_legacy_report_settings_item_count_mismatch:%', v_item_count;
  END IF;
  IF v_active_item_count <> 52 OR v_inactive_item_count <> 1 THEN
    RAISE EXCEPTION
      'mcp_legacy_report_settings_status_count_mismatch:active=%,inactive=%',
      v_active_item_count,
      v_inactive_item_count;
  END IF;
  IF v_orphan_count <> 0 THEN
    RAISE EXCEPTION 'mcp_legacy_report_settings_orphan_count_mismatch:%', v_orphan_count;
  END IF;
END
$$;

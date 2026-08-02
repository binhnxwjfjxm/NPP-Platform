-- Phase 6C.1A: demand-triggered MCP field-outlet verification in Core.
-- This migration is source-only until an explicitly approved production migration operation.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.customer-onboarding.read', 'Xác minh khách hàng', 'Xem đề nghị xác minh khách hàng', 'Cho phép đọc đề nghị xác minh/mở mã khách hàng trong phạm vi được cấp.', true, now()),
  ('core.customer-onboarding.submit', 'Xác minh khách hàng', 'Gửi đề nghị xác minh khách hàng', 'Cho phép gửi đề nghị xác minh từ một nhu cầu mua hoặc order intent cần lập đơn chính thức.', true, now()),
  ('core.customer-onboarding.review', 'Xác minh khách hàng', 'Rà soát đề nghị xác minh khách hàng', 'Cho phép nhận xử lý, yêu cầu bổ sung và hủy đề nghị xác minh khách hàng.', true, now()),
  ('core.customer-onboarding.approve', 'Xác minh khách hàng', 'Duyệt mở mã khách hàng', 'Cho phép duyệt và tạo đúng một khách hàng cùng địa chỉ chính thức.', true, now()),
  ('core.customer-onboarding.link-existing', 'Xác minh khách hàng', 'Liên kết khách hàng hiện hữu', 'Cho phép liên kết đề nghị với khách hàng và địa chỉ đang hoạt động.', true, now()),
  ('core.customer-onboarding.reject', 'Xác minh khách hàng', 'Từ chối đề nghị xác minh khách hàng', 'Cho phép từ chối đề nghị với lý do bắt buộc.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS sales.customer_onboarding_requests (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  source_system text NOT NULL CHECK (source_system = 'MCP'),
  source_outlet_id text NOT NULL CHECK (char_length(btrim(source_outlet_id)) BETWEEN 1 AND 128),
  source_demand_reference text NOT NULL CHECK (char_length(btrim(source_demand_reference)) BETWEEN 1 AND 128),
  order_required boolean NOT NULL CHECK (order_required = true),
  trigger_reason text NOT NULL CHECK (trigger_reason = 'OFFICIAL_ORDER_REQUIRED'),
  proposed_name text NOT NULL CHECK (char_length(btrim(proposed_name)) BETWEEN 1 AND 256),
  proposed_phone text NULL CHECK (proposed_phone IS NULL OR char_length(proposed_phone) <= 20),
  proposed_address_label text NOT NULL DEFAULT 'Địa chỉ chính' CHECK (char_length(btrim(proposed_address_label)) BETWEEN 1 AND 128),
  proposed_address_line1 text NOT NULL CHECK (char_length(btrim(proposed_address_line1)) BETWEEN 1 AND 512),
  proposed_address_line2 text NULL CHECK (proposed_address_line2 IS NULL OR char_length(proposed_address_line2) <= 512),
  proposed_ward text NULL CHECK (proposed_ward IS NULL OR char_length(proposed_ward) <= 128),
  proposed_district text NULL CHECK (proposed_district IS NULL OR char_length(proposed_district) <= 128),
  proposed_province text NULL CHECK (proposed_province IS NULL OR char_length(proposed_province) <= 128),
  proposed_postal_code text NULL CHECK (proposed_postal_code IS NULL OR char_length(proposed_postal_code) <= 32),
  proposed_country_code text NOT NULL DEFAULT 'VN' CHECK (proposed_country_code ~ '^[A-Z]{2}$'),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'),
  requested_by_actor_id text NOT NULL CHECK (char_length(requested_by_actor_id) BETWEEN 1 AND 128),
  requested_by_employee_id uuid NULL,
  reviewed_by_actor_id text NULL CHECK (reviewed_by_actor_id IS NULL OR char_length(reviewed_by_actor_id) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'under_review', 'need_more_info', 'approved', 'linked_existing', 'rejected', 'cancelled'
  )),
  review_reason text NULL CHECK (review_reason IS NULL OR char_length(review_reason) <= 2000),
  approved_customer_id uuid NULL,
  approved_customer_address_id uuid NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_onboarding_requests_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_onboarding_requests_source_demand_unique UNIQUE (
    installation_id, source_system, source_outlet_id, source_demand_reference
  ),
  CONSTRAINT customer_onboarding_requests_result_pair_check CHECK (
    (approved_customer_id IS NULL AND approved_customer_address_id IS NULL)
    OR (approved_customer_id IS NOT NULL AND approved_customer_address_id IS NOT NULL)
  ),
  CONSTRAINT customer_onboarding_requests_result_status_check CHECK (
    status NOT IN ('approved', 'linked_existing')
    OR (approved_customer_id IS NOT NULL AND approved_customer_address_id IS NOT NULL)
  ),
  CONSTRAINT customer_onboarding_requests_customer_installation_fk
    FOREIGN KEY (installation_id, approved_customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT customer_onboarding_requests_address_installation_fk
    FOREIGN KEY (installation_id, approved_customer_address_id)
    REFERENCES shared.customer_addresses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customer_onboarding_requests_status_idx
  ON sales.customer_onboarding_requests (installation_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS customer_onboarding_requests_requester_idx
  ON sales.customer_onboarding_requests (installation_id, requested_by_actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_onboarding_requests_source_outlet_idx
  ON sales.customer_onboarding_requests (installation_id, source_system, source_outlet_id, created_at DESC);

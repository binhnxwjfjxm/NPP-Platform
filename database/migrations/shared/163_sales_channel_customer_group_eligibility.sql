-- Quyền hưởng giá theo nhóm khách chính thức; không suy đoán bằng mã hay tên.
CREATE TABLE IF NOT EXISTS shared.sales_channel_customer_groups (
  installation_id text NOT NULL,
  channel_id uuid NOT NULL,
  customer_group_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, channel_id, customer_group_id),
  CONSTRAINT sales_channel_group_channel_fk FOREIGN KEY (installation_id, channel_id)
    REFERENCES shared.sales_channels (installation_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_channel_group_group_fk FOREIGN KEY (installation_id, customer_group_id)
    REFERENCES shared.customer_groups (installation_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sales_channel_group_customer_idx
  ON shared.sales_channel_customer_groups (installation_id, customer_group_id, channel_id);
-- Không tự backfill nhóm theo mã; đối chiếu các nhóm được phép trước khi bật production.

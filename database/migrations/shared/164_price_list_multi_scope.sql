-- Multiple eligible channels/groups per price list with foreign keys and backfill.
-- Scalar scope columns remain primary IDs for old API consumers.
CREATE TABLE shared.price_list_channels (
  installation_id text NOT NULL,
  price_list_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  PRIMARY KEY (installation_id, price_list_id, channel_id),
  FOREIGN KEY (installation_id, price_list_id)
    REFERENCES shared.price_lists (installation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (installation_id, channel_id)
    REFERENCES shared.sales_channels (installation_id, id) ON DELETE RESTRICT
);
CREATE INDEX price_list_channels_by_channel_idx
  ON shared.price_list_channels (installation_id, channel_id, price_list_id);
CREATE TABLE shared.price_list_customer_groups (
  installation_id text NOT NULL,
  price_list_id uuid NOT NULL,
  customer_group_id uuid NOT NULL,
  PRIMARY KEY (installation_id, price_list_id, customer_group_id),
  FOREIGN KEY (installation_id, price_list_id)
    REFERENCES shared.price_lists (installation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (installation_id, customer_group_id)
    REFERENCES shared.customer_groups (installation_id, id) ON DELETE RESTRICT
);
CREATE INDEX price_list_groups_by_group_idx
  ON shared.price_list_customer_groups (installation_id, customer_group_id, price_list_id);
INSERT INTO shared.price_list_channels (installation_id, price_list_id, channel_id)
SELECT installation_id, id, channel_id FROM shared.price_lists WHERE channel_id IS NOT NULL;
INSERT INTO shared.price_list_customer_groups (installation_id, price_list_id, customer_group_id)
SELECT installation_id, id, customer_group_id FROM shared.price_lists WHERE customer_group_id IS NOT NULL;

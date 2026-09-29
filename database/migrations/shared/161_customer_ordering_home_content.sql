CREATE TABLE IF NOT EXISTS shared.customer_ordering_home_content (
  installation_id text PRIMARY KEY CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  section_title text NOT NULL DEFAULT 'Sự kiện' CHECK (char_length(section_title) BETWEEN 1 AND 80),
  is_visible boolean NOT NULL DEFAULT false,
  banner_image_present boolean NOT NULL DEFAULT false,
  banner_image_version bigint NOT NULL DEFAULT 0 CHECK (banner_image_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_ordering_home_content_visible
  ON shared.customer_ordering_home_content (installation_id, is_visible);

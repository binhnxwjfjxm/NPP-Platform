-- B1: canonical customer-media registry for one installation-wide R2 bucket.
-- Files are never copied between MCP/Core. This table stores canonical customer linkage
-- and provider-safe metadata; object_key remains backend-only.

CREATE TABLE IF NOT EXISTS shared.customer_media (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_id uuid NOT NULL,
  source_app text NOT NULL CHECK (source_app IN ('CORE', 'MCP')),
  source_media_id text NULL CHECK (source_media_id IS NULL OR char_length(source_media_id) BETWEEN 1 AND 160),
  source_route_customer_id text NULL CHECK (source_route_customer_id IS NULL OR char_length(source_route_customer_id) BETWEEN 1 AND 160),
  source_session_id text NULL CHECK (source_session_id IS NULL OR char_length(source_session_id) BETWEEN 1 AND 160),
  client_upload_id text NULL CHECK (client_upload_id IS NULL OR char_length(client_upload_id) BETWEEN 1 AND 128),
  object_key text NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 1024),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/webp', 'image/png')),
  expected_byte_size bigint NULL CHECK (expected_byte_size IS NULL OR expected_byte_size BETWEEN 1 AND 5242880),
  actual_byte_size bigint NULL CHECK (actual_byte_size IS NULL OR actual_byte_size BETWEEN 1 AND 5242880),
  width integer NULL CHECK (width IS NULL OR width BETWEEN 1 AND 20000),
  height integer NULL CHECK (height IS NULL OR height BETWEEN 1 AND 20000),
  etag text NULL CHECK (etag IS NULL OR char_length(etag) <= 512),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'deleted')),
  captured_by text NULL CHECK (captured_by IS NULL OR char_length(captured_by) <= 160),
  captured_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 160),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 160),
  CONSTRAINT customer_media_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_media_customer_installation_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT customer_media_core_shape CHECK (
    source_app <> 'CORE'
    OR (source_media_id IS NULL AND source_route_customer_id IS NULL AND source_session_id IS NULL)
  ),
  CONSTRAINT customer_media_mcp_shape CHECK (
    source_app <> 'MCP'
    OR (source_media_id IS NOT NULL AND source_route_customer_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS customer_media_customer_ready_idx
  ON shared.customer_media (installation_id, customer_id, captured_at DESC NULLS LAST, created_at DESC)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS customer_media_customer_active_idx
  ON shared.customer_media (installation_id, customer_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS customer_media_source_unique
  ON shared.customer_media (installation_id, source_app, source_media_id)
  WHERE source_media_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_media_core_client_upload_unique
  ON shared.customer_media (installation_id, source_app, client_upload_id)
  WHERE source_app = 'CORE' AND client_upload_id IS NOT NULL;

-- If MCP linkage has already been migrated, import existing ready outlet media without
-- moving its R2 object. Only the newest three images per canonical customer are exposed.
DO $migration$
BEGIN
  IF to_regclass('mcp.mcp_route_customers') IS NULL OR to_regclass('mcp.mcp_outlet_media') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'mcp' AND table_name = 'mcp_route_customers' AND column_name = 'core_customer_id'
  ) THEN
    RETURN;
  END IF;

  EXECUTE $sql$
    WITH candidates AS (
      SELECT
        media.*,
        route_customer.core_customer_id,
        row_number() OVER (
          PARTITION BY media.installation_id, route_customer.core_customer_id
          ORDER BY media.captured_at DESC NULLS LAST, media.created_at DESC, media.id DESC
        ) AS media_rank
      FROM mcp.mcp_outlet_media AS media
      JOIN mcp.mcp_route_customers AS route_customer
        ON route_customer.installation_id = media.installation_id
       AND route_customer.id = media.route_customer_id
      JOIN shared.customers AS customer
        ON customer.installation_id = media.installation_id
       AND customer.id::text = route_customer.core_customer_id
      WHERE media.status = 'ready'
        AND route_customer.core_customer_id IS NOT NULL
    )
    INSERT INTO shared.customer_media (
      id, installation_id, customer_id, source_app, source_media_id,
      source_route_customer_id, source_session_id, object_key, mime_type,
      expected_byte_size, actual_byte_size, width, height, etag, status,
      captured_by, captured_at, created_at, updated_at, created_by, updated_by
    )
    SELECT
      gen_random_uuid(), candidate.installation_id, candidate.core_customer_id::uuid, 'MCP', candidate.id,
      candidate.route_customer_id, candidate.session_id, candidate.object_key, candidate.mime_type,
      candidate.expected_byte_size, candidate.actual_byte_size, candidate.width, candidate.height,
      candidate.etag, 'ready', candidate.captured_by, candidate.captured_at,
      COALESCE(candidate.created_at, now()), COALESCE(candidate.updated_at, now()),
      COALESCE(NULLIF(candidate.captured_by, ''), 'service:mcp:media-import'),
      COALESCE(NULLIF(candidate.captured_by, ''), 'service:mcp:media-import')
    FROM candidates AS candidate
    WHERE candidate.media_rank <= 3
    ON CONFLICT DO NOTHING
  $sql$;
END
$migration$;

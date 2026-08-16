const CANONICAL_SCHEMAS = Object.freeze([
  'shared',
  'mcp',
  'sales',
  'purchasing',
  'inventory',
  'logistics',
  'accounting',
  'reporting',
]);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function text(value) {
  return String(value ?? '').trim();
}

function requireText(value, code) {
  const normalized = text(value);
  if (!normalized) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return normalized;
}

function rowCountString(value) {
  const normalized = text(value);
  if (!/^\d+$/.test(normalized)) {
    const error = new Error('BACKUP_MANIFEST_ROW_COUNT_INVALID');
    error.code = 'BACKUP_MANIFEST_ROW_COUNT_INVALID';
    throw error;
  }
  return normalized;
}

export async function collectRestoreSnapshotMetadata(client) {
  if (!client?.query) throw new Error('BACKUP_MANIFEST_CLIENT_REQUIRED');
  const versionResult = await client.query(
    "SELECT current_setting('server_version') AS server_version",
  );
  const tableResult = await client.query(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema = ANY($1::text[])
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name`,
    [CANONICAL_SCHEMAS],
  );

  const tables = [];
  let totalRows = 0n;
  for (const row of tableResult.rows ?? []) {
    const schema = requireText(row.table_schema, 'BACKUP_MANIFEST_SCHEMA_INVALID');
    const table = requireText(row.table_name, 'BACKUP_MANIFEST_TABLE_INVALID');
    const countResult = await client.query(
      `SELECT count(*)::text AS row_count FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
    );
    const rowCount = rowCountString(countResult.rows?.[0]?.row_count ?? '0');
    totalRows += BigInt(rowCount);
    tables.push(Object.freeze({ schema, table, rowCount }));
  }

  return Object.freeze({
    sourcePostgresVersion: requireText(
      versionResult.rows?.[0]?.server_version,
      'BACKUP_MANIFEST_POSTGRES_VERSION_UNAVAILABLE',
    ),
    canonicalSchemas: CANONICAL_SCHEMAS,
    tableCount: tables.length,
    totalRows: totalRows.toString(),
    tables: Object.freeze(tables),
  });
}

export function createSystemRestoreManifest({
  backupJobId,
  installationId,
  snapshotAt,
  schemaVersion,
  migrationIds,
  dump,
  snapshotMetadata,
  generatedAt,
}) {
  const normalizedMigrations = Array.isArray(migrationIds)
    ? migrationIds.map((id) => requireText(id, 'BACKUP_MANIFEST_MIGRATION_ID_INVALID'))
    : [];
  const dumpFilename = requireText(dump?.filename, 'BACKUP_MANIFEST_DUMP_FILENAME_REQUIRED');
  const dumpKey = requireText(dump?.key, 'BACKUP_MANIFEST_DUMP_KEY_REQUIRED');
  const dumpSha256 = requireText(dump?.sha256, 'BACKUP_MANIFEST_DUMP_CHECKSUM_REQUIRED').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(dumpSha256)) {
    const error = new Error('BACKUP_MANIFEST_DUMP_CHECKSUM_INVALID');
    error.code = 'BACKUP_MANIFEST_DUMP_CHECKSUM_INVALID';
    throw error;
  }
  const dumpSize = Number(dump?.size);
  if (!Number.isSafeInteger(dumpSize) || dumpSize < 0) {
    const error = new Error('BACKUP_MANIFEST_DUMP_SIZE_INVALID');
    error.code = 'BACKUP_MANIFEST_DUMP_SIZE_INVALID';
    throw error;
  }

  return Object.freeze({
    manifestVersion: 1,
    purpose: 'SYSTEM_MOVE_RESTORE',
    backupJobId: requireText(backupJobId, 'BACKUP_MANIFEST_JOB_ID_REQUIRED'),
    installationId: requireText(installationId, 'BACKUP_MANIFEST_INSTALLATION_REQUIRED'),
    snapshotAt: requireText(snapshotAt, 'BACKUP_MANIFEST_SNAPSHOT_REQUIRED'),
    generatedAt: requireText(generatedAt, 'BACKUP_MANIFEST_GENERATED_AT_REQUIRED'),
    schemaVersion: schemaVersion ? text(schemaVersion) : null,
    migrationIds: Object.freeze(normalizedMigrations),
    source: Object.freeze({
      databaseEngine: 'PostgreSQL',
      serverVersion: requireText(
        snapshotMetadata?.sourcePostgresVersion,
        'BACKUP_MANIFEST_POSTGRES_VERSION_UNAVAILABLE',
      ),
    }),
    artifacts: Object.freeze({
      databaseDump: Object.freeze({
        filename: dumpFilename,
        objectKey: dumpKey,
        format: 'postgresql-custom',
        sizeBytes: dumpSize,
        sha256: dumpSha256,
      }),
      manifest: Object.freeze({ filename: 'manifest.json', format: 'json' }),
    }),
    reconciliation: Object.freeze({
      method: 'EXACT_BASE_TABLE_ROW_COUNTS',
      canonicalSchemas: Object.freeze([...(snapshotMetadata?.canonicalSchemas ?? CANONICAL_SCHEMAS)]),
      tableCount: Number(snapshotMetadata?.tableCount ?? 0),
      totalRows: rowCountString(snapshotMetadata?.totalRows ?? '0'),
      tables: Object.freeze((snapshotMetadata?.tables ?? []).map((item) => Object.freeze({
        schema: requireText(item.schema, 'BACKUP_MANIFEST_SCHEMA_INVALID'),
        table: requireText(item.table, 'BACKUP_MANIFEST_TABLE_INVALID'),
        rowCount: rowCountString(item.rowCount),
      }))),
    }),
    verification: Object.freeze({
      dumpArchiveListVerified: true,
      dumpStorageVerified: true,
      dumpStorageVerification: 'R2_HEAD_SIZE_SHA256',
      manifestStorageVerificationBeforeJobVerified: 'R2_HEAD_SIZE_SHA256',
      restoreMode: 'PG_RESTORE_CUSTOM_ARCHIVE',
    }),
  });
}

export function serializeSystemRestoreManifest(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

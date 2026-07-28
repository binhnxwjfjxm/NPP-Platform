import { readFileSync } from 'node:fs';

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const CORE_IDEMPOTENCY_SQL = readFileSync(new URL('../../../../database/migrations/shared/002_core_idempotency.sql', import.meta.url), 'utf8');
const CORE_AUDIT_OUTBOX_SQL = readFileSync(new URL('../../../../database/migrations/shared/003_core_audit_outbox.sql', import.meta.url), 'utf8');
const ORG_BRANCHES_SQL = readFileSync(new URL('../../../../database/migrations/shared/004_org_branches.sql', import.meta.url), 'utf8');
const ORG_WAREHOUSES_SQL = readFileSync(new URL('../../../../database/migrations/shared/005_org_warehouses.sql', import.meta.url), 'utf8');
const ORG_LOCATIONS_SQL = readFileSync(new URL('../../../../database/migrations/shared/006_org_locations.sql', import.meta.url), 'utf8');
const HR_EMPLOYEES_SQL = readFileSync(new URL('../../../../database/migrations/shared/007_hr_employees.sql', import.meta.url), 'utf8');
const ACCESS_ROLES_PERMISSIONS_SQL = readFileSync(new URL('../../../../database/migrations/shared/008_access_roles_permissions.sql', import.meta.url), 'utf8');
const ACCESS_USERS_ROLE_ASSIGNMENTS_SQL = readFileSync(new URL('../../../../database/migrations/shared/009_access_users_role_assignments.sql', import.meta.url), 'utf8');
const CUSTOMER_MASTER_DATA_SQL = readFileSync(new URL('../../../../database/migrations/shared/010_customer_master_data.sql', import.meta.url), 'utf8');
const SUPPLIER_MASTER_DATA_SQL = readFileSync(new URL('../../../../database/migrations/shared/011_supplier_master_data.sql', import.meta.url), 'utf8');
const PRODUCT_CATALOG_FOUNDATION_SQL = readFileSync(new URL('../../../../database/migrations/shared/012_product_catalog_foundation.sql', import.meta.url), 'utf8');
const PRODUCT_UNITS_CONVERSIONS_BARCODES_SQL = readFileSync(new URL('../../../../database/migrations/shared/013_product_units_conversions_barcodes.sql', import.meta.url), 'utf8');
const PRICE_LISTS_CHANNEL_RESOLUTION_SQL = readFileSync(new URL('../../../../database/migrations/shared/014_price_lists_channel_resolution.sql', import.meta.url), 'utf8');
const DOCUMENT_NUMBERING_SQL = readFileSync(new URL('../../../../database/migrations/shared/015_document_numbering.sql', import.meta.url), 'utf8');
const PERMISSION_CATALOG_ALIGNMENT_SQL = readFileSync(new URL('../../../../database/migrations/shared/016_permission_catalog_alignment.sql', import.meta.url), 'utf8');
const INVENTORY_LEDGER_FOUNDATION_SQL = readFileSync(new URL('../../../../database/migrations/inventory/017_inventory_ledger_foundation.sql', import.meta.url), 'utf8');
const INVENTORY_BALANCE_READ_MODEL_SQL = readFileSync(new URL('../../../../database/migrations/inventory/018_inventory_balance_read_model.sql', import.meta.url), 'utf8');
const INVENTORY_RESERVATIONS_NEGATIVE_STOCK_SQL = readFileSync(new URL('../../../../database/migrations/inventory/019_inventory_reservations_negative_stock.sql', import.meta.url), 'utf8');

export const CORE_API_MIGRATIONS = Object.freeze([
  Object.freeze({ id: '002_core_idempotency', sql: CORE_IDEMPOTENCY_SQL }),
  Object.freeze({ id: '003_core_audit_outbox', sql: CORE_AUDIT_OUTBOX_SQL }),
  Object.freeze({ id: '004_org_branches', sql: ORG_BRANCHES_SQL }),
  Object.freeze({ id: '005_org_warehouses', sql: ORG_WAREHOUSES_SQL }),
  Object.freeze({ id: '006_org_locations', sql: ORG_LOCATIONS_SQL }),
  Object.freeze({ id: '007_hr_employees', sql: HR_EMPLOYEES_SQL }),
  Object.freeze({ id: '008_access_roles_permissions', sql: ACCESS_ROLES_PERMISSIONS_SQL }),
  Object.freeze({ id: '009_access_users_role_assignments', sql: ACCESS_USERS_ROLE_ASSIGNMENTS_SQL }),
  Object.freeze({ id: '010_customer_master_data', sql: CUSTOMER_MASTER_DATA_SQL }),
  Object.freeze({ id: '011_supplier_master_data', sql: SUPPLIER_MASTER_DATA_SQL }),
  Object.freeze({ id: '012_product_catalog_foundation', sql: PRODUCT_CATALOG_FOUNDATION_SQL }),
  Object.freeze({ id: '013_product_units_conversions_barcodes', sql: PRODUCT_UNITS_CONVERSIONS_BARCODES_SQL }),
  Object.freeze({ id: '014_price_lists_channel_resolution', sql: PRICE_LISTS_CHANNEL_RESOLUTION_SQL }),
  Object.freeze({ id: '015_document_numbering', sql: DOCUMENT_NUMBERING_SQL }),
  Object.freeze({ id: '016_permission_catalog_alignment', sql: PERMISSION_CATALOG_ALIGNMENT_SQL }),
  Object.freeze({ id: '017_inventory_ledger_foundation', sql: INVENTORY_LEDGER_FOUNDATION_SQL }),
  Object.freeze({ id: '018_inventory_balance_read_model', sql: INVENTORY_BALANCE_READ_MODEL_SQL }),
  Object.freeze({ id: '019_inventory_reservations_negative_stock', sql: INVENTORY_RESERVATIONS_NEGATIVE_STOCK_SQL }),
]);

function validateMigration(migration) {
  if (!migration || !IDENTIFIER_PATTERN.test(String(migration.id ?? ''))) throw new Error('invalid_migration_id');
  if (typeof migration.up !== 'function' && typeof migration.sql !== 'string') throw new Error('invalid_migration_body');
}

export async function runMigrations(adapter, migrations = []) {
  if (!adapter || typeof adapter.query !== 'function') throw new Error('invalid_migration_adapter');
  const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
  ordered.forEach(validateMigration);
  await adapter.query('BEGIN');
  try {
    await adapter.query('CREATE SCHEMA IF NOT EXISTS shared');
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS shared.schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await adapter.query('SELECT id FROM shared.schema_migrations ORDER BY id');
    const appliedIds = new Set((existing.rows ?? []).map((row) => row.id));
    const applied = [];
    for (const migration of ordered) {
      if (appliedIds.has(migration.id)) continue;
      if (typeof migration.up === 'function') await migration.up(adapter);
      else await adapter.query(migration.sql);
      await adapter.query('INSERT INTO shared.schema_migrations (id) VALUES ($1)', [migration.id]);
      applied.push(migration.id);
    }
    await adapter.query('COMMIT');
    return Object.freeze({ status: 'complete', applied: Object.freeze(applied) });
  } catch (error) {
    await adapter.query('ROLLBACK');
    throw error;
  }
}

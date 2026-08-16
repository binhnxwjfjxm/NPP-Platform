import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as repo from '../db/repositories/backup.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELETE_BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
const DOMAIN_SCHEMAS = Object.freeze(['sales', 'purchasing', 'inventory', 'accounting', 'reporting', 'logistics', 'mcp']);
const MCP_PROTECTED_TABLES = new Set(['mcp_report_setting_groups', 'mcp_report_settings']);
const BUSINESS_SHARED_TABLES = new Set([
  'customer_groups',
  'customers',
  'customer_addresses',
  'customer_media',
  'suppliers',
  'supplier_contacts',
  'supplier_addresses',
  'supplier_payment_terms',
  'product_categories',
  'product_brands',
  'products',
  'product_variants',
  'product_barcodes',
  'price_lists',
  'price_list_items',
  'document_number_counters',
  'document_number_allocations',
]);
const CUSTOMER_SHARED_ROOTS = new Set(['customer_groups', 'customers', 'customer_addresses', 'customer_media']);
const SUPPLIER_SHARED_ROOTS = new Set(['suppliers', 'supplier_contacts', 'supplier_addresses', 'supplier_payment_terms']);
const PRODUCT_SHARED_ROOTS = new Set([
  'product_categories', 'product_brands', 'products', 'product_variants', 'product_barcodes', 'price_lists', 'price_list_items',
]);
const OPERATION_SHARED_ROOTS = new Set(['document_number_counters', 'document_number_allocations']);
const WALK_IN_SETTINGS_KEY = 'shared.sales_order_settings';
const CUSTOMERS_KEY = 'shared.customers';

export const BUSINESS_PURGE_TARGETS = Object.freeze({
  ALL_BUSINESS_DATA: Object.freeze({
    code: 'ALL_BUSINESS_DATA',
    label: 'Toàn bộ dữ liệu nghiệp vụ',
    description: 'Xóa dữ liệu test/nghiệp vụ, giữ nhân sự, tài khoản đăng nhập, phân quyền, cấu hình tổ chức và cấu hình nền cần để hệ thống tiếp tục hoạt động.',
  }),
  OPERATIONS_ONLY: Object.freeze({
    code: 'OPERATIONS_ONLY',
    label: 'Dữ liệu phát sinh',
    description: 'Xóa đơn hàng, kho, công nợ, giao hàng, báo cáo và hoạt động MCP; giữ khách hàng, nhà cung cấp và danh mục sản phẩm.',
  }),
  CUSTOMERS_AND_SALES: Object.freeze({
    code: 'CUSTOMERS_AND_SALES',
    label: 'Khách hàng & bán hàng',
    description: 'Xóa khách hàng và toàn bộ dữ liệu phụ thuộc như bán hàng, giao hàng, công nợ và hoạt động MCP có liên quan.',
  }),
  SUPPLIERS_AND_PURCHASING: Object.freeze({
    code: 'SUPPLIERS_AND_PURCHASING',
    label: 'Nhà cung cấp & mua hàng',
    description: 'Xóa nhà cung cấp và toàn bộ dữ liệu mua hàng/công nợ phụ thuộc.',
  }),
  PRODUCTS_AND_INVENTORY: Object.freeze({
    code: 'PRODUCTS_AND_INVENTORY',
    label: 'Sản phẩm & kho',
    description: 'Xóa danh mục sản phẩm, bảng giá và dữ liệu kho; giao dịch phụ thuộc cũng được xóa để không làm hỏng dữ liệu.',
  }),
  MCP_ONLY: Object.freeze({
    code: 'MCP_ONLY',
    label: 'Dữ liệu MCP',
    description: 'Xóa tuyến, phiên, ghé điểm, báo cáo, đơn nháp và dữ liệu hoạt động MCP; giữ cấu hình báo cáo MCP và dữ liệu Công Ty.',
  }),
});

export function normalizeBusinessPurgeTarget(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(BUSINESS_PURGE_TARGETS, code) ? code : null;
}

function resultError(code, statusCode, message, details = {}) {
  return { ok: false, failed: true, code, statusCode, message, details };
}
function q(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function tableKey(schema, table) { return `${schema}.${table}`; }
function isKnownNeutralizableDependency(parent, child) {
  return parent === CUSTOMERS_KEY && child === WALK_IN_SETTINGS_KEY;
}

async function loadCatalog(client) {
  const tables = await client.query(`
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           EXISTS (
             SELECT 1
             FROM pg_attribute a
             WHERE a.attrelid = c.oid
               AND a.attname = 'installation_id'
               AND a.attnum > 0
               AND NOT a.attisdropped
           ) AS has_installation_id
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname IN ('shared','sales','purchasing','inventory','accounting','reporting','logistics','mcp')
  `);
  const foreignKeys = await client.query(`
    SELECT child_ns.nspname AS child_schema,
           child.relname AS child_table,
           parent_ns.nspname AS parent_schema,
           parent.relname AS parent_table
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE fk.contype = 'f'
      AND child_ns.nspname IN ('shared','sales','purchasing','inventory','accounting','reporting','logistics','mcp')
      AND parent_ns.nspname IN ('shared','sales','purchasing','inventory','accounting','reporting','logistics','mcp')
  `);
  const byKey = new Map();
  for (const row of tables.rows ?? []) {
    const key = tableKey(row.schema_name, row.table_name);
    byKey.set(key, { key, schema: row.schema_name, table: row.table_name, hasInstallationId: row.has_installation_id === true });
  }
  return { tables: byKey, foreignKeys: foreignKeys.rows ?? [] };
}

function isProtectedMcpTable(table) {
  return table?.schema === 'mcp' && MCP_PROTECTED_TABLES.has(table.table);
}
function eligibleBusinessTable(table) {
  if (!table || isProtectedMcpTable(table)) return false;
  return DOMAIN_SCHEMAS.includes(table.schema)
    || (table.schema === 'shared' && BUSINESS_SHARED_TABLES.has(table.table));
}

function addSchemaRoots(roots, catalog, schemas) {
  for (const table of catalog.tables.values()) {
    if (schemas.includes(table.schema) && table.hasInstallationId && !isProtectedMcpTable(table)) roots.add(table.key);
  }
}
function addSharedRoots(roots, catalog, names) {
  for (const name of names) {
    const key = tableKey('shared', name);
    if (catalog.tables.has(key)) roots.add(key);
  }
}

function rootsForTarget(catalog, targetCode) {
  const roots = new Set();
  if (targetCode === 'ALL_BUSINESS_DATA') {
    addSchemaRoots(roots, catalog, DOMAIN_SCHEMAS);
    addSharedRoots(roots, catalog, BUSINESS_SHARED_TABLES);
  } else if (targetCode === 'OPERATIONS_ONLY') {
    addSchemaRoots(roots, catalog, DOMAIN_SCHEMAS);
    addSharedRoots(roots, catalog, OPERATION_SHARED_ROOTS);
  } else if (targetCode === 'CUSTOMERS_AND_SALES') {
    addSchemaRoots(roots, catalog, ['sales', 'logistics', 'reporting', 'mcp']);
    addSharedRoots(roots, catalog, CUSTOMER_SHARED_ROOTS);
  } else if (targetCode === 'SUPPLIERS_AND_PURCHASING') {
    addSchemaRoots(roots, catalog, ['purchasing']);
    addSharedRoots(roots, catalog, SUPPLIER_SHARED_ROOTS);
  } else if (targetCode === 'PRODUCTS_AND_INVENTORY') {
    addSchemaRoots(roots, catalog, ['inventory', 'mcp']);
    addSharedRoots(roots, catalog, PRODUCT_SHARED_ROOTS);
  } else if (targetCode === 'MCP_ONLY') {
    addSchemaRoots(roots, catalog, ['mcp']);
  }
  return roots;
}

function expandDependentTables(catalog, roots) {
  const selected = new Set(roots);
  const childrenByParent = new Map();
  for (const fk of catalog.foreignKeys) {
    const parent = tableKey(fk.parent_schema, fk.parent_table);
    const child = tableKey(fk.child_schema, fk.child_table);
    if (parent === child) continue;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, new Set());
    childrenByParent.get(parent).add(child);
  }
  const queue = [...selected];
  while (queue.length) {
    const parent = queue.shift();
    for (const child of childrenByParent.get(parent) ?? []) {
      if (selected.has(child) || isKnownNeutralizableDependency(parent, child)) continue;
      const childTable = catalog.tables.get(child);
      if (!eligibleBusinessTable(childTable)) {
        throw Object.assign(new Error('purge_protected_dependency'), { code: 'PURGE_PROTECTED_DEPENDENCY', parent, child });
      }
      selected.add(child);
      queue.push(child);
    }
  }
  return selected;
}

function deletionOrder(catalog, selected) {
  const remaining = new Set(selected);
  const childrenByParent = new Map();
  for (const fk of catalog.foreignKeys) {
    const parent = tableKey(fk.parent_schema, fk.parent_table);
    const child = tableKey(fk.child_schema, fk.child_table);
    if (parent === child || !remaining.has(parent) || !remaining.has(child)) continue;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, new Set());
    childrenByParent.get(parent).add(child);
  }
  const ordered = [];
  while (remaining.size) {
    const leaves = [...remaining].filter((key) => ![...(childrenByParent.get(key) ?? [])].some((child) => remaining.has(child)));
    if (!leaves.length) throw Object.assign(new Error('purge_fk_cycle'), { code: 'PURGE_FK_CYCLE', tables: [...remaining].sort() });
    leaves.sort();
    for (const key of leaves) {
      remaining.delete(key);
      ordered.push(catalog.tables.get(key));
    }
  }
  return ordered;
}

export async function buildBusinessPurgePlan(client, targetCode) {
  const normalizedTarget = normalizeBusinessPurgeTarget(targetCode);
  if (!normalizedTarget) throw Object.assign(new Error('purge_target_invalid'), { code: 'PURGE_TARGET_INVALID' });
  const catalog = await loadCatalog(client);
  const roots = rootsForTarget(catalog, normalizedTarget);
  if (!roots.size) throw Object.assign(new Error('purge_target_empty'), { code: 'PURGE_TARGET_EMPTY' });
  const selected = expandDependentTables(catalog, roots);
  return Object.freeze({ targetCode: normalizedTarget, tables: Object.freeze(deletionOrder(catalog, selected)) });
}

async function neutralizeProtectedReferences(client, plan, installationId) {
  if (plan.tables.some((table) => table.key === CUSTOMERS_KEY)) {
    await client.query(
      `UPDATE shared.sales_order_settings
          SET walk_in_customer_id = NULL, updated_at = now()
        WHERE installation_id = $1 AND walk_in_customer_id IS NOT NULL`,
      [installationId],
    );
  }
}

async function deleteTableRows(client, table, installationId) {
  const identifier = `${q(table.schema)}.${q(table.table)}`;
  const result = table.hasInstallationId
    ? await client.query(`DELETE FROM ${identifier} WHERE installation_id = $1`, [installationId])
    : await client.query(`DELETE FROM ${identifier}`);
  return Number(result.rowCount ?? 0);
}

async function clearTechnicalResidue(client, { installationId, requestId }) {
  const cleanup = [
    { schema: 'shared', table: 'core_audit_records', hasInstallationId: true },
    { schema: 'shared', table: 'core_outbox_events', hasInstallationId: true },
  ];
  let deleted = 0;
  for (const table of cleanup) deleted += await deleteTableRows(client, table, installationId);
  const idempotency = await client.query(
    `DELETE FROM shared.core_idempotency_records
      WHERE installation_id = $1 AND request_id <> $2`,
    [installationId, requestId],
  );
  deleted += Number(idempotency.rowCount ?? 0);
  return deleted;
}

function publicPurgedIntent(intent) {
  return {
    id: intent.id,
    status: intent.status,
    backupJobId: intent.backup_job_id,
    targetCode: intent.target_code,
    authorizedAt: intent.authorized_at,
    purgeExecuted: intent.status === 'PURGED',
    purgeStartedAt: intent.purge_started_at,
    purgeCompletedAt: intent.purge_completed_at,
    purgeSummary: intent.purge_summary ?? null,
  };
}

export async function executeDeletionIntent(pool, { requestContext, intentId, now = () => new Date() }) {
  if (!UUID_PATTERN.test(String(intentId ?? '').trim())) return resultError('DATA_DELETION_INTENT_ID_INVALID', 400, 'Mã yêu cầu xóa không hợp lệ');
  return withAuditOutboxTransaction({
    adapter: pool,
    mutate: async (client) => {
      const intent = await repo.lockDeletionIntent(client, { installationId: requestContext.installationId, intentId });
      if (!intent) return resultError('DATA_DELETION_INTENT_NOT_FOUND', 404, 'Không tìm thấy yêu cầu xóa');
      if (intent.status === 'PURGED') return { ok: true, replayed: true, intent: publicPurgedIntent(intent) };
      if (intent.status !== 'AUTHORIZED') return resultError('DATA_DELETION_NOT_AUTHORIZED', 409, 'Yêu cầu xóa chưa được xác nhận');
      const targetCode = normalizeBusinessPurgeTarget(intent.target_code);
      if (!targetCode) return resultError('PURGE_TARGET_INVALID', 409, 'Mục tiêu xóa không còn hợp lệ');

      const backup = await repo.getBackupJob(client, { installationId: requestContext.installationId, jobId: intent.backup_job_id });
      if (!backup || backup.status !== 'VERIFIED' || !backup.verified_at || !backup.snapshot_at || !backup.dump_object_key || !backup.dump_sha256) {
        return resultError('DELETE_BACKUP_REQUIRED', 409, 'Cần một bản sao lưu đã xác minh trước khi xóa dữ liệu');
      }
      const snapshotAt = new Date(backup.snapshot_at);
      if (Number.isNaN(snapshotAt.getTime()) || now().getTime() - snapshotAt.getTime() > DELETE_BACKUP_MAX_AGE_MS) {
        return resultError('DELETE_BACKUP_TOO_OLD', 409, 'Bản sao lưu bảo vệ đã quá cũ; hãy tạo bản sao lưu mới');
      }

      let plan;
      try {
        plan = await buildBusinessPurgePlan(client, targetCode);
      } catch (error) {
        if (error?.code === 'PURGE_PROTECTED_DEPENDENCY') {
          return resultError('PURGE_PROTECTED_DEPENDENCY', 409, 'Mục tiêu xóa đang phụ thuộc vào dữ liệu hệ thống cần giữ', { parent: error.parent, child: error.child });
        }
        if (error?.code === 'PURGE_FK_CYCLE') return resultError('PURGE_DEPENDENCY_CYCLE', 409, 'Quan hệ dữ liệu hiện tại chưa thể xóa an toàn theo mục tiêu đã chọn');
        return resultError(error?.code || 'PURGE_PLAN_INVALID', 409, 'Không lập được kế hoạch xóa dữ liệu an toàn');
      }

      const startedAt = now().toISOString();
      const purging = await repo.markDeletionPurging(client, { installationId: requestContext.installationId, intentId, startedAt });
      if (!purging) return resultError('DATA_DELETION_NOT_AUTHORIZED', 409, 'Yêu cầu xóa không còn ở trạng thái được phép thực hiện');

      await neutralizeProtectedReferences(client, plan, requestContext.installationId);
      let deletedRows = 0;
      for (const table of plan.tables) deletedRows += await deleteTableRows(client, table, requestContext.installationId);
      deletedRows += await clearTechnicalResidue(client, { installationId: requestContext.installationId, requestId: requestContext.requestId });

      const completedAt = now().toISOString();
      const summary = {
        targetCode,
        deletedRows,
        affectedTableCount: plan.tables.length,
        backupJobId: intent.backup_job_id,
      };
      const completed = await repo.completeDeletionPurge(client, {
        installationId: requestContext.installationId,
        intentId,
        completedAt,
        summary,
      });
      if (!completed) throw new Error('data_deletion_completion_failed');

      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'business_data_purged',
        resourceType: 'data_deletion_intent',
        resourceId: intentId,
        afterData: {
          targetCode,
          deletedRows,
          affectedTableCount: plan.tables.length,
          backupJobId: intent.backup_job_id,
        },
      }));
      return { ok: true, intent: publicPurgedIntent(completed), expectedAuditCount: 1, expectedOutboxCount: 0 };
    },
  });
}
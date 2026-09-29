import pg from 'pg';

const { Pool } = pg;

export const MCP_MOBILE_RUNTIME_E2E = Object.freeze({
  installationId: 'e2e-installation',
  employeeId: '91111111-1111-4111-8111-111111111111',
  branchId: '93333333-3333-4333-8333-333333333333',
  warehouseId: '94444444-4444-4444-8444-444444444444',
  customerId: '95555555-5555-4555-8555-555555555555',
  customerAddressId: '96666666-6666-4666-8666-666666666666',
  unitId: '97777777-7777-4777-8777-777777777777',
  productId: '98888888-8888-4888-8888-888888888888',
  variantId: '99999999-9999-4999-8999-999999999999',
  salesChannelId: '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  priceListId: '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  priceItemId: '9ccccccc-cccc-4ccc-8ccc-cccccccccccc',
});

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`MCP_MOBILE_RUNTIME_E2E_MISSING_${name}`);
  return value;
}

export function assertEphemeralDatabase(connectionString, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv !== 'test') {
    throw new Error('MCP_MOBILE_RUNTIME_E2E_TEST_ENV_REQUIRED');
  }
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('MCP_MOBILE_RUNTIME_E2E_POSTGRES_REQUIRED');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('MCP_MOBILE_RUNTIME_E2E_EPHEMERAL_DATABASE_REQUIRED');
  }
}

export async function prepareMcpMobileRuntimeE2E({
  connectionString,
  installationId,
  sslMode = 'disable',
} = {}) {
  const databaseUrl = String(connectionString ?? '').trim();
  const resolvedInstallationId = String(installationId ?? '').trim();
  assertEphemeralDatabase(databaseUrl);
  if (!resolvedInstallationId) {
    throw new Error('MCP_MOBILE_RUNTIME_E2E_INSTALLATION_ID_REQUIRED');
  }

  const fixture = MCP_MOBILE_RUNTIME_E2E;
  const actor = 'e2e:mcp-mobile-runtime';
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: String(sslMode).trim().toLowerCase() === 'require'
      ? { rejectUnauthorized: false }
      : false,
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO shared.branches
        (id, installation_id, code, name, is_active, created_by, updated_by)
       VALUES ($1,$2,'MCP-L7-BR','MCP Mobile L7',true,$3,$3)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [fixture.branchId, resolvedInstallationId, actor],
    );

    await client.query(
      `INSERT INTO shared.warehouses
        (id, installation_id, branch_id, code, name, warehouse_type,
         location_management_mode, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,'MCP-L7-WH','Kho MCP Mobile L7','main',
         'UNMANAGED',true,$4,$4)
       ON CONFLICT (id) DO UPDATE
       SET branch_id = EXCLUDED.branch_id,
           name = EXCLUDED.name,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [fixture.warehouseId, resolvedInstallationId, fixture.branchId, actor],
    );

    await client.query(
      `INSERT INTO shared.customers
        (id, installation_id, code, name, payment_terms_days, credit_limit,
         is_active, created_by, updated_by)
       VALUES ($1,$2,'MCP-L7-CUS','Khách hàng MCP Mobile L7',15,10000000,
         true,$3,$3)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [fixture.customerId, resolvedInstallationId, actor],
    );

    await client.query(
      `INSERT INTO shared.customer_addresses
        (id, installation_id, customer_id, label, recipient_name, address_line1,
         ward, province, country_code, is_default, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,'Cửa hàng','Người nhận L7','123 Đường kiểm thử L7',
         'Phường kiểm thử','TP HCM','VN',true,true,$4,$4)
       ON CONFLICT (id) DO UPDATE
       SET customer_id = EXCLUDED.customer_id,
           address_line1 = EXCLUDED.address_line1,
           is_default = true,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [
        fixture.customerAddressId,
        resolvedInstallationId,
        fixture.customerId,
        actor,
      ],
    );

    await client.query(
      `INSERT INTO shared.units_of_measure
        (id, installation_id, code, name, unit_kind, allows_fractional,
         is_active, created_by, updated_by)
       VALUES ($1,$2,'MCP-L7-EA','Đơn vị MCP Mobile L7','COUNT',true,true,$3,$3)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [fixture.unitId, resolvedInstallationId, actor],
    );

    await client.query(
      `INSERT INTO shared.products
        (id, installation_id, code, name, is_orderable, is_active,
         created_by, updated_by)
       VALUES ($1,$2,'MCP-L7-PR','Sản phẩm MCP Mobile L7',true,true,$3,$3)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           is_orderable = true,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [fixture.productId, resolvedInstallationId, actor],
    );

    await client.query(
      `INSERT INTO shared.product_variants
        (id, installation_id, product_id, sku, name, variant_kind,
         is_inventory_base, is_sellable, is_catalog_visible, is_active,
         unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
       VALUES ($1,$2,$3,'MCP-L7-SKU','SKU MCP Mobile L7','BASE',
         true,true,true,true,$4,1,true,$5,$5)
       ON CONFLICT (id) DO UPDATE
       SET product_id = EXCLUDED.product_id,
           unit_id = EXCLUDED.unit_id,
           is_sellable = true,
           is_catalog_visible = true,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [
        fixture.variantId,
        resolvedInstallationId,
        fixture.productId,
        fixture.unitId,
        actor,
      ],
    );

    await client.query(
      `INSERT INTO shared.sales_channels
        (id, installation_id, code, name, is_active, created_by, updated_by)
       VALUES ($1,$2,'MCP-L7-CH','Kênh MCP Mobile L7',true,$3,$3)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [fixture.salesChannelId, resolvedInstallationId, actor],
    );

    await client.query(
      `INSERT INTO shared.price_lists
        (id, installation_id, code, name, list_type, currency_code, priority,
         stacking_mode, stop_processing, is_active, created_by, updated_by)
       VALUES ($1,$2,'MCP-L7-BASE','Giá cơ sở MCP Mobile L7','BASE','VND',100,
         'EXCLUSIVE',true,true,$3,$3)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           list_type = 'BASE',
           currency_code = 'VND',
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [fixture.priceListId, resolvedInstallationId, actor],
    );

    await client.query(
      `INSERT INTO shared.price_list_items
        (id, installation_id, price_list_id, variant_id, adjustment_type,
         amount_minor, min_quantity, source_kind, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'FIXED_PRICE',10000,0,'ADMIN',true,$5,$5)
       ON CONFLICT (id) DO UPDATE
       SET price_list_id = EXCLUDED.price_list_id,
           variant_id = EXCLUDED.variant_id,
           adjustment_type = 'FIXED_PRICE',
           amount_minor = 10000,
           min_quantity = 0,
           is_active = true,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [
        fixture.priceItemId,
        resolvedInstallationId,
        fixture.priceListId,
        fixture.variantId,
        actor,
      ],
    );

    await client.query('COMMIT');
    return Object.freeze({
      installationId: resolvedInstallationId,
      employeeId: fixture.employeeId,
      warehouseId: fixture.warehouseId,
      customerId: fixture.customerId,
      customerAddressId: fixture.customerAddressId,
      productId: fixture.productId,
      variantId: fixture.variantId,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname;
if (isMain) {
  const result = await prepareMcpMobileRuntimeE2E({
    connectionString: required('DATABASE_URL'),
    installationId: required('INSTALLATION_ID'),
    sslMode: process.env.DATABASE_SSL_MODE || 'disable',
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

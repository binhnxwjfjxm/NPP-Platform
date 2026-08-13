import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { reorderTripStops } from '../src/services/logistics-trip-planning.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3078',
    INSTALLATION_ID: `logistics-reorder-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3007',
  };
}

async function seedTwoStops(pool, installationId) {
  const actorId = 'test:dispatcher';
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const addressA = randomUUID();
  const addressB = randomUUID();
  const tripId = randomUUID();
  const stopA = randomUUID();
  const stopB = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('npp.logistics_write_context', 'trip_planning_service', true)");
    await client.query(
      `INSERT INTO shared.branches
         (id, installation_id, code, name, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,true,$5,$5)`,
      [branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actorId],
    );
    await client.query(
      `INSERT INTO shared.warehouses
         (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
      [warehouseId, installationId, branchId, `WH-${suffix}`, `Kho ${suffix}`, actorId],
    );
    await client.query(
      `INSERT INTO shared.customers
         (id, installation_id, code, name, payment_terms_days, credit_limit, is_active, created_by, updated_by)
       VALUES
         ($1,$3,$4,$6,15,10000000,true,$8,$8),
         ($2,$3,$5,$7,15,10000000,true,$8,$8)`,
      [customerA, customerB, installationId, `CUS-A-${suffix}`, `CUS-B-${suffix}`, `Khách A ${suffix}`, `Khách B ${suffix}`, actorId],
    );
    await client.query(
      `INSERT INTO shared.customer_addresses
         (id, installation_id, customer_id, label, recipient_name, address_line1,
          ward, province, country_code, is_default, is_active, created_by, updated_by)
       VALUES
         ($1,$3,$4,'Cửa hàng A','Người nhận A','123 Đường A','Phường A','TP HCM','VN',true,true,$6,$6),
         ($2,$3,$5,'Cửa hàng B','Người nhận B','456 Đường B','Phường B','TP HCM','VN',true,true,$6,$6)`,
      [addressA, addressB, installationId, customerA, customerB, actorId],
    );
    await client.query(
      `INSERT INTO logistics.delivery_trips
         (id, installation_id, trip_number, warehouse_id, status,
          create_idempotency_key, create_payload_hash, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$7)`,
      [tripId, installationId, `TRP-${suffix}`, warehouseId, `seed-trip-${suffix}`, 'a'.repeat(64), actorId],
    );
    await client.query(
      `INSERT INTO logistics.trip_stops
         (id, installation_id, trip_id, stop_sequence, customer_id, customer_address_id,
          address_snapshot, created_by, updated_by)
       VALUES
         ($1,$3,$4,1,$5,$7,$9::jsonb,$11,$11),
         ($2,$3,$4,2,$6,$8,$10::jsonb,$11,$11)`,
      [
        stopA,
        stopB,
        installationId,
        tripId,
        customerA,
        customerB,
        addressA,
        addressB,
        JSON.stringify({ addressLine1: '123 Đường A' }),
        JSON.stringify({ addressLine1: '456 Đường B' }),
        actorId,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return { actorId, warehouseId, tripId, stopA, stopB };
}

function adapterWithPublicSearchPath(pool) {
  return {
    async connect() {
      const client = await pool.connect();
      await client.query('SET search_path TO public');
      return {
        query: (...args) => client.query(...args),
        async release() {
          await client.query('RESET search_path').catch(() => {});
          client.release();
        },
      };
    },
  };
}

test('trip stop reorder works when logistics is absent from search_path and replays exactly once', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);

  try {
    const seeded = await seedTwoStops(pool, config.installationId);
    const adapter = adapterWithPublicSearchPath(pool);
    const requestContext = Object.freeze({
      installationId: config.installationId,
      actorId: seeded.actorId,
      employeeId: null,
      sourceApp: 'npp-core-api',
      requestId: `reorder-${randomUUID()}`,
      receivedAt: '2026-08-13T05:20:00.000Z',
      roles: Object.freeze(['bootstrap']),
      permissions: Object.freeze([]),
      scopes: Object.freeze({
        branchIds: Object.freeze([]),
        warehouseIds: Object.freeze([seeded.warehouseId]),
        territoryIds: Object.freeze([]),
      }),
    });
    const idempotencyKey = `reorder-${randomUUID()}`;
    const payload = { stopIds: [seeded.stopB, seeded.stopA] };

    const first = await reorderTripStops({
      adapter,
      requestContext,
      tripId: seeded.tripId,
      payload,
      idempotencyKey,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.replayed, false);
    assert.deepEqual(first.trip.stops.map((stop) => stop.id), [seeded.stopB, seeded.stopA]);

    const persisted = await pool.query(
      `SELECT id, stop_sequence
         FROM logistics.trip_stops
        WHERE installation_id = $1 AND trip_id = $2
        ORDER BY stop_sequence, id`,
      [config.installationId, seeded.tripId],
    );
    assert.deepEqual(
      persisted.rows.map((row) => [row.id, Number(row.stop_sequence)]),
      [[seeded.stopB, 1], [seeded.stopA, 2]],
    );

    const retry = await reorderTripStops({
      adapter,
      requestContext,
      tripId: seeded.tripId,
      payload,
      idempotencyKey,
    });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.replayed, true);

    const [events, audits, outbox] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS count
           FROM logistics.trip_events
          WHERE installation_id = $1 AND trip_id = $2 AND event_type = 'REORDERED'`,
        [config.installationId, seeded.tripId],
      ),
      pool.query(
        `SELECT count(*)::int AS count
           FROM shared.core_audit_records
          WHERE installation_id = $1 AND resource_type = 'delivery_trip'
            AND resource_id = $2 AND action = 'core.delivery_trip.stops_reordered'`,
        [config.installationId, seeded.tripId],
      ),
      pool.query(
        `SELECT count(*)::int AS count
           FROM shared.core_outbox_events
          WHERE installation_id = $1 AND aggregate_type = 'logistics.delivery_trip'
            AND aggregate_id = $2 AND event_type = 'core.delivery_trip.stops_reordered'`,
        [config.installationId, seeded.tripId],
      ),
    ]);
    assert.equal(events.rows[0].count, 1);
    assert.equal(audits.rows[0].count, 1);
    assert.equal(outbox.rows[0].count, 1);
  } finally {
    await closePool();
  }
});

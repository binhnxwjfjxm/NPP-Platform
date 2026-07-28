from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, content):
    Path(path).write_text(content, encoding='utf-8')


def replace_once(path, old, new):
    source = read(path)
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:100]!r}')
    write(path, source.replace(old, new, 1))


def insert_before(path, marker, addition):
    source = read(path)
    count = source.count(marker)
    if count != 1:
        raise SystemExit(f'{path}: expected one marker, found {count}: {marker[:100]!r}')
    write(path, source.replace(marker, addition + marker, 1))


migration = 'database/migrations/inventory/019_inventory_reservations_negative_stock.sql'
repository = 'npp-core/api/src/db/repositories/inventory-reservations.js'
service = 'npp-core/api/src/services/inventory-reservations.js'
ledger_repository = 'npp-core/api/src/db/repositories/inventory-ledger.js'
ledger_service = 'npp-core/api/src/services/inventory-ledger.js'
tests = 'npp-core/api/test/inventory-reservations.test.js'
workflow = '.github/workflows/phase-4-inventory-reservations.yml'
package = 'npp-core/api/package.json'

replace_once(
    migration,
    """CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_scope_active_idx
  ON inventory.inventory_reservations (installation_id, warehouse_id, location_id, base_variant_id, lot_id, state)
  WHERE state = 'ACTIVE';""",
    """DROP INDEX IF EXISTS inventory.inventory_reservations_scope_active_idx;
CREATE INDEX inventory_reservations_scope_active_idx
  ON inventory.inventory_reservations (installation_id, warehouse_id, location_id, base_variant_id, lot_id)
  WHERE state = 'ACTIVE';""",
)

replace_once(
    migration,
    """CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_reservation_write_context', true);
BEGIN
  IF write_context IS NULL OR write_context NOT IN ('reservation_service') THEN
    RAISE EXCEPTION 'inventory_reservation_write_requires_service_context';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;""",
    """CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_reservation_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'reservation_service' THEN
    RAISE EXCEPTION 'inventory_reservation_write_requires_service_context';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory_reservations_cannot_be_deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'inventory_reservation_must_start_active';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.base_variant_id IS DISTINCT FROM OLD.base_variant_id
     OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.source_domain IS DISTINCT FROM OLD.source_domain
     OR NEW.source_document_type IS DISTINCT FROM OLD.source_document_type
     OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'inventory_reservation_immutable_fields_cannot_change';
  END IF;

  IF OLD.state <> 'ACTIVE'
     OR NEW.state NOT IN ('RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'inventory_reservation_invalid_state_transition';
  END IF;

  IF NEW.transitioned_at < OLD.transitioned_at THEN
    RAISE EXCEPTION 'inventory_reservation_transition_time_cannot_move_backwards';
  END IF;

  RETURN NEW;
END;
$$;""",
)

insert_before(
    migration,
    '-- Update inventory.inventory_balances reserved_quantity via trigger when reservation events occur\n',
    """-- Reservation events may only be appended by the reservation service transaction.
CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_event_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_reservation_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'reservation_service' THEN
    RAISE EXCEPTION 'inventory_reservation_event_insert_requires_service_context';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservation_events_insert_guard ON inventory.inventory_reservation_events;
CREATE TRIGGER inventory_reservation_events_insert_guard
BEFORE INSERT ON inventory.inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_reservation_event_insert();

-- Database backstop for all future negative inventory movement lines.
-- A negative line must leave on-hand greater than or equal to reserved quantity.
CREATE OR REPLACE FUNCTION inventory.guard_inventory_negative_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_on_hand numeric(30,12);
  current_reserved numeric(30,12);
BEGIN
  IF NEW.base_quantity_delta >= 0 THEN
    RETURN NEW;
  END IF;

  SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO current_on_hand, current_reserved
    FROM inventory.inventory_balances balance
   WHERE balance.installation_id = NEW.installation_id
     AND balance.warehouse_id = NEW.warehouse_id
     AND balance.location_id IS NOT DISTINCT FROM NEW.location_id
     AND balance.base_variant_id = NEW.base_variant_id
     AND balance.lot_id IS NULL
   FOR UPDATE;

  IF NOT FOUND OR current_on_hand + NEW.base_quantity_delta < current_reserved THEN
    RAISE EXCEPTION 'inventory_negative_stock_denied';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_lines_negative_stock_guard
  ON inventory.inventory_movement_lines;
CREATE TRIGGER inventory_movement_lines_negative_stock_guard
BEFORE INSERT ON inventory.inventory_movement_lines
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_negative_stock();

""",
)

replace_once(
    migration,
    """  -- Determine delta based on transition
  CASE NEW.transition
    WHEN 'CREATE_ACTIVE' THEN
      delta := reservation_record.quantity;
    WHEN 'RELEASE_TO_RELEASED', 'CONSUME_TO_CONSUMED', 'EXPIRE_TO_EXPIRED', 'CANCEL_TO_CANCELLED' THEN
      delta := -reservation_record.quantity;
    ELSE
      delta := 0;
  END CASE;""",
    """  -- Validate that the immutable event matches the aggregate state, then determine delta.
  CASE NEW.transition
    WHEN 'CREATE_ACTIVE' THEN
      IF reservation_record.state <> 'ACTIVE' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := reservation_record.quantity;
    WHEN 'RELEASE_TO_RELEASED' THEN
      IF reservation_record.state <> 'RELEASED' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := -reservation_record.quantity;
    WHEN 'CONSUME_TO_CONSUMED' THEN
      IF reservation_record.state <> 'CONSUMED' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := -reservation_record.quantity;
    WHEN 'EXPIRE_TO_EXPIRED' THEN
      IF reservation_record.state <> 'EXPIRED' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := -reservation_record.quantity;
    WHEN 'CANCEL_TO_CANCELLED' THEN
      IF reservation_record.state <> 'CANCELLED' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := -reservation_record.quantity;
    ELSE
      RAISE EXCEPTION 'inventory_reservation_transition_not_supported';
  END CASE;""",
)

replace_once(
    repository,
    """export async function lockIdempotencyKey(client, { installationId, idempotencyKey }) {
  // Advisory lock on idempotency key to prevent concurrent duplicate creates
  const lockId = Buffer.from(`${installationId}:${idempotencyKey}`).toString('hex').slice(0, 16);
  const lockValue = BigInt(`0x${lockId}`) % 4294967296n; // pg_advisory_lock accepts 32-bit integer
  await client.query('SELECT pg_advisory_lock($1)', [lockValue]);
}""",
    """export async function lockIdempotencyKey(client, { installationId, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`${installationId}:${idempotencyKey}`],
  );
}""",
)

replace_once(
    repository,
    """       AND base_variant_id = $4
        AND lot_id IS NOT DISTINCT FROM $5`,""",
    """       AND base_variant_id = $4
        AND lot_id IS NOT DISTINCT FROM $5
      FOR UPDATE`,""",
)

replace_once(
    repository,
    """export async function resolveVariant(client, { installationId, baseVariantId }) {
  const result = await client.query(
    `SELECT
       id,
       installation_id,
       sku,
       is_active
       FROM shared.product_variants
      WHERE installation_id = $1 AND id = $2`,
    [installationId, baseVariantId],
  );
  return result.rows[0] ?? null;
}""",
    """export async function resolveVariant(client, { installationId, baseVariantId }) {
  const result = await client.query(
    `SELECT
       variant.id,
       variant.installation_id,
       variant.sku,
       variant.is_active,
       variant.is_inventory_base,
       variant.unit_id,
       unit.allows_fractional,
       unit.is_active AS unit_active
       FROM shared.product_variants variant
       JOIN shared.units_of_measure unit
         ON unit.installation_id = variant.installation_id
        AND unit.id = variant.unit_id
      WHERE variant.installation_id = $1 AND variant.id = $2`,
    [installationId, baseVariantId],
  );
  return result.rows[0] ?? null;
}""",
)

replace_once(
    repository,
    """  const row = result.rows[0];
  return row?.total_reserved ? BigInt(row.total_reserved) : 0n;
}""",
    """  return result.rows[0]?.total_reserved ?? '0.000000000000';
}""",
)

replace_once(
    service,
    """  return Object.freeze({ ok: true, scaled, value: normalized });
}""",
    """  return Object.freeze({ ok: true, scaled, value: formatScale12(scaled) });
}""",
)

insert_before(
    service,
    'function hasPermission(requestContext, permission) {\n',
    """function parseStoredScale12(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\\d+)(?:\\.(\\d{1,12}))?$/.exec(normalized);
  if (!match) throw new Error('invalid_stored_inventory_quantity');
  const fractional = (match[3] ?? '').padEnd(12, '0');
  const scaled = BigInt(match[2]) * SCALE_12 + BigInt(fractional || '0');
  return match[1] === '-' ? -scaled : scaled;
}

function validateRequestContext(requestContext) {
  if (!requestContext
    || typeof requestContext.installationId !== 'string'
    || !requestContext.installationId.trim()
    || typeof requestContext.actorId !== 'string'
    || !requestContext.actorId.trim()
    || typeof requestContext.requestId !== 'string'
    || !requestContext.requestId.trim()
    || typeof requestContext.sourceApp !== 'string'
    || !requestContext.sourceApp.trim()) {
    return failure('INVALID_REQUEST_CONTEXT', 'A complete server-owned request context is required');
  }
  return null;
}

""",
)

replace_once(
    service,
    """  // P4.3: No partial reservations allowed
  if (quantity.scaled % SCALE_12 !== 0n) {
    return failure('PARTIAL_RESERVATION_NOT_SUPPORTED', 'P4.3 does not support partial quantity; reservation must be whole number in base unit');
  }

""",
    '',
)

replace_once(
    service,
    """async function createReservation(client, { requestContext, idempotencyKey, payload }) {
  const idempotencyError = validateIdempotencyKey(idempotencyKey);""",
    """async function createReservation(client, { requestContext, idempotencyKey, payload }) {
  const contextError = validateRequestContext(requestContext);
  if (contextError) return contextError;

  const idempotencyError = validateIdempotencyKey(idempotencyKey);""",
)

replace_once(
    service,
    """  if (!variant || !variant.is_active) return failure('VARIANT_NOT_AVAILABLE', 'Base variant is missing or inactive');

  // Check negative-stock constraint: deny by default""",
    """  if (!variant || !variant.is_active || !variant.unit_active) {
    return failure('VARIANT_NOT_AVAILABLE', 'Base variant or its unit is missing or inactive');
  }
  if (!variant.is_inventory_base) {
    return failure('BASE_VARIANT_REQUIRED', 'Reservations must target the active inventory-base variant');
  }
  if (!variant.allows_fractional && normalized.value.quantityScaled % SCALE_12 !== 0n) {
    return failure('FRACTIONAL_QUANTITY_NOT_ALLOWED', 'The inventory-base unit does not allow fractional quantity');
  }

  // Check negative-stock constraint: deny by default""",
)

replace_once(
    service,
    """  const onHand = balance ? BigInt(String(balance.on_hand_quantity).split('.').join('')) : 0n;
  const reserved = balance ? BigInt(String(balance.reserved_quantity).split('.').join('')) : 0n;""",
    """  const onHand = balance ? parseStoredScale12(balance.on_hand_quantity) : 0n;
  const reserved = balance ? parseStoredScale12(balance.reserved_quantity) : 0n;""",
)

replace_once(
    service,
    """function normalizeTransitionPayload(transition, payload) {
  const valid = VALID_TRANSITIONS[transition];
  if (!valid) return failure('INVALID_TRANSITION', `Transition ${transition} is not recognized`);

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      transition,
      reason: text(payload?.reason, 500) ?? null,
      metadata: objectValue(payload?.metadata) ?? {},
    }),
  });
}""",
    """function normalizeTransitionPayload(transition, payload) {
  const valid = VALID_TRANSITIONS[transition];
  if (!valid) return failure('INVALID_TRANSITION', `Transition ${transition} is not recognized`);

  const partialFields = ['quantity', 'releaseQuantity', 'consumeQuantity', 'partialQuantity'];
  if (payload && partialFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field))) {
    return failure(
      'PARTIAL_RESERVATION_NOT_SUPPORTED',
      'P4.3 transitions apply to the complete reservation quantity; partial release or consume is not supported',
    );
  }

  const metadata = objectValue(payload?.metadata);
  if (metadata === null) return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      transition,
      reason: text(payload?.reason, 500) ?? null,
      metadata,
    }),
  });
}""",
)

replace_once(
    service,
    """async function transitionReservation(client, { requestContext, reservationId, transition, payload }) {
  if (!requestContext || !requestContext.requestId) {
    return failure('INVALID_REQUEST_CONTEXT', 'Request context is required');
  }
""",
    """async function transitionReservation(client, { requestContext, reservationId, transition, payload }) {
  const contextError = validateRequestContext(requestContext);
  if (contextError) return contextError;
""",
)

insert_before(
    ledger_repository,
    'export async function insertMovement(client, movement) {\n',
    """export async function lockInventoryBalanceScope(client, {
  installationId,
  warehouseId,
  locationId,
  baseVariantId,
}) {
  const result = await client.query(
    `SELECT on_hand_quantity, reserved_quantity
       FROM inventory.inventory_balances
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND location_id IS NOT DISTINCT FROM $3
        AND base_variant_id = $4
        AND lot_id IS NULL
      FOR UPDATE`,
    [installationId, warehouseId, locationId, baseVariantId],
  );
  return result.rows?.[0] ?? null;
}

""",
)

insert_before(
    ledger_service,
    'function multiplyToBase(sourceQuantity, conversionToBase, direction) {\n',
    """function parseStoredScale12(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\\d+)(?:\\.(\\d{1,12}))?$/.exec(normalized);
  if (!match) throw new Error('invalid_stored_inventory_quantity');
  const scale = 1_000_000_000_000n;
  const fractional = (match[3] ?? '').padEnd(12, '0');
  const scaled = BigInt(match[2]) * scale + BigInt(fractional || '0');
  return match[1] === '-' ? -scaled : scaled;
}

""",
)

insert_before(
    ledger_service,
    'function normalizeReversalPayload(payload) {\n',
    """async function validateReversalAvailability(client, installationId, originalLines) {
  const scopes = new Map();
  for (const line of originalLines) {
    const reversalDelta = -parseStoredScale12(line.base_quantity_delta);
    if (reversalDelta >= 0n) continue;
    const key = [line.warehouse_id, line.location_id ?? '', line.base_variant_id].join(':');
    const existing = scopes.get(key);
    if (existing) {
      existing.delta += reversalDelta;
    } else {
      scopes.set(key, {
        key,
        warehouseId: line.warehouse_id,
        locationId: line.location_id,
        baseVariantId: line.base_variant_id,
        delta: reversalDelta,
      });
    }
  }

  for (const scope of [...scopes.values()].sort((left, right) => left.key.localeCompare(right.key))) {
    const balance = await repository.lockInventoryBalanceScope(client, {
      installationId,
      warehouseId: scope.warehouseId,
      locationId: scope.locationId,
      baseVariantId: scope.baseVariantId,
    });
    if (!balance) {
      return failure('NEGATIVE_STOCK_DENIED', 'Reversal would create stock without an existing balance');
    }
    const onHandAfter = parseStoredScale12(balance.on_hand_quantity) + scope.delta;
    const reserved = parseStoredScale12(balance.reserved_quantity);
    if (onHandAfter < reserved) {
      return failure('NEGATIVE_STOCK_DENIED', 'Reversal would reduce on-hand below reserved quantity');
    }
  }
  return null;
}

""",
)

replace_once(
    ledger_service,
    """  if (allowedWarehouses.size === 0 || originalLines.some((line) => !allowedWarehouses.has(line.warehouse_id))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Movement contains a warehouse outside the server-owned request scope');
  }
  const movement = await repository.insertMovement(client, {""",
    """  if (allowedWarehouses.size === 0 || originalLines.some((line) => !allowedWarehouses.has(line.warehouse_id))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Movement contains a warehouse outside the server-owned request scope');
  }
  const availabilityError = await validateReversalAvailability(
    client,
    requestContext.installationId,
    originalLines,
  );
  if (availabilityError) return availabilityError;

  const movement = await repository.insertMovement(client, {""",
)

replace_once(
    tests,
    """import {
  executeInventoryPost,
} from '../src/services/inventory-ledger.js';""",
    """import {
  executeInventoryPost,
  executeInventoryReversal,
} from '../src/services/inventory-ledger.js';""",
)

replace_once(
    tests,
    """    `INSERT INTO shared.units_of_measure (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,false,true,$6,$6)`,
    [baseUnitId, installationId, 'UNIT', 'Đơn vị kiểm thử', 'COUNT', 'test:seed'],""",
    """    `INSERT INTO shared.units_of_measure (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,true,true,$6,$6)`,
    [baseUnitId, installationId, 'UNIT', 'Đơn vị kiểm thử', 'WEIGHT', 'test:seed'],""",
)

replace_once(
    tests,
    """    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, unit_id, sku, is_base, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,true,true,$6,$6)`,
    [baseVariantId, installationId, productId, baseUnitId, `SKU-${suffix}`, 'test:seed'],""",
    """    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
       is_sellable, is_catalog_visible, is_active, unit_id, conversion_to_base,
       is_purchasable, created_by, updated_by
     ) VALUES ($1,$2,$3,$5,'SKU cơ sở P4.3','BASE',true,true,true,true,$4,1,true,$6,$6)`,
    [baseVariantId, installationId, productId, baseUnitId, `SKU-${suffix}`, 'test:seed'],""",
)

insert_before(
    tests,
    "test('Phase 4.3: Inventory reservations create with permission and scope checks', async () => {\n",
    """async function postOpening(pool, config, master, quantity, label = randomUUID()) {
  return executeInventoryPost({
    adapter: pool,
    requestContext: requestContext(config.installationId, [master.warehouseId], `req-opening-${label}`),
    idempotencyKey: `opening-${label}`,
    payload: {
      movementType: 'OPENING_BALANCE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'OPENING_BALANCE_IMPORT',
      sourceDocumentId: `opening-source-${label}`,
      documentDate: '2026-07-28',
      lines: [{
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        sourceVariantId: master.baseVariantId,
        sourceQuantity: quantity,
        direction: 'IN',
      }],
    },
  });
}

async function readBalance(pool, config, master) {
  const result = await pool.query(
    `SELECT on_hand_quantity, reserved_quantity, available_quantity
       FROM inventory.inventory_balances
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND location_id = $3
        AND base_variant_id = $4
        AND lot_id IS NULL`,
    [config.installationId, master.warehouseId, master.locationId, master.baseVariantId],
  );
  return result.rows[0] ?? null;
}

""",
)

replace_once(
    tests,
    """    // Create reservation successfully
    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reserve-${randomUUID()}`),
      idempotencyKey: `reserve-${randomUUID()}`,
      payload: {""",
    """    // Create reservation successfully
    const reservationKey = `reserve-${randomUUID()}`;
    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reserve-${randomUUID()}`),
      idempotencyKey: reservationKey,
      payload: {""",
)

replace_once(
    tests,
    """      requestContext: requestContext(config.installationId, [master.warehouseId], `req-replay-${randomUUID()}`),
      idempotencyKey: `reserve-${randomUUID()}`,
      payload: {""",
    """      requestContext: requestContext(config.installationId, [master.warehouseId], `req-replay-${randomUUID()}`),
      idempotencyKey: reservationKey,
      payload: {""",
)

replace_once(
    tests,
    """      requestContext: requestContext(config.installationId, [master.warehouseId], `req-mismatch-${randomUUID()}`),
      idempotencyKey: `reserve-${randomUUID()}`,
      payload: {""",
    """      requestContext: requestContext(config.installationId, [master.warehouseId], `req-mismatch-${randomUUID()}`),
      idempotencyKey: reservationKey,
      payload: {""",
)

partial_start = "test('Phase 4.3: Inventory reservations reject partial quantity (P4.3 constraint)', async () => {"
partial_end = "test('Phase 4.3: Inventory reservations immutable event history (append-only)', async () => {"
source = read(tests)
start = source.index(partial_start)
end = source.index(partial_end)
replacement = """test('Phase 4.3: Decimal reservation succeeds while partial transition fails closed', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await postOpening(pool, config, master, '100.000000');
    assert.equal(opening.ok, true, opening.message);

    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-decimal-${randomUUID()}`),
      idempotencyKey: `decimal-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '10.5',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(reserve.ok, true, reserve.message);
    assert.equal(String(reserve.reservation.quantity), '10.500000000000');

    const partialRelease = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-partial-${randomUUID()}`),
      reservationId: reserve.reservation.id,
      payload: { quantity: '5.250000000000', reason: 'partial release is not supported' },
    });
    assert.equal(partialRelease.ok, false);
    assert.equal(partialRelease.code, 'PARTIAL_RESERVATION_NOT_SUPPORTED');

    const balanceWhileActive = await readBalance(pool, config, master);
    assert.equal(String(balanceWhileActive.reserved_quantity), '10.500000000000');

    const fullRelease = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-full-${randomUUID()}`),
      reservationId: reserve.reservation.id,
      payload: { reason: 'release complete reservation' },
    });
    assert.equal(fullRelease.ok, true, fullRelease.message);
    assert.equal(fullRelease.reservation.state, 'RELEASED');
  } finally {
    await closePool();
  }
});

""" + partial_end
write(tests, source[:start] + replacement + source[end + len(partial_end):])

insert_before(
    tests,
    "test('Phase 4.3: Inventory reservations decimal precision (scale 12)', async () => {\n",
    """test('Phase 4.3: Concurrent reservation requests are idempotent and cannot oversell', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await postOpening(pool, config, master, '10.000000');
    assert.equal(opening.ok, true, opening.message);

    const sameKey = `same-${randomUUID()}`;
    const samePayload = {
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      quantity: '4.000000000000',
      sourceDomain: 'TEST',
    };
    const sameResults = await Promise.all([
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(config.installationId, [master.warehouseId], `req-same-a-${randomUUID()}`),
        idempotencyKey: sameKey,
        payload: samePayload,
      }),
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(config.installationId, [master.warehouseId], `req-same-b-${randomUUID()}`),
        idempotencyKey: sameKey,
        payload: samePayload,
      }),
    ]);
    assert.equal(sameResults.every((result) => result.ok), true);
    assert.equal(sameResults.filter((result) => result.replayed).length, 1);
    assert.equal(sameResults[0].reservation.id, sameResults[1].reservation.id);

    const duplicateCount = await pool.query(
      `SELECT count(*)::int AS count FROM inventory.inventory_reservations
        WHERE installation_id = $1 AND idempotency_key = $2`,
      [config.installationId, sameKey],
    );
    assert.equal(duplicateCount.rows[0].count, 1);

    const released = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-release-same-${randomUUID()}`),
      reservationId: sameResults[0].reservation.id,
      payload: { reason: 'reset concurrency fixture' },
    });
    assert.equal(released.ok, true, released.message);

    const oversellPayload = {
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      quantity: '7.000000000000',
      sourceDomain: 'TEST',
    };
    const oversellResults = await Promise.all([
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(config.installationId, [master.warehouseId], `req-over-a-${randomUUID()}`),
        idempotencyKey: `over-a-${randomUUID()}`,
        payload: oversellPayload,
      }),
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(config.installationId, [master.warehouseId], `req-over-b-${randomUUID()}`),
        idempotencyKey: `over-b-${randomUUID()}`,
        payload: oversellPayload,
      }),
    ]);
    assert.equal(oversellResults.filter((result) => result.ok).length, 1);
    assert.equal(
      oversellResults.filter((result) => !result.ok && result.code === 'INSUFFICIENT_AVAILABLE_QUANTITY').length,
      1,
    );
    const balance = await readBalance(pool, config, master);
    assert.equal(String(balance.reserved_quantity), '7.000000000000');
    assert.equal(String(balance.available_quantity), '3.000000000000');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Direct balance mutation is denied and installation isolation is fail-closed', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await postOpening(pool, config, master, '20.000000');
    assert.equal(opening.ok, true, opening.message);
    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-scope-${randomUUID()}`),
      idempotencyKey: `scope-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '5.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(reserve.ok, true, reserve.message);

    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_balances
            SET reserved_quantity = 0
          WHERE installation_id = $1 AND warehouse_id = $2`,
        [config.installationId, master.warehouseId],
      ),
      /inventory_balance_write_requires_projector/,
    );

    const isolated = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(`other-${randomUUID()}`, [master.warehouseId], `req-isolated-${randomUUID()}`),
      reservationId: reserve.reservation.id,
      payload: { reason: 'cross-installation attempt' },
    });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'RESERVATION_NOT_FOUND');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Reversal cannot reduce on-hand below reserved quantity', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await postOpening(pool, config, master, '20.000000');
    assert.equal(opening.ok, true, opening.message);
    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reserve-reversal-${randomUUID()}`),
      idempotencyKey: `reserve-reversal-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '15.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(reserve.ok, true, reserve.message);

    const reversal = await executeInventoryReversal({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reversal-${randomUUID()}`),
      idempotencyKey: `reversal-${randomUUID()}`,
      movementId: opening.movement.id,
      payload: {
        documentDate: '2026-07-28',
        reasonCode: 'TEST_CORRECTION',
        reasonNote: 'Verify reserved stock cannot be reversed below zero availability',
      },
    });
    assert.equal(reversal.ok, false);
    assert.equal(reversal.code, 'NEGATIVE_STOCK_DENIED');

    const balance = await readBalance(pool, config, master);
    assert.equal(String(balance.on_hand_quantity), '20.000000000000');
    assert.equal(String(balance.reserved_quantity), '15.000000000000');
    assert.equal(String(balance.available_quantity), '5.000000000000');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Audit failure rolls back reservation, event, balance and outbox atomically', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await postOpening(pool, config, master, '20.000000');
    assert.equal(opening.ok, true, opening.message);

    const failedKey = `rollback-${randomUUID()}`;
    const failedRequestId = `req-rollback-${randomUUID()}`;
    const failingAdapter = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (sql, values = []) => {
            if (/insert\\s+into\\s+shared\\.core_audit_records/i.test(String(sql))) {
              throw new Error('forced_audit_failure');
            }
            return client.query(sql, values);
          },
          release: () => client.release(),
        };
      },
    };

    await assert.rejects(
      executeReserveInventory({
        adapter: failingAdapter,
        requestContext: requestContext(config.installationId, [master.warehouseId], failedRequestId),
        idempotencyKey: failedKey,
        payload: {
          warehouseId: master.warehouseId,
          locationId: master.locationId,
          baseVariantId: master.baseVariantId,
          quantity: '6.000000000000',
          sourceDomain: 'TEST',
        },
      }),
      /forced_audit_failure/,
    );

    const reservationCount = await pool.query(
      `SELECT count(*)::int AS count FROM inventory.inventory_reservations
        WHERE installation_id = $1 AND idempotency_key = $2`,
      [config.installationId, failedKey],
    );
    assert.equal(reservationCount.rows[0].count, 0);
    const eventCount = await pool.query(
      `SELECT count(*)::int AS count FROM inventory.inventory_reservation_events
        WHERE installation_id = $1 AND request_id = $2`,
      [config.installationId, failedRequestId],
    );
    assert.equal(eventCount.rows[0].count, 0);
    const outboxCount = await pool.query(
      `SELECT count(*)::int AS count FROM shared.core_outbox_events
        WHERE installation_id = $1 AND request_id = $2`,
      [config.installationId, failedRequestId],
    );
    assert.equal(outboxCount.rows[0].count, 0);
    const balance = await readBalance(pool, config, master);
    assert.equal(String(balance.reserved_quantity), '0.000000000000');
  } finally {
    await closePool();
  }
});

""",
)

replace_once(
    workflow,
    """      - name: Run P4.3 reservation tests
        run: npm --workspace npp-core-api test -- inventory-reservations.test.js

      - name: Run full inventory regression tests
        run: npm --workspace npp-core-api test -- inventory-*.test.js

      - name: Verify public API does not access mcp/**""",
    """      - name: Run P4.3 reservation tests
        run: node --test npp-core/api/test/inventory-reservations.test.js

      - name: Run full inventory regression tests
        run: node --test npp-core/api/test/inventory-ledger.test.js npp-core/api/test/inventory-balance.test.js npp-core/api/test/inventory-reservations.test.js

      - name: Run full Core API verification
        run: npm --workspace npp-core-api run verify

      - name: Verify public API does not access mcp/**""",
)

replace_once(
    package,
    'node --check src/db/repositories/inventory-balance.js && node --check src/services/branch.js',
    'node --check src/db/repositories/inventory-balance.js && node --check src/db/repositories/inventory-reservations.js && node --check src/services/branch.js',
)
replace_once(
    package,
    'node --check src/services/inventory-balance.js && node --check src/routes/organization.js',
    'node --check src/services/inventory-balance.js && node --check src/services/inventory-reservations.js && node --check src/routes/organization.js',
)

print('P4.3 comprehensive repair applied successfully')

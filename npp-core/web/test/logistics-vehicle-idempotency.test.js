import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gatewaySource = readFileSync(new URL('../lib/logistics-gateway.ts', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../app/logistics/trips/trip-planning-workspace.tsx', import.meta.url), 'utf8');
const coreIdempotencySource = readFileSync(new URL('../../api/src/idempotency.js', import.meta.url), 'utf8');

test('A1 vehicle create translates the UI idempotency key to the Core-safe alphabet only for vehicles', () => {
  assert.ok(workspaceSource.includes("return `${prefix}:${parts.filter(Boolean).join(':')}`;"));
  assert.ok(workspaceSource.includes(".replace(/[^A-Za-z0-9._:-]/g, '_')"));
  assert.ok(coreIdempotencySource.includes('const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;'));
  assert.ok(gatewaySource.includes("function vehicleCoreKey(v:string|null|undefined){return key(v).replace(/:/g,'_');}"));
  assert.ok(gatewaySource.includes("idempotencyKey:resource==='vehicles'?vehicleCoreKey(idempotencyKey):key(idempotencyKey)"));
  assert.ok(gatewaySource.includes("updateDeliveryTrip<T>(tripId:string,requestId:string,body:unknown,idempotencyKey:string|null):Promise<T>{assertUuid(tripId,'INVALID_TRIP_ID','Mã chuyến giao không hợp lệ');return req<T>({path:`/trips/${tripId}`,method:'PUT',requestId,body,idempotencyKey:key(idempotencyKey)})"));
});

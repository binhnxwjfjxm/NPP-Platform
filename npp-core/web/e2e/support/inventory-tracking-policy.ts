import { createIdempotencyKey } from '@npp/contracts';
import { expect, type APIRequestContext } from '@playwright/test';

type InventoryTrackingPolicyInput = {
  baseVariantId: string;
  lotTrackingMode: 'NONE' | 'REQUIRED';
  expiryTrackingMode: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  locationRequired: boolean;
};

export async function configureInventoryTrackingPolicy(
  request: APIRequestContext,
  input: InventoryTrackingPolicyInput,
) {
  const currentResponse = await request.get(`/api/inventory/tracking-policies/${input.baseVariantId}`);
  expect(currentResponse.status()).toBe(200);
  const current = (await currentResponse.json()).data;
  const expectedVersion = Number(current.version);
  expect(expectedVersion).toBeGreaterThan(0);

  const response = await request.put(`/api/inventory/tracking-policies/${input.baseVariantId}`, {
    headers: { 'Idempotency-Key': createIdempotencyKey('e2e-inventory-tracking-policy') },
    data: { ...input, expectedVersion },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

import { createIdempotencyKey } from '@npp/contracts';
import { expect, type APIRequestContext } from '@playwright/test';

type LocationManagementMode = 'MANAGED' | 'UNMANAGED';

export async function configureWarehouseLocationMode(
  request: APIRequestContext,
  warehouseId: string,
  targetMode: LocationManagementMode,
  destinationLocationId?: string,
) {
  const query = new URLSearchParams({ targetMode });
  if (destinationLocationId) query.set('destinationLocationId', destinationLocationId);

  const previewResponse = await request.get(`/api/inventory/warehouses/${warehouseId}/location-mode/preview?${query}`);
  expect(previewResponse.status()).toBe(200);
  const preview = (await previewResponse.json()).data;
  expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);

  const convertResponse = await request.post(`/api/inventory/warehouses/${warehouseId}/location-mode/convert`, {
    headers: { 'Idempotency-Key': createIdempotencyKey('e2e-warehouse-location-mode') },
    data: {
      targetMode,
      destinationLocationId: destinationLocationId ?? null,
      previewHash: preview.previewHash,
    },
  });
  expect(convertResponse.status()).toBe(200);
  return (await convertResponse.json()).data;
}

import * as portalRepository from '../db/repositories/customer-portal.js';

function publicOption(row) {
  return Object.freeze({ id: row.id, code: row.code, name: row.name });
}

export async function listPortalActivationOptions(client, { requestContext }) {
  const warehouses = await portalRepository.listActiveWarehouses(client, {
    installationId: requestContext.installationId,
    limit: 500,
  });
  const salesChannels = await portalRepository.listActiveSalesChannels(client, {
    installationId: requestContext.installationId,
    limit: 500,
  });
  return Object.freeze({
    ok: true,
    warehouses: Object.freeze(warehouses.map(publicOption)),
    salesChannels: Object.freeze(salesChannels.map(publicOption)),
  });
}

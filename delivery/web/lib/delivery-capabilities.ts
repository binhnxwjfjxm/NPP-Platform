export const DELIVERY_CAPABILITY_HEADERS = Object.freeze({
  canViewTrips: 'x-npp-delivery-can-view-trips',
  canViewCustody: 'x-npp-delivery-can-view-custody',
  canRecordCod: 'x-npp-delivery-can-record-cod',
  canCreateCodHandover: 'x-npp-delivery-can-create-cod-handover',
  canPickWithWarehouse: 'x-npp-delivery-can-pick-with-warehouse',
});

export type DeliveryCapabilities = Readonly<{
  canViewTrips: boolean;
  canViewCustody: boolean;
  canRecordCod: boolean;
  canCreateCodHandover: boolean;
  canPickWithWarehouse: boolean;
}>;

type HeaderReader = Readonly<{ get(name: string): string | null }>;

function enabled(headers: HeaderReader, name: string): boolean {
  return headers.get(name) === '1';
}

export function deliveryCapabilitiesFromHeaders(headers: HeaderReader): DeliveryCapabilities {
  return Object.freeze({
    canViewTrips: enabled(headers, DELIVERY_CAPABILITY_HEADERS.canViewTrips),
    canViewCustody: enabled(headers, DELIVERY_CAPABILITY_HEADERS.canViewCustody),
    canRecordCod: enabled(headers, DELIVERY_CAPABILITY_HEADERS.canRecordCod),
    canCreateCodHandover: enabled(headers, DELIVERY_CAPABILITY_HEADERS.canCreateCodHandover),
    canPickWithWarehouse: enabled(headers, DELIVERY_CAPABILITY_HEADERS.canPickWithWarehouse),
  });
}

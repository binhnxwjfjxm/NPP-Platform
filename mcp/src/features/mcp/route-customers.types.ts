export type RouteCustomerStatus = "active" | "hidden" | "needs_gps";

export type RouteCustomerGps = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  updatedAt: string;
};

export type RouteCustomerItem = {
  id: string;
  routeId: string;
  routeName: string;
  accountId: string;
  accountName: string;
  contactName: string;
  area: string;
  sortOrder: number;
  status: RouteCustomerStatus;
  gps?: RouteCustomerGps;
  note: string;
};

export type RouteCustomersData = {
  kpis: Array<{
    label: string;
    value: string | number;
    hint: string;
  }>;
  customers: RouteCustomerItem[];
};

export function buildGoogleMapsUrl(customer: RouteCustomerItem) {
  if (!customer.gps) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${customer.gps.lat},${customer.gps.lng}`;
}

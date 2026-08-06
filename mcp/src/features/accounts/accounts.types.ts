export type AccountStatus = "active" | "needs_gps" | "hidden";

export type AccountItem = {
  id: string;
  routeCustomerId: string;
  accountId: string | null;
  name: string;
  contactName: string;
  area: string;
  routeName: string;
  sortOrder: number;
  status: AccountStatus;
  gps: {
    lat: number;
    lng: number;
    accuracyMeters?: number | null;
    updatedAt?: string | null;
  } | null;
  note: string;
  mapsUrl: string;
};

export type AccountKpi = {
  label: string;
  value: string | number;
  hint: string;
};

export type AccountsData = {
  kpis: AccountKpi[];
  accounts: AccountItem[];
};

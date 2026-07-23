export type AccountStatus = "active" | "need_visit" | "inactive";

export type AccountTier = "A" | "B" | "C" | "-";

export type AccountItem = {
  id: string;
  name: string;
  contactName: string;
  area: string;
  routeName: string;
  tier: AccountTier;
  lastVisitDate: string;
  lastOrderDate: string;
  monthlyRevenue: number;
  status: AccountStatus;
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

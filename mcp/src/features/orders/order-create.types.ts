export type OrderSessionOption = {
  id: string;
  routeId: string;
  routeName: string;
  sessionDate: string;
  status: "active" | "done";
  plannedCustomers: number;
  visitedCustomers: number;
};

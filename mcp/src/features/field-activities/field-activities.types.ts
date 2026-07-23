export type ActivityStatus = "completed" | "follow_up" | "missed";

export type FieldActivityItem = {
  id: string;
  date: string;
  routeName: string;
  accountName: string;
  owner: string;
  startTime: string;
  durationMinutes: number;
  outcome: string;
  hasOrder: boolean;
  status: ActivityStatus;
};

export type FieldActivityKpi = {
  label: string;
  value: string | number;
  hint: string;
};

export type FieldActivitiesData = {
  kpis: FieldActivityKpi[];
  activities: FieldActivityItem[];
};

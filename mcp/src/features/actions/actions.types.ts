export type ActionPriority = "high" | "medium" | "low";

export type ActionStatus = "todo" | "doing" | "done" | "blocked";

export type ActionSource = "session" | "field_check" | "order" | "manual";

export type ActionItem = {
  id: string;
  title: string;
  accountName: string;
  routeName: string;
  owner: string;
  source: ActionSource;
  priority: ActionPriority;
  status: ActionStatus;
  dueDate: string;
  note: string;
};

export type ActionKpi = {
  label: string;
  value: string | number;
  hint: string;
};

export type ActionsData = {
  kpis: ActionKpi[];
  items: ActionItem[];
};

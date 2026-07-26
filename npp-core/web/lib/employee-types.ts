export type Employee = {
  id: string;
  installation_id: string;
  code: string;
  full_name: string;
  job_title: string | null;
  phone: string | null;
  email: string | null;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type EmployeeSnapshot = {
  employees: Employee[];
  checkedAt: string;
};

export function createEmptyEmployeeSnapshot(): EmployeeSnapshot {
  return { employees: [], checkedAt: new Date(0).toISOString() };
}

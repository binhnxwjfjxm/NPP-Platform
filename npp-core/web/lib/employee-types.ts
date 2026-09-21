export type EmploymentType = 'PROBATION' | 'PERMANENT' | 'FIXED_TERM' | 'PART_TIME' | 'TEMPORARY' | 'OTHER';
export type WorkforceHistoryQuality = 'CONFIRMED' | 'AUDIT_DERIVED' | 'LEGACY_ESTIMATED' | 'LEGACY_CURRENT_ONLY';

export type HrDepartment = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  parent_department_id: string | null;
  parent_code?: string | null;
  parent_name?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type HrPosition = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  department_id: string | null;
  department_code?: string | null;
  department_name?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type EmployeeManagerCandidate = {
  id: string;
  code: string;
  full_name: string;
  is_active: boolean;
  department_id: string | null;
  department_code?: string | null;
  department_name?: string | null;
  position_id: string | null;
  position_code?: string | null;
  position_name?: string | null;
};

export type EmployeeOrganizationCatalog = {
  departments: HrDepartment[];
  positions: HrPosition[];
  managers: EmployeeManagerCandidate[];
};

export type EmployeeEmployment = {
  id: string;
  installation_id: string;
  employee_id: string;
  employment_type: EmploymentType;
  effective_from: string;
  effective_to: string | null;
  end_reason: string | null;
  data_quality: WorkforceHistoryQuality;
  source: 'HR' | 'MIGRATION' | 'SYSTEM';
  source_reference: string | null;
  created_at: string;
  created_by: string;
};

export type EmployeeAssignment = {
  id: string;
  installation_id?: string;
  employee_id?: string;
  branch_id: string | null;
  department_id: string | null;
  position_id: string | null;
  manager_employee_id: string | null;
  effective_from: string;
  effective_to: string | null;
  reason?: string | null;
  data_quality?: WorkforceHistoryQuality;
  source?: 'HR' | 'MIGRATION' | 'SYSTEM';
  source_reference?: string | null;
  created_at?: string;
  created_by?: string;
  branch_code?: string | null;
  branch_name?: string | null;
  department_code?: string | null;
  department_name?: string | null;
  position_code?: string | null;
  position_name?: string | null;
  manager_code?: string | null;
  manager_name?: string | null;
};

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
  employment_history?: EmployeeEmployment[];
  assignment_history?: EmployeeAssignment[];
  current_employment?: EmployeeEmployment | null;
  current_assignment?: EmployeeAssignment | null;
};

export type EmployeeSnapshot = {
  employees: Employee[];
  checkedAt: string;
};

export function createEmptyEmployeeSnapshot(): EmployeeSnapshot {
  return { employees: [], checkedAt: new Date(0).toISOString() };
}

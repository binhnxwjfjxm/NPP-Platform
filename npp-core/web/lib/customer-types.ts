export type CustomerGroup = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type Customer = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  group_id: string | null;
  group_name: string | null;
  responsible_employee_id: string | null;
  responsible_employee_name: string | null;
  phone: string | null;
  email: string | null;
  tax_code: string | null;
  payment_terms_days: number;
  credit_limit: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type CustomerAddress = {
  id: string;
  installation_id: string;
  customer_id: string;
  label: string;
  recipient_name: string | null;
  phone: string | null;
  address_line1: string;
  address_line2: string | null;
  ward: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
  country_code: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type Supplier = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  tax_id: string | null;
  bank_account: string | null;
  bank_name: string | null;
  avg_delivery_days: number | null;
  purchase_owner_employee_id: string | null;
  purchase_owner_employee_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type SupplierContact = {
  id: string;
  installation_id: string;
  supplier_id: string;
  contact_name: string;
  contact_title: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type SupplierAddress = {
  id: string;
  installation_id: string;
  supplier_id: string;
  address_type: string;
  street: string;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type SupplierPaymentTerm = {
  id: string;
  installation_id: string;
  supplier_id: string;
  payment_method: string;
  term_days: number | null;
  description: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

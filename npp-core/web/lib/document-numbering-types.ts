export type DocumentNumberResetPolicy = 'NONE' | 'YEARLY' | 'MONTHLY';

export type DocumentNumberSeries = {
  id: string;
  code: string;
  document_type: string;
  name: string;
  prefix: string;
  number_template: string;
  reset_policy: DocumentNumberResetPolicy;
  sequence_width: number;
  start_counter: string;
  timezone_name: string;
  description: string | null;
  is_active: boolean;
  format_locked: boolean;
  allocation_count: number;
  created_at: string;
  updated_at: string;
};

export type DocumentNumberCounter = {
  period_key: string;
  next_counter: string;
  created_at: string;
  updated_at: string;
};

export type DocumentNumberAllocation = {
  id: string;
  series_id: string;
  series_code: string;
  document_type: string;
  document_date: string;
  period_key: string;
  counter_value: string;
  document_number: string;
  allocated_at: string;
  metadata: Record<string, unknown>;
  replayed?: boolean;
};

export type DocumentNumberHistory = {
  allocations: DocumentNumberAllocation[];
  counters: DocumentNumberCounter[];
};

export type DocumentNumberSeriesForm = {
  code: string;
  documentType: string;
  name: string;
  prefix: string;
  numberTemplate: string;
  resetPolicy: DocumentNumberResetPolicy;
  sequenceWidth: string;
  startCounter: string;
  timezoneName: string;
  description: string;
  isActive: boolean;
};

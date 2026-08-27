export type PrintPageSize = 'A4' | 'A5';

export type DocumentPrintTemplateField = {
  key: string;
  label: string;
  defaultSelected: boolean;
  required: boolean;
};

export type DocumentPrintTemplate = {
  documentType: string;
  templateCode: string;
  name: string;
  pageSize: PrintPageSize;
  visibleFieldKeys: string[];
  fields: DocumentPrintTemplateField[];
  heading?: string | null;
  title?: string | null;
  subtitle?: string | null;
  isCustomized: boolean;
  updatedAt: string | null;
};

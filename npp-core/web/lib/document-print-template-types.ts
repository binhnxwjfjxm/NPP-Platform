export type PrintPageSize = 'A4' | 'A5';

export type DocumentPrintTemplateField = {
  key: string;
  label: string;
  defaultSelected: boolean;
};

export type DocumentPrintTemplate = {
  documentType: string;
  templateCode: string;
  name: string;
  pageSize: PrintPageSize;
  visibleFieldKeys: string[];
  fields: DocumentPrintTemplateField[];
  isCustomized: boolean;
  updatedAt: string | null;
};

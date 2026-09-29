export function formatOfficeExportValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const normalized = text.trim();
  if (!/^-?\d+\.\d+$/.test(normalized)) return text;
  const compact = normalized.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  return compact === '-0' ? '0' : compact;
}

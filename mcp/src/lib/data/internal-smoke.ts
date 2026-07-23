const INTERNAL_SMOKE_PREFIXES = [
  "__NPP_F05_RUNTIME_SMOKE__"
] as const;

const IDENTITY_FIELDS = [
  "route_name",
  "routeName",
  "name",
  "customer_name",
  "customerName",
  "accountName",
  "sales",
  "owner",
  "salesOwner",
  "note",
  "title",
  "order_code",
  "code"
] as const;

export function isInternalSmokeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return INTERNAL_SMOKE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isInternalSmokeRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return IDENTITY_FIELDS.some((field) => isInternalSmokeText(row[field]));
}

export function withoutInternalSmokeRows<T>(rows: T[]) {
  return rows.filter((row) => !isInternalSmokeRecord(row));
}

export function visibleRouteIds<T extends { id?: unknown }>(routes: T[]) {
  return new Set(withoutInternalSmokeRows(routes).map((route) => String(route.id ?? "").trim()).filter(Boolean));
}

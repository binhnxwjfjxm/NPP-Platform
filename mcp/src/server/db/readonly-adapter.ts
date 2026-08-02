import { backendReadCount, backendReadRows } from "@/lib/api/backend-read";
import type { DbListOptions, QueryFilter, ReadonlyDbAdapter } from "./types";

function orderByValue(options: DbListOptions) {
  const column = String(options.orderBy || "").trim();
  if (!column) return "";
  return `${column}.${options.ascending === false ? "desc" : "asc"}`;
}

/**
 * Keep server-side list/count reads behind the backend read API instead of direct database coupling.
 */
export class ReadonlyBackendReadAdapter implements ReadonlyDbAdapter {
  async list<T>(tableName: string, options: DbListOptions = {}): Promise<T[]> {
    return backendReadRows<T>(tableName, {
      select: options.select,
      order: orderByValue(options) || undefined,
      limit: options.limit,
      filters: options.filters
    });
  }

  async count(tableName: string, filters: QueryFilter = {}): Promise<number> {
    return backendReadCount(tableName, { filters });
  }
}

export function createReadonlyDbAdapter(): ReadonlyDbAdapter {
  return new ReadonlyBackendReadAdapter();
}

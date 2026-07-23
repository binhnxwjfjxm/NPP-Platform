import type { DbListOptions, QueryFilter, ReadonlyDbAdapter } from "./types";

/**
 * This adapter boundary keeps database access outside UI code.
 * Replace the internals with the concrete Supabase implementation after env keys are configured locally.
 */
export class ReadonlySupabaseAdapter implements ReadonlyDbAdapter {
  async list<T>(_tableName: string, _options: DbListOptions = {}): Promise<T[]> {
    throw new Error("ReadonlySupabaseAdapter.list is not wired yet");
  }

  async count(_tableName: string, _filters: QueryFilter = {}): Promise<number> {
    throw new Error("ReadonlySupabaseAdapter.count is not wired yet");
  }
}

export function createReadonlyDbAdapter(): ReadonlyDbAdapter {
  return new ReadonlySupabaseAdapter();
}

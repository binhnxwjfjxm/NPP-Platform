export type QueryFilter = Record<string, string | number | boolean | null | undefined>;

export type DbListOptions = {
  select?: string;
  filters?: QueryFilter;
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
};

export interface ReadonlyDbAdapter {
  list<T>(tableName: string, options?: DbListOptions): Promise<T[]>;
  count(tableName: string, filters?: QueryFilter): Promise<number>;
}

export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbConfigError";
  }
}

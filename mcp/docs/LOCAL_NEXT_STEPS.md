# Local Next Steps

Sau khi pull repo ve may local, chay:

```powershell
cd "F:\\1_A_Disk_D\\Tool\\mcp-plan"
git fetch upstream
git checkout main
git reset --hard upstream/main
git push origin main --force-with-lease
```

## 1. Tao `package.json`

```json
{
  "name": "mcp-plan",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4",
    "next": "^14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.16.10",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.6.2"
  }
}
```

## 2. Tao Supabase adapter that

File: `src/server/db/supabase-readonly-adapter.ts`

```ts
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/server/env";
import type { DbListOptions, QueryFilter, ReadonlyDbAdapter } from "./types";

function applyFilters(query: any, filters: QueryFilter = {}) {
  let nextQuery = query;
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      nextQuery = nextQuery.eq(key, value);
    }
  }
  return nextQuery;
}

export class SupabaseReadonlyAdapter implements ReadonlyDbAdapter {
  private client = createClient(getServerEnv().supabaseUrl, getServerEnv().supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  async list<T>(tableName: string, options: DbListOptions = {}): Promise<T[]> {
    let query = this.client
      .from(tableName)
      .select(options.select || "*");

    query = applyFilters(query, options.filters);

    if (options.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? true });
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as T[];
  }

  async count(tableName: string, filters: QueryFilter = {}): Promise<number> {
    let query = this.client
      .from(tableName)
      .select("*", { count: "exact", head: true });

    query = applyFilters(query, filters);

    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  }
}
```

Sau do sua `src/server/db/readonly-adapter.ts` thanh:

```ts
import type { ReadonlyDbAdapter } from "./types";
import { SupabaseReadonlyAdapter } from "./supabase-readonly-adapter";

export function createReadonlyDbAdapter(): ReadonlyDbAdapter {
  return new SupabaseReadonlyAdapter();
}
```

## 3. Chay test local

```powershell
npm install
npm run typecheck
npm run dev
```

Endpoint test truoc:

```text
http://localhost:3000/api/dashboard/summary
```

Neu endpoint nay tra KPI dung thi moi lap tiep UI dashboard.

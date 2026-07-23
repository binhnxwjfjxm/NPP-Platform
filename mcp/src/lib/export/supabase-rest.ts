import { reportErrorMessage } from "@/lib/export/business-report";

type QueryValue = string | number | boolean | null | undefined;

const RAW_FILTER_PREFIXES = ["eq.", "neq.", "gte.", "lte.", "lt.", "gt.", "ilike.", "like.", "is.", "in."];

type RequestOptions = {
  select?: string;
  order?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, QueryValue>;
};

function requiredServerEnv(name: "SUPABASE_URL" | "SUPABASE_ANON_KEY") {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

export function supabaseRestConfig() {
  const rawUrl = requiredServerEnv("SUPABASE_URL");
  const key = requiredServerEnv("SUPABASE_ANON_KEY");
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid_supabase_url");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid_supabase_url");
  return { url: parsed.toString().replace(/\/+$/, ""), key };
}

function filterValue(value: QueryValue) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (RAW_FILTER_PREFIXES.some((prefix) => text.startsWith(prefix))) return text;
  return `eq.${text}`;
}

export async function restRows<T>(table: string, options: RequestOptions = {}) {
  const cfg = supabaseRestConfig();
  const params = new URLSearchParams();
  params.set("select", options.select || "*");
  if (options.order) params.set("order", options.order);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  Object.entries(options.filters || {}).forEach(([key, value]) => {
    const next = filterValue(value);
    if (next) params.set(key, next);
  });
  const response = await fetch(`${cfg.url}/rest/v1/${table}?${params.toString()}`, {
    cache: "no-store",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Accept: "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `supabase_${response.status}`);
  return Array.isArray(payload) ? payload as T[] : [];
}

export function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "export_failed";
  return Response.json({
    ok: false,
    error: reportErrorMessage(code),
    code
  }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

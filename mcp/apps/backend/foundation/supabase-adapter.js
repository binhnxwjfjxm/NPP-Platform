// Compatibility boundary for legacy-only MCP handlers. Production never loads these handlers.
// New runtime code must depend on persistence.js/postgresql-adapter.js instead.
export {
  legacySupabaseRequest as supabaseRequest,
  legacySupabaseRest as supabaseRest,
  legacySupabaseRpc as supabaseRpc
} from "./legacy-supabase-adapter.js";

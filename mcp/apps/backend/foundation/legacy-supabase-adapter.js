export {
  supabaseRequest as legacySupabaseRequest,
  supabaseRest as legacySupabaseRest,
  supabaseRpc as legacySupabaseRpc
} from "./supabase-adapter.js";

export function createLegacySupabasePersistence(config) {
  const configured = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
  return Object.freeze({
    provider: "legacy-supabase",
    configured,
    async readiness() {
      return Object.freeze({
        provider: "legacy-supabase",
        configured,
        ready: configured,
        ...(configured ? {} : { code: "legacy_supabase_not_configured" })
      });
    },
    async assertReady() {
      const state = await this.readiness();
      if (!state.ready) {
        const error = new Error(state.code);
        error.code = state.code;
        error.statusCode = 503;
        throw error;
      }
      return state;
    },
    async close() {}
  });
}

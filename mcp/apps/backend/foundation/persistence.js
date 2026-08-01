import { createPostgresqlPersistence } from "./postgresql-adapter.js";

export async function createPersistence(config, options = {}) {
  if (config.persistence.provider === "postgresql") {
    return createPostgresqlPersistence(config, options.postgresql);
  }
  if (config.persistence.provider === "legacy-supabase" && config.legacyRuntime.enabled) {
    const { createLegacySupabasePersistence } = await import("./supabase-adapter.js");
    return createLegacySupabasePersistence(config);
  }
  const error = new Error("persistence_provider_forbidden");
  error.code = "persistence_provider_forbidden";
  error.statusCode = 503;
  throw error;
}

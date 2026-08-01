import { createPostgresqlPersistence } from "./postgresql-adapter.js";
import { createLegacySupabasePersistence } from "./legacy-supabase-adapter.js";

export function createPersistence(config, options = {}) {
  if (config.persistence.provider === "postgresql") return createPostgresqlPersistence(config, options.postgresql);
  if (config.persistence.provider === "legacy-supabase" && config.legacyRuntime.enabled) return createLegacySupabasePersistence(config);
  const error = new Error("persistence_provider_forbidden");
  error.code = "persistence_provider_forbidden";
  error.statusCode = 503;
  throw error;
}

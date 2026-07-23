export type ServerEnv = {
  supabaseUrl: string;
  supabaseKey: string;
};

export function getServerEnv(): ServerEnv {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL");
  }

  const supabaseKey = serviceRoleKey || anonKey;

  if (!supabaseKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY");
  }

  return { supabaseUrl, supabaseKey };
}

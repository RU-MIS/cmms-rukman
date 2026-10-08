// Supabase Edge Function entry (Deno). Deploy: supabase functions deploy admin-users
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by
// Supabase to every function of the project — nothing to configure, nothing
// to commit. No third-party imports.
import { handle } from './handler.ts';

const env = {
  url: Deno.env.get('SUPABASE_URL') ?? '',
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
};

Deno.serve((req: Request) => handle(req, env));

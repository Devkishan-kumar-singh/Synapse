// server/services/supabaseClient.js
// This client uses the SERVICE ROLE key, which bypasses Row Level Security.
// It should ONLY ever be used server-side (never sent to the browser),
// because our Express routes are responsible for checking roles/permissions
// before touching the database.

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    '[supabaseClient] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env — backend calls to Supabase will fail.'
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

module.exports = supabase;

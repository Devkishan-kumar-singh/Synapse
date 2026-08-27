require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const [email, password, teamName, fullName] = process.argv.slice(2);
if (!email || !password || !teamName || !fullName) {
  console.error('Usage: node scripts/bootstrap-admin.js <email> <password> "Team Name" "Full Name"');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required in .env.');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function bootstrap() {
  const { data: team, error: teamError } = await supabase.from('teams').insert({ name: teamName }).select().single();
  if (teamError) throw teamError;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { team_id: team.id, role: 'admin' },
  });
  if (error) {
    await supabase.from('teams').delete().eq('id', team.id);
    throw error;
  }
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: data.user.id, team_id: team.id, role: 'admin', full_name: fullName,
  });
  if (profileError) throw profileError;
  console.log(`Admin created for ${team.name}. You can now log in at /login.html.`);
}

bootstrap().catch((error) => {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exit(1);
});

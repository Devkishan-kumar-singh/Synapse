const supabase = require('./supabaseClient');

async function getPromptForTeam(promptId, teamId) {
  const { data, error } = await supabase
    .from('prompts').select('*').eq('id', promptId).eq('team_id', teamId).maybeSingle();
  return error ? null : data;
}

async function getBranchForTeam(branchId, teamId) {
  const { data, error } = await supabase
    .from('branches')
    .select('*, prompts!inner(team_id)')
    .eq('id', branchId).eq('prompts.team_id', teamId).maybeSingle();
  return error ? null : data;
}

async function getCommitForTeam(commitId, teamId) {
  const { data, error } = await supabase
    .from('commits')
    .select('*, branches!inner(prompt_id, prompts!inner(team_id))')
    .eq('id', commitId).eq('branches.prompts.team_id', teamId).maybeSingle();
  return error ? null : data;
}

module.exports = { getPromptForTeam, getBranchForTeam, getCommitForTeam };

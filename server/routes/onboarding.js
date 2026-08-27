const express = require('express');
const supabase = require('../services/supabaseClient');
const authUserMiddleware = require('../middleware/authUserMiddleware');

const router = express.Router();
router.post('/', authUserMiddleware, async (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const teamName = String(req.body.team_name || '').trim();
  if (fullName.length < 2 || fullName.length > 100 || teamName.length < 2 || teamName.length > 80) {
    return res.status(400).json({ error: 'Valid full name and workspace name are required.' });
  }
  const { data: existing } = await supabase.from('profiles').select('id').eq('id', req.authUser.id).maybeSingle();
  if (existing) return res.status(409).json({ error: 'Your workspace is already configured.' });

  const { data: team, error: teamError } = await supabase.from('teams').insert({ name: teamName }).select().single();
  if (teamError) return res.status(500).json({ error: 'Workspace could not be created.' });
  const { data: profile, error: profileError } = await supabase.from('profiles').insert({
    id: req.authUser.id, team_id: team.id, role: 'admin', full_name: fullName,
  }).select('id, team_id, role, full_name').single();
  if (profileError) {
    await supabase.from('teams').delete().eq('id', team.id);
    return res.status(500).json({ error: 'Account setup could not be completed.' });
  }
  await supabase.auth.admin.updateUserById(req.authUser.id, {
    user_metadata: { full_name: fullName },
    app_metadata: { team_id: team.id, role: 'admin' },
  });
  return res.status(201).json(profile);
});

module.exports = router;

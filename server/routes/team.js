const express = require('express');
const supabase = require('../services/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');

const router = express.Router();
const ROLES = ['admin', 'prompt_engineer', 'tester', 'viewer'];
router.use(authMiddleware);

router.get('/me', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles').select('id, full_name, role, team_id, teams(name)')
    .eq('id', req.user.id).single();
  if (error) return res.status(500).json({ error: 'Unable to load your account.' });
  return res.json(data);
});

router.get('/members', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('profiles').select('id, full_name, role, created_at')
    .eq('team_id', req.user.team_id).order('created_at');
  if (error) return res.status(500).json({ error: 'Unable to load team members.' });
  return res.json(data);
});

router.get('/directory', async (req, res) => {
  const { data, error } = await supabase.from('profiles')
    .select('id, full_name, role').eq('team_id', req.user.team_id).order('full_name');
  if (error) return res.status(500).json({ error: 'Team directory could not be loaded.' });
  return res.json(data);
});

router.post('/invitations', requireRole('admin'), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const fullName = String(req.body.full_name || '').trim();
  const role = String(req.body.role || 'viewer');
  if (!/^\S+@\S+\.\S+$/.test(email) || fullName.length < 2 || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Valid email, full name, and role are required.' });
  }

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: process.env.INVITE_REDIRECT_URL || `${process.env.APP_ORIGIN}/login.html`,
    data: { full_name: fullName },
  });
  if (error) return res.status(400).json({ error: error.message });
  const { error: profileError } = await supabase.from('profiles').insert({
    id: data.user.id, team_id: req.user.team_id, role, full_name: fullName,
  });
  if (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id);
    return res.status(500).json({ error: 'Invitation could not be completed.' });
  }
  await supabase.auth.admin.updateUserById(data.user.id, {
    app_metadata: { team_id: req.user.team_id, role },
  });
  await supabase.from('audit_logs').insert({
    team_id: req.user.team_id, actor_id: req.user.id, action: 'member_invited',
    target_type: 'profile', target_id: data.user.id, metadata: { role },
  });
  return res.status(201).json({ id: data.user.id, email, full_name: fullName, role });
});

router.patch('/members/:id/role', requireRole('admin'), async (req, res) => {
  const role = String(req.body.role || '');
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });
  const { data, error } = await supabase.from('profiles').update({ role, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('team_id', req.user.team_id).select('id, full_name, role').maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Team member not found.' });
  await supabase.auth.admin.updateUserById(data.id, { app_metadata: { team_id: req.user.team_id, role } });
  return res.json(data);
});

module.exports = router;

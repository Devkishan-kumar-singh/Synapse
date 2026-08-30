const express = require('express');
const supabase = require('../services/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');
const { getPromptForTeam } = require('../services/access');

const router = express.Router();
router.use(authMiddleware);

router.get('/messages', async (req, res) => {
  const projectId = req.query.project_id || null;
  if (projectId && !(await getPromptForTeam(projectId, req.user.team_id))) {
    return res.status(404).json({ error: 'Project not found.' });
  }
  let query = supabase.from('chat_messages')
    .select('id, body, project_id, sender_id, created_at, profiles!chat_messages_sender_id_fkey(full_name, role)')
    .eq('team_id', req.user.team_id)
    .order('created_at', { ascending: false })
    .limit(100);
  query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Messages could not be loaded.' });
  return res.json(data.reverse());
});

router.post('/messages', requireRole('admin', 'prompt_engineer', 'tester'), async (req, res) => {
  const body = String(req.body.body || '').trim();
  const projectId = req.body.project_id || null;
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Message must contain 1–2000 characters.' });
  if (projectId && !(await getPromptForTeam(projectId, req.user.team_id))) {
    return res.status(404).json({ error: 'Project not found.' });
  }
  const { data, error } = await supabase.from('chat_messages').insert({
    team_id: req.user.team_id, sender_id: req.user.id, project_id: projectId, body,
  }).select('id, body, project_id, sender_id, created_at').single();
  if (error) return res.status(500).json({ error: 'Message could not be sent.' });
  return res.status(201).json(data);
});

module.exports = router;

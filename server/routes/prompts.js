// server/routes/prompts.js
// Basic CRUD for "prompts" — the top-level container, like a Git repo.

const express = require('express');
const router = express.Router();
const supabase = require('../services/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');

router.use(authMiddleware);

// GET /api/prompts - list all prompts for the logged-in user's team
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('prompts')
    .select('*, branches(*)')
    .eq('team_id', req.user.team_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/prompts - create a new prompt, plus its default "main" branch
router.post('/', requireRole('admin', 'prompt_engineer'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required.' });

  const { data: prompt, error: promptError } = await supabase
    .from('prompts')
    .insert({ name, description, team_id: req.user.team_id, created_by: req.user.id })
    .select()
    .single();

  if (promptError) return res.status(500).json({ error: promptError.message });

  // Every prompt starts with a "main" branch, same idea as a Git repo.
  const { data: branch, error: branchError } = await supabase
    .from('branches')
    .insert({ prompt_id: prompt.id, name: 'main', created_by: req.user.id })
    .select()
    .single();

  if (branchError) return res.status(500).json({ error: branchError.message });

  await supabase.from('audit_logs').insert({
    team_id: req.user.team_id,
    actor_id: req.user.id,
    action: 'project_created',
    target_type: 'prompt',
    target_id: prompt.id,
    metadata: { name: prompt.name, main_branch_id: branch.id },
  });

  res.status(201).json({ ...prompt, main_branch: branch });
});

module.exports = router;

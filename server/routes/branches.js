// server/routes/branches.js
// Handles prompt branching, committing, and rollback — the "Git for prompts" logic.

const express = require('express');
const router = express.Router();
const supabase = require('../services/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');
const { getPromptForTeam, getBranchForTeam, getCommitForTeam } = require('../services/access');

// Everything in this file requires a logged-in user.
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const promptId = req.query.prompt_id;
  if (!promptId || !(await getPromptForTeam(promptId, req.user.team_id))) {
    return res.status(404).json({ error: 'Prompt not found.' });
  }
  const { data, error } = await supabase.from('branches')
    .select('id, name, head_commit_id, created_at').eq('prompt_id', promptId).order('created_at');
  if (error) return res.status(500).json({ error: 'Branches could not be loaded.' });
  return res.json(data);
});

router.get('/:id', async (req, res) => {
  const branch = await getBranchForTeam(req.params.id, req.user.team_id);
  if (!branch) return res.status(404).json({ error: 'Branch not found.' });
  let head = null;
  if (branch.head_commit_id) {
    const { data } = await supabase.from('commits')
      .select('id, content, message, created_at, variables(key, default_value, description)')
      .eq('id', branch.head_commit_id).maybeSingle();
    head = data;
  }
  return res.json({ id: branch.id, name: branch.name, prompt_id: branch.prompt_id, head_commit_id: branch.head_commit_id, head });
});

/**
 * POST /api/branches
 * Create a new branch, optionally forked from an existing commit.
 * body: { prompt_id, name, from_commit_id? }
 */
router.post('/', requireRole('admin', 'prompt_engineer'), async (req, res) => {
  const { prompt_id, name, from_commit_id } = req.body;

  if (!prompt_id || !name) {
    return res.status(400).json({ error: 'prompt_id and name are required.' });
  }
  const prompt = await getPromptForTeam(prompt_id, req.user.team_id);
  if (!prompt) return res.status(404).json({ error: 'Prompt not found.' });
  let sourceBranchId = null;
  if (from_commit_id) {
    const { data: sourceCommit } = await supabase.from('commits')
      .select('branch_id').eq('id', from_commit_id).maybeSingle();
    if (!sourceCommit) return res.status(400).json({ error: 'Source commit was not found.' });

    const { data: sourceBranch } = await supabase.from('branches')
      .select('id, prompt_id, prompts!inner(team_id)')
      .eq('id', sourceCommit.branch_id)
      .eq('prompt_id', prompt_id)
      .eq('prompts.team_id', req.user.team_id)
      .maybeSingle();
    if (!sourceBranch) {
      return res.status(400).json({ error: 'Source commit does not belong to this prompt.' });
    }
    sourceBranchId = sourceBranch.id;
  }

  const { data, error } = await supabase
    .from('branches')
    .insert({
      prompt_id,
      name,
      created_by: req.user.id,
      head_commit_id: from_commit_id || null,
      created_from_branch_id: sourceBranchId,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await logAudit(req.user, 'branch_created', 'branch', data.id);
  res.status(201).json(data);
});

/**
 * POST /api/branches/:id/commit
 * Save a new version of the prompt on this branch.
 * body: { content, message, variables? }
 */
router.post('/:id/commit', requireRole('admin', 'prompt_engineer'), async (req, res) => {
  const branchId = req.params.id;
  const { content, message, variables } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'content is required.' });
  }

  // Find the current HEAD of this branch, so we can link the new commit as its child.
  const branch = await getBranchForTeam(branchId, req.user.team_id);
  if (!branch) return res.status(404).json({ error: 'Branch not found.' });

  const { data: commit, error: commitError } = await supabase
    .from('commits')
    .insert({
      branch_id: branchId,
      parent_commit_id: branch.head_commit_id,
      author_id: req.user.id,
      message: message || 'Update prompt',
      content,
    })
    .select()
    .single();

  if (commitError) return res.status(500).json({ error: commitError.message });

  // Move the branch's HEAD forward to this new commit.
  await supabase.from('branches').update({ head_commit_id: commit.id }).eq('id', branchId);

  // Save any variables tied to this commit (e.g. {{tone}}, {{target_audience}}).
  if (Array.isArray(variables) && variables.length > 0) {
    const rows = variables.map((v) => ({
      commit_id: commit.id,
      key: v.key,
      default_value: v.default_value || null,
      description: v.description || null,
    }));
    await supabase.from('variables').insert(rows);
  }

  await logAudit(req.user, 'commit_created', 'commit', commit.id);
  res.status(201).json(commit);
});

/**
 * POST /api/branches/:id/rollback
 * Move a branch's HEAD back to an earlier commit. Nothing is deleted —
 * this is why keeping full commit history matters.
 * body: { commit_id }
 */
router.post('/:id/rollback', requireRole('admin', 'prompt_engineer'), async (req, res) => {
  const branchId = req.params.id;
  const { commit_id } = req.body;

  if (!commit_id) {
    return res.status(400).json({ error: 'commit_id is required.' });
  }
  const [branch, commit] = await Promise.all([
    getBranchForTeam(branchId, req.user.team_id),
    getCommitForTeam(commit_id, req.user.team_id),
  ]);
  const commitBranch = Array.isArray(commit?.branches) ? commit.branches[0] : commit?.branches;
  if (!branch || !commit || !commitBranch || commitBranch.prompt_id !== branch.prompt_id) {
    return res.status(400).json({ error: 'Rollback commit must belong to this prompt.' });
  }

  let ancestorId = branch.head_commit_id;
  let isAncestor = false;
  let steps = 0;
  while (ancestorId && steps < 1000) {
    if (ancestorId === commit_id) { isAncestor = true; break; }
    const { data: ancestor } = await supabase.from('commits')
      .select('parent_commit_id').eq('id', ancestorId).maybeSingle();
    ancestorId = ancestor?.parent_commit_id || null;
    steps += 1;
  }
  if (!isAncestor) {
    return res.status(400).json({ error: 'Rollback is allowed only to an earlier version in this branch history.' });
  }

  const { error } = await supabase
    .from('branches')
    .update({ head_commit_id: commit_id })
    .eq('id', branchId);

  if (error) return res.status(500).json({ error: error.message });

  await logAudit(req.user, 'branch_rolled_back', 'branch', branchId);
  res.json({ success: true, branch_id: branchId, head_commit_id: commit_id });
});

/**
 * GET /api/branches/:id/history
 * Walk the parent_commit_id chain from HEAD backward to show full version history.
 */
router.get('/:id/history', async (req, res) => {
  const branchId = req.params.id;

  const branch = await getBranchForTeam(branchId, req.user.team_id);
  if (!branch) return res.status(404).json({ error: 'Branch not found.' });

  const history = [];
  let currentId = branch.head_commit_id;

  while (currentId) {
    const { data: commit, error } = await supabase
      .from('commits')
      .select('*')
      .eq('id', currentId)
      .single();

    if (error || !commit) break;
    history.push(commit);
    currentId = commit.parent_commit_id;
  }

  res.json(history);
});

// Small helper to write an audit log row without repeating this everywhere.
async function logAudit(user, action, targetType, targetId) {
  await supabase.from('audit_logs').insert({
    team_id: user.team_id,
    actor_id: user.id,
    action,
    target_type: targetType,
    target_id: targetId,
  });
}

module.exports = router;

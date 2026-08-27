// server/routes/testRuns.js
// The A/B Testing Arena: run two prompt versions against two models simultaneously.

const express = require('express');
const router = express.Router();
const supabase = require('../services/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const { callModel } = require('../services/llmProvider');
const requireRole = require('../middleware/roleMiddleware');
const { getCommitForTeam } = require('../services/access');

router.use(authMiddleware);

/**
 * POST /api/test-runs
 * body: {
 *   commit_a_id, commit_b_id,
 *   provider_a, model_a, provider_b, model_b,
 *   variables: { tone: "friendly", target_audience: "developers" }
 * }
 */
router.post('/', requireRole('admin', 'prompt_engineer', 'tester'), async (req, res) => {
  const {
    commit_a_id,
    commit_b_id,
    provider_a,
    model_a,
    provider_b,
    model_b,
    variables = {},
  } = req.body;

  if (!commit_a_id || !commit_b_id) {
    return res.status(400).json({ error: 'commit_a_id and commit_b_id are required.' });
  }

  // Load the actual prompt template text for each commit.
  const [commitA, commitB] = await Promise.all([
    getCommitForTeam(commit_a_id, req.user.team_id),
    getCommitForTeam(commit_b_id, req.user.team_id),
  ]);
  if (!commitA || !commitB) {
    return res.status(404).json({ error: 'One or both commits were not found.' });
  }

  try {
    // Fire both LLM calls in parallel — this is the "split-screen" comparison.
    const [outputA, outputB] = await Promise.all([
      callModel({
        provider: provider_a || 'openai',
        model: model_a || 'gpt-4o',
        promptTemplate: commitA.content,
        variables,
      }),
      callModel({
        provider: provider_b || 'anthropic',
        model: model_b || 'claude-3-5-sonnet-20241022',
        promptTemplate: commitB.content,
        variables,
      }),
    ]);

    const { data: testRun, error: insertError } = await supabase
      .from('test_runs')
      .insert({
        team_id: req.user.team_id,
        commit_a_id,
        commit_b_id,
        model_a: model_a || 'gpt-4o',
        model_b: model_b || 'claude-3-5-sonnet-20241022',
        provider_a: provider_a || 'openai',
        provider_b: provider_b || 'anthropic',
        input_payload: variables,
        output_a: outputA,
        output_b: outputB,
        verdict: 'pending',
        tested_by: req.user.id,
      })
      .select()
      .single();

    if (insertError) return res.status(500).json({ error: insertError.message });

    res.status(201).json(testRun);
  } catch (err) {
    res.status(502).json({ error: `LLM call failed: ${err.message}` });
  }
});

/**
 * PATCH /api/test-runs/:id/verdict
 * Mark a test run as "commit" (promote) or "discard".
 * body: { verdict: "commit" | "discard" }
 */
router.patch('/:id/verdict', requireRole('admin', 'prompt_engineer', 'tester'), async (req, res) => {
  const { verdict } = req.body;

  if (!['commit', 'discard'].includes(verdict)) {
    return res.status(400).json({ error: "verdict must be 'commit' or 'discard'." });
  }

  const { data, error } = await supabase
    .from('test_runs')
    .update({ verdict })
    .eq('id', req.params.id)
    .eq('team_id', req.user.team_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('audit_logs').insert({
    team_id: req.user.team_id,
    actor_id: req.user.id,
    action: `test_run_${verdict}`,
    target_type: 'test_run',
    target_id: req.params.id,
  });

  res.json(data);
});

module.exports = router;

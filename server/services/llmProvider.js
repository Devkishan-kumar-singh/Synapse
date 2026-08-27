// server/services/llmProvider.js
// A thin abstraction so the rest of the app doesn't care which LLM it's calling.
// Add more providers here later (Gemini, etc.) without touching route logic.

require('dotenv').config();

/**
 * Resolves {{variable}} placeholders in a prompt template.
 * e.g. resolveTemplate("Write a {{tone}} email", { tone: "friendly" })
 *      -> "Write a friendly email"
 */
function resolveTemplate(template, variables = {}) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const trimmedKey = key.trim();
    return variables[trimmedKey] !== undefined ? variables[trimmedKey] : `{{${trimmedKey}}}`;
  });
}

/**
 * Calls OpenAI's chat completions endpoint.
 */
async function callOpenAI(promptText, model = 'gpt-4o') {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: promptText }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Calls Anthropic's messages endpoint.
 */
async function callAnthropic(promptText, model = 'claude-3-5-sonnet-20241022') {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: promptText }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}

/**
 * Unified entry point. `provider` is "openai" or "anthropic".
 */
async function callModel({ provider, model, promptTemplate, variables }) {
  const resolvedPrompt = resolveTemplate(promptTemplate, variables);

  if (provider === 'openai') {
    return callOpenAI(resolvedPrompt, model);
  }
  if (provider === 'anthropic') {
    return callAnthropic(resolvedPrompt, model);
  }
  throw new Error(`Unknown provider: ${provider}`);
}

module.exports = { callModel, resolveTemplate };

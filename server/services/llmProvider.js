// server/services/llmProvider.js
// A thin abstraction so the rest of the app doesn't care which LLM it's calling.
// Provider keys stay on the server and are never returned to the browser.

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

async function callGemini(promptText, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash') {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini is not configured.');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: { maxOutputTokens: 1000 },
      }),
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok) throw new Error(`Gemini API error (${response.status}).`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

async function callGroq(promptText, model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile') {
  if (!process.env.GROQ_API_KEY) throw new Error('Groq is not configured.');
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: promptText }], max_tokens: 1000 }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Groq API error (${response.status}).`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Unified entry point for supported providers.
 */
async function callModel({ provider, model, promptTemplate, variables }) {
  const resolvedPrompt = resolveTemplate(promptTemplate, variables);

  if (provider === 'openai') {
    return callOpenAI(resolvedPrompt, model);
  }
  if (provider === 'anthropic') {
    return callAnthropic(resolvedPrompt, model);
  }
  if (provider === 'gemini') return callGemini(resolvedPrompt, model);
  if (provider === 'groq') return callGroq(resolvedPrompt, model);
  throw new Error(`Unknown provider: ${provider}`);
}

module.exports = { callModel, resolveTemplate };

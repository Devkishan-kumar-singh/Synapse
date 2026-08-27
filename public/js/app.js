let session;
let profile;

function setMessage(id, text, type = '') {
  const element = document.getElementById(id);
  element.textContent = text;
  element.className = `auth-msg ${type}`.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function renderPrompts(prompts) {
  const list = document.getElementById('prompts-list');
  document.getElementById('project-count').textContent = `${prompts.length} project${prompts.length === 1 ? '' : 's'}`;
  list.replaceChildren();
  if (!prompts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = profile.role === 'viewer' || profile.role === 'tester'
      ? 'No prompt projects are available yet.' : 'Create your first prompt project to begin.';
    list.append(empty);
    return;
  }
  prompts.forEach((prompt) => {
    const card = document.createElement('article');
    card.className = 'project-card';
    const title = document.createElement('h3');
    title.textContent = prompt.name;
    const description = document.createElement('p');
    description.textContent = prompt.description || 'No description provided.';
    const metadata = document.createElement('div');
    metadata.className = 'project-meta';
    metadata.textContent = `${prompt.branches?.length || 0} branch${prompt.branches?.length === 1 ? '' : 'es'}`;
    card.append(title, description, metadata);
    list.append(card);
  });
}

async function loadPrompts() {
  renderPrompts(await api('/api/prompts'));
}

async function init() {
  const client = await window.synapseReady;
  ({ data: { session } } = await client.auth.getSession());
  if (!session) return window.location.replace('login.html');
  try {
    profile = await api('/api/team/me');
  } catch (error) {
    await client.auth.signOut();
    return window.location.replace('login.html');
  }
  document.getElementById('user-email').textContent = session.user.email;
  document.getElementById('role-badge').textContent = profile.role.replace('_', ' ');
  document.getElementById('team-name').textContent = profile.teams?.name || 'Team workspace';
  if (['admin', 'prompt_engineer'].includes(profile.role)) document.getElementById('new-prompt-button').classList.remove('hidden');
  if (profile.role === 'admin') document.getElementById('admin-panel').classList.remove('hidden');
  await loadPrompts();
}

document.getElementById('new-prompt-button').addEventListener('click', () => document.getElementById('new-prompt-panel').classList.remove('hidden'));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).classList.add('hidden')));
document.getElementById('new-prompt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('prompt-message', 'Creating project…');
  try {
    await api('/api/prompts', { method: 'POST', body: JSON.stringify({ name: document.getElementById('prompt-name').value, description: document.getElementById('prompt-description').value }) });
    event.target.reset();
    setMessage('prompt-message', 'Project created.', 'success');
    await loadPrompts();
  } catch (error) { setMessage('prompt-message', error.message, 'error'); }
});
document.getElementById('invite-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('invite-message', 'Sending secure invitation…');
  try {
    await api('/api/team/invitations', { method: 'POST', body: JSON.stringify({ full_name: document.getElementById('invite-name').value, email: document.getElementById('invite-email').value, role: document.getElementById('invite-role').value }) });
    event.target.reset();
    setMessage('invite-message', 'Invitation sent successfully.', 'success');
  } catch (error) { setMessage('invite-message', error.message, 'error'); }
});
document.getElementById('logout-link').addEventListener('click', async (event) => {
  event.preventDefault();
  const client = await window.synapseReady;
  await client.auth.signOut();
  window.location.replace('login.html');
});

init().catch((error) => {
  document.getElementById('prompts-list').textContent = error.message;
});

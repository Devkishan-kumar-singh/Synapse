let session;
let profile;
let projects = [];
let projectBranches = [];
let currentProject = null;
let currentBranch = null;
let currentTestRunId = null;
let chatScope = 'team';
let chatChannel = null;
let unreadCount = 0;

const canEdit = () => ['admin', 'prompt_engineer'].includes(profile?.role);
const canChat = () => ['admin', 'prompt_engineer', 'tester'].includes(profile?.role);
const canTest = () => ['admin', 'prompt_engineer', 'tester'].includes(profile?.role);

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

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function renderProjects() {
  const list = document.getElementById('prompts-list');
  document.getElementById('project-count').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;
  list.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = canEdit() ? 'Create your first prompt project to begin.' : 'No prompt projects are available yet.';
    list.append(empty);
    return;
  }
  projects.forEach((project) => {
    const card = document.createElement('button');
    card.className = 'project-card project-card-button';
    const title = document.createElement('h3'); title.textContent = project.name;
    const description = document.createElement('p'); description.textContent = project.description || 'No description provided.';
    const metadata = document.createElement('div'); metadata.className = 'project-meta';
    metadata.textContent = `${project.branches?.length || 0} branch${project.branches?.length === 1 ? '' : 'es'} · Open editor →`;
    card.append(title, description, metadata);
    card.addEventListener('click', () => openProject(project));
    list.append(card);
  });
}

async function loadProjects() {
  projects = await api('/api/prompts');
  renderProjects();
}

async function openProject(project) {
  currentProject = project;
  document.getElementById('projects-view').classList.add('hidden');
  document.getElementById('editor-view').classList.remove('hidden');
  document.getElementById('editor-project-label').textContent = 'Prompt project';
  document.getElementById('editor-project-name').textContent = project.name;
  document.getElementById('editor-project-description').textContent = project.description || 'No description provided.';
  document.getElementById('project-chat-tab').disabled = false;
  if (canEdit()) document.getElementById('new-branch-button').classList.remove('hidden');
  document.getElementById('ab-test-panel').classList.toggle('hidden', !canTest());
  await loadBranches();
}

async function loadBranches(preferredId) {
  const branches = await api(`/api/branches?prompt_id=${encodeURIComponent(currentProject.id)}`);
  projectBranches = branches;
  const list = document.getElementById('branches-list');
  list.replaceChildren();
  branches.forEach((branch) => {
    const button = document.createElement('button');
    button.className = `branch-row${branch.id === currentBranch?.id ? ' active' : ''}`;
    button.textContent = branch.name;
    button.addEventListener('click', () => selectBranch(branch.id));
    list.append(button);
  });
  const target = preferredId || currentBranch?.id || branches[0]?.id;
  if (target) await selectBranch(target);
}

async function loadABOptions() {
  if (!canTest() || !projectBranches.length) return;
  const histories = await Promise.all(projectBranches.map(async (branch) => ({
    branch,
    commits: await api(`/api/branches/${branch.id}/history`),
  })));
  const unique = new Map();
  histories.forEach(({ branch, commits }) => commits.forEach((commit) => {
    if (!unique.has(commit.id)) unique.set(commit.id, { ...commit, branch_name: branch.name });
  }));
  const commits = [...unique.values()];
  const selectA = document.getElementById('test-commit-a');
  const selectB = document.getElementById('test-commit-b');
  const previousA = selectA.value;
  const previousB = selectB.value;
  selectA.replaceChildren(); selectB.replaceChildren();
  commits.forEach((commit) => {
    const label = `${commit.branch_name} · ${commit.message} · ${formatDate(commit.created_at)}`;
    [selectA, selectB].forEach((select) => {
      const option = document.createElement('option'); option.value = commit.id; option.textContent = label; select.append(option);
    });
  });
  if (commits.some((commit) => commit.id === previousA)) selectA.value = previousA;
  if (commits.some((commit) => commit.id === previousB)) selectB.value = previousB;
  else if (commits[1]) selectB.value = commits[1].id;
  document.getElementById('run-test-button').disabled = commits.length < 2;
  setMessage('test-message', commits.length < 2 ? 'Create at least two saved versions before running an A/B test.' : '');
}

async function selectBranch(branchId) {
  currentBranch = await api(`/api/branches/${branchId}`);
  document.getElementById('current-branch-name').textContent = currentBranch.name;
  document.getElementById('prompt-content').value = currentBranch.head?.content || '';
  document.getElementById('prompt-content').readOnly = !canEdit();
  document.getElementById('editor-mode').textContent = canEdit() ? 'Editing' : 'Read only';
  document.getElementById('commit-controls').classList.toggle('hidden', !canEdit());
  document.querySelectorAll('.branch-row').forEach((row) => row.classList.toggle('active', row.textContent === currentBranch.name));
  await loadHistory();
  await loadABOptions();
}

async function loadHistory() {
  const history = await api(`/api/branches/${currentBranch.id}/history`);
  const list = document.getElementById('history-list');
  list.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('p'); empty.className = 'empty-copy'; empty.textContent = 'No versions yet.'; list.append(empty); return;
  }
  history.forEach((commit, index) => {
    const item = document.createElement('div'); item.className = 'history-item';
    const message = document.createElement('strong'); message.textContent = commit.message;
    const date = document.createElement('span'); date.textContent = formatDate(commit.created_at);
    item.append(message, date);
    if (canEdit() && index > 0) {
      const rollback = document.createElement('button'); rollback.className = 'text-button'; rollback.textContent = 'Roll back';
      rollback.addEventListener('click', () => rollbackTo(commit.id)); item.append(rollback);
    }
    list.append(item);
  });
}

async function rollbackTo(commitId) {
  if (!window.confirm('Move this branch back to the selected version? No history will be deleted.')) return;
  try {
    await api(`/api/branches/${currentBranch.id}/rollback`, { method: 'POST', body: JSON.stringify({ commit_id: commitId }) });
    setMessage('editor-message', 'Branch rolled back successfully.', 'success');
    await selectBranch(currentBranch.id);
  } catch (error) { setMessage('editor-message', error.message, 'error'); }
}

async function loadDirectory() {
  const members = await api('/api/team/directory');
  const directory = document.getElementById('team-directory');
  directory.replaceChildren();
  members.forEach((member) => {
    const chip = document.createElement('span'); chip.className = 'member-chip';
    chip.textContent = `${member.full_name} · ${member.role.replace('_', ' ')}`;
    directory.append(chip);
  });
}

async function loadChat() {
  const projectId = chatScope === 'project' ? currentProject?.id : null;
  if (chatScope === 'project' && !projectId) return;
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  const messages = await api(`/api/chat/messages${query}`);
  const list = document.getElementById('chat-messages');
  list.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('div'); empty.className = 'empty-chat';
    empty.textContent = canChat() ? 'No messages yet. Start the conversation.' : 'No messages yet.';
    list.append(empty);
  } else {
    messages.forEach((message) => {
      const item = document.createElement('div'); item.className = `chat-message-item${message.sender_id === profile.id ? ' mine' : ''}`;
      const head = document.createElement('div'); head.className = 'chat-message-head';
      const sender = document.createElement('strong'); sender.textContent = message.profiles?.full_name || 'Team member';
      const time = document.createElement('span'); time.textContent = formatDate(message.created_at);
      const body = document.createElement('p'); body.textContent = message.body;
      head.append(sender, time); item.append(head, body); list.append(item);
    });
    list.scrollTop = list.scrollHeight;
  }
}

function subscribeToChat(client) {
  if (chatChannel) client.removeChannel(chatChannel);
  chatChannel = client.channel(`team-chat-${profile.team_id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `team_id=eq.${profile.team_id}` }, async () => {
      if (document.getElementById('chat-drawer').classList.contains('open')) await loadChat();
      else {
        unreadCount += 1;
        const badge = document.getElementById('chat-unread'); badge.textContent = unreadCount; badge.classList.remove('hidden');
      }
    }).subscribe();
}

async function init() {
  const client = await window.synapseReady;
  ({ data: { session } } = await client.auth.getSession());
  if (!session) return window.location.replace('login.html');
  try { profile = await api('/api/team/me'); }
  catch { await client.auth.signOut(); return window.location.replace('login.html'); }
  document.getElementById('user-email').textContent = session.user.email;
  document.getElementById('role-badge').textContent = profile.role.replace('_', ' ');
  document.getElementById('team-name').textContent = profile.teams?.name || 'Team workspace';
  document.getElementById('chat-team-name').textContent = profile.teams?.name || 'Team workspace';
  if (!canChat()) {
    document.getElementById('chat-form').classList.add('hidden');
    setMessage('chat-message', 'Viewer access is read-only. You can view chat history but cannot send messages.');
  }
  if (canEdit()) document.getElementById('new-prompt-button').classList.remove('hidden');
  if (profile.role === 'admin') document.getElementById('admin-panel').classList.remove('hidden');
  await Promise.all([loadProjects(), loadDirectory(), loadChat()]);
  subscribeToChat(client);
}

document.getElementById('new-prompt-button').addEventListener('click', () => document.getElementById('new-prompt-panel').classList.remove('hidden'));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).classList.add('hidden')));
document.getElementById('new-prompt-form').addEventListener('submit', async (event) => { event.preventDefault(); setMessage('prompt-message', 'Creating project…'); try { await api('/api/prompts', { method: 'POST', body: JSON.stringify({ name: document.getElementById('prompt-name').value, description: document.getElementById('prompt-description').value }) }); event.target.reset(); setMessage('prompt-message', 'Project created.', 'success'); await loadProjects(); } catch (error) { setMessage('prompt-message', error.message, 'error'); } });
document.getElementById('invite-form').addEventListener('submit', async (event) => { event.preventDefault(); setMessage('invite-message', 'Sending secure invitation…'); try { await api('/api/team/invitations', { method: 'POST', body: JSON.stringify({ full_name: document.getElementById('invite-name').value, email: document.getElementById('invite-email').value, role: document.getElementById('invite-role').value }) }); event.target.reset(); setMessage('invite-message', 'Invitation sent successfully.', 'success'); await loadDirectory(); } catch (error) { setMessage('invite-message', error.message, 'error'); } });
document.getElementById('back-projects').addEventListener('click', () => { document.getElementById('editor-view').classList.add('hidden'); document.getElementById('projects-view').classList.remove('hidden'); currentProject = null; currentBranch = null; document.getElementById('project-chat-tab').disabled = true; if (chatScope === 'project') document.querySelector('[data-scope="team"]').click(); });
document.getElementById('new-branch-button').addEventListener('click', () => document.getElementById('new-branch-panel').classList.toggle('hidden'));
document.getElementById('new-branch-form').addEventListener('submit', async (event) => { event.preventDefault(); setMessage('branch-message', 'Creating branch…'); try { const branch = await api('/api/branches', { method: 'POST', body: JSON.stringify({ prompt_id: currentProject.id, name: document.getElementById('branch-name').value, from_commit_id: currentBranch?.head_commit_id || null }) }); event.target.reset(); setMessage('branch-message', 'Branch created.', 'success'); await loadBranches(branch.id); } catch (error) { setMessage('branch-message', error.message, 'error'); } });
document.getElementById('commit-button').addEventListener('click', async () => { const content = document.getElementById('prompt-content').value; const message = document.getElementById('commit-message').value.trim(); if (!content.trim() || !message) return setMessage('editor-message', 'Prompt content and commit message are required.', 'error'); setMessage('editor-message', 'Saving version…'); try { await api(`/api/branches/${currentBranch.id}/commit`, { method: 'POST', body: JSON.stringify({ content, message }) }); document.getElementById('commit-message').value = ''; setMessage('editor-message', 'Version committed.', 'success'); await selectBranch(currentBranch.id); } catch (error) { setMessage('editor-message', error.message, 'error'); } });
document.getElementById('ab-test-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const commitA = document.getElementById('test-commit-a').value;
  const commitB = document.getElementById('test-commit-b').value;
  if (!commitA || !commitB || commitA === commitB) return setMessage('test-message', 'Choose two different saved versions.', 'error');
  let variables;
  try {
    variables = JSON.parse(document.getElementById('test-variables').value || '{}');
    if (!variables || Array.isArray(variables) || typeof variables !== 'object') throw new Error();
  } catch { return setMessage('test-message', 'Template variables must be a valid JSON object, for example {"tone":"friendly"}.', 'error'); }
  const button = document.getElementById('run-test-button');
  button.disabled = true; setMessage('test-message', 'Running Gemini and Groq…');
  document.getElementById('test-results').classList.add('hidden');
  document.getElementById('test-verdict-controls').classList.add('hidden');
  try {
    const run = await api('/api/test-runs', { method: 'POST', body: JSON.stringify({
      commit_a_id: commitA, commit_b_id: commitB,
      provider_a: 'gemini', provider_b: 'groq', variables,
    }) });
    currentTestRunId = run.id;
    document.getElementById('test-output-a').textContent = run.output_a || 'No response returned.';
    document.getElementById('test-output-b').textContent = run.output_b || 'No response returned.';
    document.getElementById('test-results').classList.remove('hidden');
    document.getElementById('test-verdict-controls').classList.remove('hidden');
    setMessage('test-message', 'A/B test completed.', 'success');
  } catch (error) { setMessage('test-message', error.message, 'error'); }
  finally { button.disabled = false; }
});
document.querySelectorAll('[data-verdict]').forEach((button) => button.addEventListener('click', async () => {
  if (!currentTestRunId) return;
  try {
    await api(`/api/test-runs/${currentTestRunId}/verdict`, { method: 'PATCH', body: JSON.stringify({ verdict: button.dataset.verdict }) });
    setMessage('test-message', button.dataset.verdict === 'commit' ? 'Result accepted.' : 'Test discarded.', 'success');
    document.getElementById('test-verdict-controls').classList.add('hidden');
  } catch (error) { setMessage('test-message', error.message, 'error'); }
}));
document.getElementById('chat-toggle').addEventListener('click', async () => { const drawer = document.getElementById('chat-drawer'); drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.getElementById('chat-toggle').setAttribute('aria-expanded', 'true'); unreadCount = 0; document.getElementById('chat-unread').classList.add('hidden'); await loadChat(); });
document.getElementById('chat-close').addEventListener('click', () => { document.getElementById('chat-drawer').classList.remove('open'); document.getElementById('chat-drawer').setAttribute('aria-hidden', 'true'); document.getElementById('chat-toggle').setAttribute('aria-expanded', 'false'); });
document.querySelectorAll('.chat-tab').forEach((tab) => tab.addEventListener('click', async () => { if (tab.disabled) return; chatScope = tab.dataset.scope; document.querySelectorAll('.chat-tab').forEach((item) => item.classList.toggle('active', item === tab)); document.getElementById('chat-input').placeholder = chatScope === 'project' ? `Message about ${currentProject.name}…` : 'Message your team…'; await loadChat(); }));
document.getElementById('chat-form').addEventListener('submit', async (event) => { event.preventDefault(); if (!canChat()) return setMessage('chat-message', 'Viewer access is read-only.', 'error'); const input = document.getElementById('chat-input'); const body = input.value.trim(); if (!body) return; try { await api('/api/chat/messages', { method: 'POST', body: JSON.stringify({ body, project_id: chatScope === 'project' ? currentProject?.id : null }) }); input.value = ''; setMessage('chat-message', ''); await loadChat(); } catch (error) { setMessage('chat-message', error.message, 'error'); } });
document.getElementById('logout-link').addEventListener('click', async (event) => { event.preventDefault(); const client = await window.synapseReady; if (chatChannel) client.removeChannel(chatChannel); await client.auth.signOut(); window.location.replace('login.html'); });

init().catch((error) => { document.getElementById('prompts-list').textContent = error.message; });

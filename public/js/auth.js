const loginForm = document.getElementById('login-form');
const otpForm = document.getElementById('otp-form');
const loginMessage = document.getElementById('login-msg');
const otpMessage = document.getElementById('otp-msg');
let pendingEmail = '';
let pendingSession = null;

function show(element, text, type = '') {
  element.textContent = text;
  element.className = `auth-msg ${type}`.trim();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  pendingEmail = document.getElementById('login-email').value.trim().toLowerCase();
  show(loginMessage, 'Sending your secure login code...');
  try {
    const client = await window.synapseReady;
    const { error } = await client.auth.signInWithOtp({
      email: pendingEmail,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
    loginForm.classList.add('hidden');
    otpForm.classList.remove('hidden');
    document.getElementById('otp-code').focus();
    show(otpMessage, `Code sent to ${pendingEmail}.`, 'success');
  } catch (error) {
    show(loginMessage, 'A code cannot be sent right now. Please wait and try again.', 'error');
  }
});

otpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = document.getElementById('otp-code').value.trim();
  show(otpMessage, 'Verifying code...');
  try {
    const client = await window.synapseReady;
    const { data, error } = await client.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
    if (error || !data.session) throw error || new Error('Verification failed.');
    pendingSession = data.session;
    const response = await fetch('/api/team/me', {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    if (!response.ok) {
      otpForm.classList.add('hidden');
      document.getElementById('onboarding-form').classList.remove('hidden');
      document.querySelector('.auth-heading h1').textContent = 'Create your workspace';
      document.querySelector('.auth-heading p').textContent = 'Tell us who you are and name your private team workspace.';
      return;
    }
    show(otpMessage, 'Verified. Opening your workspace...', 'success');
    window.location.replace('dashboard.html');
  } catch (error) {
    show(otpMessage, error.message || 'Invalid or expired code.', 'error');
  }
});

document.getElementById('onboarding-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const onboardingMessage = document.getElementById('onboarding-msg');
  show(onboardingMessage, 'Creating your secure workspace...');
  try {
    const response = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pendingSession.access_token}` },
      body: JSON.stringify({
        full_name: document.getElementById('onboarding-name').value,
        team_name: document.getElementById('onboarding-team').value,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Workspace setup failed.');
    show(onboardingMessage, 'Workspace ready. Opening Synapse...', 'success');
    window.location.replace('dashboard.html');
  } catch (error) {
    show(onboardingMessage, error.message, 'error');
  }
});

document.getElementById('change-email').addEventListener('click', () => {
  otpForm.reset();
  otpForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  show(loginMessage, '');
});

window.synapseReady.then(async (client) => {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return;
  const response = await fetch('/api/team/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (response.ok) return window.location.replace('dashboard.html');
  pendingSession = session;
  loginForm.classList.add('hidden');
  otpForm.classList.add('hidden');
  document.getElementById('onboarding-form').classList.remove('hidden');
  document.querySelector('.auth-heading h1').textContent = 'Create your workspace';
  document.querySelector('.auth-heading p').textContent = 'Tell us who you are and name your private team workspace.';
}).catch((error) => show(loginMessage, error.message, 'error'));

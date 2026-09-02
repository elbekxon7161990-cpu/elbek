const TOKEN_KEY = 'afa_admin_session_token';

// Already logged in? Skip straight to the dashboard.
if (sessionStorage.getItem(TOKEN_KEY)) {
  window.location.href = '/dashboard.html';
}

let challengeToken = null;

const passwordForm = document.getElementById('password-form');
const mfaForm = document.getElementById('mfa-form');
const passwordError = document.getElementById('password-error');
const mfaError = document.getElementById('mfa-error');

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordError.textContent = '';
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw new Error('Invalid email or password.');
    }
    const data = await response.json();
    challengeToken = data.challengeToken;
    passwordForm.hidden = true;
    mfaForm.hidden = false;
    document.getElementById('code').focus();
  } catch (error) {
    passwordError.textContent = error.message;
  }
});

mfaForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  mfaError.textContent = '';
  const code = document.getElementById('code').value;

  try {
    const response = await fetch('/admin/auth/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, code }),
    });
    if (!response.ok) {
      throw new Error('Invalid or expired code.');
    }
    const data = await response.json();
    sessionStorage.setItem(TOKEN_KEY, data.sessionToken);
    window.location.href = '/dashboard.html';
  } catch (error) {
    mfaError.textContent = error.message;
  }
});

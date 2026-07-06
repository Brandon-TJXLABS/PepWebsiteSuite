// Auth helpers — used by login.html, signup.html, and the nav on every page

async function acionaSignUp(email, password, fullName) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  });
  return { data, error };
}

async function acionaSignIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  return { data, error };
}

async function acionaSignOut() {
  await supabaseClient.auth.signOut();
  window.location.href = '/';
}

async function acionaGetUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

// Redirect to login if not authenticated. Call at the top of any protected page.
async function acionaRequireAuth() {
  const user = await acionaGetUser();
  if (!user) {
    window.location.href = 'login';
  }
  return user;
}

// Updates the "Account" nav link on every page depending on login state.
// Expects an element with id="nav-account" in the nav.
async function acionaUpdateNav() {
  const user = await acionaGetUser();
  const navAccount = document.getElementById('nav-account');
  if (!navAccount) return;

  if (user) {
    navAccount.textContent = 'Account';
    navAccount.href = 'account';
  } else {
    navAccount.textContent = 'Login';
    navAccount.href = 'login';
  }
}

document.addEventListener('DOMContentLoaded', acionaUpdateNav);

// Auth helpers — used by login.html, signup.html, and the nav on every page

async function purevialSignUp(email, password, fullName) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  });
  return { data, error };
}

async function purevialSignIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  return { data, error };
}

async function purevialSignOut() {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

async function purevialGetUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

// Redirect to login if not authenticated. Call at the top of any protected page.
async function purevialRequireAuth() {
  const user = await purevialGetUser();
  if (!user) {
    window.location.href = 'login.html';
  }
  return user;
}

// Updates the "Account" nav link on every page depending on login state.
// Expects an element with id="nav-account" in the nav.
async function purevialUpdateNav() {
  const user = await purevialGetUser();
  const navAccount = document.getElementById('nav-account');
  if (!navAccount) return;

  if (user) {
    navAccount.textContent = 'Account';
    navAccount.href = 'account.html';
  } else {
    navAccount.textContent = 'Login';
    navAccount.href = 'login.html';
  }
}

document.addEventListener('DOMContentLoaded', purevialUpdateNav);

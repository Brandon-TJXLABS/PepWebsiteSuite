// Admin-only helper — loaded on admin.html only, not on every page (unlike
// auth.js), since it queries profiles.is_admin and there's no reason to run
// that check for every visitor on every page load.
//
// This is a UX gate only (redirects a non-admin away). The real security
// boundary is the admin-scoped RLS policies in sql-editor/migrations — this
// function does not, and cannot, enforce anything by itself.
async function acionaRequireAdmin() {
  const user = await acionaRequireAuth();
  if (!user) return null;

  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !profile || !profile.is_admin) {
    window.location.href = 'index.html';
    return null;
  }
  return user;
}

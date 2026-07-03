// Mobile nav hamburger toggle — shared across all pages
function purevialToggleNav() {
  document.getElementById('nav-links').classList.toggle('nav-open');
}

// Close the mobile menu automatically if the window is resized back to desktop width
window.addEventListener('resize', () => {
  if (window.innerWidth > 560) {
    const nav = document.getElementById('nav-links');
    if (nav) nav.classList.remove('nav-open');
  }
});

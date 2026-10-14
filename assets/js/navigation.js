const mainNavigation = document.querySelector('.main-nav');
const menuToggle = document.querySelector('.nav-menu-toggle');
const navigationLinks = document.getElementById('primary-nav-links');

if (mainNavigation && menuToggle && navigationLinks) {
  mainNavigation.classList.add('nav-menu-ready');

  const closeMenu = () => {
    navigationLinks.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    navigationLinks.querySelectorAll('details[open]').forEach((dropdown) => {
      dropdown.removeAttribute('open');
    });
  };

  menuToggle.addEventListener('click', () => {
    const willOpen = !navigationLinks.classList.contains('is-open');
    navigationLinks.classList.toggle('is-open', willOpen);
    menuToggle.setAttribute('aria-expanded', String(willOpen));
  });

  navigationLinks.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navigationLinks.classList.contains('is-open')) {
      closeMenu();
      menuToggle.focus();
    }
  });

  window.matchMedia('(min-width: 769px)').addEventListener('change', (event) => {
    if (event.matches) {
      closeMenu();
    }
  });
}

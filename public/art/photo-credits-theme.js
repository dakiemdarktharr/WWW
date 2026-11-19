// Keep the standalone attribution page consistent with the website preference.
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    let saved;
    try {
      saved = window.localStorage.getItem('kivuno-portal-theme');
    } catch {
      /* System appearance remains available without storage. */
    }
    document.documentElement.dataset.portalTheme =
      saved === 'light' || saved === 'dark' ? saved : system.matches ? 'dark' : 'light';
  };
  system.addEventListener('change', apply);
  window.addEventListener('storage', apply);
  apply();
})();

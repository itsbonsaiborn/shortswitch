try {
  const value = JSON.parse(localStorage.getItem('ss_preferences_active') || 'null');
  const legacyTheme = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ss_theme='))
    ?.slice('ss_theme='.length);
  const theme = value?.theme || legacyTheme || 'system';
  const dark = theme === 'dark'
    || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  const pathname = location.pathname;
  const publicPath = /^\/present\/[^/]+\/?$/i.test(pathname)
    || (/^\/[^/]+\/?$/.test(pathname) && pathname !== '/' && pathname !== '/login');
  const primaryLanguage = String(navigator.language || '').toLowerCase();
  const publicLocale = primaryLanguage === 'lv' || primaryLanguage.startsWith('lv-') ? 'lv' : 'en';
  document.documentElement.lang = publicPath ? publicLocale : value?.locale === 'lv' ? 'lv' : 'en';
} catch {
  // Invalid local cache must never prevent the application from starting.
}

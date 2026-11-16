try {
  const parse = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  };
  const cookie = (name) => {
    const raw = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!raw) return null;
    try { return decodeURIComponent(raw); } catch { return raw; }
  };
  const account = parse('ss_preferences_active');
  const accountInterface = location.pathname.startsWith('/app');
  const legacyTheme = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ss_theme='))
    ?.slice('ss_theme='.length);
  const publicAppearance = cookie('ss_public_appearance_preference');
  const validThemes = ['light', 'dark', 'system'];
  const accountTheme = validThemes.includes(account?.theme)
    ? account.theme
    : (validThemes.includes(legacyTheme) ? legacyTheme : null);
  const publicTheme = validThemes.includes(publicAppearance) ? publicAppearance : 'system';
  const theme = accountInterface && accountTheme ? accountTheme : publicTheme;
  const dark = theme === 'dark'
    || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = theme;
  const primaryLanguage = String(navigator.language || '').toLowerCase();
  const browserLocale = primaryLanguage === 'lv' || primaryLanguage.startsWith('lv-') ? 'lv' : 'en';
  const publicLanguage = cookie('ss_public_language_preference');
  const language = accountInterface
    ? (['en', 'lv'].includes(account?.locale) ? account.locale : 'en')
    : (['auto', 'en', 'lv'].includes(publicLanguage) ? publicLanguage : 'auto');
  document.documentElement.lang = language === 'auto' ? browserLocale : language;
} catch {
  // Invalid local cache must never prevent the application from starting.
}

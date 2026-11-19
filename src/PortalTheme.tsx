import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Moon, Sun } from 'lucide-react';
import { usePortalLocale } from './PortalLocale';
import './portal-theme.css';

export type PortalTheme = 'light' | 'dark';
const storageKey = 'kivuno-portal-theme';
const mediaQuery = '(prefers-color-scheme: dark)';

function savedTheme(): PortalTheme | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

type ThemeContext = { theme: PortalTheme; setTheme: (theme: PortalTheme) => void };
const Context = createContext<ThemeContext | null>(null);

export function PortalThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<PortalTheme | null>(savedTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(mediaQuery).matches);
  const theme = preference || (systemDark ? 'dark' : 'light');

  useEffect(() => {
    const media = window.matchMedia(mediaQuery);
    const systemChanged = () => setSystemDark(media.matches);
    const storageChanged = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPreference(savedTheme());
    };
    media.addEventListener('change', systemChanged);
    window.addEventListener('storage', storageChanged);
    systemChanged();
    return () => {
      media.removeEventListener('change', systemChanged);
      window.removeEventListener('storage', storageChanged);
    };
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-portal-theme');
    const chromeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousChromeColor = chromeColor?.getAttribute('content');
    root.setAttribute('data-portal-theme', theme);
    chromeColor?.setAttribute('content', theme === 'dark' ? '#101014' : '#f7f7f4');
    return () => {
      if (previous === null) root.removeAttribute('data-portal-theme');
      else root.setAttribute('data-portal-theme', previous);
      if (chromeColor && previousChromeColor !== undefined) {
        if (previousChromeColor === null) chromeColor.removeAttribute('content');
        else chromeColor.setAttribute('content', previousChromeColor);
      }
    };
  }, [theme]);

  const value = useMemo<ThemeContext>(
    () => ({
      theme,
      setTheme(next) {
        setPreference(next);
        try {
          window.localStorage.setItem(storageKey, next);
        } catch {
          // The selected appearance still works when persistent storage is unavailable.
        }
      },
    }),
    [theme],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePortalTheme() {
  const value = useContext(Context);
  if (!value) throw new Error('Portal theme controls require PortalThemeProvider.');
  return value;
}

export function PortalThemeToggle() {
  const { theme, setTheme } = usePortalTheme();
  const { locale } = usePortalLocale();
  const dark = theme === 'dark';
  const label = locale === 'en' ? 'Dark appearance' : 'Giao diện tối';
  const title =
    locale === 'en'
      ? dark
        ? 'Switch to light appearance'
        : 'Switch to dark appearance'
      : dark
        ? 'Chuyển sang giao diện sáng'
        : 'Chuyển sang giao diện tối';
  return (
    <button
      className="kp-theme-toggle"
      type="button"
      data-theme-toggle
      aria-label={label}
      aria-pressed={dark}
      title={title}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}

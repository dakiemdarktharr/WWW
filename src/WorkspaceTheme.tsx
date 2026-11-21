import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';
const themeKey = 'kivuno-theme';
const WorkspaceTheme = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

export function WorkspaceThemeProvider({ children }: { children: ReactNode }) {
  return useContext(WorkspaceTheme) ? (
    children
  ) : (
    <WorkspaceThemePreferences>{children}</WorkspaceThemePreferences>
  );
}

function WorkspaceThemePreferences({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const userChangedTheme = useRef(false);

  useEffect(() => {
    let current = true;
    void window.relayDesktop
      ?.workspaceTheme?.()
      .then((saved) => {
        if (current && !userChangedTheme.current && saved) setTheme(saved);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  function toggleTheme() {
    userChangedTheme.current = true;
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    void window.relayDesktop?.workspaceTheme?.(next).catch(() => {});
  }

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.workspaceTheme = theme;
    try {
      localStorage.setItem(themeKey, theme);
    } catch {
      /* Keep the current theme when browser storage is unavailable. */
    }
    return () => {
      delete root.dataset.workspaceTheme;
    };
  }, [theme]);

  return (
    <WorkspaceTheme.Provider value={{ theme, toggleTheme }}>{children}</WorkspaceTheme.Provider>
  );
}

export function useWorkspaceTheme() {
  const preference = useContext(WorkspaceTheme);
  if (!preference) throw new Error('WorkspaceThemeProvider is required.');
  return preference;
}

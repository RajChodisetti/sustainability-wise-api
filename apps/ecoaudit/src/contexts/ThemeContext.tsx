'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
};

const THEME_KEY = 'ea_web_theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [systemDark, setSystemDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const saved = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    const initialMode = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    const initialSystemDark = mq.matches;
    document.documentElement.classList.toggle(
      'dark',
      initialMode === 'dark' || (initialMode === 'system' && initialSystemDark),
    );
    const initialization = window.setTimeout(() => {
      setModeState(initialMode);
      setSystemDark(initialSystemDark);
      setMounted(true);
    }, 0);
    const handler = () => setSystemDark(mq.matches);
    mq.addEventListener('change', handler);
    return () => {
      window.clearTimeout(initialization);
      mq.removeEventListener('change', handler);
    };
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark, mounted]);

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(THEME_KEY, next);
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode, isDark }), [mode, setMode, isDark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

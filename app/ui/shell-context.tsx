'use client';

import { createContext, useContext, useEffect } from 'react';

type ShellContextValue = {
  setPageTitle: (title: string | null) => void;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

/** Sets the compact title shown in the app top bar (PageHeader does this automatically). */
export function usePageTitle(title: string | null | undefined) {
  const ctx = useContext(ShellContext);
  useEffect(() => {
    if (!ctx || !title) return;
    ctx.setPageTitle(title);
    return () => ctx.setPageTitle(null);
  }, [ctx, title]);
}

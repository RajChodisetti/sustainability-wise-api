'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { PortalAuthProvider } from '@/contexts/PortalAuthContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { SolarAuthProvider } from '@solar/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastViewport } from '@/components/ui/Toast';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <PortalAuthProvider>
            <AuthProvider>
              <SolarAuthProvider>
                {children}
                <ToastViewport />
              </SolarAuthProvider>
            </AuthProvider>
          </PortalAuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

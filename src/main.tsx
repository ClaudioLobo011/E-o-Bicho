import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

import App from './app/App';
import './styles/index.css';
import { applyStorageMigrations } from './shared/lib/storage-migrations';

applyStorageMigrations();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false
    }
  }
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
      <Toaster richColors position="top-right" duration={4000} />
    </QueryClientProvider>
  </React.StrictMode>
);

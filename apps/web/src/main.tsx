import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient();

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && window.location.pathname === '/dev/photo-editor') {
  void import('./components/media/photo-editor/PhotoEditorLab').then(({ PhotoEditorLab }) => {
    root.render(
      <StrictMode>
        <PhotoEditorLab />
      </StrictMode>,
    );
  });
} else
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );

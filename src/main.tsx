import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { queryClient } from '@/app/queryClient';
import { router } from '@/app/router';
import '@/styles/base.css';

// A page's code failed to load: after a hub update the device serves a newer build whose
// files have other names. Load the new build at the page being opened, at most once a
// minute so a real outage still shows the error page.
const RELOADED_KEY = 'kaonic.reloadedForNewBuild';
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
  if (Date.now() - last < 60_000) return;
  sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  event.preventDefault();
  const next = router.state.navigation.location;
  if (next) window.location.assign(next.pathname + next.search + next.hash);
  else window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

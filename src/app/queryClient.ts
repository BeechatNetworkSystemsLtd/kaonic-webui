import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { api, isApiError } from '@/api';
import { keys } from '@/data/queries';

/** A lost session, noticed on any call, sends the user back through the gate. */
function onError(error: unknown) {
  if (isApiError(error, 'unauthenticated')) void queryClient.invalidateQueries({ queryKey: keys.auth });
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      // Live resources are kept fresh by events; the rest is cheap to re-read.
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failures, error) => failures < 2 && isApiError(error, 'network'),
    },
  },
});

// The live stream closes for good only when the session has ended: the gate decides what comes next.
api.events.onConnectionChange((state) => {
  if (state === 'closed') void queryClient.invalidateQueries({ queryKey: keys.auth });
});

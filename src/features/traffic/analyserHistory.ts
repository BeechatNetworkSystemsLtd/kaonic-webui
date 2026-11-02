import { useSyncExternalStore } from 'react';
import { api, type RadioFrame } from '@/api';
import { createAnalyserHistory } from './frameAnalysis';

/*
 * The frames the analyser shows, shared by every reader: the hub's backlog
 * first, then the live feed, for as long as anyone is looking.
 */
const history = createAnalyserHistory((push) => {
  let stopped = false;
  const stop = api.events.subscribe('frames', (frames) => push({ live: frames }));
  // The live feed starts first, so nothing falls between the backlog and it; duplicates are merged.
  api.radio
    .frames({ limit: 500 })
    .then((frames) => {
      if (!stopped) push({ seed: frames });
    })
    // Without the backlog the analyser still fills from the live feed.
    .catch(() => undefined);
  return () => {
    stopped = true;
    stop();
  };
});

/** Every frame of the last 15 minutes, oldest first. */
export function useAnalyserFrames(): readonly RadioFrame[] {
  return useSyncExternalStore(history.subscribe, history.getSnapshot);
}

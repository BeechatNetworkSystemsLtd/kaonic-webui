import { useSyncExternalStore } from 'react';
import { api, type TrafficSample } from '@/api';
import { createSharedBuffer, type SharedBuffer } from '@/lib/sharedBuffer';

/** A rolling window of traffic samples for the charts, shared by every chart. */

type Source = (onSample: (sample: TrafficSample) => void) => () => void;

export function createTrafficHistory(source: Source, capacity: number): SharedBuffer<TrafficSample> {
  return createSharedBuffer(source, (samples, sample: TrafficSample) => [...samples, sample].slice(-capacity));
}

/** Seconds between samples from the hub. */
const SAMPLE_SECS = 2;

/** The longest range a chart can show. History is kept for this long. */
export const TRAFFIC_MAX_WINDOW_MS = 15 * 60 * 1000;

const TRAFFIC_CAPACITY = TRAFFIC_MAX_WINDOW_MS / 1000 / SAMPLE_SECS + 1;

const history = createTrafficHistory((onSample) => api.events.subscribe('traffic', onSample), TRAFFIC_CAPACITY);

export function useTrafficHistory(): readonly TrafficSample[] {
  return useSyncExternalStore(history.subscribe, history.getSnapshot);
}

import { useCallback, useEffect, useState } from 'react';
import { api, type VpnCapture } from '@/api';
import { CaptureBuffer, type CapturedRow } from './captureBuffer';

/** Packets kept on the page; the oldest go first. */
export const CAPTURE_KEEP = 20000;
/** Asked for at once; when a batch is full, the next is asked for straight away. */
const BATCH = 1000;
const POLL_MS = 1000;

export interface CapturePackets {
  rows: readonly CapturedRow[];
  clearView: () => void;
  error: unknown;
}

/**
 * The captured packets of one capture, fetched every second while it runs and
 * the tab is visible, and once more when it stops. Mount it once per capture
 * (key it by the capture's start): a new capture numbers its packets from 1.
 */
export function useCapturePackets(capture: VpnCapture): CapturePackets {
  const [buffer] = useState(() => new CaptureBuffer(CAPTURE_KEEP));
  const [rows, setRows] = useState<readonly CapturedRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const running = capture.running;
  const started = capture.startedTs !== null;

  useEffect(() => {
    if (!started) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!stopped && running) timer = setTimeout(() => void pull(), POLL_MS);
    };
    const pull = async () => {
      if (document.hidden) return schedule();
      try {
        for (let round = 0; round < 20 && !stopped; round += 1) {
          const packets = await api.vpn.capturePackets(buffer.after(), BATCH);
          if (stopped) return;
          if (buffer.append(packets) > 0) setRows(buffer.all().slice());
          if (packets.length < BATCH) break;
        }
        setError(null);
      } catch (cause) {
        if (!stopped) setError(cause);
      }
      schedule();
    };
    void pull();
    const onVisible = () => {
      if (!document.hidden && running) {
        clearTimeout(timer);
        void pull();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [buffer, running, started]);

  const clearView = useCallback(() => {
    buffer.clearRows();
    setRows([]);
  }, [buffer]);

  return { rows, clearView, error };
}

/** The current time, updated every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return now;
}

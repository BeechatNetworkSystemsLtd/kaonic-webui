import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { errorMessage, type DeviceTime } from '@/api';
import { useDeviceTime, useSetTime } from '@/data/queries';
import { Badge, Button } from '@/ui';
import styles from './SystemPage.module.css';

const SOURCE_TEXT: Record<NonNullable<DeviceTime['source']>, string> = {
  browser: 'set from a browser',
  hand: 'synced by the admin',
  peer: 'from the network',
  ntp: 'from the internet',
};

/** The device's clock, ticking from its last reading. */
function useTicking(time: DeviceTime | undefined, readAt: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return time ? time.nowMs + (now - readAt) : null;
}

/** The device's time with whether it can be trusted, and, for the admin, setting it from this browser. */
export function DeviceClock({ admin }: { admin: boolean }) {
  const time = useDeviceTime();
  const set = useSetTime();
  const now = useTicking(time.data, time.dataUpdatedAt);
  if (!time.data || now === null) return <span>–</span>;
  return (
    <span className={styles.clock}>
      <span className="num">{new Date(now).toLocaleString()}</span>
      {admin ? (
        <Button
          size="small"
          variant="ghost"
          iconOnly
          busy={set.isPending}
          onClick={() => set.mutate()}
          aria-label="Set from this browser"
          title={set.isError ? errorMessage(set.error) : time.data.source ? `Set from this browser (now ${SOURCE_TEXT[time.data.source]})` : 'Set from this browser'}
        >
          <Clock size={14} aria-hidden />
        </Button>
      ) : null}
      {time.data.valid ? null : <Badge tone="warn">not set</Badge>}
    </span>
  );
}

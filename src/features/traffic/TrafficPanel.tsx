import { useState } from 'react';
import type { TrafficChannelId } from '@/api';
import { BAND_IDS, BAND_NAMES } from '@/features/radio/bands';
import { Segmented } from '@/ui';
import { DEFAULT_TRAFFIC_RANGE, TRAFFIC_RANGES, TrafficChart } from './TrafficChart';
import styles from './TrafficPanel.module.css';

const CHANNELS: ReadonlyArray<{ id: TrafficChannelId; name: string }> = [
  { id: 'vpn', name: 'Mesh VPN' },
  ...BAND_IDS.map((id) => ({ id, name: BAND_NAMES[id] })),
];

/** The VPN first, then one chart per radio band. Each has its own scale. */
export function TrafficPanel() {
  const [windowMs, setWindowMs] = useState<number>(DEFAULT_TRAFFIC_RANGE);

  return (
    <div className={styles.list}>
      <Segmented label="Time range" options={TRAFFIC_RANGES} value={windowMs} onChange={setWindowMs} />
      {CHANNELS.map(({ id, name }) => (
        <TrafficChart key={id} channel={id} name={name} windowMs={windowMs} height={84} />
      ))}
    </div>
  );
}

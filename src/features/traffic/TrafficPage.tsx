import { useState } from 'react';
import { Page } from '@/shell/Page';
import { Segmented } from '@/ui';
import { Analyser } from './Analyser';
import { RadioStats } from './RadioStats';
import { DEFAULT_TRAFFIC_RANGE, TRAFFIC_RANGES } from './TrafficChart';
import { VpnStats } from './VpnStats';

/** What the radio and the VPN are carrying: counters, live rates, and every frame on the air. */
export default function TrafficPage() {
  const [windowMs, setWindowMs] = useState<number>(DEFAULT_TRAFFIC_RANGE);

  return (
    <Page
      title="Traffic"
      description="What this device's radio and mesh VPN are carrying, and every frame it sends and hears, to find who is talking and what goes wrong."
      actions={<Segmented label="Chart time range" options={TRAFFIC_RANGES} value={windowMs} onChange={setWindowMs} />}
    >
      <RadioStats windowMs={windowMs} />
      <VpnStats windowMs={windowMs} />
      <Analyser />
    </Page>
  );
}

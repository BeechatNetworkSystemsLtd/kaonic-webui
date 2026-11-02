import { ArrowDown, ArrowUp } from 'lucide-react';
import type { TrafficChannelId } from '@/api';
import { formatRate } from '@/lib/format';
import { AreaChart } from '@/ui/AreaChart';
import { useTrafficHistory } from './trafficHistory';
import styles from './TrafficChart.module.css';

interface TrafficChartProps {
  channel: TrafficChannelId;
  name: string;
  windowMs: number;
  height?: number;
}

/** Sent and received rate of one interface: the current numbers on top, the history below. */
export function TrafficChart({ channel, name, windowMs, height }: TrafficChartProps) {
  const history = useTrafficHistory();
  const latest = history.at(-1)?.channels[channel];

  return (
    <div className={styles.chart}>
      <div className={styles.head}>
        <h3 className={styles.name}>{name}</h3>
        <p className={`${styles.now} num`}>
          <span className={styles.rate} title="Sent">
            <ArrowUp style={{ color: 'var(--series-tx)' }} aria-label="Sent" />
            {latest ? formatRate(latest.txBps) : '–'}
          </span>
          <span className={styles.rate} title="Received">
            <ArrowDown style={{ color: 'var(--series-rx)' }} aria-label="Received" />
            {latest ? formatRate(latest.rxBps) : '–'}
          </span>
        </p>
      </div>
      <AreaChart
        label={`${name}: sent and received rate`}
        times={history.map((sample) => sample.ts)}
        windowMs={windowMs}
        height={height}
        formatValue={formatRate}
        series={[
          { id: 'rx', label: 'Received', color: 'var(--series-rx)', values: history.map((sample) => sample.channels[channel].rxBps) },
          { id: 'tx', label: 'Sent', color: 'var(--series-tx)', values: history.map((sample) => sample.channels[channel].txBps) },
        ]}
      />
    </div>
  );
}

/** Time ranges offered wherever traffic charts are shown. */
export const TRAFFIC_RANGES = [
  { value: 2 * 60_000, label: '2 min' },
  { value: 5 * 60_000, label: '5 min' },
  { value: 15 * 60_000, label: '15 min' },
] as const;

export const DEFAULT_TRAFFIC_RANGE = TRAFFIC_RANGES[0].value;

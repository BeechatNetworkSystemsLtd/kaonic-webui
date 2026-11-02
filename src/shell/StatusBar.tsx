import { useSyncExternalStore, type ReactNode } from 'react';
import { api, type ConnectionState } from '@/api';
import { useDevice, useMetrics, useNetwork, usePeers, useRadioBands, useRadioStats } from '@/data/queries';
import { SOURCE_LABELS } from '@/features/network/labels';
import { formatCount, formatDuration, formatRate } from '@/lib/format';
import { StatusDot, type Tone } from '@/ui';
import styles from './StatusBar.module.css';

const CONNECTION: Record<ConnectionState, { tone: Tone; text: string }> = {
  open: { tone: 'ok', text: 'Connected' },
  connecting: { tone: 'warn', text: 'Reconnecting' },
  closed: { tone: 'danger', text: 'Disconnected' },
};

/** The strip along the bottom: the few facts worth seeing on every page. */
export function StatusBar() {
  const connection = useSyncExternalStore(api.events.onConnectionChange, api.events.connection);
  const network = useNetwork().data;
  const peers = usePeers().data;
  const radio = useRadioBands().data;
  const metrics = useMetrics().data;
  const device = useDevice().data;
  const stats = useRadioStats().data;
  // All bands together: what this node's radios carry right now, and packets since the hub started.
  const total = stats?.reduce(
    (sum, band) => ({ rxBps: sum.rxBps + band.rxBps, txBps: sum.txBps + band.txBps, rx: sum.rx + band.rxPackets, tx: sum.tx + band.txPackets }),
    { rxBps: 0, txBps: 0, rx: 0, tx: 0 },
  );

  const online = peers?.filter((peer) => peer.online).length;
  const { tone, text } = CONNECTION[connection];

  return (
    <footer className={styles.bar}>
      <Item priority>
        <StatusDot tone={tone} />
        {text}
      </Item>
      {network ? (
        <Item priority>
          <StatusDot tone={network.activeSource ? 'ok' : 'neutral'} />
          {network.activeSource ? `Internet: ${SOURCE_LABELS[network.activeSource].short}` : 'No internet'}
        </Item>
      ) : null}
      {online !== undefined ? <Item priority>{online === 1 ? '1 device in range' : `${online} devices in range`}</Item> : null}
      {radio ? (
        <Item>
          Radio: {radio.filter((band) => band.config.modulation.kind !== 'off').length} of {radio.length} bands on
        </Item>
      ) : null}
      {total ? (
        <Item priority>
          <span title="Radio receive and send rate">
            ↓ {formatRate(total.rxBps)} ↑ {formatRate(total.txBps)}
          </span>
        </Item>
      ) : null}
      {total ? (
        <Item>
          <span title="Radio packets received and sent since the hub started">
            Packets ↓ {formatCount(total.rx)} ↑ {formatCount(total.tx)}
          </span>
        </Item>
      ) : null}
      <span className={styles.spacer} />
      {metrics ? <Item>CPU {metrics.cpuPercent}%</Item> : null}
      {metrics ? <Item>Up {formatDuration(metrics.uptimeSecs)}</Item> : null}
      {device ? <Item>Hub {device.versions.hub}</Item> : null}
    </footer>
  );
}

/** `priority` items stay visible on a phone; the rest are dropped. */
function Item({ children, priority }: { children: ReactNode; priority?: boolean }) {
  return <span className={`${styles.item} num`} data-priority={priority || undefined}>{children}</span>;
}

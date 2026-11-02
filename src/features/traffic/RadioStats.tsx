import type { RadioBandStats } from '@/api';
import { useRadioStats } from '@/data/queries';
import { BAND_NAMES } from '@/features/radio/bands';
import { formatBytes, formatCount } from '@/lib/format';
import { PanelGrid } from '@/shell/Page';
import { Badge, EmptyState, KeyValues, LoadError, Meter, Panel, Skeleton } from '@/ui';
import { TrafficChart } from './TrafficChart';
import styles from './TrafficPage.module.css';

/** Above this share of undecodable frames a band has a problem worth pointing at. */
const DECODE_ERROR_WARNING = 0.05;

/** One card per band that carries traffic. */
export function RadioStats({ windowMs }: { windowMs: number }) {
  const stats = useRadioStats();

  if (stats.isPending) return <Skeleton lines={4} />;
  if (stats.isError) return <LoadError error={stats.error} onRetry={() => void stats.refetch()} />;
  if (stats.data.length === 0) {
    return (
      <Panel title="Radio">
        <EmptyState title="No radio is carrying traffic">Turn a band on and give it to the mesh on the Radio page.</EmptyState>
      </Panel>
    );
  }
  return (
    <PanelGrid min={420}>
      {stats.data.map((band) => (
        <BandStats key={band.band} stats={band} windowMs={windowMs} />
      ))}
    </PanelGrid>
  );
}

function BandStats({ stats, windowMs }: { stats: RadioBandStats; windowMs: number }) {
  const errorShare = stats.rxFrames > 0 ? stats.rxDecodeErrors / stats.rxFrames : 0;
  const drops = stats.driver.txDropped + stats.driver.rxDropped;
  const driverErrors = stats.driver.txErrors + stats.driver.rxErrors;

  return (
    <Panel title={BAND_NAMES[stats.band]} actions={<Badge>{stats.interface}</Badge>}>
      <div className={styles.band}>
        <TrafficChart channel={stats.band} name="Traffic" windowMs={windowMs} height={96} />
        <div className={styles.airtime}>
          <Meter label="Air time sending" value={stats.airtime.txPct / 100} text={`${stats.airtime.txPct.toFixed(1)} %`} />
          <Meter label="Air time receiving" value={stats.airtime.rxPct / 100} text={`${stats.airtime.rxPct.toFixed(1)} %`} />
        </div>
        <KeyValues
          rows={[
            ['Packets', <InOut key="packets" received={formatCount(stats.rxPackets)} sent={formatCount(stats.txPackets)} />],
            ['Frames', <InOut key="frames" received={formatCount(stats.rxFrames)} sent={formatCount(stats.txFrames)} />],
            ['Data', <InOut key="bytes" received={formatBytes(stats.rxBytes)} sent={formatBytes(stats.txBytes)} />],
            [
              'Not decoded',
              <span key="decode" className={styles.inline}>
                <span className="num">
                  {formatCount(stats.rxDecodeErrors)} frames, {(errorShare * 100).toFixed(1)} %
                </span>
                {errorShare > DECODE_ERROR_WARNING ? <Badge tone="warn">High</Badge> : null}
              </span>,
            ],
            ['Signal', <span key="rssi" className="num">{stats.lastRssi !== null ? `${stats.lastRssi} dBm, last frame` : 'Nothing received yet'}</span>],
            ['Noise floor', <span key="noise" className="num">{stats.noiseDbm !== null ? `${stats.noiseDbm} dBm` : 'Unknown'}</span>],
            [
              'Driver',
              drops + driverErrors + stats.txErrors === 0 ? (
                <span key="driver" className={styles.muted}>No drops or errors</span>
              ) : (
                <span key="driver" className={styles.badges}>
                  {stats.driver.txDropped > 0 ? <Badge tone="warn">{formatCount(stats.driver.txDropped)} sent frames dropped</Badge> : null}
                  {stats.driver.rxDropped > 0 ? <Badge tone="warn">{formatCount(stats.driver.rxDropped)} received frames dropped</Badge> : null}
                  {driverErrors > 0 ? <Badge tone="warn">{formatCount(driverErrors)} driver errors</Badge> : null}
                  {stats.txErrors > 0 ? <Badge tone="warn">{formatCount(stats.txErrors)} packets not sent</Badge> : null}
                </span>
              ),
            ],
          ]}
        />
      </div>
    </Panel>
  );
}

/** "↓ received · ↑ sent", the order the charts use. */
export function InOut({ received, sent }: { received: string; sent: string }) {
  return (
    <span className={`${styles.inOut} num`}>
      <span title="Received">
        <span aria-hidden>↓ </span>
        <span className="visually-hidden">received </span>
        {received}
      </span>
      <span title="Sent">
        <span aria-hidden>↑ </span>
        <span className="visually-hidden">sent </span>
        {sent}
      </span>
    </span>
  );
}

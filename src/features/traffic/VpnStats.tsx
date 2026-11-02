import { Link } from 'react-router';
import type { VpnPeer, VpnState } from '@/api';
import { useVpn, useVpnPackets } from '@/data/queries';
import { formatBytes, formatClock, formatRate } from '@/lib/format';
import { Badge, EmptyState, KeyValues, LoadError, Notice, Panel, Skeleton, Status, type Tone } from '@/ui';
import { InOut } from './RadioStats';
import { TrafficChart } from './TrafficChart';
import styles from './TrafficPage.module.css';

const STATUS: Record<VpnState['status'], { tone: Tone; label: string }> = {
  running: { tone: 'ok', label: 'Running' },
  stopped: { tone: 'neutral', label: 'Stopped' },
  error: { tone: 'danger', label: 'Failed' },
};

const PEER_STATE: Record<VpnPeer['state'], { tone: Tone; label: string }> = {
  active: { tone: 'ok', label: 'Active' },
  pending: { tone: 'warn', label: 'Connecting' },
  discovered: { tone: 'neutral', label: 'Found' },
  closed: { tone: 'neutral', label: 'Closed' },
  error: { tone: 'danger', label: 'Failed' },
};

/** The tunnel: its state, its traffic, and each node at the other end. */
export function VpnStats({ windowMs }: { windowMs: number }) {
  const vpn = useVpn();

  if (vpn.isPending) return <Skeleton lines={4} />;
  if (vpn.isError) return <LoadError error={vpn.error} onRetry={() => void vpn.refetch()} />;
  const state = vpn.data;
  const status = STATUS[state.status];

  return (
    <>
      <Panel
        title="Mesh VPN"
        actions={
          <span className={styles.inline}>
            <Link to="/vpn" className={styles.pageLink}>
              Routes and packet capture →
            </Link>
            <Status tone={state.enabled ? status.tone : 'neutral'}>{state.enabled ? status.label : 'Off'}</Status>
          </span>
        }
      >
        {!state.enabled ? (
          <EmptyState title="The mesh VPN is not running on this device">
            When it runs, its traffic, the nodes at the other end of the tunnel and the packets going through it show here.
          </EmptyState>
        ) : (
          <div className={styles.vpn}>
            {state.lastError ? <Notice tone="danger">{state.lastError}</Notice> : null}
            <div className={styles.vpnTop}>
              <KeyValues
                rows={[
                  ['Address', <span key="ip" className="num">{state.tunnelIp ?? 'None yet'}</span>],
                  ['Network', <span key="net" className="num">{state.network ?? 'Not configured'}</span>],
                  ['Interface', state.interface ?? '–'],
                  ['Data', <InOut key="bytes" received={formatBytes(state.counters.rxBytes)} sent={formatBytes(state.counters.txBytes)} />],
                  ['Packets', <InOut key="packets" received={String(state.counters.rxPackets)} sent={String(state.counters.txPackets)} />],
                  ['Dropped', state.counters.dropped > 0 ? <Badge key="dropped" tone="warn">{state.counters.dropped} packets</Badge> : <span key="dropped" className={styles.muted}>None</span>],
                ]}
              />
              <TrafficChart channel="vpn" name="Traffic" windowMs={windowMs} height={120} />
            </div>
            <VpnPeers peers={state.peers} />
          </div>
        )}
      </Panel>
      {state.enabled ? <VpnPackets /> : null}
    </>
  );
}

/** The nodes at the other end of the tunnel. Also on the VPN page. */
export function VpnPeers({ peers }: { peers: VpnPeer[] }) {
  if (peers.length === 0) return <p className={styles.muted}>No node is on the tunnel yet.</p>;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className="visually-hidden">Nodes on the tunnel</caption>
        <thead>
          <tr>
            <th scope="col">Node</th>
            <th scope="col">Address</th>
            <th scope="col">State</th>
            <th scope="col" className={styles.number}>Received</th>
            <th scope="col" className={styles.number}>Sent</th>
            <th scope="col" className={styles.number}>Round trip</th>
            <th scope="col" className={styles.number} title="Packets sent again because no receipt came">Resent</th>
          </tr>
        </thead>
        <tbody>
          {peers.map((peer) => {
            const state = PEER_STATE[peer.state];
            return (
              <tr key={peer.peerId}>
                <th scope="row" title={peer.peerId}>
                  {peer.codename}
                  {peer.isGateway ? <Badge tone="accent">Gateway</Badge> : null}
                </th>
                <td className="num">{peer.tunnelIp ?? '–'}</td>
                <td title={peer.lastError ?? undefined}>
                  <Status tone={state.tone}>{state.label}</Status>
                </td>
                <td className={`${styles.number} num`}>
                  {formatBytes(peer.counters.rxBytes)}
                  <span className={styles.rate}>{formatRate(peer.counters.rxBps)}</span>
                </td>
                <td className={`${styles.number} num`}>
                  {formatBytes(peer.counters.txBytes)}
                  <span className={styles.rate}>{formatRate(peer.counters.txBps)}</span>
                </td>
                <td className={`${styles.number} num`}>{peer.arq?.rttMs != null ? `${peer.arq.rttMs} ms` : '–'}</td>
                <td className={`${styles.number} num`} title={peer.arq ? `${peer.arq.fastResent} fast, ${peer.arq.givenUp} given up, ${peer.arq.duplicates} duplicates` : undefined}>
                  {peer.arq ? peer.arq.resent : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The latest packets through the tunnel, headers only. */
function VpnPackets() {
  const packets = useVpnPackets(true);
  return (
    <Panel title="Tunnel packets" actions={<span className={styles.muted}>Latest 64, every 2 s</span>} flush>
      {packets.isPending ? (
        <div className={styles.pad}>
          <Skeleton lines={3} />
        </div>
      ) : packets.isError ? (
        <div className={styles.pad}>
          <LoadError error={packets.error} onRetry={() => void packets.refetch()} />
        </div>
      ) : packets.data.length === 0 ? (
        <EmptyState title="No packets yet">Packets show here as they go through the tunnel.</EmptyState>
      ) : (
        <div className={`${styles.scroll} ${styles.tall}`}>
          <table className={styles.table}>
            <caption className="visually-hidden">Packets through the tunnel, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Way</th>
                <th scope="col">Protocol</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col" className={styles.number}>Size</th>
              </tr>
            </thead>
            <tbody>
              {packets.data.map((packet, index) => (
                <tr key={`${packet.ts}-${index}`}>
                  <td className="num">{formatClock(packet.ts)}</td>
                  <td>{packet.direction === 'rx' ? '↓ In' : '↑ Out'}</td>
                  <td>{packet.proto}</td>
                  <td className="num">{packet.sport !== null ? `${packet.src}:${packet.sport}` : packet.src}</td>
                  <td className="num">{packet.dport !== null ? `${packet.dst}:${packet.dport}` : packet.dst}</td>
                  <td className={`${styles.number} num`}>{packet.len} B</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

import { useState } from 'react';
import type { VpnRemoteRoute, VpnState } from '@/api';
import { useAuthState, usePeers, useVpn } from '@/data/queries';
import { formatAgo, formatBytes, formatRate } from '@/lib/format';
import { Page } from '@/shell/Page';
import { Badge, EmptyState, KeyValues, LoadError, Notice, Panel, Segmented, Skeleton, Status, type Tone } from '@/ui';
import { InOut } from '@/features/traffic/RadioStats';
import { DEFAULT_TRAFFIC_RANGE, TRAFFIC_RANGES, TrafficChart } from '@/features/traffic/TrafficChart';
import { VpnPeers } from '@/features/traffic/VpnStats';
import { CapturePanel } from './CapturePanel';
import { SharingPanel } from './SharingPanel';
import styles from './VpnPage.module.css';

const STATUS: Record<VpnState['status'], { tone: Tone; label: string }> = {
  running: { tone: 'ok', label: 'Running' },
  stopped: { tone: 'neutral', label: 'Stopped' },
  error: { tone: 'danger', label: 'Failed' },
};

const ROUTE_STATUS: Record<string, { tone: Tone; label: string }> = {
  active: { tone: 'ok', label: 'Active' },
  conflict: { tone: 'warn', label: 'Conflict' },
  refused: { tone: 'danger', label: 'Refused' },
};

/** The mesh VPN: its state, peers and routes, and a Wireshark-style capture of what crosses it. */
export default function VpnPage() {
  const vpn = useVpn();
  const auth = useAuthState();
  const admin = auth.data?.role === 'admin';
  const [windowMs, setWindowMs] = useState<number>(DEFAULT_TRAFFIC_RANGE);

  return (
    <Page
      title="VPN"
      description="The mesh VPN carries IP between the nodes over their authenticated links. See who is on it, which routes are in use, and capture the packets that cross it."
      actions={<Segmented label="Traffic time range" options={TRAFFIC_RANGES} value={windowMs} onChange={setWindowMs} />}
    >
      {vpn.isPending ? (
        <Skeleton lines={6} />
      ) : vpn.isError ? (
        <LoadError error={vpn.error} onRetry={() => void vpn.refetch()} />
      ) : !vpn.data.enabled ? (
        <Panel title="Mesh VPN" actions={<Status tone="neutral">Off</Status>}>
          <EmptyState title="The mesh VPN is not running on this device">
            {vpn.data.lastError ?? 'Start the hub with the VPN turned on, and its tunnel, the nodes at the other end and the packets crossing it show here.'}
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Overview state={vpn.data} windowMs={windowMs} />
          <Routes state={vpn.data} />
          <SharingPanel state={vpn.data} admin={admin} />
          <CapturePanel admin={admin} />
        </>
      )}
    </Page>
  );
}

function Overview({ state, windowMs }: { state: VpnState; windowMs: number }) {
  const status = STATUS[state.status];
  return (
    <Panel title="Tunnel" actions={<Status tone={status.tone}>{status.label}</Status>}>
      <div className={styles.overview}>
        {state.lastError ? <Notice tone="danger">{state.lastError}</Notice> : null}
        <div className={styles.overviewTop}>
          <KeyValues
            rows={[
              ['Address', <span key="ip" className="num">{state.tunnelIp ?? 'None yet'}</span>],
              ['Network', <span key="net" className="num">{state.network ?? 'Not configured'}</span>],
              ['Interface', state.interface ?? '–'],
              ['MTU', state.mtu !== null ? <span key="mtu" className="num">{state.mtu} bytes</span> : '–'],
              ['Rate', <InOut key="rate" received={formatRate(state.counters.rxBps)} sent={formatRate(state.counters.txBps)} />],
              ['Data', <InOut key="bytes" received={formatBytes(state.counters.rxBytes)} sent={formatBytes(state.counters.txBytes)} />],
              ['Packets', <InOut key="packets" received={String(state.counters.rxPackets)} sent={String(state.counters.txPackets)} />],
              ['Dropped', state.counters.dropped > 0 ? <Badge key="dropped" tone="warn">{state.counters.dropped} packets</Badge> : <span key="dropped" className={styles.muted}>None</span>],
            ]}
          />
          <TrafficChart channel="vpn" name="Throughput" windowMs={windowMs} height={140} />
        </div>
        <h3 className={styles.subtitle}>Nodes on the tunnel</h3>
        <VpnPeers peers={state.peers} />
      </div>
    </Panel>
  );
}

function Routes({ state }: { state: VpnState }) {
  const peers = usePeers();
  const codename = (id: string) => state.peers.find((peer) => peer.peerId === id)?.codename ?? peers.data?.find((peer) => peer.id === id)?.codename ?? id.slice(0, 8);
  const remote = [...state.routes.remote].sort((a, b) => order(a) - order(b) || a.network.localeCompare(b.network));
  return (
    <Panel title="Routes" flush>
      <div className={styles.routes}>
        <p className={styles.routesLine}>
          <span className={styles.muted}>Offered by this device: </span>
          {state.routes.advertised.length ? (
            state.routes.advertised.map((prefix) => (
              <Badge key={prefix} tone="accent">
                {prefix}
              </Badge>
            ))
          ) : (
            <span className={styles.muted}>nothing beyond its tunnel address</span>
          )}
        </p>
        {remote.length === 0 ? (
          <p className={styles.muted}>No other node offers a network.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className="visually-hidden">Networks other nodes offer</caption>
              <thead>
                <tr>
                  <th scope="col">Network</th>
                  <th scope="col">Node</th>
                  <th scope="col">Status</th>
                  <th scope="col">In routing table</th>
                  <th scope="col">Last heard</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {remote.map((route) => {
                  const status = ROUTE_STATUS[route.status] ?? { tone: 'neutral' as Tone, label: route.status };
                  return (
                    <tr key={`${route.network}-${route.peerId}`}>
                      <th scope="row" className="num">
                        {route.network}
                      </th>
                      <td title={route.peerId}>{codename(route.peerId)}</td>
                      <td>
                        <Status tone={status.tone}>{status.label}</Status>
                      </td>
                      <td>{route.installed ? 'Yes' : <span className={styles.muted}>No</span>}</td>
                      <td>{route.lastSeenTs ? formatAgo(route.lastSeenTs) : '–'}</td>
                      <td className={styles.reason}>{route.reason ?? <span className={styles.muted}>–</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Problems first. */
const order = (route: VpnRemoteRoute) => (route.status === 'refused' ? 0 : route.status === 'conflict' ? 1 : 2);

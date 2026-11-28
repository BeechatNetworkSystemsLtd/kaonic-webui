import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import type { NodeList, Peer } from '@/api';
import { errorMessage } from '@/api';
import { nodePagePath } from '@/app/pages';
import { useDevice, useNetwork, usePeers, useSetNodeList } from '@/data/queries';
import { LINK_TEXT, LIST_TEXT, NETWORK_TEXT } from '@/features/nodes/labels';
import { seenText, shortHash } from '@/lib/format';
import { Button, KeyValues, LoadError, Notice, Skeleton, Status } from '@/ui';
import { InternetSharingDialog } from './InternetSharing';
import { MeshGraph, MeshLegend } from './MeshGraph';
import { SELF } from './meshLayout';
import styles from './MeshPage.module.css';

type Act = (id: string, list: NodeList) => void;

/** A device in range that announces it waits for an admin, and nobody has decided about yet. */
const waitsToJoin = (peer: Peer) => peer.online && peer.list === 'none' && peer.trust.network === 'unprovisioned' && peer.trust.provisioning === null;

/**
 * The home page: the mesh as a 3D map that fills the whole middle column. The
 * page itself never scrolls; the wheel zooms the map. Everything about a device
 * is in the popup that opens when you select it.
 */
export default function MeshPage() {
  const peers = usePeers();
  const device = useDevice();
  const move = useSetNodeList();
  const [selected, setSelected] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const act: Act = (id, list) => move.mutate({ id, list });

  useEffect(() => {
    document.title = 'Mesh · Kaonic';
  }, []);

  if (peers.isPending) return <div className={styles.message}><Skeleton lines={4} /></div>;
  if (peers.isError) return <div className={styles.message}><LoadError error={peers.error} onRetry={() => void peers.refetch()} /></div>;

  const selectedPeer = peers.data.find((peer) => peer.id === selected) ?? null;
  // A selected device that has left the list simply closes its popup.
  const selectedId = selected === SELF ? SELF : (selectedPeer?.id ?? null);
  const inRange = peers.data.filter((peer) => peer.online).length;
  const whitelisted = peers.data.filter((peer) => peer.list === 'whitelist').length;
  const waiting = peers.data.filter(waitsToJoin);
  const close = () => setSelected(null);

  return (
    <div className={styles.stage}>
      <MeshGraph
        peers={peers.data}
        selfIdentity={device.data?.identityHash ?? null}
        selfIsAdmin={device.data?.isAdmin ?? false}
        selected={selectedId}
        onSelect={setSelected}
        popup={
          selectedId === SELF ? (
            <SelfDetails onClose={close} />
          ) : selectedPeer ? (
            <PeerDetails
              peer={selectedPeer}
              peers={peers.data}
              busy={move.isPending && move.variables.id === selectedPeer.id}
              error={move.isError && move.variables.id === selectedPeer.id ? move.error : null}
              act={act}
              onClose={close}
            />
          ) : null
        }
      />

      {/* Text and buttons laid over the map. Only the buttons take clicks; the rest lets drags through. */}
      <header className={styles.heading}>
        <h1 className={styles.title}>Mesh</h1>
        <p className={`${styles.count} num`}>
          {inRange === 1 ? '1 device in range' : `${inRange} devices in range`}, {whitelisted} whitelisted
        </p>
        {device.data?.isAdmin ? (
          <Button size="small" className={styles.sharing} onClick={() => setSharing(true)}>
            Internet sharing
          </Button>
        ) : null}
        {waiting.map((peer) => (
          <button key={peer.id} type="button" className={styles.asking} onClick={() => setSelected(peer.id)}>
            <span className="mono">{shortHash(peer.id)}</span> waits to join
          </button>
        ))}
      </header>
      <div className={styles.legend}>
        <MeshLegend />
      </div>
      {sharing ? <InternetSharingDialog onClose={() => setSharing(false)} /> : null}
    </div>
  );
}

/* ── popups ── */

function PopupFrame({ title, subtitle, onClose, children }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className={styles.popup}>
      <div className={styles.popupHead}>
        <div>
          <p className={`${styles.popupTitle} mono`}>{title}</p>
          {subtitle ? <p className={styles.popupSub}>{subtitle}</p> : null}
        </div>
        <Button variant="ghost" size="small" iconOnly aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {children}
    </div>
  );
}

interface PeerDetailsProps {
  peer: Peer;
  peers: readonly Peer[];
  busy: boolean;
  error: unknown;
  act: Act;
  onClose: () => void;
}

function PeerDetails({ peer, peers, busy, error, act, onClose }: PeerDetailsProps) {
  const via = peers.find((candidate) => candidate.id === peer.viaId);
  const dash = '–';
  return (
    <PopupFrame title={shortHash(peer.id)} subtitle={peer.tag || undefined} onClose={onClose}>
      <Status tone={peer.online ? 'ok' : 'neutral'}>{peer.online ? 'In range' : seenText(peer.lastSeenTs, 'Out of range, last seen')}</Status>
      <KeyValues
        rows={[
          ['Codename', <span className="mono">{peer.codename}</span>],
          ['Network', NETWORK_TEXT[peer.trust.network]],
          ['List', LIST_TEXT[peer.list]],
          ['Link', peer.link.detail && peer.link.state !== 'active' ? `${LINK_TEXT[peer.link.state]}: ${peer.link.detail}` : LINK_TEXT[peer.link.state]],
          ['Signal (RSSI)', <span className="num">{peer.rssi !== null ? `${peer.rssi} dBm` : dash}</span>],
          ['Hops', <span className="num">{peer.hops ?? dash}</span>],
          ['Reached through', peer.hops === 1 ? 'direct' : <span className="mono">{via ? shortHash(via.id) : dash}</span>],
          ['Round trip', <span className="num">{peer.rttMs !== null ? `${peer.rttMs} ms` : dash}</span>],
          ['IP address', <span className="mono">{peer.tunnelIp ?? dash}</span>],
          ['Identity', <span className={`${styles.hash} mono`}>{peer.id}</span>],
        ]}
      />
      {peer.trust.provisioning?.state === 'running' ? (
        <Notice>Setting this device up: {peer.trust.provisioning.detail}.</Notice>
      ) : peer.trust.provisioning?.state === 'failed' ? (
        <Notice tone="danger">Could not set this device up: {peer.trust.provisioning.detail}.</Notice>
      ) : null}
      {error ? <Notice tone="danger">{errorMessage(error)}</Notice> : null}
      <div className={styles.popupActions}>
        <PeerActions peer={peer} busy={busy} act={act} />
        <Link className={styles.popupLink} to={nodePagePath(peer.id)}>Open node page</Link>
      </div>
    </PopupFrame>
  );
}

/**
 * What can be done from the popup. Whitelisting a device that waits to join
 * sets it up (provisions it), which needs it in range; a device that belongs
 * to another admin cannot be whitelisted at all. Removing a node is left to
 * its node page and the node table, away from a click on the map.
 */
function PeerActions({ peer, busy, act }: { peer: Peer; busy: boolean; act: Act }) {
  if (peer.trust.isAdmin || peer.list === 'whitelist') return null;
  if (peer.list === 'blacklist') return <Button size="small" busy={busy} onClick={() => act(peer.id, 'none')}>Take off the blacklist</Button>;
  const provisioning = peer.trust.provisioning?.state === 'running';
  const needsSetup = peer.trust.network !== 'ours';
  return (
    <Button
      size="small"
      variant="primary"
      busy={busy || provisioning}
      disabled={peer.trust.network === 'other' || (needsSetup && !peer.online)}
      onClick={() => act(peer.id, 'whitelist')}
    >
      {needsSetup ? 'Set up and whitelist' : 'Add to whitelist'}
    </Button>
  );
}

function SelfDetails({ onClose }: { onClose: () => void }) {
  const device = useDevice().data;
  const network = useNetwork().data;
  if (!device) return <PopupFrame title="This device" onClose={onClose}><Skeleton /></PopupFrame>;
  return (
    <PopupFrame title={shortHash(device.identityHash)} subtitle="This device" onClose={onClose}>
      <KeyValues
        rows={[
          ['Codename', <span className="mono">{device.codename}</span>],
          ['Model', device.model],
          ['Serial', <span className="mono">{device.serial}</span>],
          ['Hostname', <span className="mono">{device.hostname}.local</span>],
          ['IP address', <span className="mono">{network?.lan.address ?? '–'}</span>],
          ['Identity', <span className={`${styles.hash} mono`}>{device.identityHash}</span>],
        ]}
      />
    </PopupFrame>
  );
}

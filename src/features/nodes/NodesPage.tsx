import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown } from 'lucide-react';
import type { NodeJob, NodeList, Peer } from '@/api';
import { errorMessage } from '@/api';
import { nodePagePath } from '@/app/pages';
import { useDevice, useNodeJobs, usePeers, useSetNodeList, useSyncTimeToNodes } from '@/data/queries';
import { formatAgo, seenText, shortHash } from '@/lib/format';
import { Page } from '@/shell/Page';
import { Button, EmptyState, Input, LoadError, Notice, Skeleton, Status, StatusDot } from '@/ui';
import { currentJobs, isActive, JobStatus } from './jobs';
import { BlockDialog, ChangeRadioDialog, RestartDialog, TalkSettingsDialog, UpdateSoftwareDialog } from './NodeActionDialogs';
import { LINK_TEXT } from './labels';
import styles from './NodesPage.module.css';

/** Where a node's own page lives. */

/** The three groups of the page, in the order they are shown. */
const GROUPS: ReadonlyArray<{ list: NodeList; title: string; empty: string; explain: string }> = [
  {
    list: 'none',
    title: 'New',
    empty: 'No new nodes',
    explain: 'Nodes this device has seen that are on neither list yet, newest first.',
  },
  {
    list: 'whitelist',
    title: 'Whitelist',
    empty: 'The whitelist is empty',
    explain: 'Nodes you trust.',
  },
  {
    list: 'blacklist',
    title: 'Blocked',
    empty: 'No node is blocked',
    explain: 'Refused by every node of your network.',
  },
];

/** What can be done with a node, depending on the list it is on. */
const MOVES: Record<NodeList, ReadonlyArray<{ to: NodeList; label: string; variant?: 'danger' }>> = {
  none: [
    { to: 'whitelist', label: 'Whitelist' },
    { to: 'blacklist', label: 'Block', variant: 'danger' },
  ],
  whitelist: [
    { to: 'none', label: 'Remove' },
    { to: 'blacklist', label: 'Block', variant: 'danger' },
  ],
  blacklist: [
    { to: 'none', label: 'Unblock' },
    { to: 'whitelist', label: 'Whitelist' },
  ],
};

/** Newly seen nodes are read newest first; the two lists are looked things up in, so by name. */
function inOrder(peers: Peer[], list: NodeList): Peer[] {
  return list === 'none' ? [...peers].sort((a, b) => b.firstSeenTs - a.firstSeenTs) : [...peers].sort((a, b) => a.codename.localeCompare(b.codename));
}

const matches = (peer: Peer, query: string) => [peer.id, peer.codename, peer.tag].some((text) => text.toLowerCase().includes(query));

export default function NodesPage() {
  const peers = usePeers();
  const jobs = currentJobs(useNodeJobs().data ?? []);
  const move = useSetNodeList();
  const [search, setSearch] = useState('');
  // Groups the user has folded away. All three start open.
  const [folded, setFolded] = useState<ReadonlySet<NodeList>>(new Set());
  // Whitelisted nodes ticked for an action on all of them at once.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<'update' | 'radio' | 'restart' | 'talk' | null>(null);
  const [blocking, setBlocking] = useState<Peer | null>(null);
  // Only the Kaonic Admin changes the lists and manages nodes; members see them as they are.
  const isAdminDevice = useDevice().data?.isAdmin ?? false;
  // Our admin is shown on its own, never in a list.
  const admin = (peers.data ?? []).find((peer) => peer.trust.isAdmin);
  const others = (peers.data ?? []).filter((peer) => !peer.trust.isAdmin);

  const query = search.trim().toLowerCase();
  const toggleGroup = (list: NodeList) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(list)) next.add(list);
      return next;
    });

  // A node that has left the whitelist is no longer selected, whatever the set still holds.
  const selected = others.filter((peer) => peer.list === 'whitelist' && ticked.has(peer.id));
  const selection: Selection = {
    has: (id) => ticked.has(id),
    toggle: (id) =>
      setTicked((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    setAll: (ids, on) =>
      setTicked((current) => {
        const next = new Set(current);
        ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
        return next;
      }),
  };

  return (
    <Page
      title="Nodes"
      description={
        isAdminDevice
          ? 'Every node this device knows about, grouped by the list it is on. Whitelisted nodes can be managed from here.'
          : 'Every node this device knows about. Your Kaonic Admin decides which nodes are in the network and which are blocked.'
      }
      actions={isAdminDevice ? <SyncTime /> : null}
    >
      <Input className={styles.search} type="search" placeholder="Find by identity, codename or tag" aria-label="Find a node" value={search} onChange={(event) => setSearch(event.target.value)} />

      {move.isError ? <Notice tone="danger">{errorMessage(move.error)}</Notice> : null}

      {peers.isPending ? (
        <Skeleton lines={5} />
      ) : peers.isError ? (
        <LoadError error={peers.error} onRetry={() => void peers.refetch()} />
      ) : (
        <>
        <AdminSection admin={admin} isAdminDevice={isAdminDevice} />
        {GROUPS.map((group) => {
          const members = others.filter((peer) => peer.list === group.list);
          const rows = inOrder(query === '' ? members : members.filter((peer) => matches(peer, query)), group.list);
          // While searching, a folded group opens by itself if it holds a match.
          const open = query !== '' ? rows.length > 0 : !folded.has(group.list);
          const headingId = `nodes-${group.list}`;
          const manageable = isAdminDevice && group.list === 'whitelist';
          return (
            <section key={group.list} className={styles.group} aria-labelledby={headingId}>
              <h2 id={headingId} className={styles.groupHead}>
                <button type="button" className={styles.groupToggle} aria-expanded={open} onClick={() => toggleGroup(group.list)}>
                  <ChevronDown className={styles.chevron} aria-hidden />
                  <span className={styles.groupTitle}>{group.title}</span>
                  <span className={`${styles.count} num`}>{query === '' ? members.length : `${rows.length} of ${members.length}`}</span>
                  <span className={styles.explain}>{group.explain}</span>
                </button>
              </h2>
              {manageable && open && rows.length > 0 ? (
                <div className={styles.bulk} role="toolbar" aria-label="Actions for the selected nodes">
                  <span className={`${styles.bulkCount} num`}>{selected.length === 0 ? 'Tick nodes to act on several at once' : `${selected.length} selected`}</span>
                  <Button size="small" disabled={selected.length === 0} onClick={() => setDialog('update')}>Update software</Button>
                  <Button size="small" disabled={selected.length === 0} onClick={() => setDialog('radio')}>Change radio</Button>
                  <Button size="small" disabled={selected.length === 0} onClick={() => setDialog('talk')}>Talk settings</Button>
                  <Button size="small" disabled={selected.length === 0} onClick={() => setDialog('restart')}>Restart</Button>
                  {selected.length > 0 ? <Button size="small" variant="ghost" onClick={() => setTicked(new Set())}>Clear</Button> : null}
                </div>
              ) : null}
              {!open ? null : rows.length === 0 ? (
                <EmptyState title={query ? 'No node in this group matches the search' : group.empty} />
              ) : (
                <NodeTable rows={rows} move={isAdminDevice ? move : undefined} onBlock={setBlocking} jobs={jobs} selection={manageable ? selection : undefined} />
              )}
            </section>
          );
        })}
        </>
      )}

      {dialog === 'update' ? <UpdateSoftwareDialog nodes={selected} onClose={() => setDialog(null)} /> : null}
      {dialog === 'radio' ? <ChangeRadioDialog nodes={selected} onClose={() => setDialog(null)} /> : null}
      {dialog === 'restart' ? <RestartDialog nodes={selected} onClose={() => setDialog(null)} /> : null}
      {dialog === 'talk' ? <TalkSettingsDialog nodes={selected} onClose={() => setDialog(null)} /> : null}
      {blocking ? (
        <BlockDialog
          peer={blocking}
          busy={move.isPending}
          error={move.isError && move.variables?.id === blocking.id ? move.error : null}
          onBlock={() => move.mutate({ id: blocking.id, list: 'blacklist' }, { onSuccess: () => setBlocking(null) })}
          onClose={() => setBlocking(null)}
        />
      ) : null}
    </Page>
  );
}

interface Selection {
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  setAll: (ids: string[], on: boolean) => void;
}

interface NodeTableProps {
  rows: Peer[];
  /** Absent on a member device: the lists are shown, not changed. */
  move?: ReturnType<typeof useSetNodeList>;
  /** Blocking asks first. */
  onBlock: (peer: Peer) => void;
  jobs: ReadonlyMap<string, NodeJob>;
  /** Present for the group whose nodes can be managed: adds the tick boxes and the software column. */
  selection?: Selection;
}

function NodeTable({ rows, move, onBlock, jobs, selection }: NodeTableProps) {
  const ids = rows.map((peer) => peer.id);
  const allTicked = selection !== undefined && ids.every((id) => selection.has(id));
  return (
    <div className={styles.scroll}>
      <table className={styles.table} data-selectable={selection ? true : undefined}>
        <thead>
          <tr>
            {selection ? (
              <th scope="col" className={styles.tick}>
                <input type="checkbox" aria-label="Select all shown" checked={allTicked} onChange={() => selection.setAll(ids, !allTicked)} />
              </th>
            ) : null}
            <th scope="col">Identity</th>
            <th scope="col">Codename</th>
            <th scope="col">State</th>
            <th scope="col" className={styles.number}>Hops</th>
            <th scope="col" className={styles.number}>Signal</th>
            <th scope="col">{selection ? 'Software' : 'First seen'}</th>
            {move ? <th scope="col"><span className="visually-hidden">Actions</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((peer) => {
            const job = jobs.get(peer.id);
            return (
              <tr key={peer.id} data-ticked={selection?.has(peer.id) || undefined}>
                {selection ? (
                  <td className={styles.tick}>
                    <input type="checkbox" aria-label={`Select ${peer.codename}`} checked={selection.has(peer.id)} onChange={() => selection.toggle(peer.id)} />
                  </td>
                ) : null}
                <th scope="row" title={peer.id}>
                  {/* The dot repeats the State column, so a narrow screen can drop that column and lose nothing. */}
                  <Link to={nodePagePath(peer.id)} className={styles.identity}>
                    {/* While something is being done to the node the dot says so, even where the Software column is hidden. */}
                    <StatusDot tone={job && isActive(job) ? 'accent' : peer.online ? 'ok' : 'neutral'} />
                    <span className="mono">{shortHash(peer.id)}</span>
                  </Link>
                </th>
                <td>
                  <span className="mono">{peer.codename}</span>
                  {peer.tag ? <span className={styles.tag}>{peer.tag}</span> : null}
                </td>
                <td>
                  <Status tone={peer.online ? 'ok' : 'neutral'}>{peer.online ? 'In range' : seenText(peer.lastSeenTs)}</Status>
                </td>
                <td className={`${styles.number} num`}>{peer.hops ?? '–'}</td>
                <td className={`${styles.number} num`}>{peer.rssi !== null ? `${peer.rssi} dBm` : '–'}</td>
                <td className="num">{!selection ? formatAgo(peer.firstSeenTs) : job ? <JobStatus job={job} compact /> : peer.version}</td>
                {move ? (
                <td>
                  <span className={styles.actions}>
                    {MOVES[peer.list].map(({ to, label, variant }) => (
                      <Button
                        key={to}
                        size="small"
                        variant={variant ?? 'default'}
                        busy={move.isPending && move.variables.id === peer.id && move.variables.list === to}
                        disabled={move.isPending && move.variables.id === peer.id}
                        onClick={() => (to === 'blacklist' ? onBlock(peer) : move.mutate({ id: peer.id, list: to }))}
                      >
                        {label}
                      </Button>
                    ))}
                  </span>
                </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Our Kaonic Admin, on its own above the lists: it is trusted by definition, never new, never blocked. */
function AdminSection({ admin, isAdminDevice }: { admin: Peer | undefined; isAdminDevice: boolean }) {
  return (
    <section className={styles.group} aria-labelledby="nodes-admin">
      <h2 id="nodes-admin" className={styles.groupHead}>
        <span className={styles.groupStatic}>
          <span className={styles.groupTitle}>Kaonic Admin</span>
          <span className={styles.explain}>The device that runs your network.</span>
        </span>
      </h2>
      {isAdminDevice ? (
        <p className={styles.adminCard}>This device is the Kaonic Admin. It decides which nodes are in the network and can manage them from here.</p>
      ) : admin ? (
        <Link to={nodePagePath(admin.id)} className={styles.adminCard}>
          <StatusDot tone={admin.online ? 'ok' : 'neutral'} />
          <span className="mono">{shortHash(admin.id)}</span>
          <span className="mono">{admin.codename}</span>
          <Status tone={admin.online ? 'ok' : 'neutral'}>{admin.online ? 'In range' : seenText(admin.lastSeenTs)}</Status>
          <span className="muted">{LINK_TEXT[admin.link.state]}</span>
        </Link>
      ) : (
        <EmptyState title="Your Kaonic Admin has not been heard yet." />
      )}
    </section>
  );
}

/** Pushes this device's clock to every node: they take it even when theirs is ahead. */
function SyncTime() {
  const sync = useSyncTimeToNodes();
  return (
    <div className={styles.syncTime}>
      <Button busy={sync.isPending} onClick={() => sync.mutate()} title="Send this device's time to every node">
        Sync time
      </Button>
      {sync.isSuccess ? (
        <span className={styles.syncNote}>
          Sent to {sync.data.nodes} {sync.data.nodes === 1 ? 'node' : 'nodes'}
        </span>
      ) : null}
      {sync.isError ? <span className={styles.syncError}>{errorMessage(sync.error)}</span> : null}
    </div>
  );
}

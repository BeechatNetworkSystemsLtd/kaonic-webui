import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { maxTxPower } from '@/api/radioLimits';
import type { BandId, NodeDetails, Peer } from '@/api';
import { errorMessage, validationFields } from '@/api';
import { nodePagePath } from '@/app/pages';
import { useDevice, useNodeDetails, useNodeJobs, usePeers, useSetNodeCodename, useSetNodeList, useSoftwareRelease } from '@/data/queries';
import { BAND_NAMES } from '@/features/radio/bands';
import { describeRadio } from '@/features/radio/RadioConfigFields';
import { formatAgo, formatDuration, shortHash } from '@/lib/format';
import { Page, PanelGrid } from '@/shell/Page';
import { Badge, Button, EmptyState, Field, FormError, Input, KeyValues, LoadError, Notice, Panel, Skeleton, Status } from '@/ui';
import { JobStatus, JOB_NAMES } from './jobs';
import { LINK_TEXT, LIST_TEXT, NETWORK_TEXT } from './labels';
import { BlockDialog, ChangeRadioDialog, RestartDialog, TalkSettingsDialog, UpdateSoftwareDialog } from './NodeActionDialogs';
import { OpenShellDialog, ShellPanel } from './RemoteShell';
import styles from './NodePage.module.css';


/** Everything about one node, and everything that can be done to it. */
export default function NodePage() {
  const { nodeId = '' } = useParams();
  const peers = usePeers();
  const peer = peers.data?.find((candidate) => candidate.id === nodeId);

  if (peers.isPending) return <Frame title="Node"><Skeleton lines={5} /></Frame>;
  if (peers.isError) return <Frame title="Node"><LoadError error={peers.error} onRetry={() => void peers.refetch()} /></Frame>;
  if (!peer) {
    return (
      <Frame title="Node not found">
        <EmptyState title="This device does not know a node with that identity.">It may have been forgotten since the link was made.</EmptyState>
      </Frame>
    );
  }
  return <NodeView peer={peer} peers={peers.data} />;
}

function Frame({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Page
      title={title}
      description={description}
      actions={
        <Link to="/nodes" className={styles.back}>
          <ArrowLeft aria-hidden />
          All nodes
        </Link>
      }
    >
      {children}
    </Page>
  );
}

function NodeView({ peer, peers }: { peer: Peer; peers: readonly Peer[] }) {
  // Only the Kaonic Admin manages other nodes, and only those in its network.
  const isAdminDevice = useDevice().data?.isAdmin ?? false;
  const managed = isAdminDevice && peer.list === 'whitelist';
  // The node is only asked about itself when we are allowed to manage it and it can hear us.
  const details = useNodeDetails(peer.id, managed && peer.online);
  const release = useSoftwareRelease().data;
  const jobs = (useNodeJobs().data ?? []).filter((job) => job.nodeId === peer.id).sort((a, b) => b.createdTs - a.createdTs);
  const move = useSetNodeList();
  const [dialog, setDialog] = useState<{ kind: 'update' | 'restart' | 'talk' | 'shell' | 'block' } | { kind: 'radio'; band: BandId } | null>(null);
  // The password the shell was opened with, while it is open (kept only in memory, for this panel).
  const [shell, setShell] = useState<{ password: string; key: number } | null>(null);
  const [shellError, setShellError] = useState<unknown>(null);

  const via = peers.find((candidate) => candidate.id === peer.viaId);
  const dash = '–';
  const version = details.data?.version ?? peer.version;
  const upToDate = release !== undefined && version === release.version;
  const close = () => setDialog(null);

  return (
    <Frame title={shortHash(peer.id)} description={[peer.codename, peer.tag].filter(Boolean).join(', ')}>
      {!isAdminDevice ? null : !managed && !peer.trust.isAdmin ? (
        <Notice>
          <span>Only whitelisted nodes can be managed. This one is {peer.list === 'blacklist' ? 'on the blacklist' : 'on neither list'}.</span>
          <Button size="small" busy={move.isPending} onClick={() => move.mutate({ id: peer.id, list: 'whitelist' })}>
            Add to the whitelist
          </Button>
        </Notice>
      ) : !peer.online ? (
        <Notice tone="warn">This node is out of range. What is shown is what this device last knew, and nothing can be changed on it until it is back.</Notice>
      ) : null}
      {move.isError ? <Notice tone="danger">{errorMessage(move.error)}</Notice> : null}

      <PanelGrid min={320}>
        <Panel title="Node" actions={<Status tone={peer.online ? 'ok' : 'neutral'}>{peer.online ? 'In range' : `Seen ${formatAgo(peer.lastSeenTs)}`}</Status>}>
          <KeyValues
            rows={[
              ['Identity', <span className={`${styles.hash} mono`}>{peer.id}</span>],
              ['Codename', <span className="mono">{peer.codename}</span>],
              ['List', LIST_TEXT[peer.list]],
              ['Network', NETWORK_TEXT[peer.trust.network]],
              ['First seen', formatAgo(peer.firstSeenTs)],
            ]}
          />
          {peer.trust.isAdmin ? (
            <p className={styles.adminNote}>This is the Kaonic Admin of your network. It can't be removed or blacklisted.</p>
          ) : null}
          <div className={styles.buttons} hidden={peer.trust.isAdmin || !isAdminDevice}>
            {peer.list !== 'none' ? <Button size="small" busy={move.isPending} onClick={() => move.mutate({ id: peer.id, list: 'none' })}>{peer.list === 'blacklist' ? 'Unblock' : 'Remove from the whitelist'}</Button> : null}
            {peer.list !== 'blacklist' ? <Button size="small" variant="danger" busy={move.isPending} onClick={() => setDialog({ kind: 'block' })}>Block</Button> : null}
          </div>
        </Panel>

        <Panel title="Link">
          <KeyValues
            rows={[
              ['Hops', <span className="num">{peer.hops ?? dash}</span>],
              ['Reached through', peer.hops === 1 ? 'direct' : via ? <Link className={`${styles.link} mono`} to={nodePagePath(via.id)}>{shortHash(via.id)}</Link> : dash],
              ['Signal (RSSI)', <span className="num">{peer.rssi !== null ? `${peer.rssi} dBm` : dash}</span>],
              ['Round trip', <span className="num">{peer.rttMs !== null ? `${peer.rttMs} ms` : dash}</span>],
              ['IP address', <span className="mono">{peer.tunnelIp ?? dash}</span>],
              ['State', peer.link.detail && peer.link.state !== 'active' ? `${LINK_TEXT[peer.link.state]}: ${peer.link.detail}` : LINK_TEXT[peer.link.state]],
            ]}
          />
        </Panel>

        <Panel
          title="Software"
          actions={
            managed ? (
              <Button size="small" variant={upToDate ? 'default' : 'primary'} disabled={!peer.online || upToDate} onClick={() => setDialog({ kind: 'update' })}>
                {upToDate ? 'Up to date' : 'Update'}
              </Button>
            ) : undefined
          }
        >
          <KeyValues
            rows={[
              ['Version', <span className="num">{version}</span>],
              ['Newest available', <span className="num">{release?.version ?? dash}</span>],
              ['System', details.data?.osVersion || dash],
              ['Uptime', details.data ? formatDuration(details.data.uptimeSecs) : dash],
              ['Battery', details.data?.battery ? `${details.data.battery.percent}%` : dash],
              ['CPU', details.data?.metrics ? <span className="num">{details.data.metrics.cpuPercent}%</span> : dash],
              ['Memory', details.data?.metrics ? <span className="num">{details.data.metrics.ramUsedMb} of {details.data.metrics.ramTotalMb} MB</span> : dash],
            ]}
          />
          {managed ? (
            <div className={styles.buttons}>
              <Button size="small" disabled={!peer.online} onClick={() => setDialog({ kind: 'restart' })}>Restart node</Button>
              <Button size="small" disabled={!peer.online || shell !== null} onClick={() => setDialog({ kind: 'shell' })}>Open shell</Button>
            </div>
          ) : null}
        </Panel>

        {managed ? <SettingsPanel peer={peer} details={details.data} onTalk={() => setDialog({ kind: 'talk' })} /> : null}

        <Panel title="Activity">
          {jobs.length === 0 ? (
            <p className="muted">Nothing has been done to this node from here.</p>
          ) : (
            <ul className={styles.jobs}>
              {jobs.map((job) => (
                <li key={job.id}>
                  <span className={styles.jobName}>{JOB_NAMES[job.kind]}</span>
                  <JobStatus job={job} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PanelGrid>

      {managed && shell ? (
        <ShellPanel
          key={shell.key}
          peer={peer}
          password={shell.password}
          onClose={(error) => {
            setShell(null);
            // A wrong password: ask again, saying so.
            if (error) {
              setShellError(error);
              setDialog({ kind: 'shell' });
            }
          }}
        />
      ) : null}

      {managed ? (
        <Panel title="Radio" flush>
          {!peer.online ? (
            <EmptyState title="The radio settings can be read when the node is back in range." />
          ) : details.isPending ? (
            <div className={styles.pad}><Skeleton lines={4} /></div>
          ) : details.isError ? (
            <div className={styles.pad}><LoadError error={details.error} onRetry={() => void details.refetch()} /></div>
          ) : (
            <ul className={styles.bands}>
              {details.data.bands.map((band) => (
                <li key={band.id} className={styles.band}>
                  <span className={styles.bandName}>{BAND_NAMES[band.id]}</span>
                  <span className={`${styles.bandConfig} num`}>
                    {describeRadio(band.config)}
                    {band.config.modulation.kind !== 'off' ? `, power ${band.config.txPower} of ${maxTxPower(band.config.modulation.kind)}` : ''}
                  </span>
                  {band.usedBy.length > 0 ? <Badge tone="accent">Used by {band.usedBy.join(', ')}</Badge> : null}
                  <Button size="small" onClick={() => setDialog({ kind: 'radio', band: band.id })}>Change</Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {dialog?.kind === 'update' ? <UpdateSoftwareDialog nodes={[peer]} onClose={close} /> : null}
      {dialog?.kind === 'restart' ? <RestartDialog nodes={[peer]} onClose={close} /> : null}
      {dialog?.kind === 'block' ? <BlockDialog peer={peer} busy={move.isPending} error={move.error} onBlock={() => move.mutate({ id: peer.id, list: 'blacklist' }, { onSuccess: close })} onClose={close} /> : null}
      {dialog?.kind === 'talk' ? <TalkSettingsDialog nodes={[peer]} current={details.data?.ptt} onClose={close} /> : null}
      {dialog?.kind === 'shell' ? (
        <OpenShellDialog
          peer={peer}
          error={shellError}
          onOpen={(password) => {
            setShellError(null);
            setShell({ password, key: Date.now() });
            close();
          }}
          onClose={() => {
            setShellError(null);
            close();
          }}
        />
      ) : null}
      {dialog?.kind === 'radio' ? <ChangeRadioDialog nodes={[peer]} current={details.data?.bands} band={dialog.band} onClose={close} /> : null}
    </Frame>
  );
}

/** The node's name and talk basics, changed from here. */
function SettingsPanel({ peer, details, onTalk }: { peer: Peer; details: NodeDetails | undefined; onTalk: () => void }) {
  const rename = useSetNodeCodename();
  const [codename, setCodename] = useState<string | null>(null);
  const ptt = details?.ptt;
  const onOff = (value: boolean | undefined) => (value === undefined ? '–' : value ? 'On' : 'Off');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (codename !== null) rename.mutate({ id: peer.id, codename }, { onSuccess: () => setCodename(null) });
  };
  return (
    <Panel title="Settings">
      {codename === null ? (
        <KeyValues
          rows={[
            ['Codename', <span className="mono">{details?.codename || peer.codename}</span>],
            ['Talk', ptt === undefined ? '–' : ptt === null ? 'Not running' : `volume ${ptt.volume ?? 'as set'}${ptt.volume !== null ? '%' : ''}, squelch ${onOff(ptt.squelchEnabled).toLowerCase()}, relay ${onOff(ptt.relay).toLowerCase()}`],
            ['Hardware talk button', onOff(ptt?.autoArm)],
          ]}
        />
      ) : (
        <form onSubmit={submit} noValidate>
          <Field label="Codename" hint="Exactly 8 lowercase letters or digits." error={validationFields(rename.error).codename}>
            {(control) => <Input {...control} className="mono" autoFocus maxLength={8} value={codename} onChange={(event) => setCodename(event.target.value.toLowerCase())} />}
          </Field>
          <FormError error={validationFields(rename.error).codename ? null : rename.error} />
          <div className={styles.buttons}>
            <Button type="submit" size="small" variant="primary" busy={rename.isPending} disabled={!/^[a-z0-9]{8}$/.test(codename)}>Rename</Button>
            <Button size="small" disabled={rename.isPending} onClick={() => setCodename(null)}>Cancel</Button>
          </div>
        </form>
      )}
      {codename === null ? (
        <div className={styles.buttons}>
          <Button size="small" disabled={!peer.online} onClick={() => { rename.reset(); setCodename(details?.codename || peer.codename); }}>Rename</Button>
          <Button size="small" disabled={!peer.online || ptt === null} onClick={onTalk}>Talk settings</Button>
        </div>
      ) : null}
    </Panel>
  );
}

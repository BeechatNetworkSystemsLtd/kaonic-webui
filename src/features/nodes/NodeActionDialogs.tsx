import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage, validationFields, type BandId, type Peer, type RadioBand, type RemotePttSettings } from '@/api';
import { useNodeAction, useRadioBands, useSoftwareRelease, type NodeAction } from '@/data/queries';
import { BAND_IDS, BAND_NAMES } from '@/features/radio/bands';
import { RadioConfigFields, useRadioDraft } from '@/features/radio/RadioConfigFields';
import { formatMegabytes, shortHash } from '@/lib/format';
import { Button, Dialog, Field, FormError, Input, LoadError, Notice, Select, Skeleton } from '@/ui';
import styles from './NodeActionDialogs.module.css';

/*
 * The popups that start something on other nodes: a software update, a radio
 * change, a restart. Each works the same for one node (from its own page) and
 * for many (the selection on the Nodes page), and each only starts the work:
 * progress is shown wherever the nodes are listed.
 */

interface ActionDialogProps {
  nodes: Peer[];
  onClose: () => void;
}

const countOf = (nodes: Peer[]) => (nodes.length === 1 ? '1 node' : `${nodes.length} nodes`);

/** The nodes an action will touch, so nobody starts it on the wrong ones. */
function NodeNames({ nodes, note }: { nodes: Peer[]; note?: (peer: Peer) => string | null }) {
  return (
    <ul className={styles.nodes}>
      {nodes.map((peer) => (
        <li key={peer.id}>
          <span className="mono">{shortHash(peer.id)}</span>
          <span className="muted">{peer.codename}</span>
          {note?.(peer) ? <span className={styles.note}>{note(peer)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Starts the action and closes; shows why if the device refuses. */
function useStart(nodes: Peer[], onClose: () => void) {
  const action = useNodeAction();
  return {
    busy: action.isPending,
    error: action.error,
    start: (what: NodeAction) => action.mutate({ ids: nodes.map((peer) => peer.id), action: what }, { onSuccess: onClose }),
  };
}

function Buttons({ children, onClose, busy }: { children: ReactNode; onClose: () => void; busy: boolean }) {
  return (
    <div className={styles.buttons}>
      {children}
      <Button onClick={onClose} disabled={busy}>
        Cancel
      </Button>
    </div>
  );
}

const outOfRange = (peer: Peer) => (peer.online ? null : 'out of range, will fail');

export function UpdateSoftwareDialog({ nodes, onClose }: ActionDialogProps) {
  const release = useSoftwareRelease();
  const { busy, error, start } = useStart(nodes, onClose);
  const behind = release.data ? nodes.filter((peer) => peer.version !== release.data.version) : nodes;

  return (
    <Dialog title="Update software" onClose={onClose}>
      {release.isPending ? (
        <Skeleton />
      ) : release.isError ? (
        <LoadError error={release.error} onRetry={() => void release.refetch()} />
      ) : (
        <>
          <p>
            Version <strong className="num">{release.data.version}</strong> ({formatMegabytes(release.data.sizeBytes / 1_000_000)}) is sent over the radio, one node at a time. A node
            restarts when it has the whole update.
          </p>
          <NodeNames nodes={nodes} note={(peer) => outOfRange(peer) ?? (peer.version === release.data.version ? 'already on this version' : `now ${peer.version}`)} />
          {error ? <Notice tone="danger">{errorMessage(error)}</Notice> : null}
          <Buttons onClose={onClose} busy={busy}>
            <Button variant="primary" busy={busy} disabled={behind.length === 0} onClick={() => start({ kind: 'update' })}>
              Update {countOf(behind)}
            </Button>
          </Buttons>
        </>
      )}
    </Dialog>
  );
}

export function RestartDialog({ nodes, onClose }: ActionDialogProps) {
  const { busy, error, start } = useStart(nodes, onClose);
  return (
    <Dialog title="Restart" onClose={onClose}>
      <p>Each node drops off the mesh for about a minute while it restarts. Nodes reached through it are cut off for that time too.</p>
      <NodeNames nodes={nodes} note={outOfRange} />
      {error ? <Notice tone="danger">{errorMessage(error)}</Notice> : null}
      <Buttons onClose={onClose} busy={busy}>
        <Button variant="danger" busy={busy} onClick={() => start({ kind: 'restart' })}>
          Restart {countOf(nodes)}
        </Button>
      </Buttons>
    </Dialog>
  );
}

interface ChangeRadioDialogProps extends ActionDialogProps {
  /** The bands as one node has them now, to start from. Without it the form starts from this device's own settings. */
  current?: RadioBand[];
  /** The band to open on. */
  band?: BandId;
}

export function ChangeRadioDialog({ nodes, onClose, current, band: firstBand = 'a_sub' }: ChangeRadioDialogProps) {
  const own = useRadioBands();
  const [bandId, setBandId] = useState<BandId>(firstBand);
  const template = (current ?? own.data)?.find((band) => band.id === bandId);

  return (
    <Dialog title="Change radio settings" onClose={onClose}>
      {!current && own.isPending ? (
        <Skeleton />
      ) : !template ? (
        <LoadError error={own.error} onRetry={() => void own.refetch()} />
      ) : (
        <>
          <Field label="Band">
            {(control) => (
              <Select {...control} value={bandId} onChange={(event) => setBandId(event.target.value as BandId)}>
                {BAND_IDS.map((id) => (
                  <option key={id} value={id}>{BAND_NAMES[id]}</option>
                ))}
              </Select>
            )}
          </Field>
          {/* The key starts the form afresh from the chosen band's settings. */}
          <RadioForm key={bandId} band={template} nodes={nodes} fromOwn={!current} onClose={onClose} />
        </>
      )}
    </Dialog>
  );
}

function RadioForm({ band, nodes, fromOwn, onClose }: { band: RadioBand; nodes: Peer[]; fromOwn: boolean; onClose: () => void }) {
  const draft = useRadioDraft(band.config, band);
  const { busy, error, start } = useStart(nodes, onClose);
  const fieldErrors = validationFields(error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.valid) start({ kind: 'radio', band: band.id, config: draft.config });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {fromOwn ? <p className="muted">The form starts from this device&rsquo;s own settings for the band.</p> : null}
      <RadioConfigFields draft={draft} errors={fieldErrors} />
      <Notice tone="warn">
        A node that changes the band it is reached on can no longer be heard until this device, and every node on the way, uses the same settings. Change the furthest nodes first.
      </Notice>
      <NodeNames nodes={nodes} note={outOfRange} />
      <FormError error={error} />
      <Buttons onClose={onClose} busy={busy}>
        <Button type="submit" variant="primary" busy={busy} disabled={!draft.valid}>
          Apply to {countOf(nodes)}
        </Button>
      </Buttons>
    </form>
  );
}

/** A setting that is left as each node has it until it is chosen. */
type Choice = 'keep' | 'on' | 'off';
const CHOICES: Array<[Choice, string]> = [
  ['keep', 'Leave as it is'],
  ['on', 'On'],
  ['off', 'Off'],
];
const choiceOf = (value: boolean | undefined): Choice => (value === undefined ? 'keep' : value ? 'on' : 'off');
const fromChoice = (choice: Choice) => (choice === 'keep' ? undefined : choice === 'on');

const SWITCHES: Array<{ key: 'playOnDevice' | 'autoArm' | 'squelchEnabled' | 'relay'; label: string; hint: string }> = [
  { key: 'playOnDevice', label: 'Play on the device speaker', hint: 'The group is heard on the node itself.' },
  { key: 'autoArm', label: 'Hardware talk button', hint: 'Keeps the microphone armed so the headset button keys it.' },
  { key: 'squelchEnabled', label: 'Squelch', hint: 'Talk only while the microphone hears a voice.' },
  { key: 'relay', label: 'Relay voice', hint: 'Passes voice on to nodes further away.' },
];

interface TalkSettingsDialogProps extends ActionDialogProps {
  /** One node's settings now, to start from; without them every setting starts as "leave as it is". */
  current?: RemotePttSettings | null;
}

/** The talk basics on one node or many. Only what is changed is sent. */
export function TalkSettingsDialog({ nodes, onClose, current }: TalkSettingsDialogProps) {
  const { busy, error, start } = useStart(nodes, onClose);
  const fieldErrors = validationFields(error);
  const [switches, setSwitches] = useState<Record<string, Choice>>(() => Object.fromEntries(SWITCHES.map(({ key }) => [key, choiceOf(current?.[key])])));
  const [volume, setVolume] = useState(current?.volume != null ? String(current.volume) : '');
  const [squelch, setSquelch] = useState(current?.squelchOpenDbfs != null ? String(current.squelchOpenDbfs) : '');

  const volumeValue = volume.trim() === '' ? undefined : Number(volume);
  const squelchValue = squelch.trim() === '' ? undefined : Number(squelch);
  const volumeBad = volumeValue !== undefined && !(Number.isInteger(volumeValue) && volumeValue >= 0 && volumeValue <= 100);
  const squelchBad = squelchValue !== undefined && !(Number.isFinite(squelchValue) && squelchValue >= -90 && squelchValue <= 0);

  const settings: RemotePttSettings = {};
  for (const { key } of SWITCHES) {
    const value = fromChoice(switches[key] ?? 'keep');
    if (value !== undefined && value !== current?.[key]) settings[key] = value;
  }
  if (volumeValue !== undefined && !volumeBad && volumeValue !== current?.volume) settings.volume = volumeValue;
  if (squelchValue !== undefined && !squelchBad && squelchValue !== current?.squelchOpenDbfs) settings.squelchOpenDbfs = squelchValue;
  const changes = Object.keys(settings).length;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (changes > 0 && !volumeBad && !squelchBad) start({ kind: 'ptt', settings });
  }

  return (
    <Dialog title="Talk settings" onClose={onClose}>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {current ? null : <p className="muted">Only the settings you choose are changed; the rest stay as each node has them.</p>}
        {SWITCHES.map(({ key, label, hint }) => (
          <Field key={key} label={label} hint={hint}>
            {(control) => (
              <Select {...control} value={switches[key]} onChange={(event) => setSwitches({ ...switches, [key]: event.target.value as Choice })}>
                {CHOICES.filter(([choice]) => choice !== 'keep' || !current).map(([choice, text]) => (
                  <option key={choice} value={choice}>{text}</option>
                ))}
              </Select>
            )}
          </Field>
        ))}
        <Field label="Speaker volume, %" hint={current ? '0 to 100' : '0 to 100; empty leaves it'} error={volumeBad ? 'Use 0 to 100.' : fieldErrors.volume}>
          {(control) => <Input {...control} inputMode="numeric" value={volume} onChange={(event) => setVolume(event.target.value)} />}
        </Field>
        <Field label="Squelch opens at, dBFS" hint={current ? '-90 to 0' : '-90 to 0; empty leaves it'} error={squelchBad ? 'Use -90 to 0.' : fieldErrors.squelchOpenDbfs}>
          {(control) => <Input {...control} inputMode="numeric" value={squelch} onChange={(event) => setSquelch(event.target.value)} />}
        </Field>
        <NodeNames nodes={nodes} note={outOfRange} />
        <FormError error={error} />
        <Buttons onClose={onClose} busy={busy}>
          <Button type="submit" variant="primary" busy={busy} disabled={changes === 0 || volumeBad || squelchBad}>
            Apply to {countOf(nodes)}
          </Button>
        </Buttons>
      </form>
    </Dialog>
  );
}

/** Blocking is for the whole network and takes a node out of it: asked once more. */
export function BlockDialog({ peer, busy, error, onBlock, onClose }: { peer: Peer; busy: boolean; error: unknown; onBlock: () => void; onClose: () => void }) {
  return (
    <Dialog title="Block this node?" onClose={onClose}>
      <p>
        Every node of your network will refuse <span className="mono">{shortHash(peer.id)}</span> ({peer.codename || 'no codename'}).
        {peer.list === 'whitelist' ? ' It is taken out of the network, and the talk group key is changed so it can no longer listen.' : ''}
      </p>
      <FormError error={error} />
      <Buttons onClose={onClose} busy={busy}>
        <Button variant="danger" busy={busy} onClick={onBlock}>
          Block
        </Button>
      </Buttons>
    </Dialog>
  );
}

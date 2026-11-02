import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Lock, Wifi, WifiHigh, WifiLow, WifiZero } from 'lucide-react';
import { errorMessage, validationFields, type SavedWifiNetwork, type WifiClient, type WifiProblem, type WifiScanEntry, type WifiSecurity } from '@/api';
import {
  useConnectWifi,
  useForgetWifi,
  useJoinWifi,
  useReorderWifi,
  useUnpinWifi,
  useUpdateWifi,
  useWifi,
  useWifiLastScan,
  useWifiScan,
} from '@/data/queries';
import { formatAgo } from '@/lib/format';
import { Badge, Button, Dialog, EmptyState, Field, FormError, Input, LoadError, Notice, Skeleton, Switch } from '@/ui';
import styles from './Wifi.module.css';

const SECURITY_TEXT: Record<WifiSecurity, string> = { open: 'Open', wpa2: 'WPA2', wpa3: 'WPA3' };

/** Why the last try to join a network failed, in words. */
const PROBLEM_TEXT: Record<WifiProblem, (ssid: string) => string> = {
  wrong_password: (ssid) => `The password for "${ssid}" is wrong.`,
  not_found: (ssid) => `"${ssid}" is not in range.`,
  rejected: (ssid) => `"${ssid}" refused the connection.`,
  timeout: (ssid) => `"${ssid}" did not answer.`,
  no_address: (ssid) => `Joined "${ssid}", but it gave the device no address.`,
};

const PROBLEM_BADGE: Record<WifiProblem, string> = {
  wrong_password: 'Wrong password',
  not_found: 'Not in range',
  rejected: 'Refused',
  timeout: 'No answer',
  no_address: 'No address',
};

/** Four steps of signal strength, the way a phone shows it. */
function SignalIcon({ dbm }: { dbm: number }) {
  const props = { className: styles.signal, 'aria-hidden': true } as const;
  if (dbm >= -60) return <Wifi {...props} />;
  if (dbm >= -70) return <WifiHigh {...props} />;
  if (dbm >= -80) return <WifiLow {...props} />;
  return <WifiZero {...props} />;
}

const band = (frequencyMhz: number) => (frequencyMhz >= 5000 ? '5 GHz' : '2.4 GHz');

/** What the network form is for: a network from the scan, one typed by name, or a new password for a saved one. */
type Form = { kind: 'join'; ssid: string; security: WifiSecurity | 'unknown' } | { kind: 'password'; ssid: string };

/**
 * The editor for client (STA) mode. The hub keeps the client on the best saved
 * network: the first one in this list that is in range and may join on its own.
 * A network joined by hand is kept until it fails.
 */
export function WifiNetworksDialog({ onClose }: { onClose: () => void }) {
  const wifi = useWifi();
  const lastScan = useWifiLastScan();
  const scan = useWifiScan();
  const connect = useConnectWifi();
  const forget = useForgetWifi();
  const update = useUpdateWifi();
  const reorder = useReorderWifi();
  const unpin = useUnpinWifi();
  const [form, setForm] = useState<Form | null>(null);

  const failed = connect.error ?? forget.error ?? update.error ?? reorder.error ?? unpin.error;
  const networks = scan.data ?? lastScan.data?.networks ?? null;
  const scannedTs = lastScan.data?.scannedTs ?? null;
  const busy = connect.isPending || forget.isPending || update.isPending || reorder.isPending;

  return (
    <Dialog title="Wi-Fi networks" onClose={onClose}>
      {wifi.isPending ? (
        <Skeleton lines={4} />
      ) : wifi.isError ? (
        <LoadError error={wifi.error} onRetry={() => void wifi.refetch()} />
      ) : (
        <>
          <ClientStatus client={wifi.data.client} unpinBusy={unpin.isPending} onUnpin={() => unpin.mutate()} onFixPassword={(ssid) => setForm({ kind: 'password', ssid })} />
          {failed ? <Notice tone="danger">{errorMessage(failed)}</Notice> : null}

          <section className={styles.section}>
            <h3 className={styles.heading}>Saved networks</h3>
            {wifi.data.saved.length === 0 ? (
              <EmptyState title="No saved networks">Scan for networks in range, or add one by name.</EmptyState>
            ) : (
              <>
                <p className="muted">Joined in this order of preference. The device moves up the list only when a preferred network is strong.</p>
                <ul className={styles.list}>
                  {wifi.data.saved.map((network, index, saved) => (
                    <SavedRow
                      key={network.ssid}
                      network={network}
                      client={wifi.data.client}
                      first={index === 0}
                      last={index === saved.length - 1}
                      busy={busy}
                      onMove={(step) => {
                        const order = saved.map((entry) => entry.ssid);
                        [order[index], order[index + step]] = [order[index + step]!, order[index]!];
                        reorder.mutate(order);
                      }}
                      onConnect={() => connect.mutate(network.ssid)}
                      onForget={() => forget.mutate(network.ssid)}
                      onAutoConnect={(autoConnect) => update.mutate({ ssid: network.ssid, patch: { autoConnect } })}
                      onPassword={() => setForm({ kind: 'password', ssid: network.ssid })}
                    />
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.heading}>Networks in range</h3>
              <Button size="small" busy={scan.isPending} disabled={wifi.data.client.state === 'off'} onClick={() => scan.mutate()}>
                Scan now
              </Button>
            </div>
            {wifi.data.client.state === 'off' ? <p className="muted">Switch on the Wi-Fi network to see what is in range.</p> : null}
            {scan.isError ? <Notice tone="danger">{errorMessage(scan.error)}</Notice> : null}
            {networks && networks.length > 0 ? (
              <>
                {scannedTs !== null && !scan.data ? <p className="muted">Found {formatAgo(scannedTs)}.</p> : null}
                <ul className={styles.list}>
                  {networks.map((entry) => (
                    <ScanRow key={entry.ssid} entry={entry} onJoin={() => setForm({ kind: 'join', ssid: entry.ssid, security: entry.security })} />
                  ))}
                </ul>
              </>
            ) : networks && !scan.isPending && wifi.data.client.state !== 'off' ? (
              <p className="muted">No networks found yet.</p>
            ) : null}
          </section>

          {form ? (
            // The key starts a fresh form for each network picked.
            <NetworkForm key={`${form.kind}:${form.ssid}`} form={form} onDone={() => setForm(null)} />
          ) : (
            <Button onClick={() => setForm({ kind: 'join', ssid: '', security: 'unknown' })}>Add a network by name</Button>
          )}
        </>
      )}
    </Dialog>
  );
}

function ClientStatus({ client, unpinBusy, onUnpin, onFixPassword }: { client: WifiClient; unpinBusy: boolean; onUnpin: () => void; onFixPassword: (ssid: string) => void }) {
  let line: ReactNode;
  if (client.fault) line = 'The Wi-Fi network is switched on, but not working.';
  else if (client.state === 'off') line = 'The Wi-Fi network is off. Switch it on to join a network.';
  else if (client.state === 'connected')
    line = (
      <>
        Connected to <strong>{client.ssid}</strong>
        {client.signalDbm !== null ? (
          <>
            , <span className="num">{client.signalDbm} dBm</span>
          </>
        ) : null}
        {client.address ? (
          <>
            , address <span className="mono">{client.address}</span>
          </>
        ) : null}
        .
      </>
    );
  else if (client.state === 'connecting')
    line = (
      <>
        Joining <strong>{client.ssid}</strong>…
      </>
    );
  else line = 'Looking for a saved network in range.';

  const attempt = client.attempt;
  return (
    <>
      <p className={styles.lead}>{line}</p>
      {client.fault ? <Notice tone="danger">{client.fault}</Notice> : null}
      {client.pinned && client.state !== 'off' ? (
        <p className="muted">
          Staying on <strong>{client.pinned}</strong> because it was chosen by hand.{' '}
          <Button size="small" variant="ghost" busy={unpinBusy} onClick={onUnpin}>
            Let the device choose
          </Button>
        </p>
      ) : null}
      {attempt ? (
        <Notice tone={attempt.reason === 'wrong_password' ? 'danger' : 'warn'}>
          <span>
            {PROBLEM_TEXT[attempt.reason](attempt.ssid)}
            {client.state === 'connected' && client.ssid ? ` The device stayed on "${client.ssid}".` : ''}
          </span>
          {attempt.reason === 'wrong_password' ? (
            <Button size="small" onClick={() => onFixPassword(attempt.ssid)}>
              Change password
            </Button>
          ) : null}
        </Notice>
      ) : null}
    </>
  );
}

interface SavedRowProps {
  network: SavedWifiNetwork;
  client: WifiClient;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (step: -1 | 1) => void;
  onConnect: () => void;
  onForget: () => void;
  onAutoConnect: (autoConnect: boolean) => void;
  onPassword: () => void;
}

function SavedRow({ network, client, first, last, busy, onMove, onConnect, onForget, onAutoConnect, onPassword }: SavedRowProps) {
  const current = client.ssid === network.ssid && client.state !== 'off';
  return (
    <li className={styles.row}>
      <span className={styles.name}>
        {network.signalDbm !== null ? <SignalIcon dbm={network.signalDbm} /> : null}
        {network.ssid}
        {network.secured ? <Lock className={styles.lock} aria-label="Password protected" /> : null}
      </span>
      {current && client.state === 'connected' ? (
        <Badge tone="ok">Connected</Badge>
      ) : current ? (
        <Badge tone="accent">Joining</Badge>
      ) : network.problem ? (
        <Badge tone={network.problem === 'wrong_password' ? 'danger' : 'warn'}>{PROBLEM_BADGE[network.problem]}</Badge>
      ) : !network.inRange ? (
        <span className="muted">Not in range</span>
      ) : null}
      <span className={styles.actions}>
        <Switch label={`Join ${network.ssid} automatically`} checked={network.autoConnect} disabled={busy} onChange={onAutoConnect} />
        <Button size="small" variant="ghost" iconOnly aria-label={`Prefer ${network.ssid}`} disabled={first || busy} onClick={() => onMove(-1)}>
          <ArrowUp />
        </Button>
        <Button size="small" variant="ghost" iconOnly aria-label={`Prefer ${network.ssid} less`} disabled={last || busy} onClick={() => onMove(1)}>
          <ArrowDown />
        </Button>
        {!current && client.state !== 'off' ? (
          <Button size="small" disabled={busy} onClick={onConnect}>
            Connect
          </Button>
        ) : null}
        {network.secured || network.problem === 'wrong_password' ? (
          <Button size="small" variant="ghost" disabled={busy} onClick={onPassword}>
            Password
          </Button>
        ) : null}
        <Button size="small" variant="ghost" disabled={busy} onClick={onForget}>
          Forget
        </Button>
      </span>
    </li>
  );
}

function ScanRow({ entry, onJoin }: { entry: WifiScanEntry; onJoin: () => void }) {
  return (
    <li className={styles.row}>
      <span className={styles.name}>
        <SignalIcon dbm={entry.signalDbm} />
        {entry.ssid}
      </span>
      <span className="muted num">
        {SECURITY_TEXT[entry.security]}, {band(entry.frequencyMhz)}, {entry.signalDbm} dBm
      </span>
      <span className={styles.actions}>{entry.saved ? <span className="muted">Saved</span> : <Button size="small" onClick={onJoin}>Join</Button>}</span>
    </li>
  );
}

function NetworkForm({ form, onDone }: { form: Form; onDone: () => void }) {
  const [ssid, setSsid] = useState(form.ssid);
  const [password, setPassword] = useState('');
  const [hidden, setHidden] = useState(false);
  const join = useJoinWifi();
  const update = useUpdateWifi();
  const pending = join.isPending || update.isPending;
  const error = join.error ?? update.error;
  const fields = validationFields(error);
  const typed = form.kind === 'join' && form.ssid === '';
  const open = form.kind === 'join' && form.security === 'open';
  const title = form.kind === 'password' ? `New password for ${form.ssid}` : typed ? 'Add a network' : `Join ${form.ssid}`;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // An empty password on a network we know nothing about means it is open.
    const value = open || password === '' ? null : password;
    if (form.kind === 'password') update.mutate({ ssid: form.ssid, patch: { password: value } }, { onSuccess: onDone });
    else join.mutate({ ssid, password: value, hidden: typed && hidden }, { onSuccess: onDone });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <h3 className={styles.heading}>{title}</h3>
      {typed ? (
        <>
          <Field label="Network name" error={fields.ssid}>
            {(control) => <Input {...control} autoFocus maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={ssid} onChange={(event) => setSsid(event.target.value)} />}
          </Field>
          <label className="muted">
            <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} /> This network does not show its name (hidden)
          </label>
        </>
      ) : null}
      {open ? (
        <p className="muted">This network has no password. Anyone in range can read what is sent over it.</p>
      ) : (
        <Field label="Password" hint={form.kind === 'join' && form.security === 'unknown' ? 'Leave empty for a network without a password.' : '8 to 63 characters.'} error={fields.password}>
          {(control) => <Input {...control} type="password" autoFocus={!typed} autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
      )}
      <FormError error={error} />
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" busy={pending} disabled={ssid.trim() === ''}>
          {form.kind === 'password' ? 'Save and try again' : 'Save and connect'}
        </Button>
        <Button onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Plus } from 'lucide-react';
import { errorMessage, validationFields, type Plugin, type PluginAction, type PluginInstallResult } from '@/api';
import { pluginPagePath } from '@/app/pages';
import {
  useAuthState,
  usePluginAction,
  usePluginPolicy,
  usePlugins,
  usePluginsChanging,
  useRemovePlugin,
  useSetPluginPolicy,
} from '@/data/queries';
import { Page } from '@/shell/Page';
import { Badge, Button, EmptyState, Field, FormError, Input, LoadError, Notice, Panel, Skeleton, Status, Switch } from '@/ui';
import { CoreSoftware } from './CoreSoftware';
import { HistoryPanel } from './HistoryPanel';
import { InstallPluginDialog } from './InstallPluginDialog';
import { PluginGlyph } from './PluginGlyph';
import { isInstallerDown, PERMISSIONS } from './software';
import styles from './PluginsPage.module.css';

export default function PluginsPage() {
  const plugins = usePlugins();
  const admin = useAuthState().data?.role === 'admin';
  const act = usePluginAction();
  const remove = useRemovePlugin();
  const changing = usePluginsChanging();
  /** The last failure per plugin, shown on its own row until the next try. */
  const [failures, setFailures] = useState<Record<string, string>>({});
  /** The install dialog: for any package, or to update one plugin. */
  const [installing, setInstalling] = useState<{ plugin?: Plugin } | null>(null);
  /** What the last install did, said once at the top and marked on the plugin's row. */
  const [installed, setInstalled] = useState<PluginInstallResult | null>(null);
  const installerDown = plugins.isError && isInstallerDown(plugins.error);

  const installButton =
    admin && !installerDown ? (
      <Button variant="primary" onClick={() => setInstalling({})}>
        <Plus aria-hidden />
        Install plugin
      </Button>
    ) : undefined;

  function clearFailure(id: string) {
    setFailures((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  const failed = (id: string) => (error: unknown) => setFailures((current) => ({ ...current, [id]: errorMessage(error) }));

  function run(plugin: Plugin, action: PluginAction) {
    clearFailure(plugin.id);
    act.mutate({ id: plugin.id, action }, { onError: failed(plugin.id) });
  }

  return (
    <Page title="Plugins" description="Extra functions installed on this device. A running plugin with its own page also appears in the menu." actions={installButton}>
      {installed ? <InstalledNotice result={installed} /> : null}
      {plugins.isPending ? (
        <Panel>
          <Skeleton lines={4} />
        </Panel>
      ) : installerDown ? (
        <Panel>
          <EmptyState title="The plugin installer is not running">
            <p className="muted">Plugins cannot be listed or changed until it is back. It restarts on its own; check the System page if it stays down.</p>
            <Button size="small" busy={plugins.isFetching} onClick={() => void plugins.refetch()}>
              Try again
            </Button>
          </EmptyState>
        </Panel>
      ) : plugins.isError ? (
        <Panel>
          <LoadError error={plugins.error} onRetry={() => void plugins.refetch()} />
        </Panel>
      ) : (
        <>
          <CoreSoftware admin={admin} />
          <PolicyPanel admin={admin} />
          {plugins.data.length === 0 ? (
            <Panel>
              <EmptyState title="No plugins are installed on this device.">Install one from its package file.</EmptyState>
            </Panel>
          ) : (
            <>
              <p className={styles.summary}>
                <span className="num">{plugins.data.filter((plugin) => plugin.running).length}</span> of{' '}
                <span className="num">{plugins.data.length}</span> plugins running
              </p>
              <Panel flush>
                <ul className={styles.list}>
                  {plugins.data.map((plugin) => (
                    <PluginRow
                      key={plugin.id}
                      plugin={plugin}
                      admin={admin}
                      changing={changing.find((change) => change.id === plugin.id)?.action ?? null}
                      failure={failures[plugin.id]}
                      fresh={installed?.plugin.id === plugin.id}
                      onAction={(action) => run(plugin, action)}
                      onUpdate={() => setInstalling({ plugin })}
                      removing={remove.isPending && remove.variables?.id === plugin.id}
                      onRemove={(keepData) => {
                        clearFailure(plugin.id);
                        remove.mutate(
                          { id: plugin.id, keepData },
                          {
                            onSuccess: () => setInstalled((current) => (current?.plugin.id === plugin.id ? null : current)),
                            onError: failed(plugin.id),
                          },
                        );
                      }}
                    />
                  ))}
                </ul>
              </Panel>
            </>
          )}
          {admin ? <HistoryPanel plugins={plugins.data} /> : null}
        </>
      )}
      {installing ? (
        <InstallPluginDialog
          plugin={installing.plugin}
          onClose={() => setInstalling(null)}
          onInstalled={(result) => {
            setInstalling(null);
            setInstalled(result);
          }}
        />
      ) : null}
    </Page>
  );
}

/** What the last install did, and what the plugin may use. */
function InstalledNotice({ result }: { result: PluginInstallResult }) {
  const { plugin } = result;
  const what = result.action === 'installed' ? `${plugin.name} ${plugin.version} is installed` : `${plugin.name} is updated to version ${plugin.version}`;
  const state = plugin.running ? 'and running' : 'but not running';
  const rights = plugin.permissions.map((permission) => PERMISSIONS[permission].explain);
  return (
    <Notice>
      {what} {state}.{rights.length > 0 ? ` It ${rights.join(', ')}.` : ' It asks for no extra rights.'}
    </Notice>
  );
}

/** Whether only signed plugins install. A development device has no release key, so it cannot require them. */
function PolicyPanel({ admin }: { admin: boolean }) {
  const policy = usePluginPolicy();
  const setPolicy = useSetPluginPolicy();
  const [wanted, setWanted] = useState<boolean | null>(null);
  const needsPassword = useAuthState().data?.passwordSet ?? true;
  const [password, setPassword] = useState('');
  const fields = validationFields(setPolicy.error);
  const devDevice = policy.data?.releaseKey === false;

  if (policy.isPending) return null;
  if (policy.isError) {
    return (
      <Panel>
        <LoadError error={policy.error} onRetry={() => void policy.refetch()} />
      </Panel>
    );
  }
  const signedOnly = policy.data.requireSigned;

  function close() {
    setWanted(null);
    setPassword('');
    setPolicy.reset();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (wanted !== null) setPolicy.mutate({ requireSigned: wanted, password }, { onSuccess: close });
  }

  return (
    <Panel>
      <div className={styles.policy}>
        {devDevice ? <Notice tone="warn">Development device: no release key. Plugins and updates install unsigned.</Notice> : null}
        <div className={styles.policyRow}>
          <div>
            <p className={styles.policyName}>Signed plugins only</p>
            <p className={styles.policyHint}>{signedOnly ? 'Only packages signed by Beechat install.' : 'Unsigned packages install too, marked as unsigned.'}</p>
          </div>
          {admin ? (
            <Switch
              label="Install signed plugins only"
              checked={wanted ?? signedOnly}
              disabled={devDevice || setPolicy.isPending}
              onChange={(next) => (next === signedOnly ? close() : setWanted(next))}
            />
          ) : (
            <Status tone={signedOnly ? 'ok' : 'neutral'}>{signedOnly ? 'On' : 'Off'}</Status>
          )}
        </div>
        {wanted !== null ? (
          <form className={styles.confirm} onSubmit={onSubmit}>
            {needsPassword ? (
              <Field label={`Enter the password to turn it ${wanted ? 'on' : 'off'}`} error={fields.password}>
                {(control) => (
                  <Input {...control} type="password" autoComplete="current-password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} />
                )}
              </Field>
            ) : null}
            <FormError error={setPolicy.error} />
            <div className={styles.buttons}>
              <Button type="submit" size="small" variant="primary" busy={setPolicy.isPending}>
                Save
              </Button>
              <Button size="small" disabled={setPolicy.isPending} onClick={close}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Panel>
  );
}

interface PluginRowProps {
  plugin: Plugin;
  admin: boolean;
  /** What is being done to it right now, if anything. */
  changing: PluginAction | 'update' | null;
  failure: string | undefined;
  /** Just installed or updated: the row is marked so it is easy to find. */
  fresh: boolean;
  onAction: (action: PluginAction) => void;
  onUpdate: () => void;
  removing: boolean;
  onRemove: (keepData: boolean) => void;
}

const CHANGING_TEXT: Record<PluginAction | 'update', string> = {
  start: 'Starting',
  stop: 'Stopping',
  restart: 'Restarting',
  rollback: 'Rolling back',
  update: 'Updating',
};

function PluginRow({ plugin, admin, changing, failure, fresh, onAction, onUpdate, removing, onRemove }: PluginRowProps) {
  // Turned on but not running: it failed to start or keeps crashing.
  const state = changing ? CHANGING_TEXT[changing] : plugin.running ? 'Running' : plugin.enabled ? 'Not running' : 'Stopped';
  const tone = changing ? 'neutral' : plugin.running ? 'ok' : plugin.enabled ? 'danger' : 'neutral';
  const [confirming, setConfirming] = useState(false);
  const [keepData, setKeepData] = useState(false);
  const busy = changing !== null || removing;
  return (
    <li className={styles.plugin} data-running={plugin.running} data-fresh={fresh}>
      {plugin.hasIcon ? (
        <img className={styles.icon} src={`/api/v1/plugins/${encodeURIComponent(plugin.id)}/icon`} alt="" width={40} height={40} />
      ) : (
        <PluginGlyph id={plugin.id} lit={plugin.running} />
      )}

      <div className={styles.text}>
        <h2 className={styles.name}>
          {plugin.name}
          {plugin.official ? <Badge tone="accent">Official</Badge> : <Badge tone="warn">Unsigned</Badge>}
          {plugin.channel && plugin.channel !== 'stable' ? <Badge>{plugin.channel}</Badge> : null}
        </h2>
        <p className={styles.byline}>
          By {plugin.developer}, version <span className="num">{plugin.version}</span>
          {plugin.url ? (
            <>
              {' · '}
              <a className={styles.link} href={plugin.url} target="_blank" rel="noopener noreferrer">
                Developer page
                <ExternalLink aria-hidden className={styles.external} />
              </a>
            </>
          ) : null}
        </p>
        <p className={styles.description}>{plugin.description}</p>
        {plugin.permissions.length > 0 ? (
          <ul className={styles.permissions} aria-label="What it may use">
            {plugin.permissions.map((permission) => (
              <li key={permission} data-permission={permission}>
                <strong>{PERMISSIONS[permission].label}</strong> {PERMISSIONS[permission].explain}
              </li>
            ))}
          </ul>
        ) : null}
        {plugin.previousVersion ? (
          <p className={styles.kept}>
            Version <span className="num">{plugin.previousVersion}</span> is kept for a rollback.
          </p>
        ) : null}
        {failure ? (
          <p className={styles.failure} role="alert">
            {failure}
          </p>
        ) : null}
      </div>

      <div className={styles.controls}>
        <div className={styles.run}>
          <Status tone={tone}>{state}</Status>
          {admin ? <Switch label={`Run ${plugin.name}`} checked={plugin.enabled} disabled={busy} onChange={(on) => onAction(on ? 'start' : 'stop')} /> : null}
        </div>
        {plugin.appUrl ? (
          plugin.running ? (
            <Link className={styles.open} to={pluginPagePath(plugin.id)}>
              Open {plugin.name}
            </Link>
          ) : (
            <p className={styles.hint}>Start it to open its page</p>
          )
        ) : null}
        {admin ? (
          confirming ? (
            <div className={styles.removeConfirm}>
              <span className={styles.hint}>Remove {plugin.name}?</span>
              <div className={styles.keep}>
                <Switch label="Keep its data" checked={keepData} disabled={removing} onChange={setKeepData} />
                <span>Keep its data</span>
              </div>
              <div className={styles.manage}>
                <Button size="small" variant="danger" busy={removing} onClick={() => onRemove(keepData)}>
                  Remove
                </Button>
                <Button size="small" disabled={removing} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.manage}>
              {plugin.running ? (
                <Button size="small" disabled={busy} onClick={() => onAction('restart')}>
                  Restart
                </Button>
              ) : null}
              <Button size="small" disabled={busy} onClick={onUpdate}>
                Update…
              </Button>
              {plugin.previousVersion ? (
                <Button size="small" disabled={busy} onClick={() => onAction('rollback')}>
                  Roll back to {plugin.previousVersion}
                </Button>
              ) : null}
              {plugin.removable ? (
                <Button size="small" disabled={busy} onClick={() => setConfirming(true)}>
                  Remove
                </Button>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </li>
  );
}

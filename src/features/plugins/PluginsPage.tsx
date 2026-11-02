import { useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Plus } from 'lucide-react';
import { errorMessage, type Plugin, type PluginInstallResult } from '@/api';
import { pluginPagePath } from '@/app/pages';
import { usePlugins, usePluginsChanging, useRemovePlugin, useRestartPlugin, useSetPluginRunning } from '@/data/queries';
import { Page } from '@/shell/Page';
import { Badge, Button, EmptyState, LoadError, Notice, Panel, Skeleton, Status, Switch } from '@/ui';
import { InstallPluginDialog } from './InstallPluginDialog';
import { PluginGlyph } from './PluginGlyph';
import styles from './PluginsPage.module.css';

export default function PluginsPage() {
  const plugins = usePlugins();
  const setRunning = useSetPluginRunning();
  const restart = useRestartPlugin();
  const remove = useRemovePlugin();
  const changing = usePluginsChanging();
  /** The last failure per plugin, shown on its own row until the next try. */
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  /** What the last install did, said once at the top and marked on the plugin's row. */
  const [installed, setInstalled] = useState<PluginInstallResult | null>(null);

  const installButton = (
    <Button variant="primary" onClick={() => setInstalling(true)}>
      <Plus aria-hidden />
      Install plugin
    </Button>
  );

  function clearFailure(id: string) {
    setFailures((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  const failed = (id: string) => (error: unknown) => setFailures((current) => ({ ...current, [id]: errorMessage(error) }));

  function toggle(plugin: Plugin, running: boolean) {
    clearFailure(plugin.id);
    setRunning.mutate({ id: plugin.id, running }, { onError: failed(plugin.id) });
  }

  return (
    <Page title="Plugins" description="Extra functions installed on this device. A running plugin with its own page also appears in the menu." actions={installButton}>
      {installed ? (
        <Notice>
          {installed.action === 'installed'
            ? `${installed.plugin.name} is installed. Turn it on when you are ready.`
            : `${installed.plugin.name} is updated to version ${installed.plugin.version}.`}
        </Notice>
      ) : null}
      {plugins.isPending ? (
        <Panel>
          <Skeleton lines={4} />
        </Panel>
      ) : plugins.isError ? (
        <Panel>
          <LoadError error={plugins.error} onRetry={() => void plugins.refetch()} />
        </Panel>
      ) : plugins.data.length === 0 ? (
        <Panel>
          <EmptyState title="No plugins are installed on this device.">Install one from its package file, then turn it on here.</EmptyState>
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
                  changing={changing.includes(plugin.id)}
                  failure={failures[plugin.id]}
                  fresh={installed?.plugin.id === plugin.id}
                  onToggle={(running) => toggle(plugin, running)}
                  onRestart={() => {
                    clearFailure(plugin.id);
                    restart.mutate({ id: plugin.id }, { onError: failed(plugin.id) });
                  }}
                  removing={remove.isPending && remove.variables === plugin.id}
                  onRemove={() => {
                    clearFailure(plugin.id);
                    remove.mutate(plugin.id, {
                      onSuccess: () => setInstalled((current) => (current?.plugin.id === plugin.id ? null : current)),
                      onError: failed(plugin.id),
                    });
                  }}
                />
              ))}
            </ul>
          </Panel>
        </>
      )}
      {installing ? (
        <InstallPluginDialog
          onClose={() => setInstalling(false)}
          onInstalled={(result) => {
            setInstalling(false);
            setInstalled(result);
          }}
        />
      ) : null}
    </Page>
  );
}

interface PluginRowProps {
  plugin: Plugin;
  changing: boolean;
  failure: string | undefined;
  /** Just installed or updated: the row is marked so it is easy to find. */
  fresh: boolean;
  onToggle: (running: boolean) => void;
  onRestart: () => void;
  removing: boolean;
  onRemove: () => void;
}

/** A gateway-era plugin's own page, on its own port of this device. */
function webviewUrl(webview: NonNullable<Plugin['webview']>): string {
  return `${webview.tls ? 'https' : 'http'}://${window.location.hostname}:${webview.port}/`;
}

function PluginRow({ plugin, changing, failure, fresh, onToggle, onRestart, removing, onRemove }: PluginRowProps) {
  const state = changing ? (plugin.running ? 'Stopping' : 'Starting') : plugin.running ? 'Running' : 'Stopped';
  const [confirming, setConfirming] = useState(false);
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
          {plugin.official ? <Badge tone="accent">Official</Badge> : <Badge tone="warn">Unsigned plugin</Badge>}
          {plugin.channel && plugin.channel !== 'stable' ? <Badge>{plugin.channel}</Badge> : null}
        </h2>
        <p className={styles.byline}>
          By {plugin.developer}, version <span className="num">{plugin.version}</span>
        </p>
        <p className={styles.description}>{plugin.description}</p>
        {plugin.adopted ? <p className={styles.hint}>Moved over from the old gateway installer.</p> : null}
        {failure ? (
          <p className={styles.failure} role="alert">
            {failure}
          </p>
        ) : null}
      </div>

      <div className={styles.controls}>
        <div className={styles.run}>
          <Status tone={changing ? 'neutral' : plugin.running ? 'ok' : 'neutral'}>{state}</Status>
          <Switch label={`Run ${plugin.name}`} checked={plugin.running} disabled={changing} onChange={onToggle} />
        </div>
        {plugin.appUrl || plugin.webview ? (
          !plugin.running ? (
            <p className={styles.hint}>Start it to open its page</p>
          ) : plugin.appUrl ? (
            <Link className={styles.open} to={pluginPagePath(plugin.id)}>
              Open {plugin.name}
            </Link>
          ) : plugin.webview ? (
            <a className={styles.open} href={webviewUrl(plugin.webview)} target="_blank" rel="noopener noreferrer">
              Open {plugin.name}
              <ExternalLink aria-hidden className={styles.external} />
            </a>
          ) : null
        ) : null}
        <div className={styles.manage}>
          {confirming ? (
            <>
              <span className={styles.hint}>Remove it and its settings?</span>
              <Button size="small" variant="danger" busy={removing} onClick={onRemove}>
                Remove
              </Button>
              <Button size="small" disabled={removing} onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <>
              {plugin.running ? (
                <Button size="small" disabled={changing} onClick={onRestart}>
                  Restart
                </Button>
              ) : null}
              <Button size="small" disabled={changing} onClick={() => setConfirming(true)}>
                Remove
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

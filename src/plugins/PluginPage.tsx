import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { usePlugins } from '@/data/queries';
import { EmptyState, LoadError, Skeleton } from '@/ui';
import { isGuestMessage, PLUGIN_SANDBOX, readThemeTokens, type HostMessage } from './bridge';
import styles from './PluginPage.module.css';

/** Shows a plugin's own web UI inside the middle column. */
export default function PluginPage() {
  const { pluginId } = useParams();
  const plugins = usePlugins();
  const plugin = plugins.data?.find((candidate) => candidate.id === pluginId);

  useEffect(() => {
    if (plugin) document.title = `${plugin.name} · Kaonic`;
  }, [plugin]);

  if (plugins.isPending) return <div className={styles.message}><Skeleton /></div>;
  if (plugins.isError) return <div className={styles.message}><LoadError error={plugins.error} onRetry={() => void plugins.refetch()} /></div>;

  if (!plugin || !plugin.running || !plugin.appUrl) {
    return (
      <div className={styles.message}>
        <EmptyState title={plugin ? `${plugin.name} has no page to show` : 'This plugin is not installed'}>
          {plugin && !plugin.running ? <p>Start the plugin to use its page.</p> : null}
          <Link to="/plugins" style={{ color: 'var(--accent)' }}>Go to Plugins</Link>
        </EmptyState>
      </div>
    );
  }

  return <PluginFrame key={plugin.id} name={plugin.name} url={plugin.appUrl} />;
}

function PluginFrame({ name, url }: { name: string; url: string }) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only this plugin's frame may talk to us.
      if (event.source !== frame.current?.contentWindow || !isGuestMessage(event.data)) return;
      const message: HostMessage = { type: 'kaonic:theme', tokens: readThemeTokens() };
      // The frame is sandboxed into an opaque origin, so no narrower target exists. The message holds nothing secret.
      frame.current.contentWindow?.postMessage(message, '*');
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return <iframe ref={frame} className={styles.frame} title={name} src={url} sandbox={PLUGIN_SANDBOX} referrerPolicy="no-referrer" />;
}

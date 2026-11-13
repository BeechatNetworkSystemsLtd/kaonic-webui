import { useState } from 'react';
import { Link } from 'react-router';
import { useSoftware } from '@/data/queries';
import { Panel, Status } from '@/ui';
import { PluginGlyph } from './PluginGlyph';
import styles from './PluginsPage.module.css';

/** The icon the hub serves for the hub or the installer; the id's pattern if it can't. */
export function CoreIcon({ id, lit, size = 40 }: { id: 'kaonic-hub' | 'kaonic-hub-installer'; lit: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PluginGlyph id={id} lit={lit} />;
  return (
    <img
      className={styles.icon}
      src={`/api/v1/software/${id}/icon`}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, verticalAlign: 'middle' }}
      onError={() => setFailed(true)}
    />
  );
}

/** The hub and the installer, above the plugins: they run every plugin and update each other. */
export function CoreSoftware({ admin }: { admin: boolean }) {
  const software = useSoftware();
  if (!software.data) return null;
  const { hub, installer } = software.data;
  return (
    <Panel flush>
      <ul className={styles.list} aria-label="System software">
        <li className={styles.plugin} data-running>
          <CoreIcon id="kaonic-hub" lit />
          <div className={styles.text}>
            <h2 className={styles.name}>Kaonic Hub</h2>
            <p className={styles.byline}>
              Version <span className="num">{hub.version}</span>
              {hub.fromUpdate ? ', updated copy' : ', from the system image'}
            </p>
          </div>
          <Status tone="ok">Running</Status>
        </li>
        <li className={styles.plugin} data-running={installer.reachable}>
          <CoreIcon id="kaonic-hub-installer" lit={installer.reachable} />
          <div className={styles.text}>
            <h2 className={styles.name}>Plugin installer</h2>
            <p className={styles.byline}>
              {installer.reachable && installer.version ? (
                <>
                  Version <span className="num">{installer.version}</span>
                </>
              ) : (
                'Installs, runs and updates plugins'
              )}
              {admin ? (
                <>
                  {' · '}
                  <Link className={styles.link} to="/system">
                    Update on the System page
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          {installer.reachable ? <Status tone="ok">Running</Status> : <Status tone="danger">Not running</Status>}
        </li>
      </ul>
    </Panel>
  );
}

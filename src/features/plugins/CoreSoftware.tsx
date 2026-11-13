import { useState } from 'react';
import { Link } from 'react-router';
import type { CoreProgram } from '@/api';
import { useSoftware } from '@/data/queries';
import { Panel, Status } from '@/ui';
import { PluginGlyph } from './PluginGlyph';
import styles from './PluginsPage.module.css';

/** The icon the hub serves for a core program; the id's pattern if it can't. */
export function CoreIcon({ id, lit, size = 40 }: { id: string; lit: boolean; size?: number }) {
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

/** A core program the hub updates (commd, the factory server), as its own manifest names it. */
function ProgramRow({ program, admin }: { program: CoreProgram; admin: boolean }) {
  return (
    <li className={styles.plugin} data-running={program.running}>
      <CoreIcon id={program.id} lit={program.running} />
      <div className={styles.text}>
        <h2 className={styles.name}>{program.name}</h2>
        <p className={styles.byline}>
          {program.version ? (
            <>
              Version <span className="num">{program.version}</span>
              {program.fromUpdate ? ', updated copy' : ', from the system image'}
            </>
          ) : (
            program.description
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
      {program.running ? <Status tone="ok">Running</Status> : <Status tone="danger">Not running</Status>}
    </li>
  );
}

/** The core programs, above the plugins: the hub and the installer run every plugin and update each other; the hub also updates commd and the factory server. */
export function CoreSoftware({ admin }: { admin: boolean }) {
  const software = useSoftware();
  if (!software.data) return null;
  const { hub, installer, programs } = software.data;
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
        {programs.map((program) => (
          <ProgramRow key={program.id} program={program} admin={admin} />
        ))}
      </ul>
    </Panel>
  );
}

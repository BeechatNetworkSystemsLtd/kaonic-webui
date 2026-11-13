import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/api';
import { useAuthState, useDevice, useFactoryReset, useMetrics, useReboot, useRestartService, useServices, useSystemReport } from '@/data/queries';
import { formatDuration, formatMegabytes } from '@/lib/format';
import { Page, PanelGrid } from '@/shell/Page';
import { Button, Field, Input, KeyValues, LoadError, Meter, Notice, Panel, Skeleton, Status } from '@/ui';
import { BootPanel } from './BootPanel';
import { SoftwarePanel } from './SoftwarePanel';
import styles from './SystemPage.module.css';

export default function SystemPage() {
  const admin = useAuthState().data?.role === 'admin';
  return (
    <Page title="System" description="Device details, services and maintenance.">
      <PanelGrid min={340}>
        <DevicePanel />
        <HealthPanel />
        <ServicesPanel />
      </PanelGrid>
      {admin ? <SoftwarePanel /> : null}
      <MaintenancePanel admin={admin} />
      <BootPanel />
    </Page>
  );
}

function DevicePanel() {
  const device = useDevice();
  return (
    <Panel title="This device">
      {device.isPending ? <Skeleton lines={5} /> : device.isError ? <LoadError error={device.error} onRetry={() => void device.refetch()} /> : (
        <KeyValues
          rows={[
            ['Codename', <span className="mono">{device.data.codename}</span>],
            ['Model', device.data.model],
            ['Serial', <span className="mono">{device.data.serial}</span>],
            ['Hostname', <span className="mono">{device.data.hostname}.local</span>],
            ['Identity', <span className="mono">{device.data.identityHash}</span>],
            ['Radio modules', device.data.radioModules],
            ['Uptime', formatDuration(device.data.uptimeSecs)],
            ['Hub', device.data.versions.hub],
            ['System', device.data.versions.os],
            ['Web UI', device.data.versions.webui ?? '–'],
          ]}
        />
      )}
    </Panel>
  );
}

function HealthPanel() {
  const metrics = useMetrics();
  return (
    <Panel title="Device health">
      {metrics.isPending ? <Skeleton /> : metrics.isError ? <LoadError error={metrics.error} onRetry={() => void metrics.refetch()} /> : (
        <div className={styles.maintenance}>
          <Meter label="Processor" value={metrics.data.cpuPercent / 100} text={`${metrics.data.cpuPercent}%`} />
          <Meter
            label="Memory"
            value={metrics.data.ramUsedMb / metrics.data.ramTotalMb}
            text={`${formatMegabytes(metrics.data.ramUsedMb)} of ${formatMegabytes(metrics.data.ramTotalMb)}`}
          />
          <Meter
            label="Storage"
            value={1 - metrics.data.fsFreeMb / metrics.data.fsTotalMb}
            text={`${formatMegabytes(metrics.data.fsFreeMb)} free of ${formatMegabytes(metrics.data.fsTotalMb)}`}
          />
        </div>
      )}
    </Panel>
  );
}

function ServicesPanel() {
  const services = useServices();
  const restart = useRestartService();
  return (
    <Panel title="Services">
      {services.isPending ? <Skeleton /> : services.isError ? <LoadError error={services.error} onRetry={() => void services.refetch()} /> : (
        <ul className={styles.services}>
          {services.data.map((service) => (
            <li key={service.unit} className={styles.service}>
              <div>
                <p className={styles.serviceName}>{service.name}</p>
                <p className={`${styles.unit} mono`}>{service.unit}{service.version ? ` ${service.version}` : ''}</p>
              </div>
              <Status tone={service.state === 'active' ? 'ok' : service.state === 'failed' ? 'danger' : 'neutral'}>
                {service.state === 'active' ? 'Running' : service.state === 'failed' ? 'Failed' : 'Stopped'}
              </Status>
              <Button size="small" busy={restart.isPending && restart.variables === service.unit} onClick={() => restart.mutate(service.unit)}>
                Restart
              </Button>
            </li>
          ))}
        </ul>
      )}
      {restart.isError ? <Notice tone="danger">{errorMessage(restart.error)}</Notice> : null}
    </Panel>
  );
}

/** Copies text, with a fallback for browsers that refuse the clipboard API (plain HTTP). */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('The browser did not allow copying.');
}

function SystemData() {
  const report = useSystemReport();
  const [copied, setCopied] = useState<'copied' | string | null>(null);
  async function onCopy() {
    setCopied(null);
    try {
      const text = await report.mutateAsync();
      await copyText(text);
      setCopied('copied');
    } catch (error) {
      setCopied(errorMessage(error));
    }
  }
  return (
    <>
      <div className={styles.action}>
        <div>
          <p className={styles.serviceName}>System data</p>
          <p className={styles.unit}>Versions of the hub, web UI, installer, plugins and OS, for a support request. No passwords or keys.</p>
        </div>
        <Button busy={report.isPending} onClick={() => void onCopy()}>
          Copy system data
        </Button>
      </div>
      {copied === 'copied' ? <Notice>Copied. Paste it into your message.</Notice> : null}
      {copied && copied !== 'copied' ? <Notice tone="danger">{copied}</Notice> : null}
    </>
  );
}

function MaintenancePanel({ admin }: { admin: boolean }) {
  const reboot = useReboot();
  const reset = useFactoryReset();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');

  function onReset(event: FormEvent) {
    event.preventDefault();
    reset.mutate(password);
  }

  return (
    <Panel title="Maintenance">
      <div className={styles.maintenance}>
        {admin ? <SystemData /> : null}
        <div className={styles.action}>
          <div>
            <p className={styles.serviceName}>Restart the device</p>
            <p className={styles.unit}>Connections drop for about a minute.</p>
          </div>
          <Button busy={reboot.isPending} onClick={() => reboot.mutate()}>Restart device</Button>
        </div>
        {reboot.isSuccess ? <Notice>The device is restarting. This page reconnects when it is back.</Notice> : null}
        {reboot.isError ? <Notice tone="danger">{errorMessage(reboot.error)}</Notice> : null}

        <div className={styles.action}>
          <div>
            <p className={styles.serviceName}>Factory reset</p>
            <p className={styles.unit}>Erases the password, keys, certificates and all settings. The device gets a new identity and starts from setup again.</p>
          </div>
          {!confirming ? <Button variant="danger" onClick={() => setConfirming(true)}>Factory reset</Button> : null}
        </div>
        {confirming ? (
          <form className={styles.confirm} onSubmit={onReset}>
            <Field label="Enter the password to confirm" error={reset.isError ? errorMessage(reset.error) : undefined}>
              {(control) => (
                <Input {...control} type="password" autoComplete="current-password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} />
              )}
            </Field>
            <div className={styles.confirmActions}>
              <Button type="submit" variant="danger" busy={reset.isPending}>Erase everything</Button>
              <Button onClick={() => { setConfirming(false); setPassword(''); reset.reset(); }}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </div>
    </Panel>
  );
}

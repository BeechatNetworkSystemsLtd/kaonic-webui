import { useEffect, useState, type FormEvent } from 'react';
import { validationFields, type RadioBand } from '@/api';
import { useAuthState, useRadioBands, useSetRadioBandFilter, useUpdateRadioBand, useUpdateRadioBandEverywhere } from '@/data/queries';
import { formatFrequency } from '@/lib/format';
import { DEFAULT_TRAFFIC_RANGE, TRAFFIC_RANGES, TrafficChart } from '@/features/traffic/TrafficChart';
import { Page } from '@/shell/Page';
import { Badge, Button, Dialog, Field, FormError, LoadError, Notice, Panel, Segmented, Select, Skeleton } from '@/ui';
import { BAND_NAMES } from './bands';
import { boardRangeHint, filterNote, outsideBoardRange } from './filters';
import { useBandFrames } from './frameHistory';
import { centreHz, RadioConfigFields, useRadioDraft } from './RadioConfigFields';
import { MeshRadioPanel, RadioTestDialog, RunningTestNotice } from './RadioTest';
import { Waterfall } from './Waterfall';
import styles from './RadioPage.module.css';

export default function RadioPage() {
  const radio = useRadioBands();
  const auth = useAuthState();
  const [windowMs, setWindowMs] = useState<number>(DEFAULT_TRAFFIC_RANGE);

  return (
    <Page
      title="Radio"
      description="Each of the two radios has a sub-GHz and a 2.4 GHz band. Devices talk to each other only on a band where frequency and modulation match."
      actions={<Segmented label="Traffic time range" options={TRAFFIC_RANGES} value={windowMs} onChange={setWindowMs} />}
    >
      {radio.isPending ? (
        <Skeleton lines={5} />
      ) : radio.isError ? (
        <LoadError error={radio.error} onRetry={() => void radio.refetch()} />
      ) : (
        <>
          <MeshRadioPanel bands={radio.data} isAdmin={auth.data?.role === 'admin'} />
          {radio.data.map((band) => (
            <BandPanel key={band.id} band={band} windowMs={windowMs} isAdmin={auth.data?.role === 'admin'} />
          ))}
        </>
      )}
    </Page>
  );
}

/** One band: its settings on the left, what it is doing on the air on the right. */
function BandPanel({ band, windowMs, isAdmin }: { band: RadioBand; windowMs: number; isAdmin: boolean }) {
  const on = band.config.modulation.kind !== 'off';
  return (
    <Panel
      title={BAND_NAMES[band.id]}
      actions={
        <>
          {band.interface ? <Badge>{band.state === 'emulated' ? `${band.interface}, emulated` : band.interface}</Badge> : null}
          {!on ? <Badge>Off</Badge> : band.usedBy.length ? <Badge tone="accent">Used by {band.usedBy.join(', ')}</Badge> : <Badge>Not in use</Badge>}
        </>
      }
    >
      {band.pendingSwitch ? <PendingSwitchNotice band={band} /> : null}
      {band.test?.running ? <RunningTestNotice band={band} canStop={isAdmin} /> : null}
      <div className={styles.band}>
        {/* The key resets the form to the saved values whenever they change. */}
        <BandForm key={JSON.stringify(band.config)} band={band} />
        {on ? <BandActivity band={band} windowMs={windowMs} /> : <p className={styles.off}>This band is switched off. Choose a modulation to turn it on.</p>}
      </div>
    </Panel>
  );
}

function BandActivity({ band, windowMs }: { band: RadioBand; windowMs: number }) {
  const frames = useBandFrames(band.id);
  return (
    <div className={styles.activity}>
      <TrafficChart channel={band.id} name="Traffic" windowMs={windowMs} height={110} />
      <div className={styles.frames}>
        <h3 className={styles.subtitle}>Frames on the air, last minute</h3>
        <Waterfall label={`${BAND_NAMES[band.id]} frames by frequency and time`} frames={frames} centerHz={band.config.frequencyHz} />
      </div>
    </div>
  );
}

/** A network-wide change of this band: when it happens, and what happens if it fails. */
function PendingSwitchNotice({ band }: { band: RadioBand }) {
  const pending = band.pendingSwitch!;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((pending.at - now) / 1000));
  const target = `${formatFrequency(centreHz(pending.config))}, ${pending.config.modulation.kind.toUpperCase()}`;
  return (
    <Notice tone="warn">
      {pending.switched
        ? `Switched to ${target}. Waiting to hear another node; if none is heard within a minute, this node goes back.`
        : `Every node switches to ${target} in ${seconds} s.`}
    </Notice>
  );
}

function BandForm({ band }: { band: RadioBand }) {
  const draft = useRadioDraft(band.config, band);
  const update = useUpdateRadioBand();
  const everywhere = useUpdateRadioBandEverywhere();
  const auth = useAuthState();
  const [confirming, setConfirming] = useState(false);
  const [testing, setTesting] = useState(false);
  const fieldErrors = { ...validationFields(update.error), ...validationFields(everywhere.error) };
  const off = draft.config.modulation.kind === 'off';
  const mesh = band.usedBy.includes('mesh');
  const isAdmin = auth.data?.role === 'admin';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.valid) update.mutate({ id: band.id, config: draft.config });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <RadioConfigFields draft={draft} errors={fieldErrors} capabilities={band.capabilities ?? []} />
      <BandFrontEnd band={band} centre={centreHz(draft.config)} canChange={isAdmin} />

      {mesh && draft.dirty ? (
        <Notice tone="warn">
          The mesh runs on this band. Changing it on this node only cuts it off from nodes that keep the old setting; use "Apply to all nodes" from the
          Kaonic Admin device.
        </Notice>
      ) : null}

      <FormError error={update.error ?? everywhere.error} />
      {everywhere.isSuccess ? (
        <Notice>
          Sent to {everywhere.data.nodes} node{everywhere.data.nodes === 1 ? '' : 's'}. Every node switches at {new Date(everywhere.data.switchAt).toLocaleTimeString()}.
        </Notice>
      ) : null}

      <div className={styles.actions}>
        <span className={styles.rssi}>{off ? '' : band.lastRssi !== null ? `Last signal ${band.lastRssi} dBm` : 'No signal received yet'}</span>
        {isAdmin && band.config.modulation.kind !== 'off' && band.state !== 'emulated' ? (
          <Button type="button" onClick={() => setTesting(true)} title="Send a raw test frame with this band's saved settings">
            Test message
          </Button>
        ) : null}
        {mesh ? (
          <Button type="button" busy={everywhere.isPending} disabled={!isAdmin || !draft.dirty || !draft.valid || off || Boolean(band.pendingSwitch)} onClick={() => setConfirming(true)}>
            Apply to all nodes
          </Button>
        ) : null}
        <Button type="submit" variant="primary" busy={update.isPending} disabled={!draft.dirty || !draft.valid}>
          {mesh ? 'Apply to this node' : 'Apply'}
        </Button>
      </div>

      {testing ? <RadioTestDialog band={band} onClose={() => setTesting(false)} /> : null}

      {confirming ? (
        <Dialog title="Change the mesh band on every node?" onClose={() => setConfirming(false)}>
          <p>
            The new setting ({formatFrequency(centreHz(draft.config))}, {draft.config.modulation.kind.toUpperCase()}) goes to every node this device has a link
            to. All of them, this one included, switch in 10 seconds.
          </p>
          <p>
            Nodes that are out of reach now do not get it and stay on the old setting. A node that hears no other node within a minute of switching goes back
            to the old setting by itself.
          </p>
          <div className={styles.actions}>
            <Button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setConfirming(false);
                everywhere.mutate({ id: band.id, config: draft.config });
              }}
            >
              Switch every node
            </Button>
          </div>
        </Dialog>
      ) : null}
    </form>
  );
}

/** The board's range for the band and its sub-GHz filter. Informative: nothing here limits the settings. */
function BandFrontEnd({ band, centre, canChange }: { band: RadioBand; centre: number; canChange: boolean }) {
  const setFilter = useSetRadioBandFilter();
  const range = boardRangeHint(band);
  const outside = outsideBoardRange(band, centre);
  const filters = band.filters ?? [];
  const active = filters.find((filter) => filter.index === band.activeFilter);
  return (
    <>
      {range ? <p className={styles.hint}>{outside ? `${range}. Outside this board's range.` : range}</p> : null}
      {band.filterState === 'unavailable' ? (
        <p className={styles.hint}>Filter control unavailable</p>
      ) : band.filterState === 'ok' && filters.length > 0 ? (
        <Field label="Filter" hint={filterNote(band, centre) ?? undefined} error={setFilter.error?.message}>
          {(field) => (
            <Select
              {...field}
              value={String(band.filter ?? 'auto')}
              disabled={!canChange || setFilter.isPending}
              onChange={(event) => setFilter.mutate({ id: band.id, filter: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })}
            >
              <option value="auto">{active ? `Auto (${active.label})` : 'Auto'}</option>
              {filters.map((filter) => (
                <option key={filter.index} value={String(filter.index)}>
                  {filter.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
    </>
  );
}

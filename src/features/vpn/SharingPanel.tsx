import { useState, type FormEvent, type ReactNode } from 'react';
import { validationFields, type VpnLanRouter, type VpnShareSettings, type VpnState } from '@/api';
import { checkAdvertised, checkGateway, checkSharePatch, checkUplink, parseList, type FieldErrors } from '@/api/vpnShare';
import { useSetVpnGateway, useSetVpnRoutes, useSetVpnUplink, useUpdateVpnSettings } from '@/data/queries';
import { Badge, Button, Field, FormError, Input, Notice, Panel, Segmented, Select, Status, Switch } from '@/ui';
import styles from './VpnPage.module.css';

const ROUTER_OPTIONS: ReadonlyArray<{ value: VpnLanRouter; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' },
];

const ROUTER_TEXT: Record<VpnLanRouter, string> = {
  auto: 'Clients get this node as their router and DNS only while it shares an internet route (gateway or uplink).',
  always: 'Clients always get this node as their router and DNS, so everything they send goes through it.',
  never: 'Clients keep their own router: they reach the mesh only with a route of their own.',
};

/** Errors to show: the page's own checks first, then what the hub said. */
const merge = (local: FieldErrors, error: unknown): FieldErrors => ({ ...validationFields(error), ...local });

/** How the VPN reaches this device's clients (hotspot, LAN, USB) and the internet. */
export function SharingPanel({ state, admin }: { state: VpnState; admin: boolean }) {
  const settings = state.settings;
  return (
    <Panel title="Sharing">
      <div className={styles.sharing}>
        {!admin ? <Notice>Only an admin session can change sharing.</Notice> : null}
        {settings ? <Clients key={JSON.stringify(settings)} settings={settings} state={state} admin={admin} /> : <p className={styles.muted}>This hub does not report its sharing settings.</p>}
        <Mappings state={state} />
        <Gateway key={JSON.stringify([state.gateway.enabled, state.gateway.egressInterface, state.gateway.routes])} state={state} admin={admin} />
        <Uplink key={JSON.stringify([state.uplink.enabled, state.uplink.peerId, state.uplink.defaultRoute, state.uplink.routes])} state={state} admin={admin} />
        {settings ? <Extra key={settings.advertise.join(',')} advertise={settings.advertise} admin={admin} /> : null}
      </div>
    </Panel>
  );
}

function Block({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.block}>
      <h3 className={styles.blockTitle}>
        {title} {status}
      </h3>
      {children}
    </section>
  );
}

function Clients({ settings, state, admin }: { settings: VpnShareSettings; state: VpnState; admin: boolean }) {
  const update = useUpdateVpnSettings();
  const [share, setShare] = useState(settings.shareLans);
  const [interfaces, setInterfaces] = useState<string[]>(settings.lanInterfaces);
  const [map, setMap] = useState(settings.mapLans);
  const [pool, setPool] = useState(settings.mappingPool);
  const [router, setRouter] = useState<VpnLanRouter>(settings.lanRouter);
  const [dns, setDns] = useState(settings.dnsServers.join(', '));
  const [local, setLocal] = useState<FieldErrors>({});
  const known = [...new Set([...settings.lanInterfaces, ...state.routes.localMappings.flatMap((lan) => (lan.interface ? [lan.interface] : [])), 'br0', 'usb0'])];
  const errors = merge(local, update.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const patch = { shareLans: share, lanInterfaces: interfaces, mapLans: map, mappingPool: pool.trim(), lanRouter: router, dnsServers: parseList(dns) };
    const found = checkSharePatch(patch);
    setLocal(found);
    if (Object.keys(found).length === 0) update.mutate(patch);
  }

  return (
    <Block title="This node's clients">
      <form className={styles.shareForm} onSubmit={onSubmit} noValidate>
        <label className={styles.switchRow}>
          <Switch checked={share} onChange={setShare} label="Share this node's clients" disabled={!admin} />
          Share the phones and laptops on this node's networks with the mesh
        </label>
        {share ? (
          <>
            <fieldset className={styles.checks} disabled={!admin}>
              <legend className={styles.muted}>Networks</legend>
              {known.map((name) => (
                <label key={name}>
                  <input type="checkbox" checked={interfaces.includes(name)} onChange={(event) => setInterfaces(event.target.checked ? [...interfaces, name] : interfaces.filter((item) => item !== name))} /> {name}
                </label>
              ))}
              {errors.lanInterfaces ? <span className={styles.error}>{errors.lanInterfaces}</span> : null}
            </fieldset>
            <label className={styles.switchRow}>
              <Switch checked={map} onChange={setMap} label="Map client networks" disabled={!admin} />
              Map client networks to their own range (every Kaonic ships the same LAN)
            </label>
            {map ? (
              <Field label="Mapping range" hint="Each client network gets its own /24 from here." error={errors.mappingPool}>
                {(control) => <Input {...control} className="mono" value={pool} disabled={!admin} onChange={(event) => setPool(event.target.value)} />}
              </Field>
            ) : null}
            <div>
              <Segmented label="Router for clients" options={ROUTER_OPTIONS} value={router} onChange={(value) => admin && setRouter(value)} />
              <p className={styles.muted}>{ROUTER_TEXT[router]}</p>
            </div>
            <Field label="DNS servers for clients" hint="Separated by commas, at most 4." error={errors.dnsServers}>
              {(control) => <Input {...control} className="mono" value={dns} disabled={!admin} onChange={(event) => setDns(event.target.value)} />}
            </Field>
          </>
        ) : null}
        <FormError error={update.error} />
        {admin ? (
          <Button type="submit" variant="primary" size="small" busy={update.isPending}>
            Save
          </Button>
        ) : null}
      </form>
    </Block>
  );
}

function Mappings({ state }: { state: VpnState }) {
  const lans = state.routes.localMappings;
  return (
    <Block title="How clients appear on the mesh">
      {lans.length === 0 ? (
        <p className={styles.muted}>No client network is shared.</p>
      ) : (
        <table className={styles.table}>
          <caption className="visually-hidden">This node's client networks and what other nodes see</caption>
          <thead>
            <tr>
              <th scope="col">Client network</th>
              <th scope="col">Seen on the mesh as</th>
              <th scope="col">Interface</th>
            </tr>
          </thead>
          <tbody>
            {lans.map((lan) => (
              <tr key={lan.subnet}>
                <th scope="row" className="num">
                  {lan.subnet}
                </th>
                <td className="num">{lan.mappedSubnet === lan.subnet ? <span className={styles.muted}>as it is</span> : lan.mappedSubnet}</td>
                <td>{lan.interface ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Block>
  );
}

const onOff = (enabled: boolean, active: boolean) =>
  !enabled ? <Status tone="neutral">Off</Status> : active ? <Status tone="ok">Active</Status> : <Status tone="warn">Waiting</Status>;

function Gateway({ state, admin }: { state: VpnState; admin: boolean }) {
  const set = useSetVpnGateway();
  const gateway = state.gateway;
  const [enabled, setEnabled] = useState(gateway.enabled);
  const [egress, setEgress] = useState(gateway.egressInterface ?? '');
  const [routes, setRoutes] = useState((gateway.routes.length ? gateway.routes : ['0.0.0.0/0']).join(', '));
  const [local, setLocal] = useState<FieldErrors>({});
  const errors = merge(local, set.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input = { enabled, egressInterface: egress || null, routes: parseList(routes) };
    const found = checkGateway(input);
    setLocal(found);
    if (Object.keys(found).length === 0) set.mutate(input);
  }

  return (
    <Block title="Internet gateway (this node)" status={onOff(gateway.enabled, gateway.active)}>
      <form className={styles.shareForm} onSubmit={onSubmit} noValidate>
        <label className={styles.switchRow}>
          <Switch checked={enabled} onChange={setEnabled} label="Be a gateway" disabled={!admin} />
          Share this node's internet with the mesh
        </label>
        {enabled ? (
          <>
            <Field label="Internet through" error={errors.egressInterface}>
              {(control) => (
                <Select {...control} value={egress} disabled={!admin} onChange={(event) => setEgress(event.target.value)}>
                  <option value="">Automatic (the default route)</option>
                  {gateway.availableInterfaces.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Destinations offered" hint="0.0.0.0/0 shares the whole internet." error={errors.routes}>
              {(control) => <Input {...control} className="mono" value={routes} disabled={!admin} onChange={(event) => setRoutes(event.target.value)} />}
            </Field>
          </>
        ) : null}
        {gateway.detail ? <p className={styles.muted}>{gateway.detail}</p> : null}
        {errors.enabled ? <span className={styles.error}>{errors.enabled}</span> : null}
        <FormError error={set.error} />
        {admin ? (
          <Button type="submit" variant="primary" size="small" busy={set.isPending}>
            Save
          </Button>
        ) : null}
      </form>
    </Block>
  );
}

function Uplink({ state, admin }: { state: VpnState; admin: boolean }) {
  const set = useSetVpnUplink();
  const uplink = state.uplink;
  const [enabled, setEnabled] = useState(uplink.enabled);
  const [peer, setPeer] = useState(uplink.peerId ?? '');
  const [everything, setEverything] = useState(uplink.defaultRoute);
  const [routes, setRoutes] = useState(uplink.routes.join(', '));
  const [local, setLocal] = useState<FieldErrors>({});
  const errors = merge(local, set.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input = { enabled, peerId: peer || null, defaultRoute: everything, routes: everything ? [] : parseList(routes) };
    const found = checkUplink(input);
    setLocal(found);
    if (Object.keys(found).length === 0) set.mutate(input);
  }

  return (
    <Block title="Use a gateway" status={onOff(uplink.enabled, uplink.active)}>
      <form className={styles.shareForm} onSubmit={onSubmit} noValidate>
        <label className={styles.switchRow}>
          <Switch checked={enabled} onChange={setEnabled} label="Use a gateway" disabled={!admin} />
          Reach the internet through another node
        </label>
        {enabled ? (
          <>
            <Field label="Gateway" error={errors.peerId}>
              {(control) => (
                <Select {...control} value={peer} disabled={!admin} onChange={(event) => setPeer(event.target.value)}>
                  <option value="">Automatic (the first node offering)</option>
                  {uplink.gateways.map((gateway) => (
                    <option key={gateway.peerId} value={gateway.peerId}>
                      {gateway.codename || gateway.peerId.slice(0, 8)} ({gateway.routes.join(', ')})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Segmented
              label="What goes through the gateway"
              options={[
                { value: 'all', label: 'Everything' },
                { value: 'some', label: 'Chosen destinations' },
              ]}
              value={everything ? 'all' : 'some'}
              onChange={(value) => admin && setEverything(value === 'all')}
            />
            {everything ? (
              <Notice tone="warn">This node's own traffic also goes through the gateway: the board cannot route only its clients' traffic.</Notice>
            ) : (
              <Field label="Destinations" hint="Prefixes separated by commas." error={errors.routes}>
                {(control) => <Input {...control} className="mono" value={routes} disabled={!admin} onChange={(event) => setRoutes(event.target.value)} />}
              </Field>
            )}
            {uplink.gateways.length === 0 ? <p className={styles.muted}>No node offers to be a gateway right now.</p> : null}
          </>
        ) : null}
        {uplink.detail ? <p className={styles.muted}>{uplink.detail}</p> : null}
        {errors.enabled ? <span className={styles.error}>{errors.enabled}</span> : null}
        <FormError error={set.error} />
        {admin ? (
          <Button type="submit" variant="primary" size="small" busy={set.isPending}>
            Save
          </Button>
        ) : null}
      </form>
    </Block>
  );
}

function Extra({ advertise, admin }: { advertise: string[]; admin: boolean }) {
  const set = useSetVpnRoutes();
  const [list, setList] = useState<string[]>(advertise);
  const [adding, setAdding] = useState('');
  const [local, setLocal] = useState<FieldErrors>({});
  const errors = merge(local, set.error);

  function add() {
    const next = [...list, ...parseList(adding)];
    const found = checkAdvertised(next);
    setLocal(found);
    if (Object.keys(found).length === 0) {
      setList(next);
      setAdding('');
    }
  }

  return (
    <Block title="Extra networks offered">
      <p className={styles.muted}>Other networks behind this node, offered to the mesh as they are (not mapped).</p>
      <p className={styles.routesLine}>
        {list.length === 0 ? <span className={styles.muted}>None</span> : null}
        {list.map((prefix) => (
          <Badge key={prefix} tone="accent">
            {prefix}
            {admin ? (
              <button type="button" className={styles.remove} aria-label={`Remove ${prefix}`} onClick={() => setList(list.filter((item) => item !== prefix))}>
                ×
              </button>
            ) : null}
          </Badge>
        ))}
      </p>
      {admin ? (
        <div className={styles.shareForm}>
          <Field label="Add a network" error={errors.advertised}>
            {(control) => (
              <Input
                {...control}
                className="mono"
                placeholder="192.168.50.0/24"
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    add();
                  }
                }}
              />
            )}
          </Field>
          <div className={styles.buttonRow}>
            <Button size="small" onClick={add} disabled={!adding.trim()}>
              Add
            </Button>
            <Button size="small" variant="primary" busy={set.isPending} disabled={list.join(',') === advertise.join(',')} onClick={() => set.mutate(list)}>
              Save
            </Button>
          </div>
          <FormError error={set.error} />
        </div>
      ) : null}
    </Block>
  );
}

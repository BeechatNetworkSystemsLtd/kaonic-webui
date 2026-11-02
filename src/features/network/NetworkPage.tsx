import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NetworkConsumer, NetworkSource, NetworkState, PortStatus } from '@/api';
import { errorMessage } from '@/api';
import { useDevice, useNetwork, useNetworkToggle, useWifi, type NetworkToggle } from '@/data/queries';
import { Page } from '@/shell/Page';
import { Badge, Button, LoadError, Notice, Skeleton, Status, Switch, type Tone } from '@/ui';
import { KaonicMark } from '@/ui/KaonicMark';
import { HotspotDialog } from './HotspotDialog';
import { CONSUMER_LABELS, SOURCE_LABELS } from './labels';
import { WifiNetworksDialog } from './WifiNetworksDialog';
import { layoutWires, type Box, type Layout, type Wire } from './wires';
import styles from './NetworkPage.module.css';

const STATUS: Record<PortStatus, { tone: Tone; text: string }> = {
  active: { tone: 'ok', text: 'In use' },
  standby: { tone: 'accent', text: 'Ready' },
  waiting: { tone: 'warn', text: 'Not working' },
  off: { tone: 'neutral', text: 'Off' },
};

/** Narrower than this, the graph is stacked and wired along its left edge. */
const WIDE_FROM = 760;

/**
 * How a wire is drawn.
 * - `flow`: internet is running through it. Yellow, with dots moving the way the traffic goes.
 * - `linked`: connected, nothing running (a standby source, or devices with no internet to use).
 * - `broken`: switched on but not working.
 * - `off`: switched off; only hinted at.
 */
type WireState = 'flow' | 'linked' | 'broken' | 'off';

const sourceWire = (source: NetworkSource): WireState =>
  ({ active: 'flow', standby: 'linked', waiting: 'broken', off: 'off' }) [source.status] as WireState;

/** A consumer is only fed internet if the device has some; otherwise it is just connected. */
const consumerWire = (consumer: NetworkConsumer, online: boolean): WireState =>
  consumer.status === 'active' ? (online ? 'flow' : 'linked') : consumer.status === 'waiting' ? 'broken' : 'off';

export default function NetworkPage() {
  const network = useNetwork();
  const toggle = useNetworkToggle();

  return (
    <Page title="Network" description="Choose where internet comes from and who gets it. The moving dots show where it is flowing right now.">
      {toggle.isError ? <Notice tone="danger">{errorMessage(toggle.error)}</Notice> : null}
      {network.isPending ? (
        <Skeleton lines={5} />
      ) : network.isError ? (
        <LoadError error={network.error} onRetry={() => void network.refetch()} />
      ) : (
        <FlowGraph network={network.data} busy={toggle.isPending} onToggle={(change) => toggle.mutate(change)} />
      )}
    </Page>
  );
}

interface Measured {
  layout: Layout;
  width: number;
  height: number;
  sources: Wire[];
  consumers: Wire[];
}

/**
 * The network as a wiring diagram: sources feed this device, this device feeds
 * the consumers. Cards are ordinary HTML; the wires are an SVG laid over the
 * same box and redrawn whenever a card moves or changes size.
 */
function FlowGraph({ network, busy, onToggle }: { network: NetworkState; busy: boolean; onToggle: (change: NetworkToggle) => void }) {
  const device = useDevice().data;
  const root = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLElement>(null);
  const sourceCards = useRef(new Map<string, HTMLElement>());
  const consumerCards = useRef(new Map<string, HTMLElement>());
  const [measured, setMeasured] = useState<Measured | null>(null);
  const online = network.activeSource !== null;

  // The single Wi-Fi radio is a client (STA), an access point (AP), or both at once.
  const wifi = useWifi().data;
  const [dialog, setDialog] = useState<'networks' | 'hotspot' | null>(null);
  const clientOn = network.sources.some((source) => source.id === 'wifi_client' && source.enabled);
  const hotspotOn = network.consumers.some((consumer) => consumer.id === 'hotspot' && consumer.enabled);
  const repeater = clientOn && hotspotOn;

  function toggleSource(source: NetworkSource, enabled: boolean) {
    onToggle({ kind: 'source', id: source.id, enabled });
    // Client mode is no use without a network to join: go straight to choosing one.
    if (source.id === 'wifi_client' && enabled && wifi?.saved.length === 0) setDialog('networks');
  }

  const sourceIds = network.sources.map((source) => source.id).join();
  const consumerIds = network.consumers.map((consumer) => consumer.id).join();

  useEffect(() => {
    const container = root.current;
    if (!container) return;

    const measure = () => {
      const frame = container.getBoundingClientRect();
      const boxOf = (element: HTMLElement | null | undefined): Box | null => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left - frame.left, top: rect.top - frame.top, width: rect.width, height: rect.height };
      };
      const hubBox = boxOf(hub.current);
      const sources = sourceIds.split(',').map((id) => boxOf(sourceCards.current.get(id)));
      const consumers = consumerIds.split(',').map((id) => boxOf(consumerCards.current.get(id)));
      if (!hubBox || sources.includes(null) || consumers.includes(null)) return;

      const layout: Layout = frame.width >= WIDE_FROM ? 'wide' : 'tall';
      setMeasured({ layout, width: frame.width, height: frame.height, ...layoutWires(layout, sources as Box[], hubBox, consumers as Box[]) });
    };

    // Any card changing size (a longer status line, a new layout) can move every wire.
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll('[data-card]').forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [sourceIds, consumerIds]);

  // Until the first measurement, guess from the window so a phone does not flash the wide layout.
  const layout = measured?.layout ?? (window.innerWidth >= WIDE_FROM + 400 ? 'wide' : 'tall');
  const wires = measured
    ? [
        ...network.sources.map((source, index) => ({ id: source.id, wire: measured.sources[index], state: sourceWire(source) })),
        ...network.consumers.map((consumer, index) => ({ id: consumer.id, wire: measured.consumers[index], state: consumerWire(consumer, online) })),
      ]
    : [];

  return (
    <div ref={root} className={styles.graph} data-layout={layout}>
      {measured ? (
        <svg className={styles.wires} width={measured.width} height={measured.height} aria-hidden>
          {wires.map(({ id, wire, state }) =>
            wire ? (
              <g key={id} className={styles.wire} data-state={state}>
                <path className={styles.line} d={wire.path} />
                {state === 'flow' ? <path className={styles.dots} d={wire.path} /> : null}
                <circle className={styles.port} cx={wire.from.x} cy={wire.from.y} r={4} />
                <circle className={styles.port} cx={wire.to.x} cy={wire.to.y} r={4} />
              </g>
            ) : null,
          )}
        </svg>
      ) : null}

      <section className={styles.column} aria-labelledby="sources-title">
        <h2 id="sources-title" className={styles.columnTitle}>Internet comes from</h2>
        {network.sources.map((source) => (
          <PortCard
            key={source.id}
            port={source}
            label={SOURCE_LABELS[source.id]}
            busy={busy}
            badges={source.id === 'wifi_client' ? ['Client (STA)', ...(repeater ? ['Repeater'] : [])] : undefined}
            action={
              source.id === 'wifi_client' && source.enabled ? (
                <Button size="small" onClick={() => setDialog('networks')}>
                  Choose network
                </Button>
              ) : undefined
            }
            register={(element) => (element ? sourceCards.current.set(source.id, element) : sourceCards.current.delete(source.id))}
            onToggle={(enabled) => toggleSource(source, enabled)}
          />
        ))}
      </section>

      <section ref={hub} className={styles.hub} data-card data-online={online || undefined} aria-label="This device">
        <span className={styles.hubMark}>
          <KaonicMark />
        </span>
        <p className={styles.hubTitle}>This Kaonic</p>
        {device ? <p className={`${styles.hubDetail} mono`}>{device.codename}</p> : null}
        <Status tone={online ? 'ok' : 'neutral'}>{network.activeSource ? `Internet from ${SOURCE_LABELS[network.activeSource].short}` : 'No internet'}</Status>
        <p className={`${styles.hubDetail} mono`}>{network.lan.address}</p>
      </section>

      <section className={styles.column} aria-labelledby="consumers-title">
        <h2 id="consumers-title" className={styles.columnTitle}>Who gets connected</h2>
        {network.consumers.map((consumer) => (
          <PortCard
            key={consumer.id}
            port={consumer}
            label={CONSUMER_LABELS[consumer.id]}
            busy={busy}
            note={consumer.status === 'active' && !online ? 'Connected, no internet' : undefined}
            badges={consumer.id === 'hotspot' ? ['Access point (AP)', ...(repeater ? ['Repeater'] : [])] : undefined}
            action={
              consumer.id === 'hotspot' && consumer.enabled ? (
                <Button size="small" onClick={() => setDialog('hotspot')}>
                  Name and password
                </Button>
              ) : undefined
            }
            register={(element) => (element ? consumerCards.current.set(consumer.id, element) : consumerCards.current.delete(consumer.id))}
            onToggle={(enabled) => onToggle({ kind: 'consumer', id: consumer.id, enabled })}
          />
        ))}
      </section>

      <ul className={styles.legend}>
        <li><span className={styles.key} data-state="flow" />Internet flowing</li>
        <li><span className={styles.key} data-state="linked" />Connected, idle</li>
        <li><span className={styles.key} data-state="broken" />Not working</li>
        <li><span className={styles.key} data-state="off" />Off</li>
      </ul>

      {dialog === 'networks' ? <WifiNetworksDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'hotspot' ? <HotspotDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

interface PortCardProps {
  port: NetworkSource | NetworkConsumer;
  label: (typeof SOURCE_LABELS)[keyof typeof SOURCE_LABELS];
  busy: boolean;
  /** Replaces the status text, for a state the port itself does not know about. */
  note?: string;
  /** The mode this block works in, when it has more than one (Wi-Fi: client or access point). */
  badges?: string[];
  /** A button that opens this block's own settings. */
  action?: ReactNode;
  register: (element: HTMLElement | null) => void;
  onToggle: (enabled: boolean) => void;
}

function PortCard({ port, label, busy, note, badges, action, register, onToggle }: PortCardProps) {
  const Icon = label.icon;
  const status = STATUS[port.status];
  const clients = 'clients' in port && port.clients > 0 ? `, ${port.clients} connected` : '';
  return (
    <article ref={register} className={styles.card} data-card data-status={port.status}>
      <Icon className={styles.icon} aria-hidden />
      <div className={styles.cardText}>
        <h3 className={styles.cardTitle}>{label.title}</h3>
        {badges ? (
          <p className={styles.badges}>
            {badges.map((badge) => (
              <Badge key={badge}>{badge}</Badge>
            ))}
          </p>
        ) : null}
        <p className={styles.cardDetail}>{port.enabled ? `${port.detail}${clients}` : label.explain}</p>
        {port.enabled ? <Status tone={note ? 'neutral' : status.tone}>{note ?? status.text}</Status> : null}
        {action ? <div className={styles.cardAction}>{action}</div> : null}
      </div>
      <Switch label={label.title} checked={port.enabled} disabled={busy} onChange={onToggle} />
    </article>
  );
}

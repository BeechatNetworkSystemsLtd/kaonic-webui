import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RadioTower, Settings, Volume2 } from 'lucide-react';
import type { PttState, PttTalker } from '@/api';
import { useAuthState, useHubStream, usePeers, usePtt } from '@/data/queries';
import { formatClock } from '@/lib/format';
import { Page } from '@/shell/Page';
import { Button, Dialog, LoadError, Notice, Skeleton, Switch } from '@/ui';
import { createHold } from './hold';
import { hopsText, lastTalked, packetRates, RATE_WINDOW_MS, signalQuality, talkTiles, type PacketSample, type TalkTile } from './nodeGrid';
import { PttSettingsPanel } from './PttSettingsPanel';
import { LevelArc } from './LevelArc';
import { useTalk, type Talk } from './useTalk';
import styles from './TalkPage.module.css';

/** Push-to-talk to every node of the network at once. */
export default function TalkPage() {
  const ptt = usePtt();
  const auth = useAuthState();
  const canChange = auth.data?.role === 'admin';
  const [settings, setSettings] = useState(false);

  return (
    <Page title="Talk" fill bare>
      {ptt.isPending ? (
        <Skeleton lines={6} />
      ) : ptt.isError ? (
        <LoadError error={ptt.error} onRetry={() => void ptt.refetch()} />
      ) : (
        <TalkContent state={ptt.data} canChange={canChange} settingsOpen={settings} onOpenSettings={() => setSettings(true)} onCloseSettings={() => setSettings(false)} />
      )}
    </Page>
  );
}

/** Why talking from here cannot work right now; null when it can. */
function unavailable(state: PttState, canChange: boolean): string | null {
  if (state.status === 'unprovisioned') {
    return state.detail ?? 'Not provisioned yet: whitelist this device from the Kaonic Admin to talk.';
  }
  if (state.status === 'error') return state.detail ?? 'Push-to-talk is not running on this device.';
  if (state.audio.codec === null) return 'The audio codec (Opus) is missing on this device: no talk or playback.';
  if (!canChange) return 'Only the device’s admin can talk from here. You can still listen.';
  return null;
}

function TalkContent({
  state,
  canChange,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
}: {
  state: PttState;
  canChange: boolean;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}) {
  // Without a microphone on the device, the button can only use the browser's.
  const input = state.audio.device ? state.settings.talkInput : 'browser';
  const talk = useTalk(input);
  const blocked = unavailable(state, canChange);
  const [hubLevel, setHubLevel] = useState(0);
  useHubStream('pttLevel', useCallback((level: number) => setHubLevel(level), []));
  const self = state.floor.talker?.local ? state.floor.talker : null;
  // The hub reports the device microphone's level while it is on air from it.
  const inputLevel = self && (self.source === 'device' || self.source === 'squelch') ? hubLevel || state.floor.level : null;

  return (
    <>
      {blocked ? <Notice tone={state.status === 'running' ? 'neutral' : 'warn'}>{blocked}</Notice> : null}
      {!state.audio.device && state.status === 'running' ? <Notice>No microphone or speaker on this device: talk and listen from this browser.</Notice> : null}
      {/* Users above and the button at the bottom; side by side on a phone held sideways. */}
      <div className={styles.layout}>
        <section className={styles.console} aria-label="Users">
          <NodeGrid state={state} talker={talk.connection === 'open' ? talk.talker : state.floor.talker} />
        </section>
        <TalkPanel
          state={state}
          talk={talk}
          hubLevel={hubLevel}
          disabled={blocked !== null || (input === 'browser' && talk.connection === 'closed')}
          onSettings={onOpenSettings}
        />
      </div>
      {settingsOpen ? (
        <Dialog title="Talk settings" wide onClose={onCloseSettings}>
          <label className={styles.listen}>
            <Switch label="Listen in this browser" checked={talk.listening} onChange={(on) => void talk.setListening(on)} />
            <span>Listen in this browser</span>
          </label>
          <PttSettingsPanel state={state} canChange={canChange} inputLevel={inputLevel} />
        </Dialog>
      ) : null}
    </>
  );
}

/* ── talking ── */

const PHASE_TEXT = {
  idle: 'Hold to talk to all',
  waiting: 'Asking for the floor…',
  keyed: 'On air · release to stop',
  busy: 'Channel busy',
} as const;

function TalkPanel({ state, talk, hubLevel, disabled, onSettings }: { state: PttState; talk: Talk; hubLevel: number; disabled: boolean; onSettings: () => void }) {
  const { press, release } = talk;
  const hold = useMemo(() => createHold({ press, release }), [press, release]);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The space bar talks while the page has focus, except while typing in a field.
  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select, button:not([data-talk]), a'));
    const down = (event: KeyboardEvent) => {
      if (disabled || typing(event.target)) return;
      if (hold.keyDown(event.code)) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      if (hold.keyUp(event.code)) event.preventDefault();
    };
    const cancel = () => hold.cancel();
    const hidden = () => {
      if (document.visibilityState === 'hidden') hold.cancel();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', hidden);
      hold.cancel();
    };
  }, [hold, disabled]);

  useEffect(() => {
    if (disabled) hold.cancel();
  }, [disabled, hold]);

  const { phase } = talk.snapshot;
  // The socket says first; the state from the events stream covers the rest.
  const talker = talk.connection === 'open' ? talk.talker : state.floor.talker;
  const browserTalking = phase === 'keyed' && talk.input === 'browser';
  const level = browserTalking ? talk.level : talker ? hubLevel || state.floor.level : 0;
  const tone = talker?.local ? 'tx' : talker ? 'rx' : 'idle';

  return (
    <section className={styles.deck} data-tone={tone} aria-label="Push to talk">
      <Button className={styles.deckSettings} variant="ghost" size="small" iconOnly aria-label="Talk settings" title="Talk settings" onClick={onSettings}>
        <Settings />
      </Button>
      <div className={styles.buttonColumn}>
        <OnAir talker={talker} />
        <div className={styles.ring}>
          {state.settings.spectrumEnabled ? <LevelArc analyser={talk.analyser} level={level} tone={tone} /> : null}
          <button
            ref={buttonRef}
            type="button"
            data-talk
            data-phase={phase}
            className={styles.talkButton}
            aria-pressed={phase === 'keyed' || phase === 'waiting'}
            title="Hold to talk, or hold the space bar"
            disabled={disabled}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              hold.pointerDown(event.pointerId);
            }}
            onPointerUp={(event) => hold.pointerUp(event.pointerId)}
            onPointerCancel={(event) => hold.pointerUp(event.pointerId)}
            onLostPointerCapture={(event) => hold.pointerUp(event.pointerId)}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (hold.keyDown(event.code)) event.preventDefault();
            }}
          >
            <MicGlyph />
            <span className={styles.talkLabel}>{PHASE_TEXT[phase]}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function MicGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

/** Who is talking, above the button. */
function OnAir({ talker }: { talker: PttTalker | null }) {
  return (
    <section className={styles.onAir} aria-label="On air">
      <p className="visually-hidden" aria-live="polite">
        {talker
          ? `${talker.codename} is talking${!talker.local && talker.hops !== null ? `, ${hopsText(talker.hops + 1).toLowerCase()}` : ''}`
          : 'Nobody is talking'}
      </p>
      {talker ? (
        <div className={styles.talkerBlock}>
          <div className={styles.talker}>
            <span className={styles.codename}>{talker.codename || talker.id.slice(0, 8)}</span>
          </div>
          {/* A talker not in the peer table is known by its first 4 bytes only. */}
          <span className={`${styles.talkerId} mono`}>{/^[0-9a-f]{8}0{24}$/.test(talker.id) ? `${talker.id.slice(0, 8)}…` : talker.id}</span>
        </div>
      ) : (
        <p className={styles.muted}>Nobody is talking</p>
      )}
    </section>
  );
}

/* ── who is on the network ── */

/** Signal bars and the RSSI, as heard from the node itself. */
function Signal({ rssi }: { rssi: number }) {
  const quality = signalQuality(rssi);
  return (
    <span className={styles.signal} data-bars={quality.bars} title={`${quality.label} signal`}>
      <span className={styles.signalBars} aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span key={bar} data-on={bar <= quality.bars || undefined} />
        ))}
      </span>
      <span className="num">{rssi} dBm</span>
    </span>
  );
}

function tileLabel(tile: TalkTile) {
  const who = `${tile.self ? 'You' : tile.codename}${tile.isAdmin ? ', Kaonic Admin' : ''}${tile.online ? '' : ', out of range'}`;
  const where = `${tile.hops !== null ? `, ${hopsText(tile.hops).toLowerCase()}` : ''}${tile.rssi !== null ? `, signal ${signalQuality(tile.rssi).label.toLowerCase()} (${tile.rssi} dBm)` : ''}`;
  const when = tile.talking ? 'talking now' : tile.lastTalkedTs ? `last talked ${formatClock(tile.lastTalkedTs).slice(0, 8)}` : 'has not talked';
  return `${who}${where}: ${when}`;
}

/** Codec bitrate, live packet rates and the counters since the hub started. Audio is never recorded. */
function AudioStats({ state, onAir }: { state: PttState; onAir: boolean }) {
  const samples = useRef<PacketSample[]>([]);
  const [rates, setRates] = useState({ rx: 0, tx: 0 });
  const { rxPackets, txPackets } = state.stats;
  useEffect(() => {
    const ts = Date.now();
    const kept = samples.current.filter((sample) => ts - sample.ts <= RATE_WINDOW_MS * 2);
    kept.push({ ts, rx: rxPackets, tx: txPackets });
    samples.current = kept;
  }, [rxPackets, txPackets]);
  // Once a second, so a rate also falls back to 0 once packets stop.
  useEffect(() => {
    const timer = setInterval(() => setRates(packetRates(samples.current, Date.now())), 1000);
    return () => clearInterval(timer);
  }, []);
  const items: Array<[string, string]> = [
    ['Bitrate', onAir ? `${(state.settings.opusBitrateBps / 1000).toFixed(0)} kbps` : '0 kbps'],
    ['RX', `${rates.rx.toFixed(1)} pkt/s`],
    ['TX', `${rates.tx.toFixed(1)} pkt/s`],
    ['Received', state.stats.rxPackets.toLocaleString()],
    ['Sent', state.stats.txPackets.toLocaleString()],
    ['Relayed', state.stats.relayed.toLocaleString()],
    ['Duplicates', state.stats.duplicates.toLocaleString()],
  ];
  return (
    <dl className={styles.audioStats} aria-label="Audio statistics" title="Audio is never recorded.">
      {items.map(([label, value]) => (
        <div key={label} className={styles.audioStat}>
          <dt>{label}</dt>
          <dd className="num">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The other users of our network as tiles; the one on air lights up. */
function NodeGrid({ state, talker }: { state: PttState; talker: PttTalker | null }) {
  const peers = usePeers().data ?? [];
  // The hub keeps the last bursts; the current talker counts from when it took the floor.
  const talked = lastTalked(new Map(), state.recent, talker, state.floor.sinceTs ?? 0);
  const tiles = talkTiles(peers, null, talker, talked);
  const online = tiles.filter((tile) => tile.online).length;
  return (
    <div className={styles.network}>
      <div className={styles.networkHead}>
        <h2 className={styles.subtitle}>Users</h2>
        <span className={`${styles.muted} num`}>
          {online === tiles.length ? `${tiles.length} ${tiles.length === 1 ? 'user' : 'users'}` : `${online} of ${tiles.length} online`}
        </span>
      </div>
      <ul className={styles.nodeGrid} aria-label="Users of the network">
        {tiles.map((tile) => (
          <li
            key={tile.id}
            className={styles.nodeTile}
            data-talking={tile.talking || undefined}
            data-admin={tile.isAdmin || undefined}
            data-offline={!tile.online || undefined}
            title={tileLabel(tile)}
            aria-label={tileLabel(tile)}
          >
            {tile.talking ? <Volume2 className={styles.nodeIcon} aria-hidden="true" /> : <RadioTower className={styles.nodeIcon} aria-hidden="true" />}
            <span className={styles.nodeName}>{tile.self ? 'you' : tile.codename}</span>
            <span className={`${styles.nodeId} num`}>{tile.hops !== null ? hopsText(tile.hops) : tile.online || tile.self ? tile.id.slice(0, 8) : 'Not heard'}</span>
            {tile.rssi !== null ? <Signal rssi={tile.rssi} /> : null}
            {tile.isAdmin ? <span className={styles.nodeAdmin}>ADMIN</span> : null}
          </li>
        ))}
      </ul>
      <AudioStats state={state} onAir={talker !== null} />
    </div>
  );
}

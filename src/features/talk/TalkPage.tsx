import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RadioTower } from 'lucide-react';
import type { PttState, PttTalker } from '@/api';
import { useAuthState, useDevice, useHubStream, usePeers, usePtt } from '@/data/queries';
import { formatClock } from '@/lib/format';
import { Page } from '@/shell/Page';
import { Badge, LoadError, Notice, Panel, Skeleton, Switch } from '@/ui';
import { createHold } from './hold';
import { lastTalked, talkTiles, type TalkTile } from './nodeGrid';
import { PttSettingsPanel } from './PttSettingsPanel';
import { Spectrum } from './LevelBars';
import { useTalk, type Talk } from './useTalk';
import styles from './TalkPage.module.css';

/** Push-to-talk to every node of the network at once. */
export default function TalkPage() {
  const ptt = usePtt();
  const auth = useAuthState();
  const canChange = auth.data?.role === 'admin';

  return (
    <Page
      title="Talk"
      description="Push to talk to every node of the network at once. Each node plays it, and relays it to the nodes further away."
    >
      {ptt.isPending ? (
        <Skeleton lines={6} />
      ) : ptt.isError ? (
        <LoadError error={ptt.error} onRetry={() => void ptt.refetch()} />
      ) : (
        <TalkContent state={ptt.data} canChange={canChange} />
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

function TalkContent({ state, canChange }: { state: PttState; canChange: boolean }) {
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
      <TalkPanel state={state} talk={talk} hubLevel={hubLevel} disabled={blocked !== null || (input === 'browser' && talk.connection === 'closed')} />
      <NodeGrid state={state} talker={talk.connection === 'open' ? talk.talker : state.floor.talker} />
      <PttSettingsPanel state={state} canChange={canChange} inputLevel={inputLevel} />
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

const SOURCE_TEXT: Record<NonNullable<PttTalker['source']>, string> = {
  device: 'device mic',
  browser: 'browser mic',
  udp: 'app',
  squelch: 'hardware PTT',
  test: 'test',
};

function TalkPanel({ state, talk, hubLevel, disabled }: { state: PttState; talk: Talk; hubLevel: number; disabled: boolean }) {
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

  const { phase, busyWith, cutOff } = talk.snapshot;
  // The socket says first; the state from the events stream covers the rest.
  const talker = talk.connection === 'open' ? talk.talker : state.floor.talker;
  const browserTalking = phase === 'keyed' && talk.input === 'browser';
  const level = browserTalking ? talk.level : talker ? hubLevel || state.floor.level : 0;
  const tone = talker?.local ? 'tx' : talker ? 'rx' : 'idle';

  return (
    <Panel title="Talk to all" actions={<ConnectionBadge state={talk.connection} />}>
      <div className={styles.talk}>
        <div className={styles.buttonColumn}>
          {state.settings.spectrumEnabled ? <Spectrum bands={state.settings.spectrumBands} analyser={talk.analyser} level={level} tone={tone} /> : null}
          <button
            ref={buttonRef}
            type="button"
            data-talk
            data-phase={phase}
            className={styles.talkButton}
            aria-pressed={phase === 'keyed' || phase === 'waiting'}
            aria-describedby="talk-help"
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
          <p className={styles.micUsed}>
            {talk.input === 'device' ? 'Talks from the device’s microphone' : 'Talks from this browser’s microphone'}
          </p>
          <p id="talk-help" className={styles.help}>
            {phase === 'busy'
              ? busyWith
                ? `${busyWith.codename} is talking. Let go and try again when they stop.`
                : 'The floor is taken. Let go and try again in a moment.'
              : cutOff === 'preempted'
                ? 'The Kaonic Admin took the floor.'
                : cutOff === 'timeout'
                  ? 'The talk was cut off: the connection to the device dropped.'
                  : cutOff === 'forbidden'
                    ? 'Only the device’s admin can talk from this page.'
                    : state.self.isAdmin
                      ? 'Hold the button, or the space bar. This is the Kaonic Admin device: you talk with priority, and take the floor from anyone talking.'
                      : 'Hold the button, or the space bar. The floor must be free; the Kaonic Admin’s talk takes it from anyone.'}
          </p>
          <Switch label="Listen here" checked={talk.listening} onChange={(on) => void talk.setListening(on)} />
          {talk.problem ? <Notice tone="warn">{talk.problem}</Notice> : null}
        </div>
        <OnAir talker={talker} since={state.floor.sinceTs} level={level} />
      </div>
    </Panel>
  );
}

function ConnectionBadge({ state }: { state: Talk['connection'] }) {
  if (state === 'open') return <Badge tone="ok">Connected</Badge>;
  if (state === 'connecting') return <Badge tone="warn">Connecting</Badge>;
  return <Badge tone="danger">Signed out</Badge>;
}

function MicGlyph() {
  return (
    <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

/** Seconds since `since`, ticking while it is set. */
function useSecondsSince(since: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? null : Math.max(0, Math.floor((now - since) / 1000));
}

function TalkerBadges({ talker }: { talker: PttTalker }) {
  return (
    <>
      {talker.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
      {talker.local ? <Badge>This device{talker.source ? ` · ${SOURCE_TEXT[talker.source]}` : ''}</Badge> : null}
    </>
  );
}

function OnAir({ talker, since, level }: { talker: PttTalker | null; since: number | null; level: number }) {
  const seconds = useSecondsSince(talker ? since : null);
  const percent = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <section className={styles.onAir} aria-labelledby="on-air-title">
      <h2 id="on-air-title" className={styles.subtitle}>
        On air now
      </h2>
      <p className="visually-hidden" aria-live="polite">
        {talker ? `${talker.codename} is talking` : 'Nobody is talking'}
      </p>
      {talker ? (
        <div className={styles.talker}>
          <span className={styles.codename}>{talker.codename}</span>
          <span className={styles.badges}>
            <TalkerBadges talker={talker} />
          </span>
          <span className={`${styles.muted} num`}>{seconds !== null ? `${seconds} s` : ''}</span>
        </div>
      ) : (
        <p className={styles.muted}>Nobody is talking.</p>
      )}
      <div className={styles.level} role="meter" aria-label="Loudness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={styles.levelFill} style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

/* ── who is on the network ── */

function tileLabel(tile: TalkTile) {
  const who = `${tile.self ? 'You' : tile.codename}${tile.isAdmin ? ', Kaonic Admin' : ''}${tile.online ? '' : ', out of range'}`;
  const when = tile.talking ? 'talking now' : tile.lastTalkedTs ? `last talked ${formatClock(tile.lastTalkedTs).slice(0, 8)}` : 'has not talked';
  return `${who}: ${when}`;
}

/** Every node of our network as a tile; the one on air lights up. Audio is never recorded. */
function NodeGrid({ state, talker }: { state: PttState; talker: PttTalker | null }) {
  const peers = usePeers().data ?? [];
  const device = useDevice().data;
  // The hub keeps the last bursts; the current talker counts from when it took the floor.
  const talked = lastTalked(new Map(), state.recent, talker, state.floor.sinceTs ?? 0);
  const self = { id: state.self.id, codename: device?.codename ?? '', isAdmin: state.self.isAdmin };
  const tiles = talkTiles(peers, self, talker, talked);
  return (
    <Panel title="Network" actions={<span className={`${styles.muted} num`}>{tiles.length} {tiles.length === 1 ? 'node' : 'nodes'}</span>}>
      <ul className={styles.nodeGrid} aria-label="Nodes of the network">
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
            <RadioTower className={styles.nodeIcon} aria-hidden="true" />
            <span className={styles.nodeName}>{tile.self ? 'you' : tile.codename}</span>
            <span className={`${styles.nodeId} num`}>{tile.id.slice(0, 8)}</span>
            {tile.isAdmin ? <span className={styles.nodeAdmin}>ADMIN</span> : null}
          </li>
        ))}
      </ul>
      <p className={styles.footnote}>Audio is never recorded.</p>
    </Panel>
  );
}

import type { ConnectionState, PttAudioHandlers, PttAudioSocket } from '../client';
import { ApiError } from '../errors';
import { DEFAULT_PTT_SETTINGS, pttSettingsProblems } from '../pttSettings';
import type { Peer, PttBurst, PttDevices, PttKeyResult, PttSession, PttSettings, PttSource, PttState, PttTalker, PttTestWav } from '../types';

/*
 * Push-to-talk in the mock, so the page can be tried without a hub:
 * - other nodes talk now and then (talker changes, levels, a synthetic
 *   voice-like tone on listening sockets);
 * - this device talks from a browser socket, from its own microphone (the
 *   device key, renewed every second, dropped 2 s after the last renewal),
 *   from the squelch now and then (as if someone pressed the hardware PTT
 *   button), or from a test transmission;
 * - keying works or reports the floor taken, and the admin takes the floor;
 * - what you say from the browser is played back as an echo after you let go.
 */

const FRAME_MS = 20;
const FRAME_SAMPLES = 320;
const TICK_MS = 250;
/** A remote talker starts on about one tick in this many, while the floor is free. */
const TALK_CHANCE = 1 / 12;
/** With auto-arm and the squelch on, the hardware button is pressed on about one tick in this many. */
const SQUELCH_CHANCE = 1 / 90;
/** A keyed socket that sends nothing for this long is unkeyed, as the hub does. */
const UNKEY_TIMEOUT_MS = 500;
/** The device key is dropped this long after the last `key()`, as the hub does. */
const DEVICE_KEY_TIMEOUT_MS = 2000;
const ECHO_DELAY_MS = 700;
const TONE_MS = 3000;
const WAV_MAX_BYTES = 32 * 1024 * 1024;

export interface MockPttDeps {
  /** Nodes that may talk. */
  peers(): Peer[];
  self(): { id: string; codename: string; isAdmin: boolean };
  provisioned(): boolean;
  loggedIn(): boolean;
  emitState(state: PttState): void;
  emitLevel(level: number): void;
  /** Someone watches the `ptt` topics. */
  watched(): boolean;
}

interface Speech {
  talker: PttTalker;
  startedTs: number;
  /** Frames still to play: synthetic, or an echo of our own. */
  frames: Int16Array[] | null;
  endsTs: number;
  played: number;
  hops: number | null;
  phase: number;
}

interface MockSocket {
  handlers: PttAudioHandlers;
  listen: boolean;
  keyed: boolean;
  lastFrameTs: number;
  recorded: Int16Array[];
  closed: boolean;
}

/** Who holds this device's own talk. */
type Owner = { kind: 'socket'; socket: MockSocket } | { kind: 'device' } | { kind: 'squelch' } | { kind: 'test'; loop: boolean; source: 'wav' | 'tone' };

interface Local {
  owner: Owner;
  talker: PttTalker;
  startedTs: number;
  frames: number;
  /** Last renewal of the device key. */
  lastTs: number;
  /** Squelch and test talk end on their own. */
  endsTs: number | null;
}

const DEVICES: PttDevices = {
  capture: [
    { name: 'default', description: 'Default (Kaonic WM8960 Audio)' },
    { name: 'hw:0,0', description: 'Kaonic WM8960 Audio, analog' },
  ],
  playback: [
    { name: 'default', description: 'Default (Kaonic WM8960 Audio)' },
    { name: 'hw:0,0', description: 'Kaonic WM8960 Audio, speaker' },
  ],
};

/** Loudness of a frame, 0..1. */
function levelOf(frame: Int16Array): number {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / Math.max(1, frame.length)) / 8000);
}

/** A WAV's duration in ms from its header (RIFF, PCM `fmt `, `data`), or why it is not one. */
export function wavDuration(header: ArrayBuffer, size: number): number | string {
  const view = new DataView(header);
  const text = (at: number) => String.fromCharCode(...new Uint8Array(header, at, 4));
  if (header.byteLength < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') return 'This is not a WAV file.';
  let at = 12;
  let byteRate = 0;
  while (at + 8 <= header.byteLength) {
    const id = text(at);
    const length = view.getUint32(at + 4, true);
    if (id === 'fmt ' && at + 24 <= header.byteLength) {
      if (view.getUint16(at + 8, true) !== 1) return 'Only PCM WAV files can be sent.';
      byteRate = view.getUint32(at + 16, true);
    }
    if (id === 'data') return byteRate > 0 ? Math.round((Math.min(length, size - at - 8) / byteRate) * 1000) : 'The WAV header has no format.';
    at += 8 + length + (length % 2);
  }
  return 'The WAV file has no audio data.';
}

/** `HubApi['ptt']` without the promises: the mock API adds latency and the session check. */
export interface MockPttApi {
  get(): PttState;
  updateSettings(patch: Partial<PttSettings>): PttSettings;
  testTone(): void;
  createSession(): PttSession;
  devices(): PttDevices;
  key(): PttKeyResult;
  unkey(): void;
  testWav(): PttTestWav | null;
  /** The first bytes of the file (its header) and its size. */
  uploadTestWav(header: ArrayBuffer, size: number): PttTestWav;
  deleteTestWav(): void;
  startTestTx(options: { source: 'wav' | 'tone'; loop: boolean }): PttKeyResult;
  stopTestTx(): void;
  audio(options: { listen: boolean }, handlers: PttAudioHandlers): PttAudioSocket;
}

export function createMockPtt(deps: MockPttDeps): { api: MockPttApi; sync(): void } {
  let settings: PttSettings = { ...DEFAULT_PTT_SETTINGS };
  const recent: PttBurst[] = [];
  const stats = { txPackets: 0, rxPackets: 0, relayed: 0, suppressed: 0, duplicates: 0 };
  const sockets = new Set<MockSocket>();
  let speech: Speech | null = null;
  let local: Local | null = null;
  let wav: PttTestWav | null = null;
  let level = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let frameTimer: ReturnType<typeof setInterval> | null = null;

  function selfTalker(source: PttSource): PttTalker {
    const self = deps.self();
    return { id: self.id, codename: self.codename, isAdmin: self.isAdmin, local: true, source };
  }

  function state(): PttState {
    const talker = local?.talker ?? speech?.talker ?? null;
    return {
      status: deps.provisioned() ? 'running' : 'unprovisioned',
      self: { id: deps.self().id, isAdmin: deps.self().isAdmin },
      detail: deps.provisioned() ? null : 'This device has no group key yet: whitelist it from the Kaonic Admin.',
      group: { name: 'all', epoch: deps.provisioned() ? 3 : null, members: deps.peers().filter((peer) => peer.online).length },
      floor: {
        state: local ? 'talking' : speech ? 'receiving' : 'idle',
        talker,
        sinceTs: local?.startedTs ?? speech?.startedTs ?? null,
        level: talker ? level : 0,
      },
      settings: { ...settings },
      audio: { device: true, codec: 'opus' },
      recent: recent.map((burst) => ({ ...burst, talker: { ...burst.talker } })),
      stats: { ...stats },
    };
  }

  function changed() {
    if (deps.loggedIn()) deps.emitState(state());
  }

  function broadcast(message: Parameters<NonNullable<PttAudioHandlers['onMessage']>>[0]) {
    sockets.forEach((socket) => socket.handlers.onMessage?.(message));
  }

  function remember(burst: PttBurst) {
    recent.unshift(burst);
    recent.length = Math.min(recent.length, 20);
  }

  function startSpeech(next: Speech) {
    speech = next;
    broadcast({ type: 'talker', talker: next.talker });
    changed();
  }

  function endSpeech(how: PttBurst['ended'] = 'released') {
    if (!speech) return;
    const ended = speech;
    speech = null;
    remember({
      talker: ended.talker,
      startedTs: ended.startedTs,
      durationMs: Date.now() - ended.startedTs,
      frames: ended.played,
      lostFrames: ended.frames ? 0 : Math.floor(Math.random() * 4),
      hops: ended.hops,
      ended: how,
    });
    stats.rxPackets += Math.ceil(ended.played / settings.packetFrames);
    if (settings.relay && ended.hops !== null && ended.hops < settings.ttl) stats.relayed += Math.ceil(ended.played / 6);
    level = 0;
    broadcast({ type: 'talker', talker: null });
    changed();
  }

  /** A voice-ish synthetic frame: two tones, swelling like syllables. */
  function syntheticFrame(current: Speech): Int16Array {
    const frame = new Int16Array(FRAME_SAMPLES);
    for (let index = 0; index < FRAME_SAMPLES; index += 1) {
      const t = (current.phase + index) / 16_000;
      const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.2 * t);
      const voice = Math.sin(2 * Math.PI * 180 * t) * 0.6 + Math.sin(2 * Math.PI * 360 * t) * 0.25;
      frame[index] = Math.round(voice * syllable * 7000);
    }
    current.phase += FRAME_SAMPLES;
    return frame;
  }

  function playFrame() {
    // Our own talk from the device: frames are counted, nothing reaches the page.
    if (local && local.owner.kind !== 'socket') {
      local.frames += 1;
      const t = (Date.now() - local.startedTs) / 1000;
      level = local.owner.kind === 'test' ? 0.55 : Math.max(0, 0.35 + 0.3 * Math.sin(2 * Math.PI * 3.2 * t) + (Math.random() - 0.5) * 0.15);
    }
    if (!speech) return;
    const current = speech;
    let frame: Int16Array | undefined;
    if (current.frames) {
      frame = current.frames.shift();
      if (!frame) return endSpeech();
    } else {
      if (Date.now() >= current.endsTs) return endSpeech();
      frame = syntheticFrame(current);
    }
    current.played += 1;
    level = levelOf(frame);
    sockets.forEach((socket) => {
      if (socket.listen && !socket.closed) socket.handlers.onFrame?.(frame);
    });
  }

  function testLength(source: 'wav' | 'tone') {
    return source === 'wav' && wav ? wav.durationMs : TONE_MS;
  }

  function tick() {
    if (!deps.loggedIn()) return;
    const now = Date.now();
    if (local) {
      const { owner } = local;
      // A keyed socket that went quiet, or a device key not renewed, loses the floor.
      if (owner.kind === 'socket' && now - owner.socket.lastFrameTs > UNKEY_TIMEOUT_MS) release('timeout');
      else if (owner.kind === 'device' && now - local.lastTs > DEVICE_KEY_TIMEOUT_MS) release('timeout');
      else if (local.endsTs !== null && now >= local.endsTs) {
        if (owner.kind === 'test' && owner.loop) local.endsTs = now + testLength(owner.source);
        else release('released');
      }
    }
    if (!local && !speech && deps.provisioned()) {
      if (settings.autoArm && settings.squelchEnabled && Math.random() < SQUELCH_CHANCE) {
        // Someone pressed the hardware button: the microphone hears speech, the squelch keys.
        take({ kind: 'squelch' }, 'squelch', now + 1500 + Math.random() * 3000);
      } else if (Math.random() < TALK_CHANCE) {
        const talkers = deps.peers().filter((peer) => peer.online && peer.list === 'whitelist');
        const peer = talkers[Math.floor(Math.random() * talkers.length)];
        if (peer) {
          startSpeech({
            talker: { id: peer.id, codename: peer.codename, isAdmin: peer.trust.isAdmin, local: false, source: null },
            startedTs: now,
            frames: null,
            endsTs: now + 1500 + Math.random() * 4500,
            played: 0,
            hops: peer.hops,
            phase: 0,
          });
        }
      }
    }
    if (local || speech) deps.emitLevel(level);
  }

  /** Our own talk ends. */
  function release(reason: PttBurst['ended']) {
    if (!local) return;
    const ended = local;
    local = null;
    level = 0;
    if (ended.owner.kind === 'socket') {
      ended.owner.socket.keyed = false;
      if (reason !== 'released') ended.owner.socket.handlers.onMessage?.({ type: 'unkeyed', reason });
    }
    remember({ talker: ended.talker, startedTs: ended.startedTs, durationMs: Date.now() - ended.startedTs, frames: ended.frames, lostFrames: 0, hops: null, ended: reason });
    stats.txPackets += Math.ceil(ended.frames / settings.packetFrames);
    broadcast({ type: 'talker', talker: null });
    changed();
    if (ended.owner.kind !== 'socket') return;
    // Your own words come back, as if a node far away said them.
    const socket = ended.owner.socket;
    const echo = socket.recorded;
    socket.recorded = [];
    if (echo.length > 0) {
      setTimeout(() => {
        if (local || speech) return;
        const now = Date.now();
        startSpeech({
          talker: { id: 'echo', codename: 'emuecho1', isAdmin: false, local: false, source: null },
          startedTs: now,
          frames: echo,
          endsTs: now + echo.length * FRAME_MS,
          played: 0,
          hops: 2,
          phase: 0,
        });
      }, ECHO_DELAY_MS);
    }
  }

  function sameOwner(a: Owner, b: Owner) {
    return a.kind === b.kind && (a.kind !== 'socket' || (b.kind === 'socket' && a.socket === b.socket));
  }

  /** Who holds the floor if we may not take it; null when we may. The admin takes it from a remote member. */
  function refusal(owner: Owner): PttTalker | 'unprovisioned' | null {
    if (!deps.provisioned()) return 'unprovisioned';
    if (local && !sameOwner(local.owner, owner)) return local.talker;
    if (speech) {
      if (!deps.self().isAdmin || speech.talker.isAdmin) return speech.talker;
      endSpeech('preempted');
    }
    return null;
  }

  function take(owner: Owner, source: PttSource, endsTs: number | null) {
    const now = Date.now();
    local = { owner, talker: selfTalker(source), startedTs: now, frames: 0, lastTs: now, endsTs };
    broadcast({ type: 'talker', talker: local.talker });
    changed();
  }

  function busyReason(holder: PttTalker | 'unprovisioned'): string {
    if (holder === 'unprovisioned') return 'This device has no group key yet.';
    return holder.local ? 'This device is already talking from another source.' : `${holder.codename} is talking.`;
  }

  function keySocket(socket: MockSocket) {
    const holder = refusal({ kind: 'socket', socket });
    if (holder !== null) {
      socket.handlers.onMessage?.({ type: 'busy', talker: holder === 'unprovisioned' ? null : holder });
      return;
    }
    if (!local) {
      socket.keyed = true;
      socket.lastFrameTs = Date.now();
      socket.recorded = [];
      take({ kind: 'socket', socket }, 'browser', null);
    }
    socket.handlers.onMessage?.({ type: 'keyed' });
  }

  function sync() {
    const wanted = deps.watched() || sockets.size > 0 || local !== null;
    if (wanted && !timer) timer = setInterval(tick, TICK_MS);
    if (!wanted && timer) {
      clearInterval(timer);
      timer = null;
    }
    if (wanted && !frameTimer) frameTimer = setInterval(playFrame, FRAME_MS);
    if (!wanted && frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
  }

  function audio(options: { listen: boolean }, handlers: PttAudioHandlers): PttAudioSocket {
    const socket: MockSocket = { handlers, listen: options.listen, keyed: false, lastFrameTs: 0, recorded: [], closed: false };
    let connection: ConnectionState = 'connecting';
    sockets.add(socket);
    sync();
    setTimeout(() => {
      if (socket.closed) return;
      connection = 'open';
      handlers.onState?.('open');
      handlers.onMessage?.({ type: 'talker', talker: local?.talker ?? speech?.talker ?? null });
    }, 50);
    const releaseSocket = () => {
      if (local?.owner.kind === 'socket' && local.owner.socket === socket) release('released');
    };
    return {
      state: () => connection,
      listen(on) {
        socket.listen = on;
      },
      key: () => (connection === 'open' ? keySocket(socket) : handlers.onMessage?.({ type: 'unkeyed', reason: 'timeout' })),
      unkey: releaseSocket,
      sendFrame(frame) {
        if (!socket.keyed || local?.owner.kind !== 'socket' || local.owner.socket !== socket) return;
        socket.lastFrameTs = Date.now();
        socket.recorded.push(frame.slice());
        local.frames += 1;
        level = levelOf(frame);
      },
      close() {
        if (socket.closed) return;
        releaseSocket();
        socket.closed = true;
        sockets.delete(socket);
        connection = 'closed';
        handlers.onState?.('closed');
        sync();
      },
    };
  }

  function check(patch: Partial<PttSettings>) {
    const problems = pttSettingsProblems(patch, settings);
    if (Object.keys(problems).length > 0) throw new ApiError('validation_failed', 'Check the highlighted fields.', problems as Record<string, string>);
  }

  return {
    sync,
    api: {
      get: () => state(),
      updateSettings(patch) {
        check(patch);
        settings = { ...settings, ...patch };
        changed();
        return { ...settings };
      },
      testTone() {
        if (!state().audio.device) throw new ApiError('unavailable', 'This device has no speaker the hub can use.');
      },
      createSession() {
        return {
          token: Math.floor(Math.random() * 0xffffffff)
            .toString(16)
            .padStart(8, '0'),
          udpPort: 8781,
          sampleRateHz: 16_000,
          frameMs: FRAME_MS,
          samplesPerFrame: FRAME_SAMPLES,
          keepaliveIntervalMs: 1000,
          unkeyTimeoutMs: UNKEY_TIMEOUT_MS,
        };
      },
      devices: () => ({ capture: DEVICES.capture.map((device) => ({ ...device })), playback: DEVICES.playback.map((device) => ({ ...device })) }),
      key() {
        const holder = refusal({ kind: 'device' });
        if (holder !== null) return { keyed: false, reason: busyReason(holder) };
        if (local) local.lastTs = Date.now();
        else take({ kind: 'device' }, 'device', null);
        sync();
        return { keyed: true };
      },
      unkey() {
        if (local && local.owner.kind !== 'socket') release('released');
      },
      testWav: () => (wav ? { ...wav } : null),
      uploadTestWav(header, size) {
        if (size > WAV_MAX_BYTES) throw new ApiError('validation_failed', 'The file is larger than 32 MiB.', { file: 'Use a recording of at most 32 MiB.' });
        const duration = wavDuration(header, size);
        if (typeof duration === 'string') throw new ApiError('validation_failed', duration, { file: duration });
        wav = { durationMs: duration, sizeBytes: size, uploadedTs: Math.floor(Date.now() / 1000) };
        return { ...wav };
      },
      deleteTestWav() {
        wav = null;
      },
      startTestTx({ source, loop }) {
        if (!deps.provisioned()) throw new ApiError('unavailable', 'This device has no group key yet.');
        if (source === 'wav' && !wav) return { keyed: false, reason: 'Upload a recording first.' };
        const owner: Owner = { kind: 'test', loop, source };
        const holder = local?.owner.kind === 'test' ? null : refusal(owner);
        if (holder !== null) return { keyed: false, reason: busyReason(holder) };
        if (local) release('released');
        take(owner, 'test', Date.now() + testLength(source));
        sync();
        return { keyed: true };
      },
      stopTestTx() {
        if (local?.owner.kind === 'test') release('released');
      },
      audio,
    },
  };
}

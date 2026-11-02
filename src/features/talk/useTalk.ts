import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, type ConnectionState, type PttAudioSocket, type PttSettings, type PttTalker } from '@/api';
import { Microphone, Speaker } from './audio/browserAudio';
import { createDeviceKey, type DeviceKey } from './deviceKey';
import { createTalkSession, type TalkSession, type TalkSnapshot } from './talkSession';

/*
 * Push-to-talk from this page. The Talk button keys one of two microphones
 * (the `talk_input` setting, as in the plugin):
 * - `device`: the device's own microphone. The page only holds the key
 *   (`POST /ptt/key`, renewed every second); no browser microphone, no
 *   permission prompt. This is the default: the page usually runs on the
 *   node itself.
 * - `browser`: this browser's microphone, sent over the audio socket (kept
 *   warm a few seconds after a press, so the next one starts at once).
 * The audio socket also carries the group to the speaker while "Listen here"
 * is on, and tells who is talking.
 */

/** How long the microphone stays open after a press, for the next one. */
const MIC_WARM_MS = 10_000;
/** The browser path sends the microphone as it is: its own gain control is on. */
const BROWSER_GAIN = 1;

export interface Talk {
  snapshot: TalkSnapshot;
  /** Which microphone the button keys. */
  input: PttSettings['talkInput'];
  connection: ConnectionState;
  /** The talker as the socket last said; null when nobody talks. */
  talker: PttTalker | null;
  /** Our own loudness while talking from the browser, 0..1. */
  level: number;
  listening: boolean;
  setListening(on: boolean): Promise<void>;
  /** Why the microphone, speaker or key could not be used. */
  problem: string | null;
  press(): void;
  release(): void;
  /** The audio this page has, for the level animation: the browser microphone while talking from it, else what plays here. */
  analyser(): AnalyserNode | null;
}

const IDLE: TalkSnapshot = { phase: 'idle', busyWith: null, cutOff: null };

export function useTalk(input: PttSettings['talkInput']): Talk {
  const [browserSnapshot, setBrowserSnapshot] = useState<TalkSnapshot>(IDLE);
  const [deviceSnapshot, setDeviceSnapshot] = useState<TalkSnapshot>(IDLE);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [talker, setTalker] = useState<PttTalker | null>(null);
  const [level, setLevel] = useState(0);
  const [listening, setListeningState] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const sessionRef = useRef<TalkSession | null>(null);
  const deviceRef = useRef<DeviceKey | null>(null);
  const socketRef = useRef<PttAudioSocket | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const micRef = useRef<Promise<Microphone | null> | null>(null);
  const micOpen = useRef<Microphone | null>(null);
  const micTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levelAt = useRef(0);
  /** The input of the press in progress: a setting changed mid-press must not strand the other one. */
  const pressed = useRef<PttSettings['talkInput'] | null>(null);

  // One socket for the page's life; listening is switched on it.
  useEffect(() => {
    const socket = api.ptt.audio(
      { listen: false },
      {
        onFrame: (frame) => speakerRef.current?.play(frame),
        onMessage: (message) => {
          if (message.type === 'talker') {
            setTalker(message.talker);
            if (message.talker === null) speakerRef.current?.clear();
          }
          sessionRef.current?.message(message);
        },
        onState: setConnection,
      },
    );
    socketRef.current = socket;
    const session = createTalkSession(socket, setBrowserSnapshot);
    sessionRef.current = session;
    const device = createDeviceKey({
      key: () => api.ptt.key(),
      unkey: () => api.ptt.unkey(),
      onChange: setDeviceSnapshot,
      onError: (error) => setProblem(errorMessage(error)),
    });
    deviceRef.current = device;
    return () => {
      session.release();
      device.release();
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, []);

  const closeMic = useCallback(() => {
    const pending = micRef.current;
    micRef.current = null;
    micOpen.current = null;
    void pending?.then((mic) => mic?.close());
  }, []);

  // Everything closes with the page.
  useEffect(
    () => () => {
      if (micTimer.current) clearTimeout(micTimer.current);
      closeMic();
      speakerRef.current?.close();
      speakerRef.current = null;
    },
    [closeMic],
  );

  const press = useCallback(() => {
    setProblem(null);
    pressed.current = input;
    if (input === 'device') {
      deviceRef.current?.press();
      return;
    }
    if (micTimer.current) clearTimeout(micTimer.current);
    micTimer.current = null;
    sessionRef.current?.press();
    micRef.current ??= Microphone.open(
      (frame, frameLevel) => {
        sessionRef.current?.frame(frame);
        // A level for the meter, ten times a second is plenty.
        const now = performance.now();
        if (now - levelAt.current > 100) {
          levelAt.current = now;
          setLevel(frameLevel);
        }
      },
      () => BROWSER_GAIN,
    ).then(
      (mic) => {
        micOpen.current = mic;
        return mic;
      },
      (error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
        sessionRef.current?.release();
        micRef.current = null;
        return null;
      },
    );
  }, [input]);

  const release = useCallback(() => {
    const was = pressed.current;
    pressed.current = null;
    if (was === 'device') {
      deviceRef.current?.release();
      return;
    }
    sessionRef.current?.release();
    setLevel(0);
    if (micTimer.current) clearTimeout(micTimer.current);
    micTimer.current = setTimeout(closeMic, MIC_WARM_MS);
  }, [closeMic]);

  const setListening = useCallback(async (on: boolean) => {
    if (on) {
      try {
        // Inside the click: browsers start audio only from a user gesture.
        speakerRef.current ??= await Speaker.open();
      } catch {
        setProblem('This browser cannot play the audio.');
        return;
      }
    }
    socketRef.current?.listen(on);
    if (!on) {
      speakerRef.current?.close();
      speakerRef.current = null;
    }
    setListeningState(on);
  }, []);

  const snapshot = input === 'device' ? deviceSnapshot : browserSnapshot;
  const browserTalking = browserSnapshot.phase === 'keyed' || browserSnapshot.phase === 'waiting';
  const analyser = useCallback(
    () => (browserTalking ? micOpen.current?.analyser : null) ?? speakerRef.current?.analyser ?? null,
    [browserTalking],
  );

  return { snapshot, input, connection, talker, level, listening, setListening, problem, press, release, analyser };
}

import type { PttAudioMessage, PttTalker } from '@/api';

/*
 * One browser talker's side of the floor. Press asks the hub for it; frames
 * captured before the answer are held (up to `PREROLL_FRAMES`) and sent the
 * moment the floor is ours, so the first syllable is not lost while the
 * request crosses the network. Busy holds until the press ends. Pure: the
 * socket and the microphone are passed in.
 */

export type TalkPhase = 'idle' | 'waiting' | 'keyed' | 'busy';

export interface TalkSnapshot {
  phase: TalkPhase;
  /** Who has the floor, when we were refused it. */
  busyWith: PttTalker | null;
  /** Why the last talk ended, when it was not our release. */
  cutOff: 'preempted' | 'timeout' | 'forbidden' | null;
}

/** About 300 ms of speech. */
export const PREROLL_FRAMES = 15;

export interface TalkSocket {
  key(): void;
  unkey(): void;
  sendFrame(frame: Int16Array): void;
}

export interface TalkSession {
  press(): void;
  release(): void;
  /** A frame from the microphone. */
  frame(frame: Int16Array): void;
  /** What the hub said. */
  message(message: PttAudioMessage): void;
  snapshot(): TalkSnapshot;
}

export function createTalkSession(socket: TalkSocket, onChange: (snapshot: TalkSnapshot) => void): TalkSession {
  let snapshot: TalkSnapshot = { phase: 'idle', busyWith: null, cutOff: null };
  let preroll: Int16Array[] = [];

  function set(next: Partial<TalkSnapshot>) {
    snapshot = { ...snapshot, ...next };
    onChange(snapshot);
  }

  return {
    press() {
      if (snapshot.phase !== 'idle') return;
      preroll = [];
      set({ phase: 'waiting', busyWith: null, cutOff: null });
      socket.key();
    },
    release() {
      if (snapshot.phase === 'idle') return;
      const wasTalking = snapshot.phase === 'waiting' || snapshot.phase === 'keyed';
      preroll = [];
      set({ phase: 'idle', busyWith: null });
      if (wasTalking) socket.unkey();
    },
    frame(frame) {
      if (snapshot.phase === 'keyed') socket.sendFrame(frame);
      else if (snapshot.phase === 'waiting') {
        preroll.push(frame);
        if (preroll.length > PREROLL_FRAMES) preroll.shift();
      }
    },
    message(message) {
      switch (message.type) {
        case 'keyed':
          if (snapshot.phase !== 'waiting') {
            // Granted after we let go: give it straight back.
            if (snapshot.phase === 'idle') socket.unkey();
            return;
          }
          set({ phase: 'keyed' });
          preroll.forEach((frame) => socket.sendFrame(frame));
          preroll = [];
          return;
        case 'busy':
          if (snapshot.phase === 'waiting') {
            preroll = [];
            set({ phase: 'busy', busyWith: message.talker });
          }
          return;
        case 'unkeyed':
          if (snapshot.phase === 'keyed' || snapshot.phase === 'waiting') {
            preroll = [];
            set({ phase: 'idle', cutOff: message.reason === 'released' ? null : message.reason });
          }
          return;
        case 'talker':
          return;
      }
    },
    snapshot: () => snapshot,
  };
}

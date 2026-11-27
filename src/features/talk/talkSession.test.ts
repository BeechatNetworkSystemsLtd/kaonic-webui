import { describe, expect, it } from 'vitest';
import type { PttTalker } from '@/api';
import { createTalkSession, PREROLL_FRAMES, type TalkSnapshot } from './talkSession';

const ADMIN: PttTalker = { id: 'a'.repeat(32), codename: 'emuadmin', isAdmin: true, local: false, source: null, hops: 1 };

function setup() {
  const sent: Array<string | number> = [];
  const snapshots: TalkSnapshot[] = [];
  const session = createTalkSession(
    { key: () => sent.push('key'), unkey: () => sent.push('unkey'), sendFrame: (frame) => sent.push(frame[0]!) },
    (snapshot) => snapshots.push(snapshot),
  );
  const frame = (value: number) => session.frame(new Int16Array([value]));
  return { session, sent, snapshots, frame };
}

describe('talk session', () => {
  it('asks for the floor, holds early frames, and sends them once keyed', () => {
    const { session, sent, frame } = setup();
    session.press();
    frame(1);
    frame(2);
    session.message({ type: 'keyed' });
    frame(3);
    session.release();
    expect(sent).toEqual(['key', 1, 2, 3, 'unkey']);
    expect(session.snapshot().phase).toBe('idle');
  });

  it('keeps only the last frames before the floor is granted', () => {
    const { session, sent, frame } = setup();
    session.press();
    for (let value = 0; value < PREROLL_FRAMES + 5; value += 1) frame(value);
    session.message({ type: 'keyed' });
    expect(sent.slice(1)).toHaveLength(PREROLL_FRAMES);
    expect(sent[1]).toBe(5);
  });

  it('stays busy until let go, sending nothing', () => {
    const { session, sent, frame } = setup();
    session.press();
    session.message({ type: 'busy', talker: ADMIN });
    frame(1);
    expect(session.snapshot()).toMatchObject({ phase: 'busy', busyWith: ADMIN });
    session.release();
    expect(sent).toEqual(['key']);
  });

  it('says why the floor was taken away', () => {
    const { session } = setup();
    session.press();
    session.message({ type: 'keyed' });
    session.message({ type: 'unkeyed', reason: 'preempted' });
    expect(session.snapshot()).toMatchObject({ phase: 'idle', cutOff: 'preempted' });
    session.press();
    expect(session.snapshot().cutOff).toBeNull();
  });

  it('gives back a floor granted after the press ended', () => {
    const { session, sent } = setup();
    session.press();
    session.release();
    session.message({ type: 'keyed' });
    expect(sent).toEqual(['key', 'unkey', 'unkey']);
    expect(session.snapshot().phase).toBe('idle');
  });
});

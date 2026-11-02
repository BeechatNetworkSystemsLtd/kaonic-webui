import { describe, expect, it } from 'vitest';
import { chooseLabels } from './labelLayout';

describe('label layout', () => {
  it('labels everything when there is room', () => {
    const shown = chooseLabels(
      [
        { id: 'a', x: 100, y: 100, priority: 1 },
        { id: 'b', x: 300, y: 100, priority: 1 },
      ],
      30,
    );
    expect([...shown].sort()).toEqual(['a', 'b']);
  });

  it('gives a contested spot to the higher priority', () => {
    const shown = chooseLabels(
      [
        { id: 'low', x: 100, y: 100, priority: 1 },
        { id: 'high', x: 130, y: 100, priority: 5 },
      ],
      20,
    );
    expect([...shown]).toEqual(['high']);
  });

  it('drops a label that would cover another node', () => {
    // The second node sits right where the first one's label would go.
    const shown = chooseLabels(
      [
        { id: 'above', x: 100, y: 100, priority: 5 },
        { id: 'below', x: 100, y: 126, priority: 1 },
      ],
      20,
    );
    expect(shown.has('above')).toBe(false);
    expect(shown.has('below')).toBe(true);
  });
});

/*
 * A list fed by a live source, kept outside React so every component reading it
 * shares one subscription. It only listens to the source while at least one
 * component is subscribed.
 */

export interface SharedBuffer<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly T[];
}

/** `append` returns the new list, or the same list when nothing changed (listeners are then not called). */
export function createSharedBuffer<Incoming, T>(
  source: (push: (incoming: Incoming) => void) => () => void,
  append: (items: readonly T[], incoming: Incoming) => readonly T[],
): SharedBuffer<T> {
  let items: readonly T[] = [];
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;

  function push(incoming: Incoming) {
    const next = append(items, incoming);
    if (next === items) return;
    items = next;
    listeners.forEach((listener) => listener());
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      stop ??= source(push);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = null;
        }
      };
    },
    getSnapshot: () => items,
  };
}

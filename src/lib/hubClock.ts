/**
 * The hub's clock, as seen from this browser. A device without network time
 * can be off by months, and its timestamps (frames, packets) are in its own
 * time: "the last 15 minutes" of them must be measured with `hubNow()`, not
 * `Date.now()`.
 *
 * The offset comes from each live event's timestamp, and before the first
 * event from the HTTP `Date` header (whole seconds, so events win).
 */

let offsetMs = 0;
let fromEvents = false;

/** A live event stamped by the hub at `hubMs` arrived now. */
export function noteEventTime(hubMs: number, localMs: number = Date.now()): void {
  offsetMs = hubMs - localMs;
  fromEvents = true;
}

/** A response carried the hub's `Date` header. */
export function noteDateHeader(header: string | null, localMs: number = Date.now()): void {
  if (fromEvents || header === null) return;
  const hubMs = Date.parse(header);
  if (!Number.isNaN(hubMs)) offsetMs = hubMs - localMs;
}

/** Now, in the hub's time. */
export function hubNow(): number {
  return Date.now() + offsetMs;
}

/** For tests. */
export function resetHubClock(): void {
  offsetMs = 0;
  fromEvents = false;
}

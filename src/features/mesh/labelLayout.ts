/*
 * Which nodes on the mesh map get their label drawn. With a few devices all of
 * them do; in a crowd, labels would pile up into noise, so only those that fit
 * are shown. Zooming in makes room and brings more of them back.
 */

export interface LabelCandidate {
  id: string;
  /** Centre of the node on screen. */
  x: number;
  y: number;
  /** Higher wins a contested spot. */
  priority: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Room a label takes under its node: a shortened identity in the small mono face. */
export const LABEL_BOX = { width: 78, height: 15, gap: 3 };

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Picks the labels to show: in order of priority, a label is kept if it covers
 * neither another node nor a label already kept. Returns the ids to label.
 */
export function chooseLabels(candidates: readonly LabelCandidate[], nodeSize: number): Set<string> {
  const half = nodeSize / 2;
  const dots = candidates.map((c) => ({ id: c.id, box: { left: c.x - half, top: c.y - half, right: c.x + half, bottom: c.y + half } }));
  const kept: Box[] = [];
  const shown = new Set<string>();

  for (const candidate of [...candidates].sort((a, b) => b.priority - a.priority)) {
    const top = candidate.y + half + LABEL_BOX.gap;
    const label: Box = { left: candidate.x - LABEL_BOX.width / 2, top, right: candidate.x + LABEL_BOX.width / 2, bottom: top + LABEL_BOX.height };
    const blocked = dots.some((dot) => dot.id !== candidate.id && overlaps(label, dot.box)) || kept.some((other) => overlaps(label, other));
    if (blocked) continue;
    kept.push(label);
    shown.add(candidate.id);
  }
  return shown;
}

// Which of a bout's marks go into the saved video.
//
// A value, not a widget: the summary draws checkboxes from it and hands
// `chosen` straight to `cutBout()`. Kept in the Bout layer because it is a
// statement about a bout's marks, and it holds only their ids, so `Mark` itself
// still never leaves this layer.
//
// Mark ids are unique across a whole bout, so a selection needs no exchange
// ids of its own: which exchange a mark belongs to is the bout's to answer.

import type { Bout, MarkId } from '../contracts.js';

export interface Selection {
  /** The marks going into the video, always in the order of the bout. */
  readonly chosen: readonly MarkId[];
  /** The mark most recently ticked or unticked, or null before any. */
  readonly lastTouched: MarkId | null;
}

/** Every mark of the bout, exchange by exchange, in the order they happened. */
function inOrder(bout: Bout): MarkId[] {
  return bout.exchanges.flatMap((exchange) => exchange.marks.map((mark) => mark.id));
}

/** Every mark chosen. */
export function everyMark(bout: Bout): Selection {
  return { chosen: inOrder(bout), lastTouched: null };
}

/**
 * Only the marks that were given a point — how the summary opens.
 *
 * Those are the moments the bout turned on, and the saved video is their
 * story. The rest are listed, unticked, to be added if wanted.
 */
export function pointsOnly(bout: Bout): Selection {
  const pointed = new Set(
    bout.exchanges.flatMap((exchange) => exchange.marks.filter((mark) => mark.point).map((mark) => mark.id))
  );
  return { chosen: inOrder(bout).filter((id) => pointed.has(id)), lastTouched: null };
}

export function isChosen(selection: Selection, id: MarkId): boolean {
  return selection.chosen.includes(id);
}

/**
 * Tick or untick one mark.
 *
 * Rebuilt from the bout's own order rather than appended to, so a mark ticked
 * back in goes where it happened — its exchange, and its place in it. The video
 * runs in the order of the bout, not in the order of taps on a checklist.
 */
export function toggled(selection: Selection, bout: Bout, id: MarkId): Selection {
  const order = inOrder(bout);
  if (!order.includes(id)) throw new Error(`this bout has no mark ${id}`);

  const wanted = new Set<MarkId>(selection.chosen);
  if (wanted.has(id)) wanted.delete(id);
  else wanted.add(id);

  return { chosen: order.filter((each) => wanted.has(each)), lastTouched: id };
}

/**
 * Which mark's moment plays behind the list.
 *
 * Whichever was last touched — unticking counts, because it is a decision made
 * by looking too. Before anything has been touched, the first moment going
 * into the video, or the first mark of the bout if nothing is.
 */
export function showing(selection: Selection, bout: Bout): MarkId | null {
  return selection.lastTouched ?? selection.chosen[0] ?? inOrder(bout)[0] ?? null;
}

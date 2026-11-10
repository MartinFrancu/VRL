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
 * How the summary opens: the marks that were annotated, or every mark if none
 * was.
 *
 * Placing a hit on a mark is the referee saying it matters, so those are the
 * moments the saved video is about. A bout where nothing was annotated starts
 * with everything ticked instead, so SAVE works straight away rather than
 * being greyed out until something is ticked.
 */
export function startingChoice(bout: Bout): Selection {
  const annotated = new Set(
    bout.exchanges.flatMap((exchange) => exchange.marks.filter((mark) => mark.hits?.length).map((mark) => mark.id))
  );
  if (annotated.size === 0) return everyMark(bout);
  return { chosen: inOrder(bout).filter((id) => annotated.has(id)), lastTouched: null };
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

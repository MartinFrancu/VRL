// Which of an exchange's marks go into the saved video.
//
// A value, not a widget: the Save screen draws checkboxes from it and hands
// `chosen` straight to `cut()`. Kept in Bout because it is a statement about a
// exchange's marks, and it holds only their ids, so `Mark` itself still never
// leaves this layer.

import type { Exchange, MarkId } from '../contracts.js';

export interface Selection {
  /** The marks going into the video, always in the order they happened. */
  readonly chosen: readonly MarkId[];
  /** The mark most recently ticked or unticked, or null before any. */
  readonly lastTouched: MarkId | null;
}

/** Every mark chosen — how the Save screen opens. */
export function everyMark(exchange: Exchange): Selection {
  return { chosen: exchange.marks.map((mark) => mark.id), lastTouched: null };
}

export function isChosen(selection: Selection, id: MarkId): boolean {
  return selection.chosen.includes(id);
}

/**
 * Tick or untick one mark.
 *
 * Rebuilt from the exchange's own order rather than appended to, so a mark ticked
 * back in goes where it happened. The video runs in the order of the exchange, not
 * in the order of the taps on a checklist.
 */
export function toggled(selection: Selection, exchange: Exchange, id: MarkId): Selection {
  if (!exchange.marks.some((mark) => mark.id === id)) {
    throw new Error(`this exchange has no mark ${id}`);
  }

  const wanted = new Set<MarkId>(selection.chosen);
  if (wanted.has(id)) wanted.delete(id);
  else wanted.add(id);

  return {
    chosen: exchange.marks.map((mark) => mark.id).filter((each) => wanted.has(each)),
    lastTouched: id,
  };
}

/**
 * Which mark's moment plays behind the list.
 *
 * Whichever was last touched — unticking counts, because it is a decision made
 * by looking too. Before anything has been touched, the first mark.
 */
export function showing(selection: Selection, exchange: Exchange): MarkId | null {
  return selection.lastTouched ?? exchange.marks[0]?.id ?? null;
}

// Which of an exchange's marks go into the saved video.
//
// A value, not a widget: the Save screen draws checkboxes from it and hands
// `chosen` straight to `cut()`. Kept in Bout because it is a statement about a
// exchange's marks, and it holds only their ids, so `Mark` itself still never
// leaves this layer.
/** Every mark chosen — how the Save screen opens. */
export function everyMark(exchange) {
    return { chosen: exchange.marks.map((mark) => mark.id), lastTouched: null };
}
export function isChosen(selection, id) {
    return selection.chosen.includes(id);
}
/**
 * Tick or untick one mark.
 *
 * Rebuilt from the exchange's own order rather than appended to, so a mark ticked
 * back in goes where it happened. The video runs in the order of the exchange, not
 * in the order of the taps on a checklist.
 */
export function toggled(selection, exchange, id) {
    if (!exchange.marks.some((mark) => mark.id === id)) {
        throw new Error(`this exchange has no mark ${id}`);
    }
    const wanted = new Set(selection.chosen);
    if (wanted.has(id))
        wanted.delete(id);
    else
        wanted.add(id);
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
export function showing(selection, exchange) {
    return selection.lastTouched ?? exchange.marks[0]?.id ?? null;
}
//# sourceMappingURL=selection.js.map
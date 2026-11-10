// Which of a bout's marks go into the saved video.
//
// A value, not a widget: the summary draws checkboxes from it and hands
// `chosen` straight to `cutBout()`. Kept in the Bout layer because it is a
// statement about a bout's marks, and it holds only their ids, so `Mark` itself
// still never leaves this layer.
//
// Mark ids are unique across a whole bout, so a selection needs no exchange
// ids of its own: which exchange a mark belongs to is the bout's to answer.
/** Every mark of the bout, exchange by exchange, in the order they happened. */
function inOrder(bout) {
    return bout.exchanges.flatMap((exchange) => exchange.marks.map((mark) => mark.id));
}
/** Every mark chosen. */
export function everyMark(bout) {
    return { chosen: inOrder(bout), lastTouched: null };
}
export function isChosen(selection, id) {
    return selection.chosen.includes(id);
}
/**
 * Tick or untick one mark.
 *
 * Rebuilt from the bout's own order rather than appended to, so a mark ticked
 * back in goes where it happened — its exchange, and its place in it. The video
 * runs in the order of the bout, not in the order of taps on a checklist.
 */
export function toggled(selection, bout, id) {
    const order = inOrder(bout);
    if (!order.includes(id))
        throw new Error(`this bout has no mark ${id}`);
    const wanted = new Set(selection.chosen);
    if (wanted.has(id))
        wanted.delete(id);
    else
        wanted.add(id);
    return { chosen: order.filter((each) => wanted.has(each)), lastTouched: id };
}
/**
 * Which mark's moment plays behind the list.
 *
 * Whichever was last touched — unticking counts, because it is a decision made
 * by looking too. Before anything has been touched, the first mark of the bout.
 */
export function showing(selection, bout) {
    return selection.lastTouched ?? inOrder(bout)[0] ?? null;
}
//# sourceMappingURL=selection.js.map
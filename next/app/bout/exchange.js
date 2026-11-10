// Layer 2 — an exchange: one recording, and what was noticed in it.
//
// A bout is made of several exchanges: film until the fight is stopped, look
// at the marks, carry on. Each one is an exchange.
//
// No pixels, no codecs, no DOM. Milliseconds and identity, which is what makes
// it cheap to test and is where a wrong answer is invisible on a screen: the
// footage would look perfectly real, just of the wrong moment.
//
// Functions over the record rather than a class, because `Exchange` is already
// defined in the contracts as an immutable value and a class would mean a
// second representation of the same thing, kept in step by hand. The layers
// that own a lifecycle — Capture, with a camera and a recorder — will be
// classes. The rule: classes where there is something to keep alive, functions
// where there is a value.
/**
 * An exchange, in order and checked.
 *
 * Marks are offsets into a recording and a recording runs one way, so whatever
 * order they arrive in, what comes back is the order they happened — everything
 * downstream numbers them for the referee.
 *
 * Two marks claiming one id throws rather than being tidied away. An id is how
 * everything else refers to a mark — which tab is lit, which span a cut is for
 * — so a duplicate is a bug upstream, and carrying on would show the wrong
 * footage under the right number.
 */
export function exchangeOf(draft) {
    const seen = new Set();
    for (const mark of draft.marks) {
        if (seen.has(mark.id))
            throw new Error(`two marks claim the id ${mark.id}`);
        seen.add(mark.id);
    }
    return {
        ...draft,
        marks: [...draft.marks].sort((left, right) => left.atMs - right.atMs),
    };
}
/**
 * How far the exchange reaches, in milliseconds on its own clock.
 *
 * Derived rather than stored, because a kept copy of a derivable number is a
 * copy that can disagree. With several angles it is the furthest any of them
 * reaches: a phone whose battery died early must not shorten an exchange the others
 * are still filming.
 */
export function durationOf(exchange) {
    return Math.max(0, ...exchange.takes.map((take) => take.startedAtMs + take.durationMs));
}
/**
 * What to show for these marks, and in what order.
 *
 * One mark is instant replay — the window around the one being looked at.
 * Several is the highlight video. **They are the same operation**, which is why
 * the second use case is not a second mechanism: what differs is where the
 * result is sent, not how it is worked out.
 *
 * Spans come back in the order the marks happened, whatever order they were
 * asked for in, because a highlight that jumped about in time would be a
 * different thing from the exchange it was cut from.
 *
 * Both ends are clamped to footage that exists, and both shortfalls are
 * reported rather than silently absorbed. A window that quietly ends early
 * looks like a fault; one that says the fight was stopped does not.
 */
export function cut(exchange, markIds, spec) {
    const reaches = durationOf(exchange);
    const angles = exchange.takes.map((take) => take.id);
    const wanted = new Set(markIds);
    const have = new Set(exchange.marks.map((mark) => mark.id));
    for (const id of wanted) {
        if (!have.has(id))
            throw new Error(`this exchange has no mark ${id}`);
    }
    // Driven by the exchange's own marks rather than by the ids as given, so the
    // result is in exchange order for free.
    const spans = exchange.marks
        .filter((mark) => wanted.has(mark.id))
        .map((mark) => {
        const fromMs = Math.max(0, mark.atMs - spec.leadMs);
        const toMs = Math.min(reaches, mark.atMs + spec.tailMs);
        const atMs = Math.max(fromMs, Math.min(mark.atMs, toMs));
        return {
            fromMs,
            toMs,
            atMs,
            takes: angles,
            shortLeadMs: Math.max(0, spec.leadMs - (atMs - fromMs)),
            shortTailMs: Math.max(0, spec.tailMs - (toMs - atMs)),
        };
    });
    return { spans };
}
/**
 * The exchange with one mark's point given, changed, or taken away.
 *
 * `null` takes it away, and leaves the mark exactly as it was before it had
 * one: no point is the absence of a point, not a third side.
 */
export function withPoint(exchange, markId, side) {
    if (!exchange.marks.some((mark) => mark.id === markId)) {
        throw new Error(`this exchange has no mark ${markId}`);
    }
    return {
        ...exchange,
        marks: exchange.marks.map((mark) => {
            if (mark.id !== markId)
                return mark;
            const { point: _was, ...unpointed } = mark;
            return side ? { ...unpointed, point: side } : unpointed;
        }),
    };
}
//# sourceMappingURL=exchange.js.map
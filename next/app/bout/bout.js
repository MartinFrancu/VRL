// Layer 2 — a bout: the whole fight, as the exchanges it was filmed in.
//
// A referee films until the fight is stopped, looks at the marks, and carries
// on. Each of those is an exchange (`exchange.ts`); the bout is the exchanges
// in the order they were filmed, and saving makes one video of all of it.
//
// Functions over the record, as for an exchange.
import { cut } from './exchange.js';
export function newBout(id, startedAt) {
    return { id, startedAt, exchanges: [] };
}
/**
 * The bout with one more exchange on the end.
 *
 * The same exchange twice throws: it would put its moments in the saved video
 * twice, and it can only happen through a bug upstream.
 */
export function withExchange(bout, exchange) {
    if (bout.exchanges.some((each) => each.id === exchange.id)) {
        throw new Error(`this bout already has exchange ${exchange.id}`);
    }
    return { ...bout, exchanges: [...bout.exchanges, exchange] };
}
/**
 * The bout with one exchange swapped for a new version of itself, in the same
 * place — what happens when its marks are re-placed by the other clock.
 */
export function withExchangeReplaced(bout, exchange) {
    return {
        ...bout,
        exchanges: bout.exchanges.map((each) => (each.id === exchange.id ? exchange : each)),
    };
}
/** Which exchange a mark was taken in, or null when it is not in this bout. */
export function exchangeHolding(bout, markId) {
    return bout.exchanges.find((each) => each.marks.some((mark) => mark.id === markId)) ?? null;
}
/**
 * The whole bout cut down to the chosen moments, in the order they happened:
 * exchange by exchange, then mark by mark within each.
 *
 * Each exchange is cut by the same `cut()` instant replay uses, and the spans
 * simply follow on from one another. Each names the recording it comes from,
 * which is all the recorder needs to switch between them — so a bout of five
 * exchanges is still one Cut and still one mechanism.
 */
export function cutBout(bout, markIds, spec) {
    for (const id of markIds) {
        if (!exchangeHolding(bout, id))
            throw new Error(`this bout has no mark ${id}`);
    }
    const wanted = new Set(markIds);
    return {
        spans: bout.exchanges.flatMap((exchange) => {
            const chosen = exchange.marks.filter((mark) => wanted.has(mark.id)).map((mark) => mark.id);
            return chosen.length ? cut(exchange, chosen, spec).spans : [];
        }),
    };
}
//# sourceMappingURL=bout.js.map
// The shapes the layers agree on, and nothing else.
//
// No runtime, no behaviour, no imports — types only. It exists so the data
// structures can be argued about before any logic is written against them,
// which is the cheapest moment to disagree.
//
// The one rule, from docs/architecture.md: a structured type is a contract
// between exactly TWO layers, so changing it can break at most one neighbour.
// Opaque handles are exempt, because there is no shape to depend on.
//
//   MediaHandle  opaque              everyone, by design
//   Picture      opaque              everyone, by design
//   Take         Capture  -> Bout
//   Mark         inside Bout only
//   Span, Cut    Bout     -> Render
//   Frameset     Render   -> a sink
//   ExchangeRecord Bout   -> Store
//
// Where two of these look nearly identical — Take and StoredTake especially —
// that duplication is deliberate. See the note on StoredTake.

// ------------------------------------------------------------------ identity

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

// Distinct so that a take's id cannot be passed where a mark's is wanted. They
// are all strings at runtime; this costs nothing and catches the mix-up that
// is otherwise invisible until something shows the wrong footage.
export type BoutId = Branded<string, 'BoutId'>;
export type ExchangeId = Branded<string, 'ExchangeId'>;
export type TakeId = Branded<string, 'TakeId'>;
export type MarkId = Branded<string, 'MarkId'>;

// -------------------------------------------------------------- layer 0 only

declare const mediaHandle: unique symbol;
declare const picture: unique symbol;

/**
 * Footage, as a token. Hand it back to Media to get bytes or frames out.
 *
 * It has no readable fields on purpose: nothing above Media can learn whether
 * this is mp4 or webm, a Blob or a file handle. That is what makes swapping a
 * codec a one-layer change, and it is the only reason this may cross every
 * boundary without breaking the two-party rule.
 */
export interface MediaHandle {
  readonly [mediaHandle]: 'MediaHandle';
}

/**
 * One decoded image, as a token.
 *
 * Also opaque, for the same reason — it may be a `VideoFrame`, an
 * `ImageBitmap` or a canvas, and only Media and the sink need to know.
 *
 * Worth knowing: the screen sink does not currently produce these at all. It
 * seeks a `<video>` element and lets the browser paint, which materialises no
 * value. Pictures become real when something needs actual pixels — compositing
 * several angles, or encoding a highlight. The type is here so that sink can be
 * added without reshaping anything; it is not a claim that today's app makes
 * one.
 */
export interface Picture {
  readonly [picture]: 'Picture';
}

// -------------------------------------------------------- Capture  ->  Bout

/**
 * One continuous recording from one source.
 *
 * `startedAtMs` is on the *exchange's* clock, not on any device's. For a single
 * phone that is zero. For several, it is the offset that lines this angle up
 * against the others, and working it out is Bout's job — see Clock.
 *
 * `width` and `height` are the shape the footage actually came out, which is
 * not always the shape it was filmed in: the camera keeps whatever shape it
 * had when it was first asked. That discrepancy is a real bug this app has
 * shipped, and the only way to tell the two faults apart is to record both.
 */
export interface Take {
  readonly id: TakeId;
  /** Which phone and which camera, for a human reading diagnostics. */
  readonly source: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly media: MediaHandle;
}

// ------------------------------------------------------------- inside Bout

/**
 * One noted instant, on the exchange's clock.
 *
 * An instant, and who got the point for it if anyone. That is the first of
 * scoring to land here, and deliberately the least of it: which fighter, not
 * what was hit or under which rules, because there will be more than one rule
 * set wanting different fields. This type never leaves Bout, so when they come
 * nothing outside Bout can break — giving a point touched nothing else.
 */
export interface Mark {
  readonly id: MarkId;
  readonly atMs: number;
  /** Who the referee gave the point to, if anyone. Absent means no point. */
  readonly point?: Side;
}

/** The two fighters, by the colour each wears. */
export type Side = 'red' | 'blue';

/**
 * What the exchange's milliseconds are counted from.
 *
 * The seam for several angles, and the only place the hard part lives.
 *
 * - `take` — the exchange's clock *is* one recording's own clock. One phone, which
 *   is every exchange today, and nothing needs aligning.
 * - `shared` — every take carries an offset against a common epoch. Several
 *   phones, where lining them up is the whole problem.
 */
export type Clock =
  | { readonly kind: 'take'; readonly take: TakeId }
  | { readonly kind: 'shared'; readonly epochMs: number };

/**
 * An exchange: the footage, and what was noticed in it.
 *
 * No duration field — it is the furthest any take reaches, and a stored copy of
 * a derivable number is a copy that can disagree.
 */
export interface Exchange {
  readonly id: ExchangeId;
  /** ISO 8601, for sorting a library and showing a human when this was. */
  readonly filmedAt: string;
  readonly clock: Clock;
  readonly takes: readonly Take[];
  readonly marks: readonly Mark[];
}

/**
 * A bout: the whole fight, as a referee sees it.
 *
 * Film until the fight is stopped, review the marks, carry on — each of those
 * is an exchange, and the bout is the exchanges in the order they were filmed.
 * Saving makes one video of the whole bout.
 *
 * Like Mark, it is read only inside the Bout layer. What leaves is a Cut.
 */
export interface Bout {
  readonly id: BoutId;
  /** ISO 8601 — when the first exchange started. The saved video is named for it. */
  readonly startedAt: string;
  readonly exchanges: readonly Exchange[];
}

// --------------------------------------------------------- Bout  ->  Render

/**
 * A stretch worth showing, and where its point of interest sits.
 *
 * This is `windows.js`'s answer generalised: the same lead/tail arithmetic,
 * plus which angles to show it from. `atMs` is the instant the span exists for
 * — the zero that the readout counts from, not the middle.
 *
 * Both shortfalls can be non-zero, and they mean different things. A span near
 * the start of a recording has less run-up because there is none; one marked
 * just before the fight was stopped ends mid-movement, and that has to be
 * sayable, because a window that silently ends early looks like a fault.
 */
export interface Span {
  readonly fromMs: number;
  readonly toMs: number;
  readonly atMs: number;
  readonly takes: readonly TakeId[];
  /** Run-up asked for and not available. Zero when it got everything. */
  readonly shortLeadMs: number;
  /** Tail asked for and not available — almost always a fight stopped early. */
  readonly shortTailMs: number;
  /** For a highlight's caption. Absent when nothing is written over it. */
  readonly label?: string;
}

/**
 * What to show, in what order.
 *
 * One span is instant replay — the window around the mark being looked at.
 * Several spans in a row is the highlight video. **They are the same thing**,
 * which is why both use cases are one mechanism with different sinks, and why
 * trimming an exchange for storage is also this.
 */
export interface Cut {
  readonly spans: readonly Span[];
}

// --------------------------------------------------------- Render  ->  sink

/** One angle's view of one instant. */
export interface Angle {
  readonly take: TakeId;
  readonly picture: Picture;
}

/**
 * What one instant looks like.
 *
 * `angles` is a list when there is only ever one angle today, and that is the
 * most load-bearing decision in this file. Asking "what does this moment look
 * like?" and being answered with a list makes several phones a different
 * *number* rather than a different design — length one now, length four later,
 * with every layer above Bout already written for it.
 */
export interface Frameset {
  readonly atMs: number;
  readonly angles: readonly Angle[];
}

// ---------------------------------------------------------- Bout  ->  Store

/**
 * One stored piece of a take's footage.
 *
 * This is where the undecided question lives, and why it can stay undecided:
 * keeping whole recordings means a single entry covering the take, and keeping
 * only the marked windows means one entry per window. **Same type either way**,
 * so the decision is an argument at a call site rather than a shape, and it can
 * be made per bout, or changed later, or changed on a phone but not a laptop.
 */
export interface StoredMedia {
  /** Where Store put the bytes. Opaque to everyone but Store. */
  readonly key: string;
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * A take as it is written down.
 *
 * Nearly a `Take`, and spelled out again rather than derived from one with
 * `Omit`. That looks like duplication worth removing and is not: deriving it
 * would make this contract break whenever Capture's changed, which is the exact
 * coupling the two-party rule exists to prevent. Bouts already written to a
 * phone cannot be reshaped by a change to the camera code.
 */
export interface StoredTake {
  readonly id: TakeId;
  readonly source: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly media: readonly StoredMedia[];
}

/**
 * An exchange, serialised.
 *
 * `v` from the first version, before there is anything to migrate. Once other
 * referees' phones hold saved bouts, the format is on devices nobody controls,
 * and a version field added later cannot tell you what it is looking at.
 */
export interface ExchangeRecord {
  readonly v: 1;
  readonly id: ExchangeId;
  readonly filmedAt: string;
  readonly clock: Clock;
  readonly takes: readonly StoredTake[];
  readonly marks: readonly Mark[];
}

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
//   BoutRecord   Bout     -> Store
//
// Where two of these look nearly identical — Take and StoredTake especially —
// that duplication is deliberate. See the note on StoredTake.
export {};
//# sourceMappingURL=contracts.js.map
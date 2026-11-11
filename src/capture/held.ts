// Which way the phone is held, as far as the picture is concerned.
//
// A recording keeps the shape it started in. Turn the phone from portrait to
// landscape halfway through and the rest of the exchange is filmed sideways —
// so the filming screen warns, and this is the question it asks.

/** Portrait or landscape, from whatever the browser called it. */
function shapeOf(held: string): 'portrait' | 'landscape' | null {
  if (held.startsWith('portrait')) return 'portrait';
  if (held.startsWith('landscape')) return 'landscape';
  return null;
}

/**
 * Whether the phone is now held the other way from when filming started.
 *
 * Takes `screen.orientation.type` ('portrait-primary', 'landscape-secondary'…)
 * or the plain 'portrait'/'landscape' a browser without it is given instead.
 * Upside down is not different: the picture is the same shape. Anything it
 * cannot read — nothing filmed yet — is not different either, since a warning
 * nobody can act on is worse than none.
 */
export function heldDifferently(atStart: string, now: string): boolean {
  const before = shapeOf(atStart);
  const after = shapeOf(now);
  return before !== null && after !== null && before !== after;
}

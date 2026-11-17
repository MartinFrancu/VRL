// A bout written down, and — later — read back.
//
// The Bout layer's side of the `BoutRecord` contract. Marks never leave this
// layer except inside a record, so this is where they are written down.

import type { Bout, BoutRecord, ExchangeRecord, MarkId, MediaHandle, StoredTake, TakeId } from '../contracts.js';
import { newBout, withExchange } from './bout.js';
import { exchangeOf } from './exchange.js';

/** Where a take's recording went, and the shape of its picture as a player shows it. */
export interface TakeFile {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

export interface RecordInputs {
  readonly chosen: readonly MarkId[];
  readonly title: string;
  readonly window: { readonly leadMs: number; readonly tailMs: number };
  readonly app: string;
  readonly savedAt: string;
  readonly files: ReadonlyMap<TakeId, TakeFile>;
}

/**
 * A bout as a `BoutRecord`: its exchanges, each take pointing at its file at
 * the shape its picture is, every mark and hit as it was, and the choices
 * made about it on the Save screen.
 *
 * Throws for a take with no file, rather than writing a record that points at
 * nothing.
 */
export function boutRecord(bout: Bout, inputs: RecordInputs): BoutRecord {
  const exchanges: ExchangeRecord[] = bout.exchanges.map((exchange) => ({
    v: 1,
    id: exchange.id,
    filmedAt: exchange.filmedAt,
    clock: exchange.clock,
    takes: exchange.takes.map((take): StoredTake => {
      const file = inputs.files.get(take.id);
      if (!file) throw new Error(`no file for recording ${take.id}`);
      return {
        id: take.id,
        source: take.source,
        startedAtMs: take.startedAtMs,
        durationMs: take.durationMs,
        width: file.width,
        height: file.height,
        media: [{ key: file.key, fromMs: 0, toMs: take.durationMs }],
      };
    }),
    marks: exchange.marks,
  }));

  const title = inputs.title.trim();
  return {
    v: 1,
    id: bout.id,
    startedAt: bout.startedAt,
    savedAt: inputs.savedAt,
    app: inputs.app,
    ...(title ? { title } : {}),
    window: { leadMs: inputs.window.leadMs, tailMs: inputs.window.tailMs },
    chosen: [...inputs.chosen],
    exchanges,
  };
}

/** A bout opened again, with the choices that were made about it. */
export interface OpenedBout {
  readonly bout: Bout;
  readonly chosen: readonly MarkId[];
  readonly title: string;
  readonly window: { readonly leadMs: number; readonly tailMs: number };
}

/**
 * The bout a record was written from, each take on the recording `mediaFor`
 * finds for its file — and the ticks, title and window it was saved with.
 */
export function boutFromRecord(record: BoutRecord, mediaFor: (key: string) => MediaHandle): OpenedBout {
  const bout = record.exchanges.reduce(
    (sofar, exchange) =>
      withExchange(
        sofar,
        exchangeOf({
          id: exchange.id,
          filmedAt: exchange.filmedAt,
          clock: exchange.clock,
          takes: exchange.takes.map((take) => {
            const key = take.media[0]?.key;
            if (!key) throw new Error(`recording ${take.id} has no file`);
            return {
              id: take.id,
              source: take.source,
              startedAtMs: take.startedAtMs,
              durationMs: take.durationMs,
              width: take.width,
              height: take.height,
              media: mediaFor(key),
            };
          }),
          marks: exchange.marks,
        })
      ),
    newBout(record.id, record.startedAt)
  );
  return {
    bout,
    chosen: record.chosen,
    title: record.title ?? '',
    window: { leadMs: record.window.leadMs, tailMs: record.window.tailMs },
  };
}

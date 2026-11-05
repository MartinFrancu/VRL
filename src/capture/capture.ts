// Layer 1 — filming one bout, and handing back a bout with a clock that can be
// trusted.
//
// A class, because unlike Bout there is something to keep alive here: a
// recording in progress, and the readings taken while it runs. The rule from
// `docs/architecture.md` is classes where there is something to keep alive,
// functions where there is a value.
//
// What it does *not* own is the camera itself. Acquiring a stream, following
// the phone's rotation and noticing the camera being taken away are the shell's
// job, because they outlive any one bout — the camera is open from permission
// until the tab dies. What arrives here is a view onto whatever camera is
// currently open.
//
// Everything this depends on is ours: a camera view, a recording, a ruler. None
// of it is a stand-in for MediaRecorder or getUserMedia, which the working
// agreement forbids faking. The seam goes in front of the browser, and this is
// where it goes.

import { boutOf } from '../bout/bout.js';
import type { Bout, BoutId, MarkId, TakeId } from '../contracts.js';
import type { MediaHandle } from '../contracts.js';
import type { ClockChoice, Reading } from './clock.js';
import { resolveMarks } from './clock.js';

/** What Capture needs to know about whatever camera is open. */
export interface CameraView {
  /** The shape the camera is giving right now. */
  shape(): { readonly width: number; readonly height: number };
  /** The camera's own frame clock, or null where it offers none. */
  frameClockMs(): number | null;
}

/** A recording in progress — `media.record` returns one of these. */
export interface RecordingInProgress {
  readonly mimeType: string;
  stop(): Promise<MediaHandle>;
}

export interface CaptureDeps {
  /** A monotonic millisecond clock. `performance.now` in the app. */
  now(): number;
  /** The wall-clock date, for a human reading a library listing later. */
  nowIso(): string;
  newId(): string;
  /** Which phone and which camera, for diagnostics. */
  source: string;
  camera: CameraView;
  startRecording(): RecordingInProgress;
  measureDuration(media: MediaHandle): Promise<number>;
}

/** What a bout being filmed looks like from the inside. */
interface InFlight {
  readonly takeId: TakeId;
  readonly recording: RecordingInProgress;
  readonly startedAtWallMs: number;
  /** The frame clock when filming began; null where the camera offers none. */
  readonly startedAtFrameMs: number | null;
  /**
   * The shape the camera was giving when filming began.
   *
   * Read once, at the start, and never again. A recording keeps the shape the
   * camera had when it was asked, and turning the phone afterwards does not
   * change the file — so asking the camera again at the end would record a
   * shape the footage does not have, which is precisely the confusion that made
   * a sideways bout so hard to diagnose.
   */
  readonly shape: { readonly width: number; readonly height: number };
  readonly readings: Reading[];
}

export class Capture {
  readonly #deps: CaptureDeps;
  #flight: InFlight | null = null;

  /**
   * The bout last finished, and the readings it came from.
   *
   * Kept because the diagnostics panel can flip which clock places the marks,
   * and that has to take effect on the bout already on screen rather than only
   * on the next one. Resolving is cheap; re-filming is not.
   */
  #finished: { bout: Bout; readings: readonly Reading[] } | null = null;
  #mimeType = '';

  constructor(deps: CaptureDeps) {
    this.#deps = deps;
  }

  get recording(): boolean {
    return this.#flight !== null;
  }

  get markCount(): number {
    return this.#flight?.readings.length ?? 0;
  }

  /** What the footage was recorded as, for diagnostics. */
  get mimeType(): string {
    return this.#flight?.recording.mimeType ?? this.#mimeType;
  }

  /** The taps of the bout last finished, each still timed both ways. */
  get lastReadings(): readonly Reading[] {
    return this.#finished?.readings ?? [];
  }

  /**
   * The bout last finished, with its marks placed by `prefer` instead.
   *
   * Null before any bout has finished. The same bout, with the same id — only
   * where its marks sit changes.
   */
  usingClock(prefer: ClockChoice): Bout | null {
    const finished = this.#finished;
    if (!finished) return null;

    return boutOf({ ...finished.bout, marks: resolveMarks(finished.readings, prefer) });
  }

  /** Begin a bout. Anything the last one left behind goes. */
  start(): void {
    const deps = this.#deps;
    this.#flight = {
      takeId: deps.newId() as TakeId,
      recording: deps.startRecording(),
      startedAtWallMs: deps.now(),
      startedAtFrameMs: deps.camera.frameClockMs(),
      shape: deps.camera.shape(),
      readings: [],
    };
  }

  /**
   * Note this instant and keep filming.
   *
   * Timed twice, because the lag between asking for a recording and the first
   * encoded frame is real and nothing reports it. Which reading is believed is
   * decided at the end, by `clock.ts`, when there is enough evidence to decide.
   */
  mark(): MarkId {
    const flight = this.#flight;
    if (!flight) throw new Error('not recording, so there is nothing to mark');

    const id = this.#deps.newId() as MarkId;
    const frameNow = this.#deps.camera.frameClockMs();
    flight.readings.push({
      id,
      wallMs: this.#deps.now() - flight.startedAtWallMs,
      frameMs:
        frameNow !== null && flight.startedAtFrameMs !== null
          ? frameNow - flight.startedAtFrameMs
          : null,
    });

    return id;
  }

  /** Stop filming and hand back the bout. */
  async finish(prefer: ClockChoice): Promise<Bout> {
    const flight = this.#flight;
    if (!flight) throw new Error('not recording, so there is nothing to finish');
    this.#flight = null;

    this.#mimeType = flight.recording.mimeType;
    const media = await flight.recording.stop();
    const durationMs = await this.#deps.measureDuration(media);

    const bout = boutOf({
      id: this.#deps.newId() as BoutId,
      filmedAt: this.#deps.nowIso(),
      // One phone, so the bout's clock is this recording's own and nothing
      // needs aligning. Several would be `{ kind: 'shared', ... }`.
      clock: { kind: 'take', take: flight.takeId },
      takes: [
        {
          id: flight.takeId,
          source: this.#deps.source,
          startedAtMs: 0,
          durationMs,
          width: flight.shape.width,
          height: flight.shape.height,
          media,
        },
      ],
      marks: resolveMarks(flight.readings, prefer),
    });

    this.#finished = { bout, readings: flight.readings };
    return bout;
  }

  /**
   * Stop filming and keep nothing.
   *
   * The recording is still stopped — a recorder left running would hold the
   * camera and fill memory with footage nobody asked for.
   */
  async discard(): Promise<void> {
    const flight = this.#flight;
    if (!flight) return;
    this.#flight = null;
    await flight.recording.stop();
  }
}

// The player's view pings, batched. The player feeds every timeupdate in;
// this adds up the seconds really played (seeks do not count) and says when
// a ping is due: once when playback starts (it opens the day's row), then
// every 10 seconds of wall clock while playing, and on pause, end and leave
// when there is something unsent. One ping carries the seconds played since
// the last one. Snips (feature 11) pass firstS: 3, so the first tick goes
// out at 3 seconds, when a short's view counts. No imports, so Node can load this file directly.

import { PING_EVERY_S } from "./rules.ts";

export type Ping = { positionS: number; playedS: number; reason: PingReason };
export type PingReason = "start" | "tick" | "pause" | "end" | "leave";

/** A jump bigger than this between two timeupdates is a seek, not playback. */
const MAX_STEP_S = 2;
/** Pause and leave pings wait for at least this much unsent playback. */
const MIN_FLUSH_S = 1;

export class PingBatcher {
  private unsent = 0;
  private lastTime: number | null = null;
  private lastSentAt = 0;
  private started = false;
  private readonly everyMs: number;
  private readonly firstMs: number;
  /** With firstS, the first tick also waits for that much playback, so it lands on the view. */
  private readonly firstNeed: number;
  private ticks = 0;

  constructor(opts: { everyS?: number; firstS?: number } = {}) {
    this.everyMs = (opts.everyS ?? PING_EVERY_S) * 1000;
    this.firstMs = (opts.firstS ?? opts.everyS ?? PING_EVERY_S) * 1000;
    this.firstNeed = opts.firstS ?? 0;
  }

  /** Seconds played and not sent yet. */
  get pending(): number {
    return this.unsent;
  }

  /**
   * Playback started or resumed at `positionS`. The first time, answers the
   * start ping that opens the day's row.
   */
  play(positionS: number, now: number): Ping | null {
    this.lastTime = positionS;
    if (this.started) return null;
    this.started = true;
    this.lastSentAt = now;
    return { positionS: round(positionS), playedS: 0, reason: "start" };
  }

  /**
   * A timeupdate while playing. Adds the step when it looks like playback
   * (forward and small) and answers a ping when 10 seconds have passed since
   * the last one (`firstS` for the first tick).
   */
  tick(positionS: number, now: number): Ping | null {
    if (this.lastTime !== null) {
      const step = positionS - this.lastTime;
      if (step > 0 && step <= MAX_STEP_S) this.unsent += step;
    }
    this.lastTime = positionS;
    if (!this.started) return null;
    const first = this.ticks === 0;
    const wait = first ? this.firstMs : this.everyMs;
    if (now - this.lastSentAt >= wait && this.unsent > 0 && (!first || this.unsent >= this.firstNeed)) {
      this.ticks++;
      return this.take(positionS, now, "tick");
    }
    return null;
  }

  /** The person jumped: the next step starts from here and is not counted. */
  seek(positionS: number) {
    this.lastTime = positionS;
  }

  /** Pause, end or leaving the page: sends what is left, if anything. */
  flush(positionS: number, now: number, reason: Exclude<PingReason, "start" | "tick">): Ping | null {
    this.tick(positionS, now);
    this.lastTime = null;
    if (!this.started) return null;
    if (this.unsent < (reason === "end" ? Number.EPSILON : MIN_FLUSH_S)) return null;
    return this.take(positionS, now, reason);
  }

  private take(positionS: number, now: number, reason: PingReason): Ping {
    const playedS = round(this.unsent);
    this.unsent = 0;
    this.lastSentAt = now;
    return { positionS: round(positionS), playedS, reason };
  }
}

function round(n: number): number {
  return Math.round(Math.max(0, n) * 10) / 10;
}

/**
 * When a session's layout anchor may be taken: once tracking has settled.
 * Pure (no IWSDK imports), so it's tested in Node.
 *
 * The 2026-10-13 headset session took its anchor the moment XR began; 0.2 s
 * later the Quest reset its reference space with a correction, and the
 * anchor (in the old coordinates) put the whole group 1.6 m away, facing
 * where the head had briefly turned. So the anchor waits until:
 *
 * - the reference space is in use (the caller only samples once it is),
 * - no reset for ANCHOR_SETTLE_SECONDS (a reset restarts the wait), and
 * - the head has stayed within HEAD_STILL_METERS for ANCHOR_SETTLE_SECONDS,
 *
 * or, at the latest, ANCHOR_SETTLE_CAP_SECONDS after the session began (a
 * player who never holds still still gets a layout), but never at the
 * tracking origin's placeholder pose (0, 0, 0).
 */

export const ANCHOR_SETTLE_SECONDS = 0.5;
export const HEAD_STILL_METERS = 0.02;
export const ANCHOR_SETTLE_CAP_SECONDS = 3;

type Point = { x: number; y: number; z: number };

export class AnchorSettle {
  private startedAt = 0;
  /** When the current still, reset-free stretch began, and the head then. */
  private stillSince = 0;
  private stillAt: Point | null = null;
  /** Resets seen while waiting (for the log). */
  resets = 0;

  /** A session began: wait from now. */
  start(now: number): void {
    this.startedAt = now;
    this.stillSince = now;
    this.stillAt = null;
    this.resets = 0;
  }

  /** The reference space was reset: the wait starts over. */
  onReset(now: number): void {
    this.resets++;
    this.stillSince = now;
    this.stillAt = null;
  }

  /** Each frame while waiting, with the head's position: true once the anchor may be taken. */
  sample(now: number, head: Point): boolean {
    const atOrigin = head.x * head.x + head.y * head.y + head.z * head.z < 1e-6;
    if (atOrigin) {
      return false;
    }
    if (!this.stillAt || Math.hypot(head.x - this.stillAt.x, head.y - this.stillAt.y, head.z - this.stillAt.z) > HEAD_STILL_METERS) {
      this.stillAt = { x: head.x, y: head.y, z: head.z };
      this.stillSince = now;
    }
    return now - this.stillSince >= ANCHOR_SETTLE_SECONDS || now - this.startedAt >= ANCHOR_SETTLE_CAP_SECONDS;
  }

  /** Seconds since the session began (for the log). */
  waited(now: number): number {
    return now - this.startedAt;
  }
}

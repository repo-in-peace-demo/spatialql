/**
 * Background builds, a little per frame: slab documents for the puzzles and
 * datasets the player may go to next (the previous and next puzzle, their
 * datasets' tables and result slabs), built ahead so a load, a switch or a
 * join never builds a whole document in one frame. A job's steps are small
 * (a document's start, one cell, its finish) and each job starts on its
 * first step, so queuing costs nothing. The join system runs the queue only
 * once nothing has moved for a moment, for at most BUILD_BUDGET_MS of real
 * time per frame (at least one step), and not at all once it's empty.
 * Jobs run in the order added; `urgent` ones go first.
 */

/** Real time (ms) the queue may use per frame (one step can run over: a step is one cell, or a document's start). */
export const BUILD_BUDGET_MS = 2;

export type BuildJob = {
  /** For the log. */
  readonly name: string;
  /** Takes steps until `deadlineMs` (performance.now()); true once done. */
  step(deadlineMs: number): boolean;
};

class BuildQueue {
  private readonly jobs: BuildJob[] = [];
  /** Dev: the jobs finished, with how many frames each took (read by the log). */
  readonly finished: { name: string; frames: number; ms: number }[] = [];
  private readonly started = new Map<BuildJob, { frames: number; ms: number }>();

  add(job: BuildJob, urgent = false): void {
    if (this.jobs.includes(job)) {
      return;
    }
    if (urgent) {
      this.jobs.unshift(job);
    } else {
      this.jobs.push(job);
    }
  }

  /** Whether `job` is still waiting or in progress. */
  has(job: BuildJob): boolean {
    return this.jobs.includes(job);
  }

  remove(job: BuildJob): void {
    const index = this.jobs.indexOf(job);
    if (index >= 0) {
      this.jobs.splice(index, 1);
      this.started.delete(job);
    }
  }

  get pending(): number {
    return this.jobs.length;
  }

  /** One frame's share: steps until the budget is spent. */
  run(budgetMs = BUILD_BUDGET_MS): void {
    if (this.jobs.length === 0) {
      return;
    }
    const start = performance.now();
    const deadline = start + budgetMs;
    while (this.jobs.length > 0) {
      const job = this.jobs[0];
      const before = performance.now();
      const done = job.step(deadline);
      const stats = this.started.get(job) ?? { frames: 0, ms: 0 };
      stats.frames += done ? 0 : 1;
      stats.ms += performance.now() - before;
      this.started.set(job, stats);
      if (done) {
        this.jobs.shift();
        this.started.delete(job);
        if (import.meta.env.DEV) {
          this.finished.push({ name: job.name, frames: stats.frames + 1, ms: stats.ms });
        }
      }
      if (performance.now() >= deadline) {
        break;
      }
    }
  }
}

export const buildQueue = new BuildQueue();

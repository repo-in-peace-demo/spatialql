import { describe, expect, it } from 'vitest';
import { buildQueue, type BuildJob } from './build-queue.js';

/** A job that finishes on its first step, recording the order it ran in. */
function job(name: string, ran: string[]): BuildJob {
  return {
    name,
    step: () => {
      ran.push(name);
      return true;
    },
  };
}

describe('the build queue', () => {
  it('releases (last) run only after every build, even builds added after them', () => {
    const ran: string[] = [];
    buildQueue.add(job('build a', ran));
    buildQueue.add(job('release x', ran), 'last');
    buildQueue.add(job('build b', ran));
    buildQueue.add(job('release y', ran), 'last');
    buildQueue.add(job('urgent c', ran), 'urgent');
    while (buildQueue.pending > 0) {
      buildQueue.run(Infinity);
    }
    expect(ran).toEqual(['urgent c', 'build a', 'build b', 'release x', 'release y']);
  });
});

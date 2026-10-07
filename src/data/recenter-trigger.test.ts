import { describe, expect, it } from 'vitest';
import { RECENTER_AFTER_HIDDEN_SECONDS, RECENTER_MERGE_SECONDS, RecenterTrigger } from '../recenter-trigger.js';

const S = 1000;

describe('recenter triggers', () => {
  it('the headset back on after the threshold re-places; a shorter spell does not', () => {
    const short = new RecenterTrigger();
    short.onVisibility('hidden', 0);
    expect(short.onVisibility('visible', (RECENTER_AFTER_HIDDEN_SECONDS - 0.1) * S)).toBe(false);
    expect(short.poll(false)).toBeNull();

    const long = new RecenterTrigger();
    long.onVisibility('hidden', 0);
    expect(long.onVisibility('visible', (RECENTER_AFTER_HIDDEN_SECONDS + 0.1) * S)).toBe(true);
    expect(long.lastHiddenMs).toBe((RECENTER_AFTER_HIDDEN_SECONDS + 0.1) * S);
    expect(long.poll(false)).toBe('headset-on');
    expect(long.poll(false)).toBeNull();
  });

  it('a blurred spell (a system menu) never counts', () => {
    const trigger = new RecenterTrigger();
    trigger.onVisibility('visible-blurred', 0);
    expect(trigger.onVisibility('visible', 60 * S)).toBe(false);
    // Hidden, then blurred, then visible: the hidden spell runs until visible.
    trigger.onVisibility('hidden', 100 * S);
    trigger.onVisibility('visible-blurred', 101 * S);
    expect(trigger.onVisibility('visible', 110 * S)).toBe(true);
  });

  it('a recenter (reset) re-places; triggers within the merge window run once', () => {
    const trigger = new RecenterTrigger();
    trigger.onVisibility('hidden', 0);
    expect(trigger.onVisibility('visible', 10 * S)).toBe(true);
    expect(trigger.onReset(10 * S + 200)).toBe(false);
    expect(trigger.poll(false)).toBe('headset-on');
    expect(trigger.poll(false)).toBeNull();
    expect(trigger.onReset((10 + RECENTER_MERGE_SECONDS + 1) * S)).toBe(true);
    expect(trigger.poll(false)).toBe('reset');
  });

  it('waits while blocked (a slab is held), then runs once', () => {
    const trigger = new RecenterTrigger();
    trigger.request('button', 0);
    expect(trigger.poll(true)).toBeNull();
    expect(trigger.waiting).toBe(true);
    expect(trigger.poll(true)).toBeNull();
    expect(trigger.poll(false)).toBe('button');
    expect(trigger.poll(false)).toBeNull();
  });

  it('the button always queues, even right after another trigger', () => {
    const trigger = new RecenterTrigger();
    expect(trigger.onReset(0)).toBe(true);
    trigger.poll(false);
    expect(trigger.request('button', 100)).toBe(true);
    expect(trigger.poll(false)).toBe('button');
  });

  it('a session end forgets everything', () => {
    const trigger = new RecenterTrigger();
    trigger.onVisibility('hidden', 0);
    trigger.request('button', 0);
    trigger.reset();
    expect(trigger.poll(false)).toBeNull();
    expect(trigger.onVisibility('visible', 60 * S)).toBe(false);
  });
});

/**
 * Dev-only `?seated=1`: lowers the emulated headset to a seated eye height,
 * since SpatialQL is designed for seated use but the emulator starts
 * standing (~1.6 m). Only imported behind `import.meta.env.DEV`, so it never
 * reaches production builds, and it does nothing on a real headset.
 *
 * The emulator (IWER) keeps its emulated device on the `navigator.xr`
 * polyfill under a private symbol-keyed field. That isn't a public API, so
 * this looks it up defensively and, if it can't find it, says how to lower
 * the headset by hand instead of failing.
 */

import { VisibilityState, type World } from '@iwsdk/core';

const SEATED_EYE_HEIGHT_METERS = 1.2;
const LOG_PREFIX = '[seated]';

type EmulatedVector = { x: number; y: number; z: number; set?: (x: number, y: number, z: number) => unknown };
type EmulatedDevice = { position: EmulatedVector };

function findEmulatedDevice(): EmulatedDevice | null {
  const xr = (navigator as Navigator & { xr?: object }).xr as Record<symbol, unknown> | undefined;
  if (!xr) {
    return null;
  }
  for (const key of Object.getOwnPropertySymbols(xr)) {
    const internal = xr[key] as { device?: { position?: EmulatedVector } } | undefined;
    const position = internal?.device?.position;
    if (position && typeof position.y === 'number') {
      return internal!.device as EmulatedDevice;
    }
  }
  return null;
}

function applySeatedHeight(): boolean {
  const device = findEmulatedDevice();
  if (!device) {
    return false;
  }
  const { x, z } = device.position;
  if (typeof device.position.set === 'function') {
    device.position.set(x, SEATED_EYE_HEIGHT_METERS, z);
  } else {
    device.position.y = SEATED_EYE_HEIGHT_METERS;
  }
  return true;
}

/** Applies seated height now (before any session) and again at each session start. */
export function installSeatedHead(world: World): void {
  if (applySeatedHeight()) {
    console.info(`${LOG_PREFIX} emulated headset lowered to ${SEATED_EYE_HEIGHT_METERS} m eye height`);
  } else {
    console.warn(
      `${LOG_PREFIX} couldn't reach the emulated headset (not running in the IWSDK emulator, or its ` +
        `internals changed). Lower the headset by hand to about ${SEATED_EYE_HEIGHT_METERS} m instead: ` +
        `with the emulator's headset controls, or the IWSDK CLI's xr pose commands ` +
        `(npx @iwsdk/cli xr --help).`,
    );
    return;
  }
  world.visibilityState.subscribe((state) => {
    if (state !== VisibilityState.NonImmersive) {
      applySeatedHeight();
    }
  });
}

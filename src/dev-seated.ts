/**
 * Dev-only `seated` flag: lowers the emulated headset to a seated eye height
 * and pitches it down to the natural seated gaze (NATURAL_GAZE_PITCH_DEG),
 * since SpatialQL is designed for seated use but the emulator starts
 * standing (~1.6 m) and looking level. Only imported behind
 * `import.meta.env.DEV`, so it never reaches production builds, and it does
 * nothing on a real headset. Placement doesn't depend on the pitch (it uses
 * the natural gaze constant); this only makes the emulator view match how a
 * seated user looks.
 *
 * The emulator (IWER) keeps its emulated device on the `navigator.xr`
 * polyfill under a private symbol-keyed field. That isn't a public API, so
 * this looks it up defensively and, if it can't find it, says how to set
 * the headset by hand instead of failing.
 */

import { Euler, MathUtils, Quaternion, Vector3, VisibilityState, type World } from '@iwsdk/core';
import { NATURAL_GAZE_PITCH_DEG, NATURAL_GAZE_PITCH_RAD } from './view-comfort.js';

const SEATED_EYE_HEIGHT_METERS = 1.2;
const LOG_PREFIX = '[seated]';

type EmulatedVector = { x: number; y: number; z: number; set?: (x: number, y: number, z: number) => unknown };
type EmulatedQuaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
  set?: (x: number, y: number, z: number, w: number) => unknown;
};
type EmulatedDevice = { position: EmulatedVector; quaternion?: EmulatedQuaternion };

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

function isQuaternion(value: EmulatedQuaternion | undefined): value is EmulatedQuaternion {
  return (
    !!value &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.z === 'number' &&
    typeof value.w === 'number'
  );
}

/** Pitches the device down to the natural gaze, keeping its yaw. Returns false if it can't. */
function applyGazePitch(device: EmulatedDevice): boolean {
  const current = device.quaternion;
  if (!isQuaternion(current)) {
    return false;
  }
  const euler = new Euler().setFromQuaternion(new Quaternion(current.x, current.y, current.z, current.w), 'YXZ');
  euler.set(-NATURAL_GAZE_PITCH_RAD, euler.y, 0, 'YXZ');
  const q = new Quaternion().setFromEuler(euler);
  if (typeof current.set === 'function') {
    current.set(q.x, q.y, q.z, q.w);
  } else {
    current.x = q.x;
    current.y = q.y;
    current.z = q.z;
    current.w = q.w;
  }
  return true;
}

/** Applies seated height and gaze pitch; reports what it could set. */
function applySeated(): { found: boolean; pitched: boolean } {
  const device = findEmulatedDevice();
  if (!device) {
    return { found: false, pitched: false };
  }
  const { x, z } = device.position;
  if (typeof device.position.set === 'function') {
    device.position.set(x, SEATED_EYE_HEIGHT_METERS, z);
  } else {
    device.position.y = SEATED_EYE_HEIGHT_METERS;
  }
  return { found: true, pitched: applyGazePitch(device) };
}

/** Applies the seated pose now (before any session) and again at each session start. */
export function installSeatedHead(world: World): void {
  const result = applySeated();
  if (!result.found) {
    console.warn(
      `${LOG_PREFIX} couldn't reach the emulated headset (not running in the IWSDK emulator, or its ` +
        `internals changed). Set the headset by hand instead: about ${SEATED_EYE_HEIGHT_METERS} m eye height, ` +
        `pitched ${NATURAL_GAZE_PITCH_DEG}° down, with the emulator's headset controls or the IWSDK CLI's xr ` +
        `pose commands (npx @iwsdk/cli xr --help).`,
    );
    return;
  }
  // "Requested", not "done": whether it took is only known once a session
  // renders from it (see verifySeatedPose).
  console.info(`${LOG_PREFIX} requested ${SEATED_EYE_HEIGHT_METERS} m eye height`);
  if (result.pitched) {
    console.info(`${LOG_PREFIX} requested ${NATURAL_GAZE_PITCH_DEG}° down pitch (natural seated gaze)`);
  } else {
    console.warn(
      `${LOG_PREFIX} couldn't set the emulated headset's pitch. Pitch it ${NATURAL_GAZE_PITCH_DEG}° down by hand: ` +
        `the emulator's headset controls (rotation X = -${NATURAL_GAZE_PITCH_DEG}), or ` +
        `npx @iwsdk/cli xr set-transform --input-json '{"device":"headset","orientation":{"pitch":-${NATURAL_GAZE_PITCH_DEG}}}'.`,
    );
  }
  world.visibilityState.subscribe((state) => {
    if (state !== VisibilityState.NonImmersive) {
      applySeated();
      // Something may reset the emulated pose as the session starts, so
      // apply again shortly after, then read back what the app actually sees.
      setTimeout(applySeated, RETRY_DELAY_MS);
      setTimeout(() => verifySeatedPose(world), VERIFY_DELAY_MS);
    }
  });
}

const RETRY_DELAY_MS = 300;
const VERIFY_DELAY_MS = 800;
const HEIGHT_TOLERANCE_METERS = 0.03;
const PITCH_TOLERANCE_DEG = 2;

/**
 * Reads the head pose the app actually renders from and says plainly whether
 * the seated pose took; if not, gives the exact manual step.
 */
function verifySeatedPose(world: World): void {
  if (world.visibilityState.peek() === VisibilityState.NonImmersive) {
    return;
  }
  const head = world.player.head;
  head.updateWorldMatrix(true, false);
  const position = new Vector3().setFromMatrixPosition(head.matrixWorld);
  const euler = new Euler().setFromQuaternion(new Quaternion().setFromRotationMatrix(head.matrixWorld), 'YXZ');
  const pitchDownDeg = -MathUtils.radToDeg(euler.x);
  const heightOk = Math.abs(position.y - SEATED_EYE_HEIGHT_METERS) <= HEIGHT_TOLERANCE_METERS;
  const pitchOk = Math.abs(pitchDownDeg - NATURAL_GAZE_PITCH_DEG) <= PITCH_TOLERANCE_DEG;
  if (heightOk && pitchOk) {
    console.info(
      `${LOG_PREFIX} verified: head at ${position.y.toFixed(2)} m, pitched ${pitchDownDeg.toFixed(1)}° down`,
    );
    return;
  }
  console.warn(
    `${LOG_PREFIX} the seated pose did NOT take: head at ${position.y.toFixed(2)} m (want ` +
      `${SEATED_EYE_HEIGHT_METERS}), pitched ${pitchDownDeg.toFixed(1)}° down (want ${NATURAL_GAZE_PITCH_DEG}). ` +
      `Set it by hand in the emulator's headset panel (Pos Y = ${SEATED_EYE_HEIGHT_METERS}, Rot X = ` +
      `-${NATURAL_GAZE_PITCH_DEG}), or run: npx @iwsdk/cli xr set-transform --input-json ` +
      `'{"device":"headset","position":{"x":0,"y":${SEATED_EYE_HEIGHT_METERS},"z":0},"orientation":{"pitch":-${NATURAL_GAZE_PITCH_DEG}}}'`,
  );
}

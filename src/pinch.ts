/**
 * Hand-joint positions in world space, for pinch hit tests (the join
 * control, NULL cells, the puzzle bar). Allocation-free.
 */

import type { Object3D, Vector3, World } from '@iwsdk/core';

const PINCH_JOINTS: readonly XRHandJoint[] = ['thumb-tip', 'index-finger-tip'];
const WRIST_JOINT: readonly XRHandJoint[] = ['wrist'];

/**
 * Writes the average world position of `joints` on `source`'s hand into
 * `out`; false if the hand or a joint isn't tracked this frame. Joint poses
 * are in the XR reference space, which the player rig carries.
 */
export function readJointsPoint(
  world: World,
  player: Object3D,
  source: XRInputSource,
  joints: readonly XRHandJoint[],
  out: Vector3,
): boolean {
  const frame = world.xrFrame;
  const space = world.xrReferenceSpace;
  if (!frame || !space || !source.hand || !frame.getJointPose) {
    return false;
  }
  out.set(0, 0, 0);
  for (const name of joints) {
    const joint = source.hand.get(name);
    const pose = joint ? frame.getJointPose(joint, space) : undefined;
    if (!pose) {
      return false;
    }
    const p = pose.transform.position;
    out.x += p.x / joints.length;
    out.y += p.y / joints.length;
    out.z += p.z / joints.length;
  }
  player.updateWorldMatrix(true, false);
  out.applyMatrix4(player.matrixWorld);
  return true;
}

/**
 * `source`'s target ray this frame, straight from the XR frame (world space:
 * origin into `origin`, unit direction into `dir`); false when the platform
 * reports no pose for it (tracking lost). Unlike the player rig's ray space,
 * which keeps its last pose, a missing pose shows here.
 */
export function readTargetRay(world: World, player: Object3D, source: XRInputSource, origin: Vector3, dir: Vector3): boolean {
  const frame = world.xrFrame;
  const space = world.xrReferenceSpace;
  if (!frame || !space) {
    return false;
  }
  const pose = frame.getPose(source.targetRaySpace, space);
  if (!pose) {
    return false;
  }
  // Column-major: translation in 12-14, the local -Z axis is -(8, 9, 10).
  const m = pose.transform.matrix;
  player.updateWorldMatrix(true, false);
  origin.set(m[12], m[13], m[14]).applyMatrix4(player.matrixWorld);
  dir.set(-m[8], -m[9], -m[10]).transformDirection(player.matrixWorld);
  return true;
}

/** World-space midpoint of the thumb and index fingertips. */
export function readPinchPoint(world: World, player: Object3D, source: XRInputSource, out: Vector3): boolean {
  return readJointsPoint(world, player, source, PINCH_JOINTS, out);
}

/** World-space wrist position (for the palm-to-slab readout). */
export function readWristPoint(world: World, player: Object3D, source: XRInputSource, out: Vector3): boolean {
  return readJointsPoint(world, player, source, WRIST_JOINT, out);
}

/** The index finger's joints, knuckle to tip, one per lookup (no allocation per call). */
const INDEX_CHAIN: readonly (readonly XRHandJoint[])[] = [
  ['index-finger-metacarpal'],
  ['index-finger-phalanx-proximal'],
  ['index-finger-phalanx-intermediate'],
  ['index-finger-phalanx-distal'],
  ['index-finger-tip'],
];

/**
 * How straight the index finger is: the knuckle-to-tip distance over the
 * length along its joints (1 = fully straight; a curled finger is well
 * under 0.8). Null if the hand or a joint isn't tracked (e.g. controllers).
 * Uses `a` and `b` as scratch.
 */
export function indexStraightness(
  world: World,
  player: Object3D,
  source: XRInputSource,
  a: Vector3,
  b: Vector3,
): number | null {
  if (!readJointsPoint(world, player, source, INDEX_CHAIN[0], a)) {
    return null;
  }
  const startX = a.x;
  const startY = a.y;
  const startZ = a.z;
  let along = 0;
  for (let i = 1; i < INDEX_CHAIN.length; i++) {
    if (!readJointsPoint(world, player, source, INDEX_CHAIN[i], b)) {
      return null;
    }
    along += a.distanceTo(b);
    a.copy(b);
  }
  const straight = Math.hypot(a.x - startX, a.y - startY, a.z - startZ);
  return along > 1e-4 ? straight / along : null;
}

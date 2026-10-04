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

/** World-space midpoint of the thumb and index fingertips. */
export function readPinchPoint(world: World, player: Object3D, source: XRInputSource, out: Vector3): boolean {
  return readJointsPoint(world, player, source, PINCH_JOINTS, out);
}

/** World-space wrist position (for the palm-to-slab readout). */
export function readWristPoint(world: World, player: Object3D, source: XRInputSource, out: Vector3): boolean {
  return readJointsPoint(world, player, source, WRIST_JOINT, out);
}

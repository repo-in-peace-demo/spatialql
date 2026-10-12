/**
 * The Recenter button's prompt: "Look straight ahead" with a ring filling
 * over the countdown (recenter-countdown.ts), centered in view. Transient
 * and small, so it follows the head (it must be seen wherever the player
 * looks when they press Recenter); never a target.
 */

import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  UIKit,
  UIKitDocument,
  type Object3D,
  type World,
} from '@iwsdk/core';
import { BAR } from './data/copy.js';
import { FONT_FAMILIES } from './table-slab-view.js';
import { fontCmForAngle } from './text-angles.js';

/** How far in front of the eyes it floats. */
const PROMPT_DISTANCE_METERS = 0.7;
/** Its text, by angle (a little larger than row text: it's read at a glance). */
const PROMPT_TEXT_DEG = 1.6;
const RING_INNER_METERS = 0.022;
const RING_OUTER_METERS = 0.027;
const RING_SEGMENTS = 48;
/** The label sits this far below the ring's center. */
const LABEL_BELOW_METERS = 0.05;
const COLOR_RING = '#d08a1e';
const COLOR_RING_TRACK = '#ffffff';
const COLOR_LABEL = '#3d382e';
const COLOR_LABEL_TEXT = '#f7f4ee';

export class RecenterPrompt {
  private readonly root = new Group();
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;

  constructor(world: World) {
    this.root.name = 'recenter-prompt';
    this.root.visible = false;
    // The track (faint, whole), then the ring filling clockwise from the top (mirrored in x).
    const track = new Mesh(
      new RingGeometry(RING_INNER_METERS, RING_OUTER_METERS, RING_SEGMENTS),
      new MeshBasicMaterial({ color: new Color(COLOR_RING_TRACK), transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }),
    );
    this.ring = new Mesh(
      new RingGeometry(RING_INNER_METERS, RING_OUTER_METERS, RING_SEGMENTS, 1, Math.PI / 2, Math.PI * 2),
      new MeshBasicMaterial({ color: new Color(COLOR_RING), transparent: true, depthTest: false, depthWrite: false, side: DoubleSide }),
    );
    this.ring.scale.x = -1;
    for (const mesh of [track, this.ring] as Object3D[]) {
      mesh.raycast = () => {};
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.root.add(mesh);
    }
    const fontCm = fontCmForAngle(PROMPT_TEXT_DEG, PROMPT_DISTANCE_METERS);
    const label = new UIKit.Container({
      anchorX: 'center',
      anchorY: 'center',
      paddingX: fontCm * 0.7,
      paddingY: fontCm * 0.35,
      backgroundColor: COLOR_LABEL,
      borderRadius: fontCm,
      fontFamilies: FONT_FAMILIES,
      pointerEvents: 'none',
    });
    label.add(new UIKit.Text({ text: BAR.recenterPrompt, fontSize: fontCm, fontWeight: 'bold', color: COLOR_LABEL_TEXT }));
    const document = new UIKitDocument(label);
    document.position.set(0, -LABEL_BELOW_METERS, 0);
    this.root.add(document);
    // Persistent (under the scene root, not the level's): it shows while the layout is hidden at a session's start.
    world.createTransformEntity(this.root, { persistent: true });
  }

  /** Shown at `progress` (0-1), in front of the head (its world pose). */
  show(head: Object3D, progress: number): void {
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this.root.position);
    head.getWorldQuaternion(this.root.quaternion);
    this.root.translateZ(-PROMPT_DISTANCE_METERS);
    this.ring.geometry.setDrawRange(0, 6 * Math.max(1, Math.ceil(RING_SEGMENTS * Math.min(1, progress))));
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }
}

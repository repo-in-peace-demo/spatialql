/**
 * The reach banner ("Move closer, or hold Recenter."): a small label, never
 * a target. The join system places it -- in the gap between the source
 * slabs' rows and the result's rows, slightly in front of both, scaled to
 * fit (`placeInGap`), or, when that gap is too small, semi-transparent just
 * below the layout anchor's gaze (`placeBelowAnchor`), fixed while the head moves. It pulses gently
 * while shown and fades in and out.
 */

import { computed, signal, UIKit, UIKitDocument, type Object3D, type Quaternion, type Vector3, type World } from '@iwsdk/core';
import { BAR } from './data/copy.js';
import { FONT_FAMILIES, measureHeaderTextCm } from './table-slab-view.js';

/** The banner as built (UIKit units = cm); `placeInGap` scales it. */
const FONT_CM = 1.6;
const PADDING_X_CM = FONT_CM * 0.8;
const PADDING_Y_CM = FONT_CM * 0.3;
const LINE_HEIGHT = 1.2;
const COLOR_FILL = '#3d382e';
const COLOR_TEXT = '#f7f4ee';
/** The fallback below the gaze: how far, how far down (degrees), and how opaque. */
const BELOW_GAZE_DISTANCE_METERS = 0.6;
const BELOW_GAZE_DEG = 9;
const BELOW_GAZE_OPACITY = 0.7;
const FADE_SECONDS = 0.25;
/** The pulse: opacity between 1 - PULSE_DEPTH and 1, this often. */
const PULSE_DEPTH = 0.18;
const PULSE_HZ = 0.7;

export class ReachBanner {
  /** The banner's height and width as built (meters, before scaling). */
  readonly heightMeters = (FONT_CM * LINE_HEIGHT + 2 * PADDING_Y_CM) / 100;
  readonly widthMeters: number;
  /** Its text as built (meters): the scale times this is its text height. */
  readonly fontMeters = FONT_CM / 100;
  readonly document: UIKitDocument;
  private readonly fade = signal(0);
  private readonly pulse = signal(1);
  private readonly maxOpacity = signal(1);
  private target = 0;
  private clock = 0;

  constructor(world: World) {
    const widthCm = measureHeaderTextCm(BAR.moveCloser, FONT_CM) + 2 * PADDING_X_CM;
    this.widthMeters = widthCm / 100;
    const opacity = computed(() => this.fade.value * this.pulse.value * this.maxOpacity.value);
    const root = new UIKit.Container({
      width: widthCm,
      height: this.heightMeters * 100,
      anchorX: 'center',
      anchorY: 'center',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: COLOR_FILL,
      borderRadius: (this.heightMeters * 100) / 2,
      opacity,
      fontFamilies: FONT_FAMILIES,
      pointerEvents: 'none',
    });
    root.add(new UIKit.Text({ text: BAR.moveCloser, fontSize: FONT_CM, fontWeight: 'bold', color: COLOR_TEXT, opacity, wordBreak: 'keep-all' }));
    this.document = new UIKitDocument(root);
    this.document.visible = false;
    this.document.renderOrder = 6;
    world.createTransformEntity(this.document);
  }

  get shown(): boolean {
    return this.target > 0;
  }

  show(): void {
    this.target = 1;
    this.document.visible = true;
  }

  hide(): void {
    this.target = 0;
  }

  /** In the gap: centered at `center`, facing the eyes (`quaternion`), scaled by `scale` (fully opaque). */
  placeInGap(center: Vector3, quaternion: Quaternion, scale: number): void {
    this.document.position.copy(center);
    this.document.quaternion.copy(quaternion);
    this.document.scale.setScalar(scale);
    this.maxOpacity.value = 1;
  }

  /** The fallback: BELOW_GAZE_DEG below the head's forward, BELOW_GAZE_DISTANCE_METERS away, semi-transparent. */
  placeBelowAnchor(eyes: Vector3, yaw: number): void {
    // The layout anchor's eyes and facing (layout-anchor.ts): it stays put as the head moves.
    this.document.position.copy(eyes);
    this.document.rotation.set((-BELOW_GAZE_DEG * Math.PI) / 180, yaw, 0, 'YXZ');
    this.document.translateZ(-BELOW_GAZE_DISTANCE_METERS);
    this.document.scale.setScalar(1);
    this.maxOpacity.value = BELOW_GAZE_OPACITY;
  }

  /** Each frame: fade toward shown or hidden, and pulse while shown. */
  update(delta: number): void {
    if (!this.document.visible) {
      return;
    }
    this.clock += delta;
    const step = delta / FADE_SECONDS;
    const fade = this.fade.peek();
    const next = this.target > fade ? Math.min(this.target, fade + step) : Math.max(this.target, fade - step);
    if (next !== fade) {
      this.fade.value = next;
    }
    this.pulse.value = 1 - PULSE_DEPTH * (0.5 - 0.5 * Math.cos(this.clock * 2 * Math.PI * PULSE_HZ));
    if (next === 0 && this.target === 0) {
      this.document.visible = false;
    }
  }
}

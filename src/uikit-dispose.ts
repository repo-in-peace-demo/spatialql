/**
 * Releasing a UIKit document for good. `entity.dispose()` frees an entity's
 * Object3D and GPU resources, but not UIKit's reactive effects: each UIKit
 * component keeps its own abort signal, and its effects (and everything
 * they hold) stay alive until that component's `dispose()`. Disposing only
 * the root doesn't reach the children. Measured 2026-10-12: about 6,300
 * leaked effect listeners per puzzle step, with per-frame work rising about
 * 40% over a session.
 *
 * So: every component in the tree, deepest first, then the document itself.
 * Call before `entity.dispose()` on any entity carrying a UIKit document.
 */

import type { Object3D, UIKitDocument } from '@iwsdk/core';
import { Component } from '@pmndrs/uikit';
import { buildQueue } from './build-queue.js';

export function disposeUIKitDocument(document: UIKitDocument | null | undefined): void {
  if (!document || document.disposed) {
    return;
  }
  const components: { dispose(): void }[] = [];
  document.traverse((object: Object3D) => {
    if (object instanceof Component) {
      components.push(object);
    }
  });
  // Children before parents (traverse lists parents first).
  for (let i = components.length - 1; i >= 0; i--) {
    components[i].dispose();
  }
  document.dispose();
}

/**
 * The same release, spread over frames: a document dropped from the cache
 * (a dataset no longer kept, a puzzle's outline) leaves the scene now --
 * hidden and detached, so nothing draws or updates it -- and its components
 * are disposed in the background build queue (BUILD_BUDGET_MS a frame),
 * then the document and its entity. Disposing a dataset's slabs in one go
 * measured 43 ms on a desktop and 280-390 ms on a Quest 3 (2026-10-14).
 */
export function disposeUIKitDocumentLater(
  name: string,
  document: UIKitDocument | null | undefined,
  entity?: { dispose(): void } | null,
): void {
  if (document && !document.disposed) {
    document.visible = false;
    document.removeFromParent();
  }
  let components: { dispose(): void }[] | null = null;
  buildQueue.add({
    name: `dispose ${name}`,
    step(deadlineMs: number): boolean {
      if (document && !document.disposed) {
        if (!components) {
          const found: { dispose(): void }[] = [];
          document.traverse((object: Object3D) => {
            if (object instanceof Component) {
              found.push(object);
            }
          });
          components = found;
          if (performance.now() >= deadlineMs) {
            return false;
          }
        }
        // Children before parents (traverse lists parents first), a few per frame.
        while (components.length > 0) {
          components.pop()!.dispose();
          if (performance.now() >= deadlineMs && components.length > 0) {
            return false;
          }
        }
        document.dispose();
      }
      entity?.dispose();
      return true;
    },
  }, 'last');
}

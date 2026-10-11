/**
 * Dev only (the `debug` flag): what's alive in the scene, for finding
 * per-frame work that builds up (2026-10-12: work rose from 7 to 10-11 ms
 * after stepping through all four datasets and never came back). Counts the
 * scene graph's objects (all, and those drawn: every ancestor visible), its
 * visible meshes, UIKit roots (a document's outermost component: one per
 * slab, card, bar or panel), and the renderer's last-frame draw calls and
 * live GPU geometries and textures, and the JS heap (a drop across a long
 * task points to garbage collection).
 */

import type { Object3D, WebGLRenderer } from '@iwsdk/core';
import { Component } from '@pmndrs/uikit';

/** The JS heap in use, MB (Chromium's `performance.memory`, the Quest Browser included), or null elsewhere. */
export function heapMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / 1_048_576 : null;
}

export type SceneCensus = {
  objects: number;
  visible: number;
  meshes: number;
  uikitRoots: number;
  uikitVisible: number;
  draws: number;
  triangles: number;
  geometries: number;
  textures: number;
};

export function sceneCensus(scene: Object3D, renderer: WebGLRenderer): SceneCensus {
  const census: SceneCensus = {
    objects: 0,
    visible: 0,
    meshes: 0,
    uikitRoots: 0,
    uikitVisible: 0,
    draws: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };
  const isRoot = (object: Object3D) => object instanceof Component && !(object.parent instanceof Component);
  scene.traverse((object) => {
    census.objects++;
    if (isRoot(object)) {
      census.uikitRoots++;
    }
  });
  scene.traverseVisible((object) => {
    census.visible++;
    if ((object as { isMesh?: boolean }).isMesh) {
      census.meshes++;
    }
    if (isRoot(object)) {
      census.uikitVisible++;
    }
  });
  return census;
}

export function censusText(census: SceneCensus): string {
  return (
    `objects ${census.objects} (${census.visible} visible), meshes ${census.meshes} visible, ` +
    `UIKit roots ${census.uikitRoots} (${census.uikitVisible} visible), ` +
    `draws ${census.draws} (${census.triangles} triangles), geometries ${census.geometries}, textures ${census.textures}` +
    heapText()
  );
}

/** `, heap 123.4 MB`, or nothing where the heap isn't reported. */
export function heapText(): string {
  const heap = heapMb();
  return heap === null ? '' : `, heap ${heap.toFixed(1)} MB`;
}

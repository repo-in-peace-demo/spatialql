/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createComponent, Types } from '@iwsdk/core';

/** Identifies which data table a slab entity renders. */
export const TableSlab = createComponent('TableSlab', {
  tableId: { type: Types.String, default: '' },
});

/**
 * Live render-side state for a slab entity, mirroring the SDK's own
 * `PanelDocument` pattern of storing a live object reference on a component.
 *
 * `document` is the slab's `UIKitDocument` (also the entity's `object3D`).
 * `rowViews` is a `Map<number, RowView>` (see `table-slab-view.ts`) keyed by
 * row index into the source `Table`, ready for a future animation system to
 * look up a specific row's `Container`/`Text` nodes from `JoinResult`
 * lineage.
 */
export const TableSlabRuntime = createComponent('TableSlabRuntime', {
  document: { type: Types.Object, default: undefined },
  rowViews: { type: Types.Object, default: undefined },
});

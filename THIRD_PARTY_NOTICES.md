# Third-party notices

SpatialQL is built on the open-source software and fonts below. Each keeps its own license; the full texts ship with each package (in `node_modules/<package>/LICENSE` after `npm install`) and at the linked projects. Versions are those in `package-lock.json` at the time of writing.

## Shipped in the app

These are bundled into the production build.

| Component | Version | License | Project |
| --- | --- | --- | --- |
| Immersive Web SDK (`@iwsdk/core`, `@iwsdk/xr-input`, `@iwsdk/locomotor`) | 1.0.0-rc.2 | MIT | <https://github.com/facebook/immersive-web-sdk> |
| Three.js, as `super-three` (installed under the name `three`) | 0.181.0 | MIT | <https://threejs.org/> |
| pmndrs UIKit (`@pmndrs/uikit`, `@pmndrs/uikit-horizon`) | 1.0.76 | MIT | <https://github.com/pmndrs/uikit> |
| `@pmndrs/uikit-lucide` (Lucide icons for UIKit) | 1.0.76 | MIT | <https://github.com/pmndrs/uikit> |
| `@pmndrs/pointer-events` | 6.6.30 | MIT | <https://github.com/pmndrs/xr> |
| `@pmndrs/msdfonts` (fonts in MSDF format; see Fonts below) | 1.0.76 | MIT (code); the fonts keep their own licenses | <https://github.com/pmndrs/uikit> |
| Lucide icons (the in-XR icons, and the welcome page's icons, copied as SVG markup into `src/welcome-icons.ts`) | 0.468.0 | ISC | <https://lucide.dev> |
| Yoga layout (used by UIKit) | 3.2.1 | MIT | <https://yogalayout.dev/> |
| Preact Signals (`@preact/signals-core`) | 1.14.4 | MIT | <https://github.com/preactjs/signals> |
| EliCS (the ECS under IWSDK) | 3.4.2 | MIT | <https://github.com/elixr-games/elics> |
| Havok Physics for the web (`@babylonjs/havok`; IWSDK's physics runtime, included in the build) | 1.3.14 | MIT | <https://www.npmjs.com/package/@babylonjs/havok> |

## Fonts

| Font | Where | License | Project |
| --- | --- | --- | --- |
| Inter | `src/fonts/inter-latin-var.woff2` (the welcome page); its license sits beside it in `src/fonts/Inter-OFL.txt` | SIL Open Font License 1.1 | <https://github.com/rsms/inter> |
| Inter (MSDF) | the in-XR text, via `@pmndrs/msdfonts` | SIL Open Font License 1.1 | <https://github.com/rsms/inter> |
| Fira Code (MSDF) | the in-XR monospaced text, via `@pmndrs/msdfonts` | SIL Open Font License 1.1 | <https://github.com/tonsky/FiraCode> |

## Used only to develop and test (not shipped)

| Tool | Version | License |
| --- | --- | --- |
| `@iwsdk/cli`, `@iwsdk/vite-plugin-dev` | 1.0.0-rc.2 | MIT |
| IWER, the Immersive Web Emulation Runtime (dev only) | 2.5.0 | MIT |
| Vite | 7.3.6 | MIT |
| Vitest | 3.2.7 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| Playwright (used by the IWSDK dev tools) | 1.63.0 | Apache-2.0 |

## Not third-party

All sounds are synthesized at runtime with Web Audio (no audio files). All puzzle data (customers, orders, books, borrowers, clubs, students, drinks and tickets) is fictional and written for this project.

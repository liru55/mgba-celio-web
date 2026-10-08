# UI architecture

The initial screen has one primary action: select a local ROM. After loading, the canvas is central and the toolbar groups files, gameplay and system controls. Audio uses a small toolbar popover. Save export, screenshots and cheats remain available in settings.

Settings have eight categories. Celio has its own dialog, with local/online entry points, a room number and a status badge. Dangerous actions use the shared danger style.

`index.html` owns structure and preserves existing control IDs. `styles.css` contains CSS variables and shared native Button, Toggle, Slider, Select, Dialog, Tabs, Tooltip and StatusBadge patterns. `ui.js` owns touch visibility and Celio presentation. `app.js` only adds UI routing/audio synchronization and separated default pad layout. `link-session.js` emits `celio:state` for presentation; cable transport and core behavior remain unchanged.

Desktop uses a centered canvas with a compact toolbar. Portrait places the pad below the canvas; landscape reserves side gutters. Existing customized overlay positions remain valid. Fullscreen retains the toolbar and a visible exit. Safe areas and 44px touch targets apply throughout.

Regression checks: `test-browser.cjs`, `test-quick-layout.cjs`, `test-celio-core.cjs`, and optional `CELIO_ONLINE=1 node web/test-celio-online.cjs`. Tests use synthetic ROMs, never personal ROMs or saves.

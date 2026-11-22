# MotionDesign.ad Projection Cabinet

The Lite Version opens `public/projection-cabinet/site-web/index.html`. The presentation room opens `public/projection-cabinet/site/index.html` at its authored 1728 × 608 resolution. Both folders can be served by any static HTTP server. Hashes such as `#ui/search` work on direct visits and refreshes.

`/studio` redirects existing visitors to the responsive edition. Existing format, industry, film, theater, case study and brief links resolve to the corresponding cabinet pages. The lounge uses a poster until its TV iframe is ready. Its room-only controls live in `src/runtime/presentation/LiveStudioSurface.ts` and `public/projection-cabinet/lounge-bridge.js`.

Edit the catalogue and settings in `scripts/projection-cabinet/data/`, then run `npm run cabinet:build` to regenerate both copies of `js/content.generated.js`. Apply changes to shared JS, CSS, vendors and art to both editions. Only the browser edition links `css/web.css`, after the shared styles. Run `node scripts/projection-cabinet/build.mjs --check` to check parity, catalogue links and asset hydration.

The supplied catalogue contains 50 concept films. Playback and brief submission use the media URLs and brief endpoint configured in the data. The included settings have no remote submission endpoint.

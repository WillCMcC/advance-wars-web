# Field Kit project guide

This repository powers the private Tailnet app `https://mew.tail79fee7.ts.net:10443` (legacy
CapRover app slug `advance-wars`). It is a vanilla browser PWA served by a bounded Node HTTP
runtime. EmulatorJS 4.2.3 and its mGBA core are installed from integrity-pinned npm packages during
the build.

The game images and personal seed save are owner-provided data. Never commit, base64-encode,
patch, screenshot-extract, log, or otherwise place them in Git. `config/games.json` is the source
of truth for exact sizes and SHA-256 identities. Local builds require `ADVANCE_WARS_ROM`,
`EMERALD_ROGUE_ROM`, and `EMERALD_ROGUE_SAVE`; the post-merge release keeps mode-0600 copies under
`~/.local/share/field-kit/`.

Required gate:

```bash
npm ci --omit=optional
npm test
ADVANCE_WARS_ROM=/absolute/path/to/aw2.gba \
EMERALD_ROGUE_ROM=/absolute/path/to/emerald-rogue.gba \
EMERALD_ROGUE_SAVE=/absolute/path/to/emerald-rogue.srm npm run build
npm run test:build
CI=1 npm run test:e2e
```

`bin/release.sh` is the only production entry point and must be staged through Brain's deploy train.
Do not push, deploy, alter Tailscale Serve, or register the CapRover app directly from a task
worktree. After release, verify `/healthz`, `/api/healthz`, `/version.json`,
`/game-manifest.json`, both ROM byte-range headers, an opaque save-sync lifecycle, and a real
browser boot for both games.

Save-sync capabilities must remain in URL fragments and local browser storage. The server may
persist only ciphertext, authorization hashes, opaque channel/game IDs, revisions, timestamps, and
bounded size/timing metadata. Keep AES-GCM keys and plaintext saves client-only; require same-origin
mutations and optimistic revision guards. Service workers must bypass `/api/` and never cache seed
saves.

Keep the interface phone-safe at 320 px, preserve 44 px touch targets, and test portrait and
landscape. Do not depend on undocumented EmulatorJS APIs for required behavior. Preserve the local
CSP and all GPL/MPL/MIT notices when updating the emulator or QR renderer.

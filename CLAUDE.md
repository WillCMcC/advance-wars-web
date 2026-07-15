# Advance Wars Web project guide

This repository powers the private Tailnet app `https://mew.tail79fee7.ts.net:10443` (CapRover app
`advance-wars`). It is a
vanilla static browser application served by nginx. EmulatorJS 4.2.3 and its mGBA core are installed
from integrity-pinned npm packages during the build.

The retail ROM is owner-provided data. Never commit, base64-encode, patch, screenshot-extract, or
otherwise place it in Git. `config/game.json` is the source of truth for its 8 MiB size and SHA-256.
Local builds require `ADVANCE_WARS_ROM=/absolute/path`; the post-merge release script maintains a
mode-0600 copy at `~/.local/share/advance-wars-web/advance-wars-2.gba`.

Required gate:

```bash
npm ci --omit=optional
npm test
ADVANCE_WARS_ROM=/absolute/path npm run build
npm run test:build
CI=1 npm run test:e2e
```

`bin/release.sh` is the only production entry point and must be staged through Brain's deploy train.
Do not push, deploy, alter Tailscale Serve, or register the CapRover app directly from a task worktree.
After release, verify `/healthz`, `/version.json`, `/game-manifest.json`, the ROM byte-range header,
and a real browser boot.

Keep the interface phone-safe at 320 px, preserve 44 px touch targets, and test both portrait and
landscape. Do not depend on undocumented EmulatorJS APIs for required behavior. Preserve the local-
only CSP and all GPL/MPL notices when updating the emulator.

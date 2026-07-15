# Field Kit

Field Kit is a fast, installable browser rack for privately supplied Game Boy Advance games. It
currently carries **Advance Wars 2: Black Hole Rising** and **Pokemon Emerald Rogue v2.1a**, with
keyboard, gamepad, touch controls, save states, cartridge-save persistence, and client-encrypted
save sync between devices.

Production is `https://mew.tail79fee7.ts.net:10443`, available only on Will's Tailnet. ROMs and the
owner's Emerald Rogue seed save are never committed to Git or exposed through CapRover's public
ingress. Every build accepts only the exact file identities recorded in `config/games.json`.

## Local development

Node 22+ and both owner-supplied ROMs are required. Full builds also require the Emerald seed save.

```bash
npm ci --omit=optional
ADVANCE_WARS_ROM=/absolute/path/to/advance-wars-2.gba \
EMERALD_ROGUE_ROM=/absolute/path/to/pokemon-emerald-rogue-v2.1a.gba \
EMERALD_ROGUE_SAVE=/absolute/path/to/pokemon-emerald-rogue-v2.1a.srm \
  npm run check
CI=1 npm run test:e2e
```

Open `http://127.0.0.1:4173` after `npm run preview`.

## Save sync

Start either game, choose **Sync devices**, and make a pairing QR. The QR carries a random 256-bit
capability in its URL fragment; the fragment is removed as soon as the other browser opens it.
Each browser derives separate channel, authorization, and per-game AES-GCM keys locally. The
server stores only bounded opaque ciphertext and revision metadata, and stale writes fail instead
of silently replacing a save changed elsewhere.

The attached Emerald Rogue save loads once on a new, unpaired browser. After pairing, the encrypted
channel is authoritative for that game. The emulator menu continues to provide manual save import
and export.

## Controls

- Arrow keys: D-pad
- Z / X: A / B
- Enter / V: Start / Select
- Q / E: L / R
- Standard gamepads map automatically.
- Touch devices receive a full GBA control overlay after launch.

## Release model

`bin/release.sh` runs only from the post-merge deploy train. It verifies both cartridge images and
the seed save, keeps durable mode-0600 copies outside Git, runs the full gate, converges a
mew-pinned persistent private service plus loopback-only Tailnet proxy, deploys, and proves the
exact commit, both ROM headers, encrypted-save create/read/update/delete behavior, backend
isolation, PWA, and real browser boots.

See `DEPLOY.md` for the operational contract and `THIRD_PARTY_NOTICES.md` for licenses.

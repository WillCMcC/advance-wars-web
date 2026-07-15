# Advance Wars 2 — Field Console

A fast, installable browser console for a privately supplied **Advance Wars 2: Black Hole Rising**
Game Boy Advance cartridge image. It uses the pinned EmulatorJS 4.2.3 frontend and mGBA core,
with keyboard, gamepad, touch controls, save states, and cartridge-save persistence.

The private production app is `https://mew.tail79fee7.ts.net:10443`, available only on Will's
Tailnet. The commercial ROM is never committed to this repository or exposed through CapRover's
public ingress. Builds accept only the exact supplied `AW2E01` Rev.00 image recorded in
`config/game.json`.

## Local development

Node 22+ and a legally obtained ROM are required.

```bash
npm ci --omit=optional
ADVANCE_WARS_ROM=/absolute/path/to/advance-wars-2.gba npm run check
npm run preview
```

Open `http://127.0.0.1:4173`. Run the browser gate after building:

```bash
CI=1 npm run test:e2e
```

## Controls

- Arrow keys: D-pad
- Z / X: A / B
- Enter / V: Start / Select
- Q / E: L / R
- Standard gamepads map automatically.
- Touch devices receive a full GBA control overlay after tapping **Deploy**.

## Release model

`bin/release.sh` runs only from the post-merge deploy train. It verifies the exact reviewed Git
commit, ROM size, SHA-256, internal title, and game code; stages the ROM in an ignored build input;
runs the production checks; converges a mew-pinned, zero-ingress CapRover service, a loopback-only
proxy, and a non-Funnel Tailscale Serve endpoint; deploys; and verifies the exact commit, backend
isolation, secure headers, manifest, cartridge header, PWA, and real browser boot.

See `DEPLOY.md` for the operational contract and `THIRD_PARTY_NOTICES.md` for licenses.

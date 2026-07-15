# Third-party notices

## EmulatorJS 4.2.3

The browser emulator frontend is [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS), version
4.2.3, licensed under GNU GPL version 3. The production build concatenates its unminified source
modules in the upstream loader order and applies a separate project stylesheet; it does not fetch
runtime code from a CDN. The full upstream license is shipped as `EmulatorJS-GPL-3.0.txt`.

## NippleJS 0.10.2

The on-screen joystick implementation bundled by EmulatorJS is
[NippleJS](https://github.com/yoannmoinet/nipplejs), licensed under the MIT License. Its complete
copyright and permission notice ships as `NippleJS-MIT.txt`.

## Socket.IO client 4.8.1

EmulatorJS bundles the [Socket.IO](https://socket.io/) 4.8.1 browser client for optional network
features. It is licensed under the MIT License; the complete copyright and permission notice ships
as `Socket.IO-MIT.txt`.

## mGBA core 4.2.3

Game Boy Advance emulation is provided by the
[EmulatorJS mGBA core](https://github.com/EmulatorJS/mgba), package version 4.2.3. mGBA is licensed
under the Mozilla Public License 2.0; the core archive contains its `license.txt`, build metadata,
JavaScript loader, and WebAssembly module. The complete terms ship as `mGBA-MPL-2.0.txt`; the
corresponding core source and build system are available from the linked EmulatorJS repositories.

## Fonts

- Bebas Neue by Ryoichi Tsunekawa, distributed through Fontsource under the SIL Open Font License;
  the complete notice and terms ship as `Bebas-Neue-OFL-1.1.txt`.
- IBM Plex Mono by IBM, distributed through Fontsource under the SIL Open Font License; the complete
  notice and terms ship as `IBM-Plex-Mono-OFL-1.1.txt`.

Package versions and registry integrity hashes are pinned in `package-lock.json`. Advance Wars,
Nintendo, Game Boy Advance, and related names and game data belong to their respective owners. No
Nintendo BIOS or commercial ROM is included in this source repository.

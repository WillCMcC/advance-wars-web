# Private deployment contract

Production is `https://mew.tail79fee7.ts.net:10443`, backed by the stateless CapRover app
`advance-wars`. CapRover does not expose the app through its web router and assigns no custom
domain or published port, and the service is pinned to the dynamically discovered `mew` Swarm node
so its backend traffic stays on that host. An ownership-labelled, digest-pinned nginx sidecar joins
the attachable `captain-overlay-network` and exposes its proxy only on `127.0.0.1:8092`. Tailscale
Serve terminates trusted HTTPS on `mew:10443` and proxies to that loopback endpoint with Funnel
explicitly disabled.

The endpoint is owner-only at its client boundary: a client must be on Will's Tailnet, while the
unencrypted backend is unreachable from both the LAN and Tailnet. Cluster root and co-resident
operator workloads on `mew` remain within the trusted host boundary. Do not add a `3218i.com`
hostname, CapRover web exposure, Docker Swarm published port, non-loopback proxy binding, Cloudflare
route, or Tailscale Funnel entry.

The application source and emulator are reproducible from Git and the npm lockfile. The commercial
cartridge image stays outside Git, and both container stages are pinned by registry digest. Update a
base digest only in a reviewed dependency change. `bin/release.sh` accepts only the `AW2E01` Rev.00
image with:

- size: `8388608` bytes
- SHA-256: `ef3cc89273f9df88020f07751ea6306b25c39df01893822fe431550eedf9b134`
- internal title / game code: `ADVANCEWARS2` / `AW2E`

The Todoboy deploy train merges and pushes a reviewed task commit before invoking
`./bin/release.sh`. The script requires the train's task identity and exact commit, stages
`.deploy-version` and `.release-rom/` only in the ephemeral release worktree, runs the project gate,
and invokes `bin/provision-and-deploy.sh`. Brain's Projects pane uses the separate explicit
`ADVANCE_WARS_PROJECTS_RELEASE=1` entry point from its clean detached release worktree. Ordinary
manual invocation fails closed. Neither release script contains `git push`.

The provisioner replaces and reads back every operator-owned CapRover field, refuses persistent or
public drift, deploys through Brain's authenticated tar adapter, and converges only an explicitly
owned sidecar container. The sidecar's pinned image, loopback binding, read-only filesystem,
ownership labels, overlay attachment, config mount, and Docker-DNS-resolved service upstream are
read back exactly. A name, directory,
network, service, or port collision that is not recognized as owned state fails closed. The
Tailscale Serve handler is created only when its host and port are empty or already an exact match;
unexpected Serve state also fails closed.

Every release must prove:

- `/version.json` contains the exact merged commit;
- `/game-manifest.json` contains the exact ROM digest and size;
- a byte-range request returns HTTP 206 and the expected internal ROM header;
- HTTPS carries HSTS, COOP, and COEP headers;
- the public wildcard hostname serves neither the app's unique shell/health markers nor a valid ROM
  byte range (in addition to not serving the reviewed commit);
- direct HTTP to port `8092` from another Tailnet client is unreachable;
- a fresh browser loads the local mGBA core and ROM, renders a frame, and registers the service
  worker through the private HTTPS origin.

A successful image upload alone is not a release.

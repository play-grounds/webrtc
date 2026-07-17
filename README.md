# WebRTC Lab

A **no-build, in-browser** dashboard for debugging WebRTC peer connections layer by layer — buttons and live feedback so you can see exactly *what works, what doesn't, and why*. Everything is static ES modules; deploy anywhere (gh-pages).

**Live:** https://play-grounds.github.io/webrtc/

## Why

Headless/automated tests connect every time because they use raw-IP ICE candidates. Real desktop browsers hide local IPs behind mDNS `.local` candidates, and phones sit behind carrier NAT — so connections fail in ways you can't reproduce in CI. This lab runs *in the actual browser that's failing* and surfaces the real state: candidate types, ICE pair selection, signaling traffic.

## The pipeline, as isolated & testable modules

Each file is one layer — the future library:

| File | Layer | What it answers |
|---|---|---|
| `probe.js` | 0 Environment | Can this browser do WebRTC / data channels / getStats / OPFS at all? |
| `ice.js` | 1 ICE candidates | What addresses will this browser offer? Flags `.local` (mDNS) hosts and missing `srflx` (STUN failed); shows `relay` (TURN works). **The key diagnostic.** |
| `loopback.js` | 2 Loopback | Two peers in one tab, no signaling. If this fails WebRTC is broken; if it passes the stack is fine. |
| `signaling.js` | 3 Signaling | WebSocket relay in isolation — connect, announce, watch raw messages. |
| `webrtc-mesh.js` | 4 Real peers | **The canonical mesh library, vendored verbatim from [bitcoin-kernel/health](https://github.com/bitcoin-kernel/health)** — symmetric non-trickle handshake, reconnect, full connection lifecycle (dropped/failed/stale attempts are closed, not leaked). The lab tests exactly what the apps ship. |
| `mesh.js` | 4 Real peers | Thin instrumentation shim over `webrtc-mesh.js`: logs every peer lifecycle event and runs an app-level ping/pong to prove payload round-trips. |
| `stats.js` | — | `getStats()` → selected pair (host↔host = LAN, srflx = NAT traversal, relay = TURN). |
| `log.js` | — | Shared event bus; every layer logs through it to the console panel. |
| `lab.js` | — | Dashboard wiring. |

## Config via query string

Nothing is hard-coded. Pass a signaling server and room in the URL so links are shareable without committing a server into the repo:

```
?sig=wss://your-host/.webrtc&room=any-name&stun=stun:stun.l.google.com:19302
   &turn=turn:host:3478&tu=user&tc=cred
```

Room names are hashed to a hex resource automatically (raw hex passes through), so any human name works with hex-only trackers like JSS. The hash comes from the vendored library, so a human room name lands in the **same room here as in the apps** — you can join an app's mesh by name to debug it live (lab peers connect but stay inert in a foreign protocol).

⚠ Config (including TURN credentials) is saved in `localStorage` and embedded in share links — don't paste production TURN creds into a link you'll share publicly.

## How to read a failure

- **ICE shows only `.local` hosts, no `srflx`** → STUN unreachable *and* mDNS obfuscation on; same-machine/LAN peers need a working mDNS responder (or the browser's "hide local IPs with mDNS" flag disabled), cross-NAT peers need TURN.
- **Loopback passes but real peers stall at `checking`** → candidates aren't reachable between the two sides; add TURN.
- **No `relay` despite TURN configured** → wrong creds/ports/URL.

## Library lineage

The extraction happened — in reverse. The handshake was figured out here, ported into bitcoin-kernel/health as `webrtc-mesh.js`, and hardened there (reconnect, connection-lifecycle fixes that closed a real memory leak). That file is now the **single source of truth**; this repo vendors it verbatim and `mesh.js` is just the dashboard shim on top. When the library changes in health, copy it back here — never edit the vendored copy directly. TURN (coturn / a JSS plugin) slots in as just another ICE server via the config above.

## No build

Plain ES modules + one HTML file. `python3 -m http.server` and open `index.html`, or push to `gh-pages`.

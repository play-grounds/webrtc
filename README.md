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
| `mesh.js` | 4 Real peers | Full offer/answer over signaling (symmetric, non-trickle). Per-peer ICE state + **selected candidate pair** = how it actually connected. |
| `stats.js` | — | `getStats()` → selected pair (host↔host = LAN, srflx = NAT traversal, relay = TURN). |
| `log.js` | — | Shared event bus; every layer logs through it to the console panel. |
| `lab.js` | — | Dashboard wiring. |

## Config via query string

Nothing is hard-coded. Pass a signaling server and room in the URL so links are shareable without committing a server into the repo:

```
?sig=wss://your-host/.webrtc&room=any-name&stun=stun:stun.l.google.com:19302
   &turn=turn:host:3478&tu=user&tc=cred
```

Room names are hashed to a hex resource automatically (raw hex passes through), so any human name works with hex-only trackers like JSS.

## How to read a failure

- **ICE shows only `.local` hosts, no `srflx`** → STUN unreachable *and* mDNS obfuscation on; same-machine/LAN peers need a working mDNS responder (or the browser's "hide local IPs with mDNS" flag disabled), cross-NAT peers need TURN.
- **Loopback passes but real peers stall at `checking`** → candidates aren't reachable between the two sides; add TURN.
- **No `relay` despite TURN configured** → wrong creds/ports/URL.

## Roadmap

Figure everything out here → extract a small reusable peering library → port back into the apps that need it. TURN (coturn / a JSS plugin) slots in as just another ICE server via the config above.

## No build

Plain ES modules + one HTML file. `python3 -m http.server` and open `index.html`, or push to `gh-pages`.

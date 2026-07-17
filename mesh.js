// Layer 4 — real peer connection over signaling, now a thin instrumentation
// shim over the CANONICAL mesh library (webrtc-mesh.js, vendored verbatim from
// bitcoin-kernel/health). The lab used to carry its own fork of this handshake;
// the fork drifted — and kept a connection leak the app had already fixed — so
// the roadmap's "extract a reusable library" step now runs in reverse: the app
// library is the source of truth and the lab exercises exactly what ships.
//
// This file only adds what a debugging dashboard wants on top of MeshCore:
// a log line for every peer lifecycle event, and an app-level ping/pong over
// the data channel to prove real payload round-trips (the ICE-stats RTT and
// selected-pair path come from the library's own stats poll).
import { log } from './log.js';
import { MeshCore, toHexResource } from './webrtc-mesh.js';

export { toHexResource }; // one hash for the whole lab — same rooms as the app

export class Mesh {
  constructor({ url, room, iceServers = [], batch = 2, onPeers = () => {} }) {
    if (!iceServers.length) log('mesh', 'no ICE servers configured — the library falls back to Google STUN', 'warn');
    this.onPeers = onPeers;
    this.rtts = new Map(); // peer id -> app-level data-channel RTT (ms)
    this.pinger = null;
    this.core = new MeshCore({
      url, room, iceServers, batch, channelLabel: 'lab',
      onPeer: (id) => { log('mesh', `✓ channel OPEN with ${String(id).slice(0, 8)}`, 'ok'); this._emit(); },
      onDrop: (id) => { this.rtts.delete(id); log('mesh', `channel closed with ${String(id).slice(0, 8)}`, 'warn'); this._emit(); },
      onData: (id, data) => this._onData(id, data),
      onChange: () => this._emit(),
    });
  }

  async start() {
    await this.core.start();
    log('mesh', `started · room resource ${this.core.resource}`);
    this.pinger = setInterval(() => {
      for (const p of this.core.status().peers) if (p.open) this.core.send(p.id, 'ping ' + performance.now());
    }, 3000);
    this._emit();
  }

  stop() {
    clearInterval(this.pinger);
    this.core.stop();
    this.rtts.clear();
    log('mesh', 'stopped');
    this._emit();
  }

  _onData(id, data) {
    const s = String(data);
    if (s.startsWith('ping ')) this.core.send(id, 'pong ' + s.slice(5));
    else if (s.startsWith('pong ')) { this.rtts.set(id, Math.round(performance.now() - Number(s.slice(5)))); this._emit(); }
    // anything else is another app's protocol (e.g. block·health JSON) — a lab
    // peer in a foreign room stays connected but inert, which is the point
  }

  _emit() {
    const st = this.core.status();
    this.onPeers(st.peers.map((p) => ({
      ...p, short: String(p.id).slice(0, 8), rtt: this.rtts.get(p.id) ?? p.rtt,
    })), st.ws);
  }
}

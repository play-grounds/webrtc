// Layer 4 — real peer connection over signaling. The proven kernel handshake:
// symmetric (every peer batches offers AND answers every offer), non-trickle
// (candidates baked into the SDP), keyed by the signaling `from` id. Heavily
// instrumented: every ICE/connection state change is logged, and a stats loop
// reports the SELECTED candidate pair per peer so you can see how (or whether)
// each link actually connected.
//
// To test: open this page in two tabs / browsers / devices with the same room.
import { log } from './log.js';
import { Signal } from './signaling.js';
import { selectedPair } from './stats.js';

const rid = () => Math.random().toString(36).slice(2, 12);

function iceComplete(pc, ms = 8000) {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const c = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', c); res(); } };
    pc.addEventListener('icegatheringstatechange', c);
    setTimeout(res, ms);
  });
}

export class Mesh {
  constructor({ url, room, iceServers = [], batch = 2, onPeers = () => {} }) {
    this.sig = new Signal(url, room);
    this.room = room; this.iceServers = iceServers; this.batch = batch; this.onPeers = onPeers;
    this.peers = new Map();     // signaling id -> { id, pc, ch, rtt, pair }
    this.pending = new Map();   // offer_id -> pc
    this.reann = null; this.running = false;
  }

  async start() {
    this.running = true;
    this.sig.onmsg = (m) => this._onSignal(m);
    await this.sig.connect();
    await this._announce();
    this.reann = setInterval(() => this._announce(), 90_000);
    this._emit();
  }
  stop() {
    this.running = false;
    clearInterval(this.reann);
    for (const e of this.peers.values()) { try { e.ch?.close(); } catch {} try { e.pc.close(); } catch {} }
    for (const pc of this.pending.values()) { try { pc.close(); } catch {} }
    this.peers.clear(); this.pending.clear();
    this.sig.close();
    log('mesh', 'stopped');
    this._emit();
  }

  _emit() {
    this.onPeers([...this.peers.values()].map((e) => ({
      id: e.id, short: String(e.id).slice(0, 8),
      ice: e.pc.iceConnectionState, conn: e.pc.connectionState,
      open: e.ch?.readyState === 'open', rtt: e.rtt, pair: e.pair,
    })), this.sig.state);
  }

  _wire(pc, who) {
    pc.oniceconnectionstatechange = () => { log('mesh', `${who} ice: ${pc.iceConnectionState}`, pc.iceConnectionState === 'failed' ? 'error' : 'info'); this._emit(); };
    pc.onicegatheringstatechange = () => log('mesh', `${who} gathering: ${pc.iceGatheringState}`);
    pc.onconnectionstatechange = () => { log('mesh', `${who} conn: ${pc.connectionState}`, pc.connectionState === 'failed' ? 'error' : 'info'); this._emit(); };
  }

  async _makeOffer() {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc._ch = pc.createDataChannel('lab');
    this._wire(pc, 'offer');
    await pc.setLocalDescription(await pc.createOffer());
    await iceComplete(pc);
    return { pc, sdp: pc.localDescription.sdp };
  }

  async _announce() {
    if (this.sig.state !== 1) return;
    const offers = [];
    for (let i = 0; i < this.batch; i++) {
      try { const { pc, sdp } = await this._makeOffer(); const offer_id = rid(); this.pending.set(offer_id, pc); setTimeout(() => { if (this.pending.delete(offer_id)) { try { pc.close(); } catch {} } }, 60_000); offers.push({ offer_id, sdp }); } catch (e) { log('mesh', 'makeOffer failed: ' + e.message, 'warn'); }
    }
    if (offers.length) { this.sig.send({ type: 'announce', resource: this.room, offers }); log('mesh', `announced ${offers.length} offer(s)`); }
  }

  async _onSignal(m) {
    if (m.resource !== this.room) return;
    if (m.type === 'offer' && m.from && typeof m.sdp === 'string') {
      try {
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        this._wire(pc, 'answer');
        pc.ondatachannel = (ev) => this._adopt(m.from, pc, ev.channel);
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await iceComplete(pc);
        this.sig.send({ type: 'answer', resource: this.room, to: m.from, offer_id: m.offer_id, sdp: pc.localDescription.sdp });
      } catch (e) { log('mesh', 'answer failed: ' + e.message, 'error'); }
    } else if (m.type === 'answer' && m.offer_id && typeof m.sdp === 'string') {
      const pc = this.pending.get(m.offer_id);
      if (!pc) return;
      this.pending.delete(m.offer_id);
      try { await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); this._adopt(m.from, pc, pc._ch); }
      catch (e) { log('mesh', 'apply answer failed: ' + e.message, 'error'); try { pc.close(); } catch {} }
    }
  }

  _adopt(id, pc, ch) {
    const entry = { id, pc, ch, rtt: null, pair: null };
    const register = () => { this.peers.set(id, entry); log('mesh', `✓ channel OPEN with ${String(id).slice(0, 8)}`, 'ok'); this._ping(entry); this._statsLoop(entry); this._emit(); };
    const drop = () => { if (this.peers.get(id) === entry) { this.peers.delete(id); log('mesh', `channel closed with ${String(id).slice(0, 8)}`, 'warn'); this._emit(); } };
    if (ch.readyState === 'open') register(); else ch.addEventListener('open', register);
    ch.addEventListener('close', drop);
    ch.onmessage = (e) => this._onCh(entry, e.data);
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) drop(); });
  }

  _onCh(entry, data) {
    const s = String(data);
    if (s.startsWith('ping ')) entry.ch.send('pong ' + s.slice(5));
    else if (s.startsWith('pong ')) { entry.rtt = Math.round(performance.now() - Number(s.slice(5))); this._emit(); }
  }
  _ping(entry) {
    if (!this.peers.has(entry.id) || entry.ch.readyState !== 'open') return;
    entry.ch.send('ping ' + performance.now());
    setTimeout(() => this._ping(entry), 3000);
  }
  async _statsLoop(entry) {
    if (!this.peers.has(entry.id)) return;
    try { entry.pair = await selectedPair(entry.pc); this._emit(); } catch {}
    setTimeout(() => this._statsLoop(entry), 3000);
  }
}

// Layer 3 — signaling transport (JSS content-addressed rooms). Isolated so you
// can confirm the WebSocket relay works BEFORE blaming WebRTC: connect, announce
// into a room, and watch every raw message in/out. The tracker relays
// announce/offer/answer keyed by `resource` (room); it does NOT relay ICE
// candidates in room mode, which is why the rest of the lab bakes candidates
// into the SDP (non-trickle).
import { log } from './log.js';

export class Signal {
  constructor(url, room) { this.url = url; this.room = room; this.ws = null; this.onmsg = () => {}; this.selfHint = null; }

  connect() {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = this.ws = new WebSocket(this.url); }
      catch (e) { log('signal', 'construct failed: ' + e.message, 'error'); return reject(e); }
      const to = setTimeout(() => { log('signal', 'connect timeout', 'error'); reject(new Error('ws connect timeout')); }, 8000);
      ws.onopen = () => { clearTimeout(to); log('signal', 'ws OPEN ' + this.url, 'ok'); resolve(); };
      ws.onerror = () => { clearTimeout(to); log('signal', 'ws ERROR (see devtools for detail)', 'error'); reject(new Error('ws error')); };
      ws.onclose = (e) => log('signal', `ws CLOSE code=${e.code}${e.reason ? ' ' + e.reason : ''}`, 'warn');
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { log('signal', 'recv non-JSON: ' + String(e.data).slice(0, 120), 'warn'); return; }
        log('signal', `recv «${m.type}»${m.from ? ' from ' + String(m.from).slice(0, 8) : ''}${m.offer_id ? ' oid=' + m.offer_id : ''}`, m.type === 'error' ? 'warn' : 'info', m);
        this.onmsg(m);
      };
    });
  }

  send(m) {
    if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(m)); log('signal', `sent «${m.type}»${m.offers ? ' (' + m.offers.length + ' offers)' : ''}${m.to ? ' to ' + String(m.to).slice(0, 8) : ''}`); }
    else log('signal', 'send dropped — ws not open', 'warn');
  }

  announce(offers = []) { this.send({ type: 'announce', resource: this.room, offers }); }
  close() { try { this.ws?.close(); } catch {} }
  get state() { return this.ws ? this.ws.readyState : -1; }
}

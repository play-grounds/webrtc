// Layer 2 — same-page loopback. Two RTCPeerConnections in ONE tab, wired
// directly to each other (no signaling server, candidates shuttled in-process).
// If this fails, WebRTC itself is broken in the browser. If it passes, the
// stack works and any real-peer failure is signaling or candidate reachability,
// not WebRTC. This is the "is the engine even turning over" test.
import { log } from './log.js';
import { selectedPair } from './stats.js';

export async function loopback({ iceServers = [], timeoutMs = 10000, iceTransportPolicy = 'all' } = {}) {
  // 'relay' restricts ICE to TURN candidates — the turn layer uses it to
  // prove the relay path with no host/srflx shortcuts available.
  const a = new RTCPeerConnection({ iceServers, iceTransportPolicy });
  const b = new RTCPeerConnection({ iceServers, iceTransportPolicy });
  const t0 = performance.now();

  a.onicecandidate = (e) => { if (e.candidate) b.addIceCandidate(e.candidate).catch((err) => log('loop', 'B addIce failed: ' + err.message, 'warn')); };
  b.onicecandidate = (e) => { if (e.candidate) a.addIceCandidate(e.candidate).catch((err) => log('loop', 'A addIce failed: ' + err.message, 'warn')); };
  a.oniceconnectionstatechange = () => log('loop', 'A ice: ' + a.iceConnectionState);
  b.oniceconnectionstatechange = () => log('loop', 'B ice: ' + b.iceConnectionState);

  const ch = a.createDataChannel('lb');
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms — A.ice=${a.iceConnectionState} B.ice=${b.iceConnectionState}`)), timeoutMs);
    ch.onopen = () => { log('loop', 'data channel open, pinging'); ch.send('ping ' + performance.now()); };
    ch.onmessage = async (m) => {
      if (String(m.data).startsWith('pong ')) {
        const rtt = performance.now() - Number(m.data.slice(5));
        clearTimeout(timer);
        const pair = await selectedPair(a).catch(() => null);
        resolve({ ok: true, rtt: Math.round(rtt), openMs: Math.round(performance.now() - t0), pair });
      }
    };
    b.ondatachannel = (ev) => { ev.channel.onmessage = (m) => { if (String(m.data).startsWith('ping ')) ev.channel.send('pong ' + m.data.slice(5)); }; };
  });

  log('loop', 'creating offer/answer in-process…');
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);

  try {
    const r = await result;
    log('loop', `PASS — channel open in ${r.openMs}ms, RTT ${r.rtt}ms, path ${r.pair?.path ?? '?'}`, 'ok');
    return r;
  } catch (e) {
    log('loop', 'FAIL — ' + e.message, 'error');
    throw e;
  } finally {
    a.close(); b.close();
  }
}

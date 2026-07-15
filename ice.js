// Layer 1 — ICE candidate gathering. THE key diagnostic: it shows exactly what
// addresses this browser is willing to offer a peer, and flags the two things
// that silently break real-browser connections:
//   • host candidates that are `.local` (mDNS obfuscation) — same-machine/LAN
//     peers can't connect unless a working mDNS resolver is present.
//   • no `srflx` candidate — STUN unreachable / UDP blocked → no NAT traversal.
//   • `relay` present — TURN is working.
import { log } from './log.js';

// candidate:<foundation> <component> <proto> <priority> <address> <port> typ <type> ...
export function parseCandidate(s) {
  const raw = s.replace(/^a=/, '');
  const p = raw.split(' ');
  const typIdx = p.indexOf('typ');
  const type = typIdx >= 0 ? p[typIdx + 1] : '?';
  const address = p[4] || '';
  const port = p[5] || '';
  const protocol = (p[2] || '').toLowerCase();
  const relIdx = p.indexOf('raddr');
  const related = relIdx >= 0 ? `${p[relIdx + 1]}:${p[p.indexOf('rport') + 1] || ''}` : '';
  const isMdns = /\.local$/i.test(address);
  return { type, protocol, address, port, related, isMdns, raw };
}

function waitGather(pc, timeoutMs) {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res('complete');
    const check = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); res('complete'); } };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(() => res('timeout'), timeoutMs);
  });
}

export async function gatherCandidates({ iceServers = [], timeoutMs = 8000 } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  pc.createDataChannel('probe');
  const candidates = [];
  pc.onicecandidate = (e) => {
    if (!e.candidate || !e.candidate.candidate) return;
    const c = parseCandidate(e.candidate.candidate);
    candidates.push(c);
    log('ice', `${c.type.padEnd(6)} ${c.protocol} ${c.address}:${c.port}${c.isMdns ? '  ⚠ .local (mDNS)' : ''}${c.related ? '  via ' + c.related : ''}`);
  };
  pc.onicegatheringstatechange = () => log('ice', 'gathering: ' + pc.iceGatheringState);
  log('ice', `gathering with ${iceServers.length} ICE server(s)…`);
  await pc.setLocalDescription(await pc.createOffer());
  const how = await waitGather(pc, timeoutMs);
  pc.close();

  const verdict = analyze(candidates, iceServers);
  log('ice', verdict.summary, verdict.level);
  return { candidates, verdict, gatherEnd: how };
}

function analyze(cands, iceServers) {
  const has = (t) => cands.some((c) => c.type === t);
  const hostRaw = cands.filter((c) => c.type === 'host' && !c.isMdns);
  const hostMdns = cands.filter((c) => c.type === 'host' && c.isMdns);
  const srflx = cands.find((c) => c.type === 'srflx');
  const relay = cands.find((c) => c.type === 'relay');
  const notes = [];
  let level = 'ok';

  if (cands.length === 0) { return { level: 'error', summary: 'NO candidates gathered at all — WebRTC is blocked/disabled in this browser', notes: [], publicIp: null }; }

  if (relay) notes.push(`✓ TURN relay works (relay via ${relay.related || '?'}) — connectivity guaranteed even through hard NAT`);
  else if (iceServers.some((s) => String(s.urls).includes('turn'))) { notes.push('✗ TURN configured but produced NO relay candidate — check creds/ports/URL'); level = 'warn'; }

  if (srflx) notes.push(`✓ STUN works — your public address is ${srflx.address}:${srflx.port}`);
  else { notes.push('✗ no srflx candidate — STUN unreachable or UDP blocked → cross-NAT peers will fail without TURN'); level = 'warn'; }

  if (hostMdns.length && !hostRaw.length) {
    notes.push(`⚠ host candidates are mDNS-obfuscated (${hostMdns.length}× .local) — same-machine / same-LAN peers can only connect if BOTH sides resolve .local (needs a working mDNS responder, or disable the browser's "hide local IPs with mDNS" flag)`);
    if (level === 'ok') level = 'warn';
  } else if (hostRaw.length) {
    notes.push(`✓ raw host candidate(s) present (${hostRaw.map((c) => c.address).join(', ')}) — direct LAN connection possible`);
  }

  const kinds = [...new Set(cands.map((c) => c.type))].join(', ');
  const summary = `${cands.length} candidates [${kinds}] — ${relay ? 'TURN✓' : srflx ? 'STUN✓/noTURN' : 'noSTUN'}${hostMdns.length && !hostRaw.length ? ' · host=.local' : ''}`;
  return { level, summary, notes, publicIp: srflx ? `${srflx.address}:${srflx.port}` : null, hasHostRaw: !!hostRaw.length, hasMdns: !!hostMdns.length, hasSrflx: !!srflx, hasRelay: !!relay };
}

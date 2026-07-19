// Node smoke tests for the lab's pure functions — candidate parsing, the ICE
// verdict, room hashing, timestamp formatting. Everything else needs a real
// browser (that's the point of the lab). Run: node --test test.js  (Node ≥ 22.7)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCandidate, analyze } from './ice.js';
import { toHexResource } from './webrtc-mesh.js';
import { hhmmss } from './log.js';

test('parseCandidate: udp host', () => {
  const c = parseCandidate('candidate:842163049 1 udp 1677729535 192.168.1.10 54321 typ host generation 0');
  assert.equal(c.type, 'host');
  assert.equal(c.protocol, 'udp');
  assert.equal(c.address, '192.168.1.10');
  assert.equal(c.port, '54321');
  assert.equal(c.related, '');
  assert.equal(c.isMdns, false);
});

test('parseCandidate: srflx with raddr/rport, a= prefix, uppercase proto', () => {
  const c = parseCandidate('a=candidate:1 1 UDP 1685987327 203.0.113.7 61000 typ srflx raddr 192.168.1.10 rport 54321');
  assert.equal(c.type, 'srflx');
  assert.equal(c.protocol, 'udp');
  assert.equal(c.related, '192.168.1.10:54321');
});

test('parseCandidate: raddr without rport does not mis-parse', () => {
  const c = parseCandidate('candidate:1 1 udp 1685987327 203.0.113.7 61000 typ srflx raddr 192.168.1.10');
  assert.equal(c.related, '192.168.1.10');
});

test('parseCandidate: flags mDNS .local host', () => {
  const c = parseCandidate('candidate:1 1 udp 2113937151 f3a2b1c0-aaaa-bbbb-cccc-1234567890ab.local 49797 typ host');
  assert.equal(c.isMdns, true);
});

test('analyze: no candidates at all → error', () => {
  const v = analyze([], []);
  assert.equal(v.level, 'error');
});

test('analyze: mDNS-only hosts, no srflx → warn', () => {
  const v = analyze([{ type: 'host', isMdns: true, address: 'x.local' }], []);
  assert.equal(v.level, 'warn');
  assert.equal(v.hasMdns, true);
  assert.equal(v.hasSrflx, false);
  assert.equal(v.publicIp, null);
});

test('analyze: srflx present → ok, reports public address', () => {
  const v = analyze([
    { type: 'host', isMdns: false, address: '192.168.1.2' },
    { type: 'srflx', isMdns: false, address: '203.0.113.7', port: '61000' },
  ], []);
  assert.equal(v.level, 'ok');
  assert.equal(v.publicIp, '203.0.113.7:61000');
  assert.equal(v.hasHostRaw, true);
});

test('analyze: TURN configured but no relay candidate → warn', () => {
  const v = analyze(
    [{ type: 'srflx', isMdns: false, address: '203.0.113.7', port: '61000' }],
    [{ urls: 'stun:s' }, { urls: 'turn:host:3478' }],
  );
  assert.equal(v.level, 'warn');
  assert.equal(v.hasRelay, false);
});

test('analyze: relay candidate present → ok even without srflx note tripping', () => {
  const v = analyze([
    { type: 'srflx', isMdns: false, address: '203.0.113.7', port: '61000' },
    { type: 'relay', isMdns: false, address: '198.51.100.4', port: '3478', related: '203.0.113.7:61000' },
  ], [{ urls: 'turn:host:3478' }]);
  assert.equal(v.level, 'ok');
  assert.equal(v.hasRelay, true);
});

test('toHexResource: raw hex passes through, lowercased', async () => {
  assert.equal(await toHexResource('DEADBEEFDEADBEEF'), 'deadbeefdeadbeef');
});

test('toHexResource: human names hash deterministically to 32 hex chars', async () => {
  const a = await toHexResource('webrtc-lab-demo');
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, await toHexResource('webrtc-lab-demo'));
  assert.notEqual(a, await toHexResource('some-other-room'));
});

test('hhmmss: zero-pads every field', () => {
  assert.equal(hhmmss(new Date(2026, 0, 1, 5, 7, 9, 3)), '05:07:09.003');
});

// webrtc-mesh.js is vendored VERBATIM from bitcoin-kernel/health — this turns
// that convention into a checked guarantee. Skips when offline.
test('vendor drift: webrtc-mesh.js is byte-identical to bitcoin-kernel/health', async (t) => {
  const url = 'https://raw.githubusercontent.com/bitcoin-kernel/health/gh-pages/webrtc-mesh.js';
  let upstream;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    upstream = await res.text();
  } catch (e) {
    t.skip('upstream unreachable (offline?): ' + e.message);
    return;
  }
  const local = await readFile(new URL('./webrtc-mesh.js', import.meta.url), 'utf8');
  assert.ok(local === upstream,
    'webrtc-mesh.js has drifted from bitcoin-kernel/health — never edit the vendored copy; change it upstream and copy it back verbatim');
});

// Layer 0 — environment capability probe. Cheap, synchronous, no network.
// Answers "can this browser even do the things the rest of the lab needs?"
import { log } from './log.js';

export function probe() {
  const uaData = navigator.userAgentData;
  const browser = uaData?.brands?.map((b) => `${b.brand} ${b.version}`).join(', ') || navigator.userAgent;
  const checks = [
    { name: 'Secure context', ok: window.isSecureContext, detail: location.protocol + '//' + location.host },
    { name: 'RTCPeerConnection', ok: 'RTCPeerConnection' in window, detail: '' },
    { name: 'RTCDataChannel', ok: 'RTCDataChannel' in window, detail: '' },
    { name: 'getStats()', ok: 'RTCPeerConnection' in window && 'getStats' in RTCPeerConnection.prototype, detail: 'needed for candidate-pair inspection' },
    { name: 'WebSocket', ok: 'WebSocket' in window, detail: 'signaling transport' },
    { name: 'OPFS', ok: !!(navigator.storage && navigator.storage.getDirectory), detail: 'origin private FS (block cache)' },
    { name: 'Browser', ok: true, detail: browser, info: true },
    { name: 'Platform', ok: true, detail: (uaData?.platform || navigator.platform || '?') + (uaData?.mobile ? ' · mobile' : ''), info: true },
  ];
  const fails = checks.filter((c) => !c.ok && !c.info).map((c) => c.name);
  log('probe', fails.length ? `missing: ${fails.join(', ')}` : 'all capabilities present', fails.length ? 'warn' : 'ok');
  return checks;
}

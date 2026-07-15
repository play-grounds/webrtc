// getStats() helper — after a connection forms, this reveals HOW it connected:
// the selected candidate pair and the type of each end (host/srflx/relay).
// host↔host = LAN direct, srflx = NAT traversal, relay = TURN. A pair stuck in
// "in-progress"/"waiting" with none "succeeded" is the signature of a failure.
export async function selectedPair(pc) {
  const stats = await pc.getStats();
  const byId = new Map();
  let transport = null;
  const pairs = [];
  stats.forEach((r) => {
    byId.set(r.id, r);
    if (r.type === 'transport') transport = r;
    if (r.type === 'candidate-pair') pairs.push(r);
  });
  let pair = null;
  if (transport?.selectedCandidatePairId) pair = byId.get(transport.selectedCandidatePairId);
  if (!pair) pair = pairs.find((p) => p.selected) || pairs.find((p) => p.nominated && p.state === 'succeeded') || pairs.find((p) => p.state === 'succeeded');
  if (!pair) {
    const states = pairs.map((p) => p.state);
    return { connected: false, states, pairCount: pairs.length };
  }
  const L = byId.get(pair.localCandidateId);
  const R = byId.get(pair.remoteCandidateId);
  return {
    connected: pair.state === 'succeeded',
    state: pair.state,
    localType: L?.candidateType,
    remoteType: R?.candidateType,
    localProtocol: L?.protocol,
    localAddress: L?.address || L?.ip,
    remoteAddress: R?.address || R?.ip,
    rtt: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    bytesSent: pair.bytesSent,
    bytesReceived: pair.bytesReceived,
    path: `${L?.candidateType ?? '?'} → ${R?.candidateType ?? '?'}`,
  };
}

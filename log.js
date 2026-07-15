// Tiny event bus every lab module logs through. The dashboard subscribes with
// onLog() and renders lines; modules just call log(tag, msg, level).
const listeners = new Set();
let seq = 0;

export function onLog(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function log(tag, msg, level = 'info', data = null) {
  const entry = { seq: ++seq, ts: new Date(), tag, msg, level, data };
  for (const fn of listeners) { try { fn(entry); } catch {} }
  // mirror to devtools so a lone browser tab still has a record
  const line = `[${tag}] ${msg}`;
  if (level === 'error') console.error(line, data ?? '');
  else if (level === 'warn') console.warn(line, data ?? '');
  else console.log(line, data ?? '');
  return entry;
}

export const hhmmss = (d) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;

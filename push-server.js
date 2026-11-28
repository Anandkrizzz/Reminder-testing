/* push-server.js (MediMate, Member 1)
   Web Push prototype: the SERVER sends the reminder, so it arrives even when the website is closed.
   Run:  npm install   then   npm start   (opens on http://localhost:3000)
   Member 3 can copy the logic of createService() into PHP (cron job every minute + a Web Push library). */
process.env.TZ = 'UTC';   // the server works in UTC; each profile's own offset is applied in localNow()
const http = require('http'), fs = require('fs'), path = require('path');
const Engine = require('./reminder-engine.js');

/* ---------------- Core service (no HTTP, easy to test) ---------------- */
function createService(opts = {}) {
  const send = opts.send;                               // send(subscription, payloadString)
  const now = opts.now || (() => new Date());
  const statePath = opts.statePath || null;
  const snoozeMin = opts.snoozeMin ?? 5;
  let state = { subs: {}, tz: {}, meds: {}, fired: [], snoozes: [], doseLogs: [] };
  if (statePath && fs.existsSync(statePath)) { try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; } catch (e) {} }
  const save = () => { if (statePath) fs.writeFileSync(statePath, JSON.stringify(state)); };

  // The profile's wall-clock time. getTimezoneOffset() is minutes BEHIND UTC (India = -330), so local = UTC - offset.
  const localNow = pid => new Date(now().getTime() - (state.tz[pid] || 0) * 60000);

  async function pushTo(pid, payload) {
    let sent = 0;
    for (const sub of [...(state.subs[pid] || [])]) {
      try { await send(sub, JSON.stringify(payload)); sent++; }
      catch (e) {                                       // 404 / 410 = the phone unsubscribed: forget it
        if (e && (e.statusCode === 404 || e.statusCode === 410)) state.subs[pid] = state.subs[pid].filter(s => s.endpoint !== sub.endpoint);
      }
    }
    save(); return sent;
  }

  return {
    state: () => state,
    subscribe(pid, tzOffset, sub) {
      state.tz[pid] = tzOffset || 0;
      const list = state.subs[pid] = (state.subs[pid] || []).filter(s => s.endpoint !== sub.endpoint);
      list.push(sub); save();
    },
    setMedicines(pid, tzOffset, meds) { state.tz[pid] = tzOffset || 0; state.meds[pid] = meds; save(); },
    pushNow(pid, title, body) { return pushTo(pid, { title: title || 'MediMate test', body: body || 'Push works.', tag: 'test-' + Date.now(), profileId: pid }); },

    // Call this every 15-60 seconds (setInterval here, a cron job in PHP).
    async checkDue() {
      let total = 0;
      for (const pid of Object.keys(state.meds)) {
        if (!(state.subs[pid] || []).length) continue;  // nobody to notify: leave doses unfired (10 minute catch-up window)
        const fired = new Set(state.fired);
        for (const d of Engine.dueNow(state.meds[pid], localNow(pid), fired)) {
          state.fired.push(d.id);                       // mark first, so it is never sent twice
          total += await pushTo(pid, { title: 'Time for ' + d.name, body: d.dose, doseId: d.id, profileId: pid, tag: d.id });
        }
      }
      const t = now().getTime();
      const ready = state.snoozes.filter(s => s.at <= t); state.snoozes = state.snoozes.filter(s => s.at > t);
      for (const s of ready) total += await pushTo(s.profileId, { title: 'Reminder: ' + s.name, body: s.dose + ' (snoozed)', doseId: s.doseId, profileId: s.profileId, tag: s.doseId });
      if (state.fired.length > 500) state.fired = state.fired.slice(-500);
      save(); return total;
    },

    // The Taken / Snooze buttons on the notification end up here.
    doseAction({ doseId, profileId, action }) {
      const [medId, scheduledAt] = String(doseId).split('|');
      if (action === 'taken' || action === 'skipped') {
        state.doseLogs = state.doseLogs.filter(l => l.id !== doseId);
        state.doseLogs.push({ id: doseId, profileId, medId, scheduledAt, status: action, loggedAt: now().toISOString(), synced: true });
      } else if (action === 'snooze') {
        const med = (state.meds[profileId] || []).find(m => m.id === medId) || {};
        state.snoozes.push({ profileId, doseId, name: med.name || 'Medicine', dose: med.dose || '', at: now().getTime() + snoozeMin * 60000 });
      }
      save();
    }
  };
}

/* ---------------- HTTP layer ---------------- */
function createServer(service, vapidPublicKey) {
  const PUB = path.join(__dirname, 'public');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const readBody = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch (e) { r({}); } }); });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/api/vapid-public-key') return json(res, 200, { key: vapidPublicKey });
    if (p === '/api/state') {
      const pid = url.searchParams.get('profileId'), s = service.state();
      return json(res, 200, { subscriptions: (s.subs[pid] || []).length, medicines: s.meds[pid] || [],
        doseLogs: s.doseLogs.filter(l => l.profileId === pid), snoozes: s.snoozes.filter(x => x.profileId === pid).length });
    }
    if (req.method === 'POST' && p.startsWith('/api/')) {
      const b = await readBody(req);
      if (p === '/api/subscribe') { service.subscribe(b.profileId, b.tzOffset, b.subscription); return json(res, 200, { ok: true }); }
      if (p === '/api/medicines') { service.setMedicines(b.profileId, b.tzOffset, b.medicines || []); return json(res, 200, { ok: true }); }
      if (p === '/api/push-now') return json(res, 200, { sent: await service.pushNow(b.profileId) });
      if (p === '/api/push-later') {
        const sec = Math.min(Number(b.delaySeconds) || 60, 600);
        setTimeout(() => service.pushNow(b.profileId, 'MediMate test', 'Sent by the server after ' + sec + ' seconds.'), sec * 1000);
        return json(res, 200, { scheduledInSeconds: sec });
      }
      if (p === '/api/dose-action') { service.doseAction(b); return json(res, 200, { ok: true }); }
      return json(res, 404, { error: 'unknown endpoint' });
    }
    const file = path.join(PUB, p === '/' ? 'push-test.html' : p);
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain', 'Service-Worker-Allowed': '/' });
    res.end(fs.readFileSync(file));
  });
}

module.exports = { createService, createServer };

if (require.main === module) {
  const webpush = require('web-push');
  const vapidFile = path.join(__dirname, 'vapid.json');
  if (!fs.existsSync(vapidFile)) fs.writeFileSync(vapidFile, JSON.stringify(webpush.generateVAPIDKeys()));
  const vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
  webpush.setVapidDetails('mailto:medimate@example.com', vapid.publicKey, vapid.privateKey);
  const service = createService({ send: (sub, payload) => webpush.sendNotification(sub, payload), statePath: path.join(__dirname, 'data.json') });
  setInterval(() => service.checkDue().catch(e => console.log('check error', e.message)), 15000);
  const port = process.env.PORT || 3000;
  createServer(service, vapid.publicKey).listen(port, () => console.log('MediMate push demo: http://localhost:' + port));
}

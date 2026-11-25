/* reminder-engine.js  (Member 1)
   Core reminder logic. No UI and no storage, so it is easy to test and reuse.
   medicine = { id, name, dose, times:["08:00","20:00"], startDate:"2026-11-25", days:7 | null, expiry:"2027-03-01" } */
(function (root) {
  const DAY = 86400000;
  const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const atTime = (day, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
  };

  function activeOn(med, day) {
    const start = parseDay(med.startDate);
    if (day < start) return false;
    if (med.days) {
      const end = new Date(start); end.setDate(end.getDate() + med.days);
      if (day >= end) return false;
    }
    return true;
  }

  // All doses of one medicine on one day
  function dosesForDay(med, day) {
    const d0 = dayStart(day);
    if (!activeOn(med, d0)) return [];
    return med.times.map(t => {
      const at = atTime(d0, t);
      return { id: med.id + '|' + at.toISOString(), medId: med.id, name: med.name, dose: med.dose, at };
    });
  }

  // Next dose after "now" (looks up to 60 days ahead)
  function nextDose(med, now) {
    for (let i = 0; i < 60; i++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const next = dosesForDay(med, day).filter(d => d.at > now).sort((a, b) => a.at - b.at)[0];
      if (next) return next;
    }
    return null;
  }

  // Doses that are due now and not yet fired. The window also catches doses missed
  // while the app was closed (default: up to 10 minutes late).
  function dueNow(meds, now, fired, windowMs = 10 * 60 * 1000) {
    const out = [];
    meds.forEach(med => dosesForDay(med, now).forEach(d => {
      const age = now - d.at;
      if (age >= 0 && age <= windowMs && !fired.has(d.id)) out.push(d);
    }));
    return out;
  }

  // Expiry status: 'expired', 'soon' (within soonDays) or 'safe'
  function expiryStatus(med, now, soonDays = 30) {
    if (!med.expiry) return null;
    const days = Math.round((parseDay(med.expiry) - dayStart(now)) / DAY);
    if (days < 0) return { status: 'expired', days };
    if (days <= soonDays) return { status: 'soon', days };
    return { status: 'safe', days };
  }

  function expiryAlerts(meds, now, soonDays = 30) {
    return meds.map(m => ({ med: m, ...(expiryStatus(m, now, soonDays) || {}) }))
               .filter(x => x.status === 'expired' || x.status === 'soon');
  }

  const api = { dosesForDay, nextDose, dueNow, expiryStatus, expiryAlerts };
  root.ReminderEngine = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

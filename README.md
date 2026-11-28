# MediMate Web Push prototype (Member 1)

Why: a website cannot run timers once it is closed. With Web Push the SERVER sends the reminder and the
phone/browser wakes the service worker, so it arrives even when the site is closed (installed or not).

Run on your laptop
1. npm install
2. npm start            (http://localhost:3000)
3. Open it in Chrome, press "Enable push reminders", allow notifications
4. Press "Push in 1 minute", CLOSE the tab, wait (keep Chrome itself running)
5. Press "Add a medicine due in 2 minutes", CLOSE the tab, wait for the dose notification, tap Taken or Snooze
6. Reopen the page: the Taken / Snooze response is recorded on the server

Run on your phone (push needs https)
- Start the server, then in another terminal:  npx cloudflared tunnel --url http://localhost:3000
  (or: npx localtunnel --port 3000). Open the https link on the phone in Chrome.
- iPhone: add the page to the Home Screen first, then open it from there and enable push (iOS 16.4+).

Tests: npm test (10 tests: due logic, time zones, snooze, Taken, dead subscriptions, encryption, HTTP API)

Files
- push-server.js      server: createService() has the logic; the rest is HTTP + web-push
- reminder-engine.js  same engine used in the app (decides which doses are due)
- public/sw.js        service worker: shows the push, handles Taken / Snooze buttons
- public/push-test.html  test page

For Member 3 (PHP): copy createService(). A cron job every minute runs checkDue(); store subscriptions
(endpoint + keys) per profile; send with a PHP Web Push library (for example minishlink/web-push) and
the same VAPID keys. Keep the profile's timezone offset, because medicine times are in the user's local time.

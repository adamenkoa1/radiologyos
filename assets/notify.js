/* RadiologyOS — зв'язок сайту з Google Apps Script.
   NOTIFY_ENDPOINT — URL веб-додатка (…/exec), інструкція в apps-script.gs.
   SYNC_TOKEN — той самий код-пароль, що і в apps-script.gs.
   Поки NOTIFY_ENDPOINT порожній — усе працює локально, як раніше. */

const NOTIFY_ENDPOINT = '';
const SYNC_TOKEN = '';

/* Email реєстратури для кнопки «Email» на екрані заявки.
   Порожньо — кнопка не показується. */
const REGISTRY_EMAIL = '';

/* Оплата платних послуг — офіційне посилання ПриватБанку в/ч А3120
   (розшифровано з QR-плаката бухгалтерії). Значення з панелі
   («Комунікації та оплата») має пріоритет над цим стандартом. */
const DEFAULT_PAY_LINK_RAW = 'https://irc.privatbank.ua/qrstickws/route/qr?type=nextfastpay&params={"token":"cadc7a4d-d56c-4005-9cfe-04a96077f8c1"}';
const DEFAULT_PAY_LINK = 'https://irc.privatbank.ua/qrstickws/route/qr?type=nextfastpay&params=%7B%22token%22%3A%22cadc7a4d-d56c-4005-9cfe-04a96077f8c1%22%7D';

function notifyAdmin(payload) {
  if (!NOTIFY_ENDPOINT) return;
  try {
    fetch(NOTIFY_ENDPOINT, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
  } catch (e) {}
}

function syncPushUpdate(app) {
  if (!NOTIFY_ENDPOINT) return;
  try {
    fetch(NOTIFY_ENDPOINT, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'update', token: SYNC_TOKEN, id: app.sid || app.id,
        status: app.status,
        appointmentDate: app.appointmentDate || '',
        appointmentTime: app.appointmentTime || '',
        apparatus: (typeof appOf === 'function') ? appOf(app) : (app.apparatus || '')
      })
    });
  } catch (e) {}
}

async function syncFetchList() {
  if (!NOTIFY_ENDPOINT) return null;
  try {
    const r = await fetch(NOTIFY_ENDPOINT + '?token=' + encodeURIComponent(SYNC_TOKEN));
    const data = await r.json();
    return Array.isArray(data) ? data : null;
  } catch (e) { return null; }
}

async function syncGetAdmins() {
  if (!NOTIFY_ENDPOINT) return null;
  try {
    const r = await fetch(NOTIFY_ENDPOINT + '?action=admins&token=' + encodeURIComponent(SYNC_TOKEN));
    return await r.json();
  } catch (e) { return null; }
}

function syncSetAdmin(email) {
  if (!NOTIFY_ENDPOINT) return;
  try {
    fetch(NOTIFY_ENDPOINT, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'setAdmin', token: SYNC_TOKEN, email })
    });
  } catch (e) {}
}

async function syncFetchBusy() {
  if (!NOTIFY_ENDPOINT) return null;
  try {
    const r = await fetch(NOTIFY_ENDPOINT + '?action=busy&token=' + encodeURIComponent(SYNC_TOKEN));
    return await r.json();
  } catch (e) { return null; }
}

function syncSetHours(hours) {
  if (!NOTIFY_ENDPOINT) return;
  try {
    fetch(NOTIFY_ENDPOINT, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'setHours', token: SYNC_TOKEN, hours })
    });
  } catch (e) {}
}

function syncSetApparatus(availability) {
  if (!NOTIFY_ENDPOINT) return;
  try {
    fetch(NOTIFY_ENDPOINT, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'setApparatus', token: SYNC_TOKEN, availability })
    });
  } catch (e) {}
}

function sendFeedback(payload) {
  if (!NOTIFY_ENDPOINT) return false;
  try {
    fetch(NOTIFY_ENDPOINT, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(Object.assign({ action: 'feedback' }, payload))
    });
    return true;
  } catch (e) { return false; }
}

/* --- Публічна конфігурація (месенджери, оплата) --- */
function syncSetPublic(config) {
  if (!NOTIFY_ENDPOINT) return;
  try {
    fetch(NOTIFY_ENDPOINT, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'setPublic', token: SYNC_TOKEN, config })
    });
  } catch (e) {}
}

async function fetchPublicConfig() {
  if (!NOTIFY_ENDPOINT) return null;
  try {
    const r = await fetch(NOTIFY_ENDPOINT + '?action=public');
    return await r.json();
  } catch (e) { return null; }
}

/* --- Джерело заявки (рекламні канали): ?src=... або utm_source=... --- */
(function () {
  try {
    const p = new URLSearchParams(location.search);
    const src = p.get('src') || p.get('utm_source');
    if (src && !localStorage.getItem('radiologyos_src')) {
      localStorage.setItem('radiologyos_src', src.slice(0, 50));
    }
  } catch (e) {}
})();
function getTrafficSource() {
  try { return localStorage.getItem('radiologyos_src') || ''; } catch (e) { return ''; }
}

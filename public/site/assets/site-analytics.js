/* RadiologyOS — приватна конверсійна аналітика публічного сайту.
   Використовує ТОЙ САМИЙ endpoint (/api/analytics) і той самий journey-id, що й
   Next-посадкові сторінки (lib/client-analytics), тож шлях відвідувача
   корелюється між вітриною й лендингами. Жодних персональних чи медичних даних:
   лише подія, випадковий journey-id (sessionStorage), код послуги, категорія
   пацієнта та ключ сторінки. Best-effort — збій аналітики ніколи не впливає на UX. */
(function () {
  if (/[?&]edit=1(&|$)/.test(location.search) && window.parent !== window) return; // CRM «Тексти сайту»: редагування — не візит
  var KEY = 'radiologyos_analytics_journey_v1';

  function journeyId() {
    try {
      var existing = sessionStorage.getItem(KEY) || '';
      if (/^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
      var created = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, '')
        : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      sessionStorage.setItem(KEY, created);
      return created;
    } catch (e) { return ''; }
  }

  function pageKey() {
    var p = location.pathname || '';
    if (/military/i.test(p)) return 'military';
    if (/price/i.test(p)) return 'price';
    // Сторінки досліджень (/ct, /ct/contrast, /xray, /fluorography).
    var study = document.body && document.body.getAttribute('data-study');
    if (study) return 'study-' + study;
    return 'home';
  }

  function category() {
    return /military/i.test(location.pathname || '') ? 'military' : 'civilian';
  }

  // Статистика відвідувань (Umami через наш /stats; без cookies і без IP-адрес): сторінки, джерела
  // переходів, пристрої. Порожній скрипт, якщо Umami не налаштований.
  try {
    var umamiTag = document.createElement('script');
    umamiTag.src = '/stats/script.js';
    umamiTag.defer = true;
    document.head.appendChild(umamiTag);
  } catch (e) { /* аналітика не критична */ }

  // Публічний трекер: rosTrack('booking_started', { serviceCode });
  window.rosTrack = function (eventName, fields) {
    fields = fields || {};
    // Події воронки (крім переглядів — їх Umami рахує сам) — також у Umami.
    if (eventName !== 'page_view') {
      try {
        if (window.umami && typeof window.umami.track === 'function') {
          var data = { service: fields.serviceCode || '', category: fields.patientCategory || category(), page: fields.pageKey || pageKey() };
          if (fields.channel) data.channel = fields.channel;
          if (fields.place) data.place = fields.place;
          window.umami.track(eventName, data);
        }
      } catch (e) { /* аналітика не критична */ }
    }
    var jid = journeyId();
    if (!jid) return;
    try {
      fetch('/api/analytics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          eventName: eventName,
          journeyId: jid,
          serviceCode: fields.serviceCode || '',
          patientCategory: fields.patientCategory || category(),
          pageKey: fields.pageKey || pageKey(),
        }),
      }).catch(function () {});
    } catch (e) { /* аналітика не критична */ }
  };

  // Перегляд сторінки вітрини.
  window.rosTrack('page_view', {});

  // Натискання, що ведуть до запису (маркетинговий аудит 15.11.2026): дзвінок, месенджер, маршрут, e-mail,
  // «Записатися» біля послуги. Лише назва дії, канал, місце на сторінці й код послуги — без телефонів, імен, текстів.
  // Кнопки месенджерів у «Моя заявка» — <button>, їх рахує booking_started (d1-bridge.js), тут не дублюємо.
  function place(el) {
    var box = el.closest('#cartOverlay, section[id], header, footer');
    return box ? (box.id || box.tagName.toLowerCase()).slice(0, 32) : '';
  }
  function linkEvent(href) {
    if (/^tel:/i.test(href)) return ['call_click', 'phone'];
    if (/^mailto:/i.test(href)) return ['email_click', 'email'];
    if (/^viber:/i.test(href)) return ['messenger_click', 'viber'];
    if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href)) return ['messenger_click', 'whatsapp'];
    if (/^https?:\/\/t\.me\//i.test(href)) return ['messenger_click', 'telegram'];
    if (/^https?:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(href)) return ['route_click', 'google_maps'];
    return null;
  }
  try {
    document.addEventListener('click', function (e) {
      try {
        var t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        var a = t.closest('a[href]');
        if (a) {
          var ev = linkEvent(a.getAttribute('href') || '');
          if (ev) window.rosTrack(ev[0], { channel: ev[1], place: place(a) });
          return;
        }
        var add = t.closest('button.row-add');
        if (add) {
          // Прайс із CRM: код у data-code рядка; статичний прайс: у onclick="addToCart('101',…)".
          var row = add.closest('tr[data-code]');
          var m = /addToCart\('([0-9A-Za-z._-]{1,16})'/.exec(add.getAttribute('onclick') || '');
          var svc = String((row && row.getAttribute('data-code')) || (m && m[1]) || '');
          window.rosTrack('add_service', { serviceCode: /^[0-9A-Za-z._-]{1,16}$/.test(svc) ? svc : '' });
        }
      } catch (err) { /* аналітика не критична */ }
    }, true);
  } catch (e) { /* аналітика не критична */ }
})();

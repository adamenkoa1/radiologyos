/* RadiologyOS — приватна конверсійна аналітика публічного сайту.
   Використовує ТОЙ САМИЙ endpoint (/api/analytics) і той самий journey-id, що й
   Next-посадкові сторінки (lib/client-analytics), тож шлях відвідувача
   корелюється між вітриною й лендингами. Жодних персональних чи медичних даних:
   лише подія, випадковий journey-id (sessionStorage), код послуги, категорія
   пацієнта та ключ сторінки. Best-effort — збій аналітики ніколи не впливає на UX. */
(function () {
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
    return 'home';
  }

  function category() {
    return /military/i.test(location.pathname || '') ? 'military' : 'civilian';
  }

  // Публічний трекер: rosTrack('booking_started', { serviceCode });
  window.rosTrack = function (eventName, fields) {
    var jid = journeyId();
    if (!jid) return;
    fields = fields || {};
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
})();

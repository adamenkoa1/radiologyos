/* RadiologyOS — підказки з «Графіка роботи» (/api/public-hours) для кошика «Моя заявка».
   Порожній кошик: є години запису — «… Години запису: пн–пт 10:00–16:30.»; лише жива черга — «Запису немає —
   жива черга: …. Приходьте без заявки.». Без сервера — вбудований текст. Коли графік завантажено, сторінка
   отримує подію «schedule-hints» і перемальовує кошик. */
(function () {
  'use strict';
  var toMin = function (t) { var p = String(t).split(':'); return Number(p[0]) * 60 + Number(p[1]); };
  // «пн–пт 10:00–16:30, сб 09:00–12:00»: для кожного набору днів — від найранішого початку до найпізнішого кінця.
  function spanText(list) {
    var by = {}, order = [];
    list.forEach(function (h) {
      var g = by[h.days];
      if (!g) { g = by[h.days] = { from: h.start, to: h.end }; order.push(h.days); }
      if (toMin(h.start) < toMin(g.from)) g.from = h.start;
      if (toMin(h.end) > toMin(g.to)) g.to = h.end;
    });
    order.sort(function (a, b) { return (b === 'пн–пт') - (a === 'пн–пт'); });
    return order.map(function (d) { return d + ' ' + by[d].from + '–' + by[d].to; }).join(', ');
  }
  // Текст порожнього кошика для категорії; null — правил немає (лишається вбудований).
  function emptyCartText(hours, category, builtIn) {
    var plan = (hours || []).filter(function (h) { return h.category === category && h.mode !== 'urgent' && h.start && h.end; });
    if (!plan.length) return null;
    var booking = plan.filter(function (h) { return h.mode === 'booking'; });
    if (booking.length) return builtIn + ' Години запису: ' + spanText(booking) + '.';
    return 'Запису немає — жива черга: ' + spanText(plan) + '. Приходьте без заявки.';
  }
  // Підказка вибору часу у формі (поки дослідження не обрані) — так само рахує сервер (site-render.mjs).
  var TS_HINT = 'Оберіть дослідження та дату — тут з’являться вільні години';
  function timeHintText(hours, category) {
    var plan = (hours || []).filter(function (h) { return h.category === category && h.mode !== 'urgent' && h.start && h.end; });
    if (!plan.length) return null;
    var booking = plan.filter(function (h) { return h.mode === 'booking'; });
    return booking.length ? TS_HINT + '. Запис: ' + spanText(booking) + '.' : 'Запису немає — жива черга: ' + spanText(plan) + '. Приходьте без заявки.';
  }
  // Сторінка військових: підсумок під вступом — жива черга (з годинами), за записом (з годинами), екстрено.
  // Так само рахує сервер (site-render.mjs militarySummaryText).
  var COLUMNS = ['Флюорографія', 'Рентгенографія', 'Рентгенографія з контрастом', 'КТ', 'КТ з контрастом'];
  function columnOf(h) {
    var g = String(h.group || '');
    if (/флюорограф/i.test(g)) return 'Флюорографія';
    if (/контраст|барі/i.test(g)) return 'Рентгенографія з контрастом';
    if (h.kind === 'ctc') return 'КТ з контрастом';
    if (h.kind === 'ct') return 'КТ';
    if (!g) return 'Рентгенографія';
    g = g.replace(/^\d+\.\s*/, '').replace(/^Цифрова\s+/i, '');
    return g.charAt(0).toUpperCase() + g.slice(1);
  }
  function militarySummaryText(hours) {
    var mil = (hours || []).filter(function (h) { return h.category === 'military'; });
    var plan = mil.filter(function (h) { return h.mode !== 'urgent' && h.start && h.end; });
    if (!plan.length) return '';
    var low = function (c) { return /^КТ/.test(c) ? c : c.charAt(0).toLowerCase() + c.slice(1); };
    var order = function (a, b) { return COLUMNS.indexOf(a) - COLUMNS.indexOf(b); };
    var parts = [], queue = {}, qCols = [];
    plan.filter(function (h) { return h.mode === 'queue'; }).forEach(function (h) {
      var c = columnOf(h); if (!queue[c]) { queue[c] = []; qCols.push(c); } queue[c].push(h);
    });
    if (qCols.length) parts.push('Без запису, у живій черзі: ' + qCols.sort(order).map(function (c) { return low(c) + ' — ' + spanText(queue[c]); }).join('; ') + '.');
    var booking = plan.filter(function (h) { return h.mode === 'booking' && !queue[columnOf(h)]; });
    var bCols = [];
    booking.forEach(function (h) { var c = columnOf(h); if (bCols.indexOf(c) < 0) bCols.push(c); });
    if (bCols.length) parts.push('За попереднім записом: ' + bCols.sort(order).map(low).join(', ') + ' — ' + spanText(booking) + '.');
    var urgent = [];
    mil.forEach(function (h) { if (h.mode === 'urgent' && urgent.indexOf(h.text) < 0) urgent.push(h.text); });
    if (urgent.length) parts.push('Екстрено — ' + urgent.join(', ') + '.');
    return parts.join(' ');
  }
  // Прайс: підсумок прийому цивільних — для кожного стовпчика години запису (або живої черги, якщо запису немає),
  // стовпчики з однаковими годинами разом. Правило «Рентген» без папки — на три рентгенівські стовпчики,
  // правило папки — замість нього у своєму. Так само рахує сервер (site-render.mjs civilianSummaryText).
  function civilianSummaryText(hours) {
    var plan = (hours || []).filter(function (h) { return h.category === 'civilian' && h.mode !== 'urgent' && h.start && h.end; });
    if (!plan.length) return '';
    var low = function (c) { return /^КТ/.test(c) ? c : c.charAt(0).toLowerCase() + c.slice(1); };
    var cols = {}, specific = {};
    plan.forEach(function (h) {
      var c = h.kind === 'xray' && !h.group ? null : columnOf(h);
      (c ? [c] : ['Флюорографія', 'Рентгенографія', 'Рентгенографія з контрастом']).forEach(function (col) {
        if (c && !specific[col]) { specific[col] = true; cols[col] = []; } else if (!c && specific[col]) return;
        (cols[col] = cols[col] || []).push(h);
      });
    });
    var groups = { queue: { keys: [], map: {} }, booking: { keys: [], map: {} } };
    Object.keys(cols).sort(function (a, b) { return COLUMNS.indexOf(a) - COLUMNS.indexOf(b); }).forEach(function (col) {
      var list = cols[col], booking = list.filter(function (h) { return h.mode === 'booking'; });
      var g = groups[booking.length ? 'booking' : 'queue'], text = spanText(booking.length ? booking : list);
      if (!g.map[text]) { g.map[text] = []; g.keys.push(text); }
      g.map[text].push(low(col));
    });
    var line = function (g) { return g.keys.map(function (t) { return g.map[t].join(', ') + ' — ' + t; }).join('; '); };
    var parts = [];
    if (groups.queue.keys.length) parts.push('Без запису, у живій черзі: ' + line(groups.queue) + '.');
    if (groups.booking.keys.length) parts.push('За записом: ' + line(groups.booking) + '.');
    return parts.join(' ');
  }
  var api = window.ScheduleHints = { spanText: spanText, emptyCartText: emptyCartText, timeHintText: timeHintText, militarySummaryText: militarySummaryText, civilianSummaryText: civilianSummaryText, hours: null };
  api.emptyCart = function (category, builtIn) { return (api.hours && emptyCartText(api.hours, category, builtIn)) || builtIn; };
  api.timeHint = function (category) { return (api.hours && timeHintText(api.hours, category)) || null; };
  if (typeof fetch !== 'function' || typeof document === 'undefined') return;
  fetch('/api/public-hours', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !Array.isArray(d.hours) || !d.hours.length) return;
    api.hours = d.hours;
    try { document.dispatchEvent(new Event('schedule-hints')); } catch (e) { /* старий браузер */ }
  }).catch(function () {});
})();

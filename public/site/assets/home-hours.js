/* RadiologyOS — головна: «Як записатися» з графіка роботи CRM (/api/public-hours, «Довідники › Графік роботи»).
   Вкладки, мітки «Жива черга / За записом» і посилання стовпчиків, години під кнопкою, сама кнопка, «Моя заявка»,
   блок «екстрено». Підсумок прийому у вкладках — schedule-hints.js. Без сервера лишається вбудований у HTML текст. */
(function () {
  // Вкладки «Військовослужбовцям | Цивільним»: показується один варіант. Кнопки вгорі сторінки
  // (data-tab) і посилання #how-military / #how-civilian відкривають потрібну вкладку. Без JS видно обидва.
  (function tabs() {
    var section = document.getElementById('how');
    var bar = section && section.querySelector('.how-tabs');
    if (!bar) return;
    var cards = { military: document.getElementById('how-military'), civilian: document.getElementById('how-civilian') };
    function show(tab) {
      if (!cards[tab]) return;
      Object.keys(cards).forEach(function (k) { if (cards[k]) cards[k].classList.toggle('active', k === tab); });
      Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    }
    section.classList.add('tabbed'); bar.hidden = false;
    var fromHash = /^#how-(military|civilian)$/.exec(location.hash);
    show(fromHash ? fromHash[1] : 'military');
    bar.addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) show(b.dataset.tab); });
    Array.prototype.forEach.call(document.querySelectorAll('a[data-tab]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); show(a.dataset.tab); section.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', '#how-' + a.dataset.tab); });
    });
  })();

  var NICE ={ xray: 'Рентгенографія', ct: 'Комп’ютерна томографія', ctc: 'КТ з контрастуванням' };
  var CIV = { xray: 'Рентген і флюорографія', ct: 'Комп’ютерна томографія', ctc: 'КТ з контрастуванням' };
  var MODE = { queue: 'жива черга', booking: 'за записом' };
  var strip = function (g) { return String(g || '').replace(/^\d+\.\s*/, '').replace(/^Цифрова\s+/i, ''); };
  var upper = function (t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
  var lower = function (t) { return t && !/^[A-ZА-ЯЇІЄҐ]{2}/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; };
  var toMin = function (t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); };
  var hh = function (m) { return String(Math.floor(m / 60)).padStart(2, '0'); };
  var join = function (l) { return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' та ' + l[l.length - 1]; };
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  var nameOf = function (h) { return h.group ? upper(strip(h.group)) : NICE[h.kind]; };
  // Назви рядків графіка і їх порядок: флюорографія → рентгенографія → з контрастом → КТ → КТ з контрастом.
  var ORDER = ['Флюорографія', 'Рентгенографія', 'Рентген і флюорографія', 'Рентгенографія з контрастом', 'КТ', 'КТ з контрастом'];
  var chartName = function (h, civ) {
    var g = String(h.group || '');
    if (/флюорограф/i.test(g)) return 'Флюорографія';
    if (/контраст|барі/i.test(g)) return 'Рентгенографія з контрастом';
    if (h.kind === 'ctc') return 'КТ з контрастом';
    if (h.kind === 'ct') return 'КТ';
    return g ? upper(strip(g)) : (civ ? 'Рентген і флюорографія' : 'Рентгенографія');
  };
  var byOrder = function (a, b) { var x = ORDER.indexOf(a.label), y = ORDER.indexOf(b.label); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); };

  function daysNote(rules) {
    var d = {}; rules.forEach(function (h) { d[h.days] = 1; }); var k = Object.keys(d);
    return k.length === 1 ? k[0] : k.join('; ');
  }

  function military(hours) {
    var mil = hours.filter(function (h) { return h.category === 'military'; });
    var plan = mil.filter(function (h) { return h.mode !== 'urgent'; }).sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
    var queue = plan.filter(function (h) { return h.mode === 'queue'; });
    var booking = plan.filter(function (h) { return h.mode === 'booking'; });
    var urgent = mil.filter(function (h) { return h.mode === 'urgent'; });
    // Розклад дня: по рядку на дослідження (спершу жива черга, потім запис).
    var rows = [], idx = {};
    queue.concat(booking).forEach(function (h) {
      var key = chartName(h) + '|' + h.mode;
      if (!idx[key]) { idx[key] = { label: chartName(h), sub: MODE[h.mode], rules: [] }; rows.push(idx[key]); }
      idx[key].rules.push(h);
    });
    rows.sort(byOrder);
    rows.forEach(function (r) { r.sub += ' · ' + daysNote(r.rules) + ' · ' + r.rules.map(function (h) { return h.text; }).join(', '); });
    // Стовпчики досліджень (статичні в HTML): режим «жива черга / за записом» — з графіка, якщо рядок є в ньому.
    Array.prototype.forEach.call(document.querySelectorAll('#milSteps .study-col[data-row]'), function (card) {
      var modes = rows.filter(function (r) { return r.label === card.dataset.row; }).map(function (r) { return r.rules[0].mode; });
      var tag = card.querySelector('.how-tag');
      if (!tag || !modes.length) return;
      var queueMode = modes.indexOf('queue') >= 0;
      tag.className = 'how-tag ' + (queueMode ? 'q' : 'b');
      tag.textContent = queueMode ? 'Жива черга, без запису' : 'За попереднім записом';
      // Посилання внизу стовпчика: «… і запис →» лише там, де є години запису (так само рахує сервер).
      var go = card.querySelector('.sc-go');
      if (go) go.textContent = queueMode ? 'Перелік досліджень →' : 'Перелік і запис →';
    });
    // «Про відділення»: планові години = від найранішого до найпізнішого вікна військових (без ургентних).
    var ah = document.getElementById('aboutHours');
    if (ah && plan.length) ah.textContent = daysNote(queue.length ? queue : plan) + ' ' + plan.map(function (h) { return h.start; }).sort()[0] + '–' + plan.map(function (h) { return h.end; }).sort().slice(-1)[0];
    var u = document.querySelector('.how-urgent');
    if (u && !urgent.length) u.hidden = true;
  }

  function civilian(hours) {
    var civ = hours.filter(function (h) { return h.category === 'civilian' && h.mode === 'booking'; });
    var order = ['xray', 'ct', 'ctc'];
    var rows = [], idx = {};
    civ.sort(function (a, b) { return order.indexOf(a.kind) - order.indexOf(b.kind) || toMin(a.start) - toMin(b.start); }).forEach(function (h) {
      // Правило «Рентген» без папки діє на всі рентгенівські дослідження — показуємо його трьома рядками,
      // як у військових; правило для конкретної папки — лише в її рядку (і має пріоритет).
      var labels = h.kind === 'xray' && !h.group ? ['Флюорографія', 'Рентгенографія', 'Рентгенографія з контрастом'] : [chartName(h, true)];
      labels.forEach(function (label) {
        if (!idx[label]) { idx[label] = { label: label, sub: '', rules: [], specific: false }; rows.push(idx[label]); }
        if (h.group && !idx[label].specific) { idx[label].rules = []; idx[label].specific = true; }
        if (!h.group && idx[label].specific) return;
        idx[label].rules.push(h);
      });
    });
    rows.sort(byOrder);
    rows.forEach(function (r) { r.sub = daysNote(r.rules) + ' · ' + r.rules.map(function (h) { return h.text; }).join(', '); });
    // Мітки стовпчиків: «Запис на сайті» або «Жива черга, без запису» — з графіка (так само рахує сервер,
    // site-render.mjs). Правило «Рентген» без папки — на всі три рентгенівські стовпчики, правило папки — замість нього.
    var modes = {}, specific = {};
    hours.filter(function (h) { return h.category === 'civilian' && h.mode !== 'urgent'; }).forEach(function (h) {
      var c = h.kind === 'xray' && !h.group ? null : chartName(h, true);
      (c ? [c] : ['Флюорографія', 'Рентгенографія', 'Рентгенографія з контрастом']).forEach(function (col) {
        if (c) { if (!specific[col]) { specific[col] = true; delete modes[col]; } } else if (specific[col]) return;
        if (modes[col] !== 'queue') modes[col] = h.mode;
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#civSteps .study-col[data-row]'), function (card) {
      var mode = modes[card.dataset.row], tag = card.querySelector('.how-tag');
      if (!tag || !mode) return;
      tag.className = 'how-tag ' + (mode === 'queue' ? 'q' : 'b');
      tag.textContent = mode === 'queue' ? 'Жива черга, без запису' : 'Запис на сайті';
      var go = card.querySelector('.sc-go');
      if (go) go.textContent = mode === 'queue' ? 'Ціни →' : 'Ціни і запис →';
    });
  }

  // Рядок під кнопкою «Планові дослідження пн–пт 08:00–17:00»: для кожного набору днів — від найранішого
  // початку до найпізнішого кінця всіх планових вікон (жива черга й запис, усі категорії; без ургентних).
  function heroHours(hours) {
    var box = document.getElementById('heroHours');
    var plan = hours.filter(function (h) { return h.mode !== 'urgent' && h.start && h.end; });
    if (!box || !plan.length) return;
    var byDays = {}, order = [];
    plan.forEach(function (h) {
      var g = byDays[h.days];
      if (!g) { g = byDays[h.days] = { from: h.start, to: h.end }; order.push(h.days); }
      if (toMin(h.start) < toMin(g.from)) g.from = h.start;
      if (toMin(h.end) > toMin(g.to)) g.to = h.end;
    });
    // Будні — першими, далі решта в порядку появи.
    order.sort(function (a, b) { return (b === 'пн–пт') - (a === 'пн–пт'); });
    box.textContent = order.map(function (d) { return d + ' ' + byDays[d].from + '–' + byDays[d].to; }).join(', ');
  }

  // Головна кнопка (на прайс): «Записатися на дослідження», поки в цивільних є години запису; лише жива черга —
  // «Ціни та години прийому». Так само рахує сервер (site-render.mjs).
  function heroCta(hours) {
    var a = document.querySelector('.hero-cta');
    var civ = hours.filter(function (h) { return h.category === 'civilian' && h.mode !== 'urgent'; });
    if (!a || !civ.length) return;
    var booking = civ.some(function (h) { return h.mode === 'booking'; });
    a.textContent = booking ? 'Записатися на дослідження' : 'Ціни та години прийому';
    // «Моя заявка» — лише коли є що записати.
    Array.prototype.forEach.call(document.querySelectorAll('.floating-cart, .cart-button'), function (b) { b.style.display = booking ? '' : 'none'; });
  }

  fetch('/api/public-hours', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !Array.isArray(d.hours) || !d.hours.length) return;
    try { heroHours(d.hours); } catch (e) { /* лишається вбудований текст */ }
    try { heroCta(d.hours); } catch (e) { /* лишається вбудований текст */ }
    try { military(d.hours); } catch (e) { /* лишається вбудований текст */ }
    try { civilian(d.hours); } catch (e) { /* без розкладу */ }
  }).catch(function () {});
})();

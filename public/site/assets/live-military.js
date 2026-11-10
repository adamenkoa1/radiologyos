/* RadiologyOS — сторінка «Військовим»: один список з прайсу CRM (/api/public-services).
   Для військовослужбовців дослідження безкоштовні — ціни не показуються, код теж.
   Групи позначені кольором. Для груп «без запису, жива черга» (у вбудованому HTML
   немає кнопки запису) під їхніми позиціями лишається блок з графіком прийому.
   Якщо сервер недоступний — лишається вбудований у HTML список. */
(function () {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // Що знаємо з вбудованого HTML: які групи працюють у живій черзі та їхній графік.
  function readStaticGroups() {
    const info = {};
    document.querySelectorAll('main .price-group').forEach((section) => {
      const name = ((section.querySelector('h2') || {}).textContent || '').trim();
      if (!name) return;
      const schedule = section.querySelector('tr.schedule-row');
      info[name] = {
        queue: !section.querySelector('.military-book-btn, .military-book-head'),
        schedule: schedule ? schedule.cloneNode(true) : null
      };
    });
    return info;
  }

  function bookButton(svc) {
    const btn = el('button', 'military-book-btn', 'Записатися');
    btn.type = 'button';
    if (svc.availableToMilitary === false) {
      btn.disabled = true; btn.textContent = 'Тимчасово недоступно'; btn.title = 'Послугу вимкнено адміністратором';
    } else {
      btn.addEventListener('click', () => { if (typeof addMilitaryItem === 'function') addMilitaryItem(svc.code, svc.title); });
    }
    return btn;
  }

  // Графік із кабінету (/api/public-hours): для груп, де у військових лише «жива черга», будуємо блок графіка
  // з правил; інакше — запис кнопкою. Без даних з сервера — як у вбудованому HTML.
  const kindOfGroup = (g) => (/(^|[^A-Za-zА-Яа-яЇїІіЄєҐґ])КТ/.test(g) ? 'ct' : 'xray');
  function hoursInfo(hours, group) {
    const mil = hours.filter((h) => h.category === 'military');
    const kind = kindOfGroup(group);
    const own = (h) => h.group === group || (!h.group && (h.kind === kind || (kind === 'ct' && h.kind === 'ctc')));
    const queue = mil.filter((h) => h.mode === 'queue' && own(h));
    const booking = mil.filter((h) => h.mode === 'booking' && own(h) && (!h.group || h.group === group));
    if (!queue.length || booking.length) return null;
    const urgent = mil.filter((h) => h.mode === 'urgent' && !h.group && h.kind === kind);
    const row = el('tr', 'schedule-row');
    const td = el('td'); td.colSpan = 2;
    const box = el('div', 'shared-schedule');
    const line = (icon, strong, text) => { const d = el('div'); d.appendChild(el('span', 'schedule-icon', icon)); d.appendChild(el('strong', null, strong)); d.appendChild(document.createTextNode(' ' + text)); box.appendChild(d); };
    line('👥', 'Запису не потрібно.', 'Дослідження проводиться в порядку живої черги.');
    queue.forEach((h) => line('🗓', 'Планово:', `${h.days} ${h.text}.`));
    urgent.forEach((h) => line('🕒', 'Ургентно:', `${h.text}.`));
    queue.filter((h) => h.note).forEach((h) => line('ℹ️', '', h.note));
    td.appendChild(box); row.appendChild(td);
    return { queue: true, schedule: row };
  }

  function render(services, hours) {
    const sections = Array.from(document.querySelectorAll('main .price-group'));
    if (!sections.length) return;
    const staticInfo = readStaticGroups();
    const groupsInfo = new Proxy({}, { get: (_, g) => (hours ? hoursInfo(hours, g) || { queue: false, schedule: null } : staticInfo[g]) });
    const order = [];
    const byGroup = {};
    services.forEach((s) => { if (!byGroup[s.group]) { byGroup[s.group] = []; order.push(s.group); } byGroup[s.group].push(s); });

    const section = el('section', 'price-group open price-flat military');
    section.appendChild(el('h2', null, 'Перелік досліджень'));
    const table = el('table');
    table.innerHTML = '<thead><tr><th>Дослідження та що входить</th><th class="military-book-head"></th></tr></thead>';
    const tbody = el('tbody');
    order.forEach((group, gi) => {
      const info = groupsInfo[group] || { queue: false, schedule: null };
      const cls = 'g g' + (gi % 6);
      byGroup[group].forEach((svc, i) => {
        const tr = el('tr', cls + (i === 0 ? ' g-first' : ''));
        tr.dataset.code = svc.code;
        // Якорі для стовпчиків на головній: #fluorography, #xray, #xray-contrast, #ct, #ct-contrast, #ct-angio.
        if (i === 0) {
          const anchor = /ангіо/i.test(group) ? 'ct-angio' : /КТ з|з внутрішньовенним/i.test(group) ? 'ct-contrast' : /КТ/.test(group) ? 'ct'
            : /флюорограф/i.test(group) ? 'fluorography' : /контраст/i.test(group) ? 'xray-contrast' : 'xray';
          if (!document.getElementById(anchor)) tr.id = anchor;
        }
        const td = el('td');
        if (i === 0) td.appendChild(el('div', 'gtag', group.replace(/^\d+\.\s*/, '')));
        td.appendChild(el('div', 'service-title', svc.title));
        const helpEl = el('div', 'service-help', svc.help || ''); helpEl.appendChild(el('span', 'code-hint', 'код ' + svc.code)); td.appendChild(helpEl);
        tr.appendChild(td);
        const cell = el('td', 'military-book-cell');
        if (!info.queue) cell.appendChild(bookButton(svc));
        tr.appendChild(cell);
        tbody.appendChild(tr);
      });
      if (info.queue && info.schedule) {
        const row = info.schedule;
        row.className = 'schedule-row ' + cls;
        row.querySelectorAll('strong').forEach((s) => { s.textContent = s.textContent.replace(/^Для досліджень [\d–-]+ /, 'Для цих досліджень '); });
        tbody.appendChild(row);
      }
    });
    table.appendChild(tbody);
    section.appendChild(table);
    sections[0].parentNode.insertBefore(section, sections[0]);
    sections.forEach((s) => s.remove());
    section.querySelector('h2').addEventListener('click', () => section.classList.toggle('open'));
    // Перехід з головної за якорем: прокрутити до групи й коротко підсвітити її.
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.style.transition = 'outline-color .6s';
      target.style.outline = '3px solid #c9a227';
      setTimeout(() => { target.style.outlineColor = 'transparent'; }, 1800);
    }
  }

  const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([get('/api/public-services'), get('/api/public-hours')]).then(([d, h]) => {
    // «Моя заявка» — лише коли у військових є години запису (так само рахує сервер, site-render.mjs).
    const plan = h && Array.isArray(h.hours) ? h.hours.filter((x) => x.category === 'military' && x.mode !== 'urgent') : [];
    if (plan.length) document.querySelectorAll('.floating-cart, .cart-button').forEach((b) => { b.style.display = plan.some((x) => x.mode === 'booking') ? '' : 'none'; });
    if (d && Array.isArray(d.services) && d.services.length) render(d.services, h && Array.isArray(h.hours) && h.hours.length ? h.hours : null);
  });
})();

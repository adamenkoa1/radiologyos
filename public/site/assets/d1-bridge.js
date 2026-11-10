/* RadiologyOS — мінімалістичний запис через месенджер.
   Пацієнт обирає дослідження (кошик), вказує ПІБ + бажану дату й час і
   надсилає заявку адміністратору у Viber / WhatsApp або телефонує. Публічний
   сайт НЕ створює запис у базі, не вимагає телефон/пошту/дату народження,
   реєстрацію кабінету чи передоплату — заявку оформлює адміністратор із
   отриманого повідомлення. Підключається на index.html, price.html
   (цивільний кошик `cart`) і military.html (`militaryCart`). */
(function () {
  // Номер відділення: з «Тексти сайту» (site-texts.js), інакше — вбудований.
  const adminIntl = () => (window.SiteTexts && window.SiteTexts.phoneIntl) || '380972808899'; // для wa.me / viber

  const humanDate = (iso) => (iso ? String(iso).split('-').reverse().join('.') : '');
  const money = (n) => new Intl.NumberFormat('uk-UA').format(Number(n) || 0) + ' грн';

  // Нормалізує кошик до {code, name, price} — усе, що бачить пацієнт на сторінці.
  function cartItems(cartArr) {
    return (Array.isArray(cartArr) ? cartArr : [])
      .filter((x) => x && x.name)
      .map((x) => ({ code: x.code ? String(x.code) : '', name: String(x.name), price: Number(x.price) || 0 }));
  }

  // Текст заявки для месенджера. Передає адміністратору те саме, що пацієнт бачить
  // на сторінці: категорію, коди й назви досліджень, орієнтовну суму, бажаний слот.
  // Короткий номер заявки (без схожих символів I/O/0/1). Той самий номер іде в повідомлення
  // і в CRM («Заявки з сайту»), щоб реєстратура зіставила чат із записом.
  function requestCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(4);
    try { crypto.getRandomValues(bytes); } catch (e) { for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256); }
    return Array.from(bytes, (b) => abc[b % abc.length]).join('');
  }

  // Зберігає заявку на сервері у фоні (не затримує відкриття месенджера).
  function saveRequest(code, category, data, channel) {
    try {
      fetch('/api/site-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code, name: data.name, category: /військ/i.test(category) ? 'military' : 'civilian', channel,
          date: data.date, time: data.time, items: data.items.map((it) => ({ code: it.code }))
        }),
        keepalive: true,
      }).catch(() => {});
    } catch (e) { /* заявка все одно піде в месенджер */ }
  }

  // Час — точна година з «Графіка роботи» (/api/availability), яку пацієнт обрав у формі.

  function bookingMessage(name, category, items, date, time, code) {
    const lines = [`Добрий день! Хочу записатися на дослідження.${code ? ' Заявка №' + code : ''}`, `Пацієнт: ${name}`];
    if (category) lines.push(`Категорія: ${category}`);
    lines.push('Дослідження:');
    let total = 0;
    items.forEach((it) => {
      total += it.price;
      lines.push(`- ${it.code ? it.code + ' — ' : ''}${it.name}${it.price > 0 ? ' (' + money(it.price) + ')' : ''}`);
    });
    if (total > 0) lines.push(`Орієнтовна сума: ${money(total)} (уточнює відділення)`);
    lines.push(`Бажана дата: ${humanDate(date)}`);
    lines.push(`Зручний час: ${time || 'прошу запропонувати'}`);
    return lines.join('\n');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fallback нижче */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  let _toastTimer = null;
  function toast(text) {
    let el = document.getElementById('bookToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bookToast';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:200;max-width:min(92vw,420px);padding:13px 18px;border-radius:12px;background:#12303a;color:#fff;font-size:14px;line-height:1.4;box-shadow:0 10px 30px rgba(0,0,0,.28);text-align:center';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 5000);
  }

  function markInvalid(input, message) {
    if (!input) return;
    // Розгорнути згорнутий fallback (ручні дата/час), щоб помилку було видно.
    const det = input.closest('details');
    if (det) det.open = true;
    input.style.borderColor = '#d9705f';
    const wrap = input.closest('.field');
    const err = wrap ? wrap.querySelector('.field-error') : null;
    if (err) {
      // Опційне специфічне повідомлення (напр. «час уже минув»), зі збереженням
      // базового тексту, щоб потім відновити його.
      if (message != null) { if (err.dataset.base == null) err.dataset.base = err.textContent; err.textContent = message; }
      err.style.display = 'block';
    }
    try { input.focus(); } catch (e) {}
  }
  function clearInvalid(input) {
    if (!input) return;
    input.style.borderColor = '';
    const wrap = input.closest('.field');
    const err = wrap ? wrap.querySelector('.field-error') : null;
    if (err) { if (err.dataset.base != null) err.textContent = err.dataset.base; err.style.display = ''; }
  }

  // Дата й час у поясі клініки — щоб не дати вручну обрати момент, що вже минув
  // (слот-пікер це вже відсікає серверно; це guard для ручного fallback).
  function kyivToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function kyivNowTime() {
    return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace('.', ':');
  }

  // Прив'язує кнопки Viber/WhatsApp форми до месенджер-хендофу.
  // getCart() повертає масив обраних досліджень.
  function bindBooking(form, ids, getCart, category) {
    if (!form) return;
    const row = form.querySelector('.book-channels-row');
    if (row && !form.querySelector('.book-privacy')) {
      const note = document.createElement('p');
      note.className = 'book-privacy';
      note.style.cssText = 'font-size:12px;color:#5c6c78;margin:8px 0 0';
      note.textContent = 'Заявку (ПІБ, дослідження, бажаний день) буде збережено у відділенні для запису.';
      row.insertAdjacentElement('afterend', note);
    }
    const nameEl = document.getElementById(ids.name);
    const dateEl = document.getElementById(ids.date);
    const timeEl = document.getElementById(ids.time);
    // Нативний пікер дати не пропонує минулі дні (користувач усе ще може ввести
    // вручну — це перевіряє collect()).
    if (dateEl && dateEl.type === 'date' && !dateEl.min) dateEl.min = kyivToday();
    [nameEl, dateEl, timeEl].forEach((el) => {
      if (el) el.addEventListener('input', () => clearInvalid(el));
    });
    // Вибір часу: кнопки з вільними годинами на обраний день для обраних досліджень (сервер:
    // /api/availability). Зайняті й минулі години — неактивні.
    const slotBox = form.querySelector('.time-slots');
    let availNote = null;
    let offered = [];
    if (slotBox) {
      availNote = document.createElement('p');
      availNote.className = 'avail-note';
      availNote.style.cssText = 'font-size:12.5px;color:#9a3b2e;margin:6px 0 0;min-height:1em';
      slotBox.insertAdjacentElement('afterend', availNote);
      slotBox.addEventListener('click', (e) => {
        const b = e.target.closest('button.ts');
        if (!b || b.disabled) return;
        slotBox.querySelectorAll('button.ts').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        timeEl.value = b.dataset.time;
        clearInvalid(timeEl);
      });
    }
    // Дата за замовчуванням — сьогодні; якщо сьогодні вільного часу немає, сервер підкаже найближчий
    // день з вільним часом за «Графіком роботи» (nextFree), і форма сама перейде на нього (поки дату не обрали вручну).
    let autoDate = false;
    if (dateEl && slotBox && !dateEl.value) { dateEl.value = kyivToday(); autoDate = true; }
    if (dateEl) dateEl.addEventListener('change', () => { autoDate = false; });
    const bookButtons = () => form.querySelectorAll('button[data-book]');
    const dmy = (iso) => iso.split('-').reverse().join('.');
    // Підказка вибору часу, поки дослідження не обрані: години запису (або «жива черга») з «Графіка роботи»
    // (schedule-hints.js; сервер уже підставив те саме в HTML). Лише textContent.
    const hintCategory = /військ/i.test(category) ? 'military' : 'civilian';
    function timeHintEl() {
      const span = document.createElement('span');
      span.className = 'ts-hint';
      const shown = slotBox && slotBox.querySelector('.ts-hint'); // текст, який підставив сервер
      span.textContent = (window.ScheduleHints && window.ScheduleHints.timeHint(hintCategory))
        || (shown && shown.textContent) || 'Оберіть дослідження та дату — тут з’являться вільні години';
      return span;
    }
    document.addEventListener('schedule-hints', () => { if (slotBox && slotBox.querySelector('.ts-hint')) slotBox.replaceChildren(timeHintEl()); });
    let availSeq = 0;
    let offline = false;
    async function refreshAvailability() {
      if (!slotBox || !dateEl) return;
      const date = dateEl.value;
      const codes = cartItems(getCart()).map((it) => it.code).filter(Boolean);
      const seq = ++availSeq;
      if (!date || !codes.length) {
        offered = []; timeEl.value = '';
        bookButtons().forEach((b) => { b.disabled = false; b.title = ''; });
        slotBox.replaceChildren(timeHintEl());
        availNote.textContent = '';
        return;
      }
      let data;
      try {
        const r = await fetch(`/api/availability?date=${encodeURIComponent(date)}&codes=${encodeURIComponent(codes.join(','))}&category=${/військ/i.test(category) ? 'military' : 'civilian'}`, { cache: 'no-store' });
        data = r.ok ? await r.json() : (r.status >= 500 ? 'offline' : null);
      } catch (e) { data = 'offline'; }
      if (seq !== availSeq || !data) return;
      // Сервер відділення зараз недоступний (сайт у хмарі працює): вільний час не перевірити — заявку все одно
      // можна надіслати в месенджер, час запропонує реєстратура.
      offline = data === 'offline';
      if (offline) {
        offered = []; timeEl.value = '';
        bookButtons().forEach((b) => { b.disabled = false; b.title = ''; });
        const span = document.createElement('span');
        span.className = 'ts-hint';
        const hours = ((window.ScheduleHints && window.ScheduleHints.timeHint(hintCategory)) || '').replace(/^Оберіть[^.]*\.\s*/, '');
        span.textContent = (hours ? hours + ' ' : '') + 'Точний час підтвердить реєстратура.';
        slotBox.replaceChildren(span);
        availNote.textContent = 'Оберіть бажаний день і надішліть заявку в месенджер — реєстратура підтвердить точний час у відповідь.';
        availNote.style.color = '#0f6b6f';
        const modeEl = form.querySelector('.cart-mode');
        if (modeEl) modeEl.textContent = 'Прийом — у годину, яку підтвердить реєстратура, за записом.';
        return;
      }
      offered = data.slots;
      availNote.style.color = '#9a3b2e';
      const keep = data.slots.some((s) => s.time === timeEl.value && s.available) ? timeEl.value : '';
      timeEl.value = keep;
      slotBox.replaceChildren();
      let prev = null;
      data.slots.forEach((s) => {
        if (prev && prev !== s.period) { const sep = document.createElement('span'); sep.className = 'ts-sep'; slotBox.appendChild(sep); }
        prev = s.period;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ts' + (s.time === keep ? ' on' : ''); b.dataset.time = s.time; b.textContent = s.time;
        b.disabled = !s.available; b.setAttribute('aria-pressed', s.time === keep ? 'true' : 'false');
        if (!s.available) b.title = 'Зайнято';
        slotBox.appendChild(b);
      });
      // Години запису обраних досліджень з «Графіка роботи» — щоб було видно, на які дні й години записатися.
      const when = data.bookingHours ? ` (запис: ${data.bookingHours})` : '';
      if (!data.workday) availNote.textContent = `У цей день запису немає${when} — оберіть інший день.`;
      else if (data.past) availNote.textContent = 'Ця дата вже минула — оберіть інший день.';
      else if (data.down && data.down.length) availNote.textContent = 'На цей день апарат на технічному обслуговуванні — оберіть інший день.';
      else if (data.closed && data.closed.length) availNote.textContent = 'На цей день запису немає: ' + data.closed.join('; ') + '. Оберіть інший день.';
      else if (data.noStaff) availNote.textContent = 'На цей день прийому за записом немає — оберіть інший день.';
      else if (!data.slots.length) availNote.textContent = 'Обрані дослідження не можна провести в один час — подайте окремі заявки або зателефонуйте.';
      else if (!data.slots.some((s) => s.available)) availNote.textContent = `На цей день вільного часу немає${when} — оберіть інший день.`;
      else availNote.textContent = '';
      // Дослідження, які за «Графіком роботи» приймають лише в живій черзі: часу немає, запис через месенджер вимкнено.
      const queue = Array.isArray(data.queue) ? data.queue : [];
      const queueOnlyNow = queue.length > 0 && !data.slots.length;
      bookButtons().forEach((b) => { b.disabled = queueOnlyNow; b.title = queueOnlyNow ? 'Для цих досліджень запису немає — жива черга' : ''; });
      // Підказка в кошику «Прийом …» — для обраних досліджень (до вибору — за графіком категорії, з сервера).
      const mode = form.querySelector('.cart-mode');
      if (mode) mode.textContent = queueOnlyNow ? 'Прийом у порядку живої черги.' : 'Прийом — у вибрану годину, за записом.';
      if (queueOnlyNow) {
        const hours = [...new Set(queue.map((q) => `${q.days} ${q.text}`))].join('; ');
        const all = new Set(codes).size === new Set(queue.map((q) => q.code)).size;
        availNote.textContent = (all ? 'Ці дослідження — без запису, у порядку живої черги: ' : 'Частина обраних досліджень — без запису, у живій черзі: ')
          + hours + '. ' + (all ? 'Приходьте без заявки.' : 'Приберіть їх із заявки, щоб записатися на інші.');
        return;
      }
      // Вільного часу на цей день немає — найближчий день з вільним часом (з сервера).
      if (data.nextFree && !data.slots.some((s) => s.available)) {
        if (autoDate) { autoDate = false; dateEl.value = data.nextFree; refreshAvailability(); return; }
        const pick = document.createElement('button');
        pick.type = 'button'; pick.className = 'next-free';
        pick.style.cssText = 'margin-left:6px;border:0;background:none;padding:0;color:#0f6b6f;font:inherit;font-weight:800;text-decoration:underline;cursor:pointer';
        pick.textContent = 'Найближчий вільний день — ' + dmy(data.nextFree);
        pick.addEventListener('click', () => { dateEl.value = data.nextFree; clearInvalid(dateEl); refreshAvailability(); });
        availNote.appendChild(pick);
      }
    }
    if (slotBox) {
      dateEl.addEventListener('change', refreshAvailability);
      const list = form.closest('.cart-drawer') && form.closest('.cart-drawer').querySelector('#cartItems, #militaryCartItems');
      if (list && window.MutationObserver) new MutationObserver(() => refreshAvailability()).observe(list, { childList: true });
      let lastFocusRefresh = 0;
      form.addEventListener('focusin', () => { if (Date.now() - lastFocusRefresh > 15000) { lastFocusRefresh = Date.now(); refreshAvailability(); } });
      refreshAvailability();
    }

    function collect() {
      const items = cartItems(getCart());
      const name = (nameEl && nameEl.value || '').trim();
      const date = (dateEl && dateEl.value) || '';
      const time = (timeEl && timeEl.value) || '';
      if (!items.length) { alert('Оберіть щонайменше одне дослідження.'); return null; }
      if (!name) { markInvalid(nameEl); return null; }
      if (!date) { markInvalid(dateEl); return null; }
      if (offline && !time) {
        const today = kyivToday();
        if (date < today) { markInvalid(dateEl, 'Ця дата вже минула — оберіть сьогоднішню або пізнішу.'); return null; }
        return { items, name, date, time: '' };
      }
      if (!time) { markInvalid(timeEl, availNote && availNote.textContent ? availNote.textContent : 'Оберіть зручний час — натисніть на вільну годину.'); return null; }
      const today = kyivToday();
      if (date < today) { markInvalid(dateEl, 'Ця дата вже минула — оберіть сьогоднішню або пізнішу.'); return null; }
      if (date === today && time <= kyivNowTime()) { markInvalid(timeEl, 'Цей час сьогодні вже минув — оберіть пізніший.'); return null; }
      if (slotBox && !offered.some((s) => s.time === time && s.available)) { markInvalid(timeEl, 'Цей час уже зайнятий — оберіть інший.'); return null; }
      return { items, name, date, time };
    }

    form.querySelectorAll('[data-book]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const data = collect();
        if (!data) return; // блокуємо відкриття месенджера без обов'язкових полів
        // Конверсійна подія (best-effort, без персональних даних): пацієнт
        // почав запис через месенджер. Код першої обраної послуги — для воронки.
        if (window.rosTrack) {
          const first = getCart()[0] || {};
          window.rosTrack('booking_started', { serviceCode: first.code || '' });
        }
        const code = requestCode();
        const text = bookingMessage(data.name, category, data.items, data.date, data.time, code);
        const channel = ['viber', 'telegram'].includes(btn.dataset.book) ? btn.dataset.book : 'whatsapp';
        saveRequest(code, category, data, channel);
        if (btn.dataset.book === 'whatsapp') {
          window.open(`https://wa.me/${adminIntl()}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
          showBookConfirm(form, 'WhatsApp', text);
        } else if (btn.dataset.book === 'viber') {
          // Viber не дає підставити текст у чат конкретного контакту, тож
          // копіюємо заявку в буфер і відкриваємо чат адміністратора.
          const copied = await copyText(text);
          toast(copied
            ? 'Текст заявки скопійовано. Вставте його у повідомлення Viber'
            : 'Не вдалося скопіювати автоматично — текст заявки нижче, скопіюйте вручну або зателефонуйте');
          window.location.href = `viber://chat?number=%2B${adminIntl()}`;
          showBookConfirm(form, 'Viber', text);
        } else if (btn.dataset.book === 'telegram') {
          // Telegram теж не підставляє текст у чат контакту за номером — копіюємо заявку
          // і відкриваємо чат реєстратури в застосунку Telegram.
          const copied = await copyText(text);
          toast(copied
            ? 'Текст заявки скопійовано. Вставте його у повідомлення Telegram'
            : 'Не вдалося скопіювати автоматично — текст заявки нижче, скопіюйте вручну або зателефонуйте');
          window.location.href = `tg://resolve?phone=${adminIntl()}`;
          showBookConfirm(form, 'Telegram', text);
        }
      });
    });
  }

  // Підтвердження після відкриття месенджера: заявка вважається надісланою лише
  // після того, як користувач натисне «Надіслати». Нагадуємо про це й даємо
  // запасні шляхи (скопіювати текст / зателефонувати), якщо месенджер не відкрився.
  function showBookConfirm(form, channel, text) {
    let box = form.querySelector('.book-confirm');
    if (!box) {
      box = document.createElement('div');
      box.className = 'book-confirm';
      const anchor = form.querySelector('.book-channels');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
      else form.appendChild(box);
    }
    box.innerHTML =
      '<p class="book-confirm-title">Майже готово</p>' +
      '<p class="book-confirm-text">Ми відкрили ' + channel + '. Щоб завершити запис, <strong>надішліть підготовлене повідомлення</strong> адміністратору. Якщо ' + channel + ' не відкрився — скопіюйте текст заявки нижче або зателефонуйте.</p>' +
      '<textarea class="book-confirm-field" rows="6" readonly aria-label="Текст заявки"></textarea>' +
      '<div class="book-confirm-actions">' +
        '<button type="button" class="book-confirm-copy">Скопіювати текст заявки</button>' +
        '<a class="book-confirm-call" href="tel:+' + adminIntl() + '">Зателефонувати</a>' +
      '</div>';
    // Текст заявки завжди доступний для ручного копіювання — через value, не
    // innerHTML (містить введене пацієнтом ПІБ), і щоб буфер не був єдиною
    // точкою відмови, коли браузер блокує clipboard (напр. in-app webview).
    const field = box.querySelector('.book-confirm-field');
    if (field) field.value = text;
    const copyBtn = box.querySelector('.book-confirm-copy');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const copied = await copyText(text);
      if (copied) { toast('Текст заявки скопійовано'); }
      else { toast('Не вдалося скопіювати — виділіть текст вище і скопіюйте вручну'); if (field) { try { field.focus(); field.select(); } catch (e) {} } }
    });
    try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
  }

  // Вимикає кнопки додавання для тимчасово недоступних послуг (сервер — джерело
  // істини; тут лише підказка в UI).
  async function applyPublicServiceAvailability() {
    try {
      const response = await fetch('/api/public-services', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      const services = Array.isArray(data.services) ? data.services : [];
      if (!response.ok || !services.length) return;
      const militaryPage = /military/i.test(location.pathname);
      const byCode = Object.fromEntries(services.map((item) => [String(item.code), item]));
      document.querySelectorAll('button.row-add').forEach((button) => {
        const source = button.getAttribute('onclick') || '';
        const match = source.match(/\(['"]([^'"]+)['"]/);
        const item = match ? byCode[match[1]] : null;
        if (!item) return;
        const available = militaryPage ? item.availableToMilitary : item.availableToCivilian;
        button.disabled = !available;
        button.setAttribute('aria-disabled', available ? 'false' : 'true');
        if (!available) {
          button.textContent = 'Тимчасово недоступно';
          button.title = 'Послугу вимкнено адміністратором';
        }
      });
    } catch (e) { /* тиха підказка */ }
  }
  applyPublicServiceAvailability();

  bindBooking(
    document.getElementById('requestForm'),
    { name: 'patientName', date: 'desiredDate', time: 'desiredTime' },
    () => (typeof cart !== 'undefined' && Array.isArray(cart) ? cart : []),
    'Цивільний пацієнт',
  );
  bindBooking(
    document.getElementById('militaryRequestForm'),
    { name: 'militaryPatientName', date: 'militaryDesiredDate', time: 'militaryDesiredTime' },
    () => (typeof militaryCart !== 'undefined' && Array.isArray(militaryCart) ? militaryCart : []),
    'Військовослужбовець',
  );
})();

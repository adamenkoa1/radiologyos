/* RadiologyOS — мінімалістичний запис через месенджер.
   Пацієнт обирає дослідження (кошик), вказує ПІБ + бажану дату й час і
   надсилає заявку адміністратору у Viber / WhatsApp або телефонує. Публічний
   сайт НЕ створює запис у базі, не вимагає телефон/пошту/дату народження,
   реєстрацію кабінету чи передоплату — заявку оформлює адміністратор із
   отриманого повідомлення. Підключається на index.html, price.html
   (цивільний кошик `cart`) і military.html (`militaryCart`). */
(function () {
  const ADMIN_PHONE_INTL = '380972808899';       // для wa.me / viber
  const ADMIN_TEL = '+380972808899';             // для tel:

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
  function bookingMessage(name, category, items, date, time) {
    const lines = ['Добрий день! Хочу записатися на дослідження.', `Пацієнт: ${name}`];
    if (category) lines.push(`Категорія: ${category}`);
    lines.push('Дослідження:');
    let total = 0;
    items.forEach((it) => {
      total += it.price;
      lines.push(`- ${it.code ? it.code + ' — ' : ''}${it.name}${it.price > 0 ? ' (' + money(it.price) + ')' : ''}`);
    });
    if (total > 0) lines.push(`Орієнтовна сума: ${money(total)} (уточнює реєстратура)`);
    lines.push(`Бажана дата: ${humanDate(date)}`);
    lines.push(`Бажаний час: ${time}`);
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

  function markInvalid(input) {
    if (!input) return;
    // Розгорнути згорнутий fallback (ручні дата/час), щоб помилку було видно.
    const det = input.closest('details');
    if (det) det.open = true;
    input.style.borderColor = '#d9705f';
    const wrap = input.closest('.field');
    const err = wrap ? wrap.querySelector('.field-error') : null;
    if (err) err.style.display = 'block';
    try { input.focus(); } catch (e) {}
  }
  function clearInvalid(input) {
    if (!input) return;
    input.style.borderColor = '';
    const wrap = input.closest('.field');
    const err = wrap ? wrap.querySelector('.field-error') : null;
    if (err) err.style.display = '';
  }

  // Прив'язує кнопки Viber/WhatsApp форми до месенджер-хендофу.
  // getCart() повертає масив обраних досліджень.
  function bindBooking(form, ids, getCart, category) {
    if (!form) return;
    const nameEl = document.getElementById(ids.name);
    const dateEl = document.getElementById(ids.date);
    const timeEl = document.getElementById(ids.time);
    [nameEl, dateEl, timeEl].forEach((el) => {
      if (el) el.addEventListener('input', () => clearInvalid(el));
    });

    function collect() {
      const items = cartItems(getCart());
      const name = (nameEl && nameEl.value || '').trim();
      const date = (dateEl && dateEl.value) || '';
      const time = (timeEl && timeEl.value) || '';
      if (!items.length) { alert('Оберіть щонайменше одне дослідження.'); return null; }
      if (!name) { markInvalid(nameEl); return null; }
      if (!date) { markInvalid(dateEl); return null; }
      if (!time) { markInvalid(timeEl); return null; }
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
        const text = bookingMessage(data.name, category, data.items, data.date, data.time);
        if (btn.dataset.book === 'whatsapp') {
          window.open(`https://wa.me/${ADMIN_PHONE_INTL}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
          showBookConfirm(form, 'WhatsApp', text);
        } else if (btn.dataset.book === 'viber') {
          // Viber не дає підставити текст у чат конкретного контакту, тож
          // копіюємо заявку в буфер і відкриваємо чат адміністратора.
          await copyText(text);
          toast('Текст заявки скопійовано. Вставте його у повідомлення Viber');
          window.location.href = `viber://chat?number=%2B${ADMIN_PHONE_INTL}`;
          showBookConfirm(form, 'Viber', text);
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
      '<p class="book-confirm-text">Ми відкрили ' + channel + '. Щоб завершити запис, <strong>надішліть підготовлене повідомлення</strong> адміністратору. Якщо ' + channel + ' не відкрився — скопіюйте текст заявки або зателефонуйте.</p>' +
      '<div class="book-confirm-actions">' +
        '<button type="button" class="book-confirm-copy">Скопіювати текст заявки</button>' +
        '<a class="book-confirm-call" href="tel:' + ADMIN_TEL + '">Зателефонувати</a>' +
      '</div>';
    const copyBtn = box.querySelector('.book-confirm-copy');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      await copyText(text);
      toast('Текст заявки скопійовано');
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

/* RadiologyOS — міст між заявками v22 і базою даних відділення (D1).
   Перехоплює надсилання «Моєї заявки» (цивільна форма на index/price та
   військова форма на military) і зберігає її через /api/site-booking, щоб
   замовлення одразу з'являлось у кабінеті персоналу. Після надсилання показуємо
   попередньо призначені дату й час, номер заявки та її поточний статус. */
(function () {
  const PATIENT_PREFILL_KEY = 'radiologyos_patient_prefill_v1';

  // ПІБ пацієнта (клієнтське дзеркало серверного isPlausibleFullName): ≥3 токени
  // по ≥2 літери, укр-кирилиця/латиниця, апостроф/дефіс; без цифр і суто-
  // російських літер (ы/ъ/э/ё).
  const NAME_TOKEN = /^[А-ЩЬЮЯҐЄІЇа-щьюяґєіїA-Za-z][А-ЩЬЮЯҐЄІЇа-щьюяґєіїA-Za-z'’ʼ-]*$/;
  function fullNameOk(value) {
    const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 3) return false;
    return tokens.every((t) => t.length >= 2 && NAME_TOKEN.test(t));
  }

  // Сегментований віджет дати народження — спільний dob-widget.js
  // (window.enhanceDobSegments / window.adultDobLimit), той самий, що в кабінеті.
  const adultDobLimit = () => (typeof window.adultDobLimit === 'function'
    ? window.adultDobLimit()
    : new Date(new Date().getFullYear() - 18, new Date().getMonth(), new Date().getDate()).toISOString().slice(0, 10));

  function prepareIdentityFields(nameId, dobId) {
    const nameInput = document.getElementById(nameId);
    const dobInput = document.getElementById(dobId);
    if (dobInput) {
      dobInput.max = adultDobLimit();
      if (typeof window.enhanceDobSegments === 'function') window.enhanceDobSegments(dobInput);
    }
    if (nameInput) {
      // Дзеркалить серверний isPlausibleFullName: ≥3 токени по ≥2 літери,
      // укр-кирилиця/латиниця, апостроф/дефіс; без цифр і суто-російських літер.
      const validate = () => nameInput.setCustomValidity(
        fullNameOk(nameInput.value)
          ? ''
          : 'Вкажіть справжнє ПІБ українською — прізвище, ім’я та по батькові'
      );
      nameInput.addEventListener('input', validate);
      validate();
    }
  }

  // Persist the patient's own details so the next visit prefills automatically.
  // sessionStorage carries the cabinet auto-enter hint; localStorage keeps the
  // details across sessions on this device.
  const PATIENT_CACHE_KEY = 'radiologyos_patient_v1';
  function rememberPatient(phone, dob, name) {
    const phone9 = String(phone).replace(/\D/g, '').slice(-9);
    try {
      sessionStorage.setItem(PATIENT_PREFILL_KEY, JSON.stringify({ phone: phone9, dob: String(dob || ''), autoEnter: true }));
    } catch (e) { /* приватний режим може блокувати storage */ }
    try {
      localStorage.setItem(PATIENT_CACHE_KEY, JSON.stringify({ name: String(name || '').trim(), phone: phone9, dob: String(dob || '') }));
    } catch (e) { /* ignore */ }
  }

  function readPatientCache() {
    try { return JSON.parse(localStorage.getItem(PATIENT_CACHE_KEY) || 'null') || {}; }
    catch (e) { return {}; }
  }

  // Prefill the booking form from the cached details (only empty fields).
  // Must run before prepareIdentityFields so the date-of-birth dropdowns pick
  // up the saved value.
  function prefillPatientForm() {
    const c = readPatientCache();
    const phone9 = String(c.phone || '').replace(/\D/g, '').slice(-9);
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(String(c.dob || '')) ? c.dob : '';
    const set = (id, value) => { const el = document.getElementById(id); if (el && value && !el.value) el.value = value; };
    set('patientName', c.name); set('militaryPatientName', c.name);
    set('patientPhone', phone9); set('militaryPatientPhone', phone9);
    set('patientDob', dob); set('militaryPatientDob', dob);
  }

  prefillPatientForm();
  prepareIdentityFields('patientName', 'patientDob');
  prepareIdentityFields('militaryPatientName', 'militaryPatientDob');

  async function postBooking(payload, requestKey) {
    const journeyId = typeof radiologyAnalyticsJourney === 'function' ? radiologyAnalyticsJourney() : '';
    const firstServiceCode = Array.isArray(payload.items) && payload.items[0] ? String(payload.items[0].code || '') : '';
    if (typeof trackRadiologyAnalytics === 'function') {
      trackRadiologyAnalytics('booking_started', {
        serviceCode: firstServiceCode,
        patientCategory: payload.category === 'military' ? 'military' : 'civilian',
      });
    }
    const headers = { 'content-type': 'application/json', 'idempotency-key': requestKey };
    if (journeyId) headers['x-analytics-journey-id'] = journeyId;
    // Запобіжник: заявка не має «висіти» безкінечно. Той самий idempotency-key
    // зберігається на кнопці, тож повторне надсилання після таймауту безпечне
    // (сервер повертає вже збережений результат, а не дублює заявку).
    const controller = (typeof AbortController === 'function') ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
    let response;
    try {
      response = await fetch('/api/site-booking', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('Заявка надсилається довше, ніж очікувалося. Перевірте кабінет або зателефонуйте в реєстратуру: +380 97 280 88 99');
      }
      throw new Error('Немає зв’язку із сервером. Перевірте інтернет і спробуйте ще раз.');
    } finally {
      if (timer) clearTimeout(timer);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не вдалося надіслати заявку');
    return data;
  }

  // Civilian confirmation stays inside the drawer and offers payment right here:
  // the pay button/QR go through /api/site-payment (LiqPay checkout with the exact
  // amount when keys are set, static PrivatBank QR otherwise). The cabinet remains
  // one tap away for the exact amount and status.
  function showCivilSuccess(result) {
    const panel = document.getElementById('successPanel');
    const form = document.getElementById('requestForm');
    if (!panel || !form) { window.location.assign('/site/cabinet.html?new=1'); return; }
    const totalText = (document.getElementById('cartTotal') || {}).textContent || '';
    const summary = document.getElementById('successSummary');
    if (summary) {
      const codes = (result && Array.isArray(result.codes) && result.codes.length)
        ? result.codes.join(', ')
        : ((result && result.code) || '');
      summary.innerHTML =
        (codes ? `<div>Номер заявки: <strong>${codes}</strong></div>` : '') +
        (totalText ? `<div style="margin-top:4px">До сплати: <strong>${totalText}</strong></div>` : '');
    }
    form.hidden = true;
    panel.hidden = false;
    const totalRow = document.querySelector('.cart-total');
    if (totalRow) totalRow.style.display = 'none';
    const itemsBox = document.getElementById('cartItems');
    if (itemsBox) itemsBox.style.display = 'none';
    const codes = (result && Array.isArray(result.codes) && result.codes.length)
      ? result.codes
      : (result && result.code ? [result.code] : []);
    wirePayButton(codes);
    renderCalendarLinks(result);
    wireRegistrarWhatsApp(result);
    try { if (typeof saveCart === 'function') { cart = []; saveCart(); } } catch (e) {}
  }

  // Без шлюзу: WhatsApp відкривається з готовою копією заявки, а пацієнт
  // підтверджує відправлення одним натисканням у застосунку або WhatsApp Web.
  function wireRegistrarWhatsApp(result) {
    const link = document.getElementById('whatsappSubmitLink');
    if (!link) return;
    const codes = (result && Array.isArray(result.codes) && result.codes.length)
      ? result.codes.join(', ')
      : ((result && result.code) || '');
    const name = (document.getElementById('patientName') || {}).value || '';
    const phone9 = ((document.getElementById('patientPhone') || {}).value || '').replace(/\D/g, '');
    const phone = phone9 ? `+380${phone9}` : '';
    const comment = ((document.getElementById('comment') || {}).value || '').trim();
    const appointments = (result && Array.isArray(result.appointments)) ? result.appointments : [];
    const lines = [
      'Нова заявка з сайту',
      codes ? `Код: ${codes}` : '',
      name ? `Пацієнт: ${name}` : '',
      phone ? `Телефон: ${phone}` : '',
      ...appointments.map((item) => {
        const service = item && item.service ? item.service : 'Дослідження';
        const when = [item && item.date, item && item.time ? `о ${item.time}` : ''].filter(Boolean).join(' ');
        return `${service}${when ? ` — ${when}` : ''}`;
      }),
      comment ? `Коментар: ${comment}` : '',
    ].filter(Boolean);
    link.href = `https://wa.me/380972808899?text=${encodeURIComponent(lines.join('\n'))}`;
    link.hidden = false;
  }

  // «Додати в календар»: серверна відповідь несе готовий Google Calendar URL для
  // кожного візиту (lib/calendar-link). Малюємо через DOM (href/textContent), щоб
  // не думати про екранування.
  function renderCalendarLinks(result) {
    const box = document.getElementById('calendarBlock');
    if (!box) return;
    box.innerHTML = '';
    let any = false;
    const appts = (result && Array.isArray(result.appointments)) ? result.appointments : [];
    appts.forEach((appt) => {
      if (!appt || !appt.calendarUrl) return;
      const link = document.createElement('a');
      link.className = 'btn send-request';
      link.href = appt.calendarUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.style.cssText = 'background:#eef2f5;color:#0e454c;margin-bottom:6px';
      link.textContent = `＋ Додати в календар (${appt.date} ${appt.time})`;
      box.appendChild(link);
      any = true;
    });
    box.hidden = !any;
  }

  // Point the confirmation's pay button/QR at /api/site-payment for these codes:
  // it serves the LiqPay checkout with the exact amount when keys are set, or
  // redirects to the department's static PrivatBank QR otherwise.
  function wirePayButton(codes) {
    const block = document.getElementById('payBlock');
    if (!block) return;
    const list = (codes || []).filter(Boolean).map(String);
    if (!list.length) { block.hidden = true; return; }
    const payUrl = location.origin + '/api/site-payment?codes=' + encodeURIComponent(list.join(','));
    const btn = document.getElementById('payBtn');
    if (btn) { btn.href = payUrl; btn.hidden = false; }
    const qrBox = document.getElementById('payQr');
    if (qrBox && typeof qrcode === 'function') {
      try { const qr = qrcode(0, 'M'); qr.addData(payUrl); qr.make(); qrBox.innerHTML = qr.createImgTag(4, 6); }
      catch (e) { qrBox.innerHTML = ''; }
    }
    block.hidden = false;
  }

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
    } catch (e) { /* сервер додатково перевіряє доступність при надсиланні */ }
  }
  applyPublicServiceAvailability();

  // ----- Інлайн-валідація: показуємо помилку поля одразу на blur, а не лише
  // після сабміту. Правила вже задані нативно (pattern телефону, type=email) і
  // через setCustomValidity (ПІБ — enhanceIdentity, ДН — сегментований віджет),
  // тож тут лише таймінг фідбеку: підсвічуємо поле й показуємо .field-error, коли
  // воно «торкнуте» й невалідне; ховаємо, щойно стало валідним.
  function bindInlineValidation(form) {
    const fields = form.querySelectorAll('.field input, .field select');
    const reflect = (input) => {
      if (input.dataset.touched !== '1') return;
      const wrap = input.closest('.field');
      const err = wrap ? wrap.querySelector('.field-error') : null;
      const bad = !input.checkValidity();
      input.style.borderColor = bad ? '#d9705f' : '';
      if (err) err.style.display = bad ? 'block' : '';
    };
    fields.forEach((input) => {
      input.addEventListener('blur', () => { input.dataset.touched = '1'; reflect(input); });
      input.addEventListener('input', () => reflect(input));
      input.addEventListener('change', () => reflect(input));
    });
    return form;
  }

  // ----- Civilian request (index.html, price.html) -----
  const civilForm = document.getElementById('requestForm');
  if (civilForm) bindInlineValidation(civilForm);
  if (civilForm) {
    civilForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const items = (typeof cart !== 'undefined' && Array.isArray(cart)) ? cart : [];
      if (!items.length) { alert('Спочатку додайте послугу до заявки.'); return; }
      // Оновити кастомну валідність (ПІБ/ДН) перед перевіркою, навіть якщо поля не чіпали.
      ['patientName', 'patientDob', 'patientPhone'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { el.dataset.touched = '1'; el.dispatchEvent(new Event('input')); }
      });
      if (!civilForm.checkValidity()) { civilForm.classList.add('was-validated'); const bad = civilForm.querySelector(':invalid'); if (bad) bad.focus(); return; }

      const catSel = document.getElementById('patientCategory');
      const category = catSel
        ? (catSel.value === 'military' ? 'military' : 'civilian')
        : (/military/i.test(location.pathname) ? 'military' : 'civilian');

      const name = document.getElementById('patientName').value.trim();
      const phone = '+380' + document.getElementById('patientPhone').value.replace(/\D/g, '');
      const dob = (document.getElementById('patientDob') || {}).value || '';
      const email = ((document.getElementById('patientEmail') || {}).value || '').trim();
      const desiredDate = (typeof pickedSlot !== 'undefined' && pickedSlot && pickedSlot.date) ? pickedSlot.date : '';
      const desiredTime = (typeof pickedSlot !== 'undefined' && pickedSlot && pickedSlot.time) ? pickedSlot.time : '';
      const referralType = category === 'military' ? 'military_referral' : 'other';
      const comment = (document.getElementById('comment') || {}).value?.trim() || '';
      const source = (typeof getTrafficSource === 'function') ? getTrafficSource() : '';

      const submitBtn = civilForm.querySelector('.send-request');
      const submitLabel = submitBtn ? submitBtn.textContent : '';
      const requestKey = (submitBtn && submitBtn.dataset.idempotencyKey)
        || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
      if (submitBtn) submitBtn.dataset.idempotencyKey = requestKey;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Надсилаємо…'; }
      try {
        const result = await postBooking({
          name, phone, dob, email, category, referralType, comment, desiredDate, desiredTime, source,
          consent: true, consentVersion: '2026-07-29',
          items: items.map((x) => ({ code: String(x.code) })),
        }, requestKey);
        if (submitBtn) delete submitBtn.dataset.idempotencyKey;
        rememberPatient(phone, dob, name);
        try { sessionStorage.setItem('radiologyos_last_booking_v1', JSON.stringify(result)); } catch (e) {}
        showCivilSuccess(result);
      } catch (error) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel || 'Сформувати заявку'; }
        alert((error && error.message) || 'Не вдалося надіслати заявку. Зателефонуйте в реєстратуру: +380 97 280 88 99');
      }
    }, true);
  }

  // ----- Military request — free, category "military" (military.html) -----
  const milForm = document.getElementById('militaryRequestForm');
  if (milForm) bindInlineValidation(milForm);
  if (milForm) {
    milForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const items = (typeof militaryCart !== 'undefined' && Array.isArray(militaryCart)) ? militaryCart : [];
      if (!items.length) { alert('Оберіть хоча б одне дослідження.'); return; }
      // Оновити кастомну валідність (ПІБ/ДН) перед перевіркою, навіть якщо поля не чіпали.
      ['militaryPatientName', 'militaryPatientDob', 'militaryPatientPhone'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { el.dataset.touched = '1'; el.dispatchEvent(new Event('input')); }
      });
      if (!milForm.checkValidity()) { milForm.classList.add('was-validated'); const bad = milForm.querySelector(':invalid'); if (bad) bad.focus(); return; }

      const name = document.getElementById('militaryPatientName').value.trim();
      const phone = '+380' + document.getElementById('militaryPatientPhone').value.replace(/\D/g, '');
      const dob = (document.getElementById('militaryPatientDob') || {}).value || '';
      const email = ((document.getElementById('militaryPatientEmail') || {}).value || '').trim();
      const commentRaw = (document.getElementById('militaryComment') || {}).value || '';
      const comment = commentRaw.trim();
      const desiredDate = '';
      const desiredTime = '';
      const source = (typeof getTrafficSource === 'function') ? getTrafficSource() : '';

      const submitBtn = milForm.querySelector('.send-request');
      const submitLabel = submitBtn ? submitBtn.textContent : '';
      const requestKey = (submitBtn && submitBtn.dataset.idempotencyKey)
        || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
      if (submitBtn) submitBtn.dataset.idempotencyKey = requestKey;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Надсилаємо…'; }
      try {
        const result = await postBooking({
          name, phone, dob, email, category: 'military', referralType: 'military_referral',
          comment, desiredDate, desiredTime, source,
          consent: true, consentVersion: '2026-07-29',
          items: items.map((x) => ({ code: String(x.code) })),
        }, requestKey);
        if (submitBtn) delete submitBtn.dataset.idempotencyKey;
        rememberPatient(phone, dob, name);
        try { sessionStorage.setItem('radiologyos_last_booking_v1', JSON.stringify(result)); } catch (e) {}
        window.location.assign('/site/cabinet.html?new=1');
      } catch (error) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel || 'Надіслати заявку'; }
        alert((error && error.message) || 'Не вдалося надіслати заявку. Зателефонуйте в реєстратуру: +380 97 280 88 99');
      }
    }, true);
  }
})();

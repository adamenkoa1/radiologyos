/* RadiologyOS — міст між заявками v22 і базою даних відділення (D1).
   Перехоплює надсилання «Моєї заявки» (цивільна форма на index/price та
   військова форма на military) і зберігає її через /api/site-booking, щоб
   замовлення одразу з'являлось у кабінеті персоналу. Після надсилання показуємо
   попередньо призначені дату й час, номер заявки та її поточний статус. */
(function () {
  const PATIENT_PREFILL_KEY = 'radiologyos_patient_prefill_v1';

  function adultDobLimit() {
    const today = new Date();
    const limit = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
    const y = limit.getFullYear();
    const m = String(limit.getMonth() + 1).padStart(2, '0');
    const d = String(limit.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function enhanceDobInput(dobInput) {
    if (!dobInput || dobInput.dataset.segmented === 'true') return;
    dobInput.dataset.segmented = 'true';

    const previousValue = dobInput.value || '';
    const group = document.createElement('div');
    group.className = 'dob-segmented';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Дата народження: день, місяць і рік');

    const makeSelect = (suffix, label, placeholder) => {
      const select = document.createElement('select');
      select.id = `${dobInput.id}${suffix}`;
      select.required = true;
      select.setAttribute('aria-label', label);
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = placeholder;
      select.appendChild(empty);
      return select;
    };

    const day = makeSelect('Day', 'День народження', 'День');
    const month = makeSelect('Month', 'Місяць народження', 'Місяць');
    const year = makeSelect('Year', 'Рік народження', 'Рік');
    const monthNames = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
    monthNames.forEach((name, index) => {
      const option = document.createElement('option');
      option.value = String(index + 1);
      option.textContent = name;
      month.appendChild(option);
    });
    const lastAdultYear = Number(adultDobLimit().slice(0, 4));
    for (let value = lastAdultYear; value >= 1900; value -= 1) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = String(value);
      year.appendChild(option);
    }

    const fillDays = () => {
      const selected = day.value;
      const max = month.value && year.value
        ? new Date(Number(year.value), Number(month.value), 0).getDate()
        : 31;
      while (day.options.length > 1) day.remove(1);
      for (let value = 1; value <= max; value += 1) {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = String(value);
        day.appendChild(option);
      }
      if (Number(selected) <= max) day.value = selected;
    };

    const sync = () => {
      day.setCustomValidity('');
      if (!day.value || !month.value || !year.value) {
        dobInput.value = '';
        return;
      }
      const iso = `${year.value}-${String(month.value).padStart(2, '0')}-${String(day.value).padStart(2, '0')}`;
      if (iso > adultDobLimit()) {
        dobInput.value = '';
        year.setCustomValidity('Онлайн-запис доступний пацієнтам від 18 років');
        return;
      }
      year.setCustomValidity('');
      dobInput.value = iso;
    };

    group.append(day, month, year);
    dobInput.insertAdjacentElement('beforebegin', group);
    dobInput.type = 'hidden';
    dobInput.required = false;

    if (!document.getElementById('radiologyDobSegmentedStyles')) {
      const style = document.createElement('style');
      style.id = 'radiologyDobSegmentedStyles';
      style.textContent = '.dob-segmented{display:grid;grid-template-columns:.72fr 1.38fr 1fr;gap:8px}.dob-segmented select{width:100%;min-width:0;padding:12px 9px;border:1px solid #dbe3e8;border-radius:11px;background:#fff;color:#0e161c;font:inherit;font-size:16px}.dob-segmented select:focus-visible{outline:2px solid var(--brand,#0c7a85);outline-offset:1px}.was-validated .dob-segmented select:invalid{border-color:#d9705f;background:#fdf0ee}@media(max-width:390px){.dob-segmented{grid-template-columns:.68fr 1.42fr .9fr;gap:6px}.dob-segmented select{padding:11px 6px;font-size:15px}}';
      document.head.appendChild(style);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(previousValue)) {
      const [savedYear, savedMonth, savedDay] = previousValue.split('-').map(Number);
      year.value = String(savedYear);
      month.value = String(savedMonth);
      fillDays();
      day.value = String(savedDay);
    } else {
      fillDays();
    }
    month.addEventListener('change', () => { fillDays(); sync(); });
    year.addEventListener('change', () => { fillDays(); sync(); });
    day.addEventListener('change', sync);
    sync();
  }

  function prepareIdentityFields(nameId, dobId) {
    const nameInput = document.getElementById(nameId);
    const dobInput = document.getElementById(dobId);
    if (dobInput) {
      dobInput.max = adultDobLimit();
      enhanceDobInput(dobInput);
    }
    if (nameInput) {
      const validate = () => nameInput.setCustomValidity(
        nameInput.value.trim().split(/\s+/).filter(Boolean).length >= 3
          ? ''
          : 'Вкажіть прізвище, ім’я та по батькові повністю'
      );
      nameInput.addEventListener('input', validate);
      validate();
    }
  }

  function rememberPatient(phone, dob) {
    try {
      sessionStorage.setItem(PATIENT_PREFILL_KEY, JSON.stringify({
        phone: String(phone).replace(/\D/g, '').slice(-9),
        dob: String(dob || ''),
        autoEnter: true,
      }));
    } catch (e) { /* приватний режим може блокувати storage */ }
  }

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
    const response = await fetch('/api/site-booking', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не вдалося надіслати заявку');
    return data;
  }

  // Fill the confirmation screen's payment block from the department pay link.
  async function populatePayBlock() {
    const block = document.getElementById('payBlock');
    if (!block) return;
    try {
      const res = await fetch('/api/pay-link', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const link = (data && data.payLink) || '';
      if (!link) { block.hidden = true; return; }
      const btn = document.getElementById('payBtn');
      // The button must be a real link; a raw bank-QR payload is scan-only.
      if (btn) {
        if (/^https?:\/\//i.test(link)) { btn.href = link; btn.hidden = false; }
        else { btn.removeAttribute('href'); btn.hidden = true; }
      }
      const qrBox = document.getElementById('payQr');
      if (qrBox && typeof qrcode === 'function') {
        try { const qr = qrcode(0, 'M'); qr.addData(link); qr.make(); qrBox.innerHTML = qr.createImgTag(4, 6); }
        catch (e) { qrBox.innerHTML = ''; }
      }
      block.hidden = false;
    } catch (e) { /* leave hidden on failure */ }
  }

  // Civilian confirmation stays inside the drawer and offers payment right here:
  // the pay button/QR redirect to the department PrivatBank link (see /api/pay-link).
  // The cabinet remains one tap away for the exact amount and status.
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
    populatePayBlock();
    try { if (typeof saveCart === 'function') { cart = []; saveCart(); } } catch (e) {}
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

  // ----- Civilian request (index.html, price.html) -----
  const civilForm = document.getElementById('requestForm');
  if (civilForm) {
    civilForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const items = (typeof cart !== 'undefined' && Array.isArray(cart)) ? cart : [];
      if (!items.length) { alert('Спочатку додайте послугу до заявки.'); return; }
      const nameInput = document.getElementById('patientName');
      if (nameInput) nameInput.dispatchEvent(new Event('input'));
      if (!civilForm.checkValidity()) { civilForm.classList.add('was-validated'); const bad = civilForm.querySelector(':invalid'); if (bad) bad.focus(); return; }

      const catSel = document.getElementById('patientCategory');
      const category = catSel
        ? (catSel.value === 'military' ? 'military' : 'civilian')
        : (/military/i.test(location.pathname) ? 'military' : 'civilian');

      const name = document.getElementById('patientName').value.trim();
      const phone = '+380' + document.getElementById('patientPhone').value.replace(/\D/g, '');
      const dob = (document.getElementById('patientDob') || {}).value || '';
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
          name, phone, dob, category, referralType, comment, desiredDate, desiredTime, source,
          consent: true, consentVersion: '2026-07-29',
          items: items.map((x) => ({ code: String(x.code) })),
        }, requestKey);
        if (submitBtn) delete submitBtn.dataset.idempotencyKey;
        rememberPatient(phone, dob);
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
  if (milForm) {
    milForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const items = (typeof militaryCart !== 'undefined' && Array.isArray(militaryCart)) ? militaryCart : [];
      if (!items.length) { alert('Оберіть хоча б одне дослідження.'); return; }
      const nameInput = document.getElementById('militaryPatientName');
      if (nameInput) nameInput.dispatchEvent(new Event('input'));
      if (!milForm.checkValidity()) { milForm.classList.add('was-validated'); const bad = milForm.querySelector(':invalid'); if (bad) bad.focus(); return; }

      const name = document.getElementById('militaryPatientName').value.trim();
      const phone = '+380' + document.getElementById('militaryPatientPhone').value.replace(/\D/g, '');
      const dob = (document.getElementById('militaryPatientDob') || {}).value || '';
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
          name, phone, dob, category: 'military', referralType: 'military_referral',
          comment, desiredDate, desiredTime, source,
          consent: true, consentVersion: '2026-07-29',
          items: items.map((x) => ({ code: String(x.code) })),
        }, requestKey);
        if (submitBtn) delete submitBtn.dataset.idempotencyKey;
        rememberPatient(phone, dob);
        try { sessionStorage.setItem('radiologyos_last_booking_v1', JSON.stringify(result)); } catch (e) {}
        window.location.assign('/site/cabinet.html?new=1');
      } catch (error) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel || 'Надіслати заявку'; }
        alert((error && error.message) || 'Не вдалося надіслати заявку. Зателефонуйте в реєстратуру: +380 97 280 88 99');
      }
    }, true);
  }
})();
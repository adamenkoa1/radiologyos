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

  function prepareIdentityFields(nameId, dobId) {
    const nameInput = document.getElementById(nameId);
    const dobInput = document.getElementById(dobId);
    if (dobInput) dobInput.max = adultDobLimit();
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
    const response = await fetch('/api/site-booking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': requestKey },
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

      // Category comes from the form selector when present (home page), else the page.
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
        window.location.assign('/site/cabinet.html?new=1');
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

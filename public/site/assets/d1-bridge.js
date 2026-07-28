/* RadiologyOS — міст між заявками v22 і базою даних відділення (D1).
   Перехоплює надсилання «Моєї заявки» (цивільна форма на index/price та
   військова форма на military) і зберігає її через /api/site-booking, щоб
   замовлення одразу з'являлось у кабінеті персоналу. Екрани «Заявку прийнято»
   лишаємо від v22 — додаємо лише реальний код заявки. */
(function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const humanDate = (iso) => (iso ? String(iso).split('-').reverse().join('.') : '');
  const REFERRAL_MAP = {
    'Є направлення': 'paper_referral',
    'Направлення ще немає': 'none',
    'Потрібна консультація': 'other',
  };

  function codesLine(codes) {
    if (!codes.length) return '';
    return `<div style="margin-top:6px"><strong>${codes.length > 1 ? 'Коди заявок' : 'Код заявки'}:</strong> ${codes.map(esc).join(', ')}</div>` +
      `<div style="margin-top:4px;color:#4e5d46;font-size:13px">Збережіть код — за ним і номером телефону можна відстежити статус у кабінеті пацієнта.</div>`;
  }

  async function postBooking(payload) {
    const response = await fetch('/api/site-booking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не вдалося надіслати заявку');
    return data.codes || (data.code ? [data.code] : []);
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
      if (btn) btn.href = link;
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
      if (!civilForm.checkValidity()) { civilForm.classList.add('was-validated'); const bad = civilForm.querySelector(':invalid'); if (bad) bad.focus(); return; }

      // Category comes from the form selector when present (home page), else the page.
      const catSel = document.getElementById('patientCategory');
      const category = catSel
        ? (catSel.value === 'military' ? 'military' : 'civilian')
        : (/military/i.test(location.pathname) ? 'military' : 'civilian');

      const name = document.getElementById('patientName').value.trim();
      const phone = '+380' + document.getElementById('patientPhone').value.replace(/\D/g, '');
      const picked = (typeof pickedSlot !== 'undefined') ? pickedSlot : { date: '', time: '' };
      const desiredDate = picked.date || document.getElementById('desiredDate').value || '';
      const desiredTime = picked.time || document.getElementById('desiredTime').value || '';
      const referralType = category === 'military'
        ? 'military_referral'
        : (REFERRAL_MAP[document.getElementById('referral').value] || 'other');
      const comment = document.getElementById('comment').value.trim();
      const source = (typeof getTrafficSource === 'function') ? getTrafficSource() : '';

      const submitBtn = civilForm.querySelector('.send-request');
      const submitLabel = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Надсилаємо…'; }
      try {
        const codes = await postBooking({ name, phone, category, referralType, comment, desiredDate, desiredTime, source, items: items.map((x) => ({ code: String(x.code) })) });
        if (typeof showSuccess === 'function') {
          showSuccess(
            `<div><strong>Дослідження:</strong> ${items.map((x) => esc(x.name)).join('; ')}</div>` +
            (desiredDate ? `<div><strong>Бажана дата:</strong> ${esc(humanDate(desiredDate))}${desiredTime ? ' о ' + esc(desiredTime) : ''}</div>` : '') +
            `<div><strong>Телефон для зв'язку:</strong> ${esc(phone)}</div>` + codesLine(codes)
          );
        }
        const offline = document.getElementById('offlineNote');
        if (offline) offline.hidden = true;
        if (category === 'civilian') populatePayBlock();
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
      if (!milForm.checkValidity()) { milForm.classList.add('was-validated'); const bad = milForm.querySelector(':invalid'); if (bad) bad.focus(); return; }

      const name = document.getElementById('militaryPatientName').value.trim();
      const phone = '+380' + document.getElementById('militaryPatientPhone').value.replace(/\D/g, '');
      const picked = window.milPickedSlot || { date: '', time: '' };
      const desiredDate = picked.date || document.getElementById('militaryDesiredDate').value || '';
      const desiredTime = picked.time || document.getElementById('militaryDesiredTime').value || '';
      const refText = (document.getElementById('militaryReferral') || {}).value || '';
      const commentRaw = (document.getElementById('militaryComment') || {}).value || '';
      const comment = [refText, commentRaw.trim()].filter(Boolean).join('. ');
      const source = (typeof getTrafficSource === 'function') ? getTrafficSource() : '';

      const submitBtn = milForm.querySelector('.send-request');
      const submitLabel = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Надсилаємо…'; }
      try {
        const codes = await postBooking({
          name, phone, category: 'military', referralType: 'military_referral',
          comment, desiredDate, desiredTime, source,
          items: items.map((x) => ({ code: String(x.code) })),
        });
        const summary = document.getElementById('milSuccessSummary');
        if (summary) {
          summary.innerHTML =
            `<div><strong>Дослідження:</strong> ${items.map((x) => esc(x.name)).join('; ')}</div>` +
            (desiredDate ? `<div><strong>Бажана дата:</strong> ${esc(humanDate(desiredDate))}${desiredTime ? ' о ' + esc(desiredTime) : ''}</div>` : '') +
            `<div><strong>Телефон для зв'язку:</strong> ${esc(phone)}</div>` + codesLine(codes);
        }
        const milOffline = document.getElementById('milOfflineNote');
        if (milOffline) milOffline.hidden = true;
        milForm.hidden = true;
        const panel = document.getElementById('milSuccessPanel');
        if (panel) panel.hidden = false;
        const milList = document.getElementById('militaryCartItems');
        if (milList) milList.style.display = 'none';
        if (typeof militaryCart !== 'undefined') { militaryCart.length = 0; if (typeof saveMilitaryCart === 'function') saveMilitaryCart(); }
      } catch (error) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel || 'Надіслати заявку'; }
        alert((error && error.message) || 'Не вдалося надіслати заявку. Зателефонуйте в реєстратуру: +380 97 280 88 99');
      }
    }, true);
  }
})();

/* RadiologyOS — міст між заявкою v22 і базою даних відділення (D1).
   Перехоплює надсилання «Моєї заявки» й зберігає її через /api/site-booking,
   щоб замовлення з сайту одразу з'являлось у кабінеті персоналу. Форму й
   екран «Заявку прийнято» лишаємо від v22 — додаємо лише реальний код заявки. */
(function () {
  const form = document.getElementById('requestForm');
  if (!form) return;

  const category = /military/i.test(location.pathname) ? 'military' : 'civilian';
  const REFERRAL_MAP = {
    'Є направлення': 'paper_referral',
    'Направлення ще немає': 'none',
    'Потрібна консультація': 'other',
  };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const humanDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

  // Capture phase: run before cart.js's own submit handler and take over.
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const items = (typeof cart !== 'undefined' && Array.isArray(cart)) ? cart : [];
    if (!items.length) { alert('Спочатку додайте послугу до заявки.'); return; }
    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      const bad = form.querySelector(':invalid');
      if (bad) bad.focus();
      return;
    }

    const name = document.getElementById('patientName').value.trim();
    const phone = '+380' + document.getElementById('patientPhone').value.replace(/\D/g, '');
    const picked = (typeof pickedSlot !== 'undefined') ? pickedSlot : { date: '', time: '' };
    const desiredDate = picked.date || document.getElementById('desiredDate').value || '';
    const desiredTime = picked.time || document.getElementById('desiredTime').value || '';
    const referralType = REFERRAL_MAP[document.getElementById('referral').value] || 'other';
    const comment = document.getElementById('comment').value.trim();
    const source = (typeof getTrafficSource === 'function') ? getTrafficSource() : '';

    const submitBtn = form.querySelector('.send-request');
    const submitLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Надсилаємо…'; }

    try {
      const response = await fetch('/api/site-booking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name, phone, category, referralType, comment, desiredDate, desiredTime, source,
          items: items.map((x) => ({ code: String(x.code) })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не вдалося надіслати заявку');

      const codes = data.codes || (data.code ? [data.code] : []);
      const names = items.map((x) => esc(x.name)).join('; ');
      // showSuccess() belongs to cart.js — it clears the cart and swaps in the panel.
      if (typeof showSuccess === 'function') {
        showSuccess(
          `<div><strong>Дослідження:</strong> ${names}</div>` +
          (desiredDate ? `<div><strong>Бажана дата:</strong> ${esc(humanDate(desiredDate))}${desiredTime ? ' о ' + esc(desiredTime) : ''}</div>` : '') +
          `<div><strong>Телефон для зв'язку:</strong> ${esc(phone)}</div>` +
          (codes.length
            ? `<div style="margin-top:6px"><strong>${codes.length > 1 ? 'Коди заявок' : 'Код заявки'}:</strong> ${codes.map(esc).join(', ')}</div>` +
              `<div style="margin-top:4px;color:#4e5d46;font-size:13px">Збережіть код — за ним і номером телефону можна відстежити статус у кабінеті пацієнта.</div>`
            : '')
        );
      }
      // We saved to the server, so hide the "online transfer not configured" note.
      const offline = document.getElementById('offlineNote');
      if (offline) offline.hidden = true;
    } catch (error) {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel || 'Сформувати заявку'; }
      alert((error && error.message) || 'Не вдалося надіслати заявку. Зателефонуйте в реєстратуру: +380 97 280 88 99');
    }
  }, true);
})();

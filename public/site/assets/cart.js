/* RadiologyOS — спільна логіка «Моєї заявки» (кошика).
   Підключається на index.html та price.html:
   <script src="assets/cart.js" defer></script>
   Дані зберігаються в localStorage під ключем 'radiologyCart'. */

const PHONE = '380972808899';

let cart = JSON.parse(localStorage.getItem('radiologyCart') || '[]');

const humanDate = iso => iso ? iso.split('-').reverse().join('.') : '';
const money = n => new Intl.NumberFormat('uk-UA').format(n) + ' грн';

function saveCart() {
  localStorage.setItem('radiologyCart', JSON.stringify(cart));
  renderCart();
}

function addToCart(code, name, price) {
  _lastPickerCode = null;
  if (!cart.some(x => x.code === String(code))) {
    cart.push({ code: String(code), name, price: Number(price) });
    saveCart();
  }
  openCart();
}

function removeFromCart(code) {
  cart = cart.filter(x => x.code !== String(code));
  saveCart();
}

function renderCart() {
  document.querySelectorAll('[data-cart-count]').forEach(x => { x.textContent = cart.length; });
  const box = document.getElementById('cartItems');
  if (!box) return;
  box.innerHTML = cart.length
    ? cart.map(x => `<div class="cart-item"><div><strong>${x.name}</strong><small>Код ${x.code}</small></div><div style="text-align:right"><strong>${money(x.price)}</strong><br><button class="remove-item" onclick="removeFromCart('${x.code}')">Видалити</button></div></div>`).join('')
    : '<div class="cart-empty">Ви ще не додали жодної послуги.</div>';
  document.getElementById('cartTotal').textContent = money(cart.reduce((s, x) => s + x.price, 0));
}

function openCart() {
  document.getElementById('cartOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderCart();
}

function closeCart() {
  document.getElementById('cartOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* --- Меню «Вхід» у шапці (є лише на головній; код безпечний для інших сторінок) --- */

const headerLoginButton = document.getElementById('headerLoginButton');
const loginMenu = document.getElementById('loginMenu');

function toggleLoginMenu() {
  if (!loginMenu) return;
  const open = !loginMenu.classList.contains('open');
  loginMenu.classList.toggle('open', open);
  headerLoginButton.setAttribute('aria-expanded', String(open));
}

function closeLoginMenu() {
  if (!loginMenu) return;
  loginMenu.classList.remove('open');
  headerLoginButton.setAttribute('aria-expanded', 'false');
}

function openPatientAccess() {
  closeLoginMenu();
  openCart();
}

headerLoginButton?.addEventListener('click', e => { e.stopPropagation(); toggleLoginMenu(); });
document.addEventListener('click', e => { if (!e.target.closest('.login-menu-wrap')) closeLoginMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLoginMenu(); });
document.getElementById('cartOverlay')?.addEventListener('click', e => { if (e.target.id === 'cartOverlay') closeCart(); });

/* --- Прикріплення попереднього висновку --- */

const medicalFiles = document.getElementById('medicalFiles');
const fileSummary = document.getElementById('fileSummary');
medicalFiles?.addEventListener('change', () => {
  const files = [...medicalFiles.files];
  fileSummary.textContent = files.length
    ? `Вибрано файлів: ${files.length} — ${files.map(f => f.name).join(', ')}`
    : 'Файли не вибрано';
});


/* --- Синхронізація з панеллю персоналу (staff.html) ---
   Заявка зберігається в тому ж сховищі, яке читає панель.
   Працює в межах одного браузера/пристрою (localStorage). */

const STAFF_STORE = 'radiologyos_applications_v1';

function pushToStaffPanel({ name, phone, category, studies, desiredDate, desiredTime, apparatus, comment, sid }) {
  try {
    const apps = JSON.parse(localStorage.getItem(STAFF_STORE) || '[]');
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    studies.forEach(st => {
      const study = typeof st === 'string' ? st : st.name;
      const code = typeof st === 'string' ? '' : st.code;
      apps.push({
        id: uid(),
        name, phone, category, study,
        desiredDate: desiredDate || '',
        appointmentDate: '', appointmentTime: '',
        status: 'new',
        comment: comment || '',
        createdAt: new Date().toISOString(),
        sid: sid || '',
        desiredTime: desiredTime || '',
        apparatus: (function () {
          /* конкретна машина з прайсу, якщо призначена; інакше тип за кодом */
          try {
            if (code && typeof getPricelist === 'function') {
              for (const g of getPricelist())
                for (const it of g.items)
                  if (String(it.code) === String(code) && it.equip) return it.equip;
            }
          } catch (e) {}
          return (code && typeof apparatusForCode === 'function') ? apparatusForCode(code)
               : (apparatus || (typeof apparatusForStudyTitle === 'function' ? apparatusForStudyTitle(study) : 'xray'));
        })()
      });
    });
    localStorage.setItem(STAFF_STORE, JSON.stringify(apps));
  } catch (e) { /* сховище недоступне — заявка все одно піде у WhatsApp */ }
}

/* --- Формування заявки --- */

const requestForm = document.getElementById('requestForm');
let pickedSlot = { date: '', time: '' };

/* Апарат за вмістом кошика: якщо є хоч одне КТ — КТ, інакше рентген */
function cartApparatus() {
  if (typeof apparatusForCode !== 'function') return 'xray';
  return cart.some(x => apparatusForCode(x.code) === 'ct') ? 'ct' : 'xray';
}

let _lastPickerCode = null;
function refreshSlotPicker() {
  const box = document.getElementById('slotPicker');
  if (!box || typeof initSlotPicker !== 'function') return;
  if (!cart.length) {
    box.innerHTML = '<div class="sp-loading">Оберіть послугу — і тут з’явиться вільний час</div>';
    _lastPickerCode = null;
    return;
  }
  // Real free times come from the department schedule for the first service in
  // the cart (see /api/availability). The chosen time is a preferred slot the
  // registrar confirms for every service in the request.
  const code = String(cart[0].code);
  if (code === _lastPickerCode) return;
  _lastPickerCode = code;
  pickedSlot = { date: '', time: '' };
  initSlotPicker({
    container: box,
    serviceCode: code,
    onPick: s => {
      pickedSlot = s;
      const dd = document.getElementById('desiredDate');
      if (dd && s.date) dd.value = s.date;
    }
  });
}

requestForm?.addEventListener('submit', e => {
  e.preventDefault();
  if (!cart.length) { alert('Спочатку додайте послугу до заявки.'); return; }

  if (!requestForm.checkValidity()) {
    requestForm.classList.add('was-validated');
    requestForm.querySelector(':invalid')?.focus();
    return;
  }

  const name = document.getElementById('patientName').value.trim();
  const phone = '+380' + document.getElementById('patientPhone').value.replace(/\D/g, '');
  const dateISO = pickedSlot.date || document.getElementById('desiredDate').value;
  const time = pickedSlot.time || document.getElementById('desiredTime').value || 'будь-який';
  const ref = document.getElementById('referral').value;
  const comment = document.getElementById('comment').value.trim() || '—';
  const files = [...(document.getElementById('medicalFiles')?.files || [])];


  const sid = (crypto.randomUUID ? crypto.randomUUID() : 'sid-' + Date.now());
  const commentFull = [ref, time !== 'будь-який' ? 'Зручний час: ' + time : '', comment !== '—' ? comment : ''].filter(Boolean).join('. ');

  pushToStaffPanel({
    name, phone,
    category: 'Цивільна особа',
    studies: cart.map(x => ({ name: x.name, code: x.code })),
    desiredDate: dateISO,
    desiredTime: pickedSlot.time || '',
    comment: commentFull,
    sid
  });

  if (typeof notifyAdmin === 'function') notifyAdmin({
    id: sid, name, phone,
    category: 'Цивільна особа',
    studies: cart.map(x => x.name).join('; '),
    desiredDate: dateISO,
    apparatus: cartApparatus(),
    source: (typeof getTrafficSource === 'function') ? getTrafficSource() : '',
    comment: [pickedSlot.time ? 'Обраний час: ' + pickedSlot.time : '', commentFull].filter(Boolean).join('. ')
  });

  const escS = t => String(t ?? '').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  showSuccess(
    `<div><strong>Дослідження:</strong> ${cart.map(x => escS(x.name)).join('; ')}</div>` +
    (dateISO ? `<div><strong>Бажана дата:</strong> ${humanDate(dateISO)}${pickedSlot.time ? ' о ' + pickedSlot.time : ''}</div>` : '') +
    `<div><strong>Телефон для зв'язку:</strong> ${escS(phone)}</div>` +
    (files.length ? `<div><strong>Файли:</strong> принесіть попередній висновок із собою або передайте реєстратурі</div>` : '')
  );
});

function showSuccess(summary) {
  const box = document.getElementById('successSummary');
  if (box) box.innerHTML = summary;
  /* якщо онлайн-передача не налаштована — заявка НЕ дійде до реєстратури: чесно кажемо подзвонити */
  const off = document.getElementById('offlineNote');
  if (off) off.hidden = !!(typeof NOTIFY_ENDPOINT !== 'undefined' && NOTIFY_ENDPOINT);
  requestForm.hidden = true;
  document.getElementById('successPanel').hidden = false;
  showPaymentBlock();
  document.querySelector('.cart-total').style.display = 'none';
  document.getElementById('cartItems').style.display = 'none';
  cart = [];
  saveCart();
}




/* повертаємо форму при наступному відкритті заявки */
const _openCart = openCart;
openCart = function () {
  if (requestForm) {
    requestForm.hidden = false;
    requestForm.classList.remove('was-validated');
    document.getElementById('successPanel').hidden = true;
    const totalRow = document.querySelector('.cart-total');
    if (totalRow) totalRow.style.display = '';
    const items = document.getElementById('cartItems');
    if (items) items.style.display = '';
  }
  _openCart();
  refreshSlotPicker();
};

const _dd = document.getElementById('desiredDate');
if (_dd) _dd.min = new Date().toISOString().slice(0, 10);

renderCart();

/* Блок оплати для платних (цивільних) заявок: посилання з панелі персоналу */
async function showPaymentBlock() {
  const block = document.getElementById('payBlock');
  if (!block) return;
  let link = '', qrData = '';
  if (typeof fetchPublicConfig === 'function') {
    const cfg = await fetchPublicConfig();
    if (cfg && cfg.payLink) { link = cfg.payLink; qrData = cfg.payLink; }
  }
  if (!link && typeof DEFAULT_PAY_LINK !== 'undefined' && DEFAULT_PAY_LINK) {
    link = DEFAULT_PAY_LINK;
    qrData = (typeof DEFAULT_PAY_LINK_RAW !== 'undefined') ? DEFAULT_PAY_LINK_RAW : DEFAULT_PAY_LINK;
  }
  if (!link) return;
  document.getElementById('payBtn').href = link;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(qrData);
    qr.make();
    document.getElementById('payQr').innerHTML = qr.createImgTag(4, 6);
  } catch (e) { document.getElementById('payQr').innerHTML = ''; }
  block.hidden = false;
}

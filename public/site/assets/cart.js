/* RadiologyOS — спільна логіка «Моєї заявки» (кошика).
   Підключається на index.html та price.html:
   <script src="assets/cart.js" defer></script>
   Дані зберігаються в localStorage під ключем 'radiologyCart'. */

const PHONE = '380972808899';
// Дзеркалить серверний MAX_SERVICES_PER_REQUEST: одна заявка — до 5 послуг.
const MAX_SERVICES_PER_REQUEST = 5;

let cart = JSON.parse(localStorage.getItem('radiologyCart') || '[]');
let _lastPickerCode = null;
let pickedSlot = { date: '', time: '' };

const humanDate = iso => iso ? iso.split('-').reverse().join('.') : '';
const money = n => new Intl.NumberFormat('uk-UA').format(n) + ' грн';

function saveCart() {
  localStorage.setItem('radiologyCart', JSON.stringify(cart));
  renderCart();
}

function addToCart(code, name, price) {
  _lastPickerCode = null;
  if (!cart.some(x => x.code === String(code))) {
    if (cart.length >= MAX_SERVICES_PER_REQUEST) {
      alert(`В одну заявку можна додати до ${MAX_SERVICES_PER_REQUEST} послуг. Для більшого обсягу подайте окрему заявку або зателефонуйте в реєстратуру: +380 97 280 88 99`);
      openCart();
      return;
    }
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
  refreshSlotPicker();
}

// «Оберіть зручний час»: реальні вільні слоти з розкладу відділення для першої
// послуги в кошику (/api/availability). Обраний слот заповнює бажану дату й час,
// які потім ідуть у повідомлення месенджера.
function refreshSlotPicker() {
  const box = document.getElementById('slotPicker');
  if (!box || typeof initSlotPicker !== 'function') return;
  if (!cart.length) {
    box.innerHTML = '<div class="sp-loading">Оберіть дослідження — і тут з’явиться вільний час</div>';
    _lastPickerCode = null;
    return;
  }
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
      const dt = document.getElementById('desiredTime');
      if (dd && s.date) dd.value = s.date;
      if (dt && s.time) dt.value = s.time;
    },
  });
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

renderCart();

// Deep-link із лендінгу послуги: /site/price.html?add=<код> — додає саме цю
// послугу в кошик і відкриває його, щоб пацієнт не шукав її вручну в прайсі.
(function addServiceFromUrl() {
  try {
    const code = new URLSearchParams(location.search).get('add');
    if (!code) return;
    const target = Array.from(document.querySelectorAll('button.row-add'))
      .find(b => (b.getAttribute('onclick') || '').includes("addToCart('" + code + "'"));
    if (target && !target.disabled) target.click(); // addToCart сам відкриває кошик
  } catch (e) { /* тихо: без параметра або поза прайсом — нічого не робимо */ }
})();

// Надсилання заявки в месенджер (Viber/WhatsApp) або дзвінок обробляє
// d1-bridge.js — валідація ПІБ/дати/часу й кнопки [data-book].

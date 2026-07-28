/* Головна: тарифи з бази (кабінет → «Тарифи») — військовим безоплатно,
   цивільним за ціною. Кнопка «Записатися» додає послугу в «Мою заявку». */
(function () {
  var box = document.getElementById('homeTariffs');
  if (!box) return;
  var fmt = new Intl.NumberFormat('uk-UA');
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  };
  var failMsg = '<div class="ht-loading">Тарифи тимчасово недоступні. Зателефонуйте в реєстратуру: +380 97 280 88 99</div>';

  // Категорія у формі: показуємо підказку про безоплатність для військових.
  var cat = document.getElementById('patientCategory');
  var note = document.getElementById('categoryNote');
  function updateNote() {
    if (!cat || !note) return;
    note.textContent = cat.value === 'military'
      ? 'Для військовослужбовців за направленням дослідження безоплатні.'
      : 'Цивільним особам — оплата за чинним тарифом.';
  }
  if (cat) { cat.addEventListener('change', updateNote); updateNote(); }

  fetch('/api/catalog', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
    var groups = (d && d.groups) || [];
    if (!groups.length) { box.innerHTML = failMsg; return; }
    box.innerHTML = groups.map(function (g) {
      return '<div class="ht-group"><h3>' + esc(g.group) + '</h3>' +
        '<table class="ht-table"><thead><tr><th>Дослідження</th><th class="num">Військовим</th><th class="num">Цивільним</th><th></th></tr></thead><tbody>' +
        g.items.map(function (it) {
          return '<tr>' +
            '<td><div class="ht-title">' + esc(it.title) + '</div>' + (it.description ? '<div class="ht-help">' + esc(it.description) + '</div>' : '') + '</td>' +
            '<td class="num" data-label="Військовим"><span class="ht-mil">безоплатно</span></td>' +
            '<td class="num" data-label="Цивільним"><span class="ht-civ">' + fmt.format(it.price) + ' грн</span></td>' +
            '<td class="num"><button type="button" class="ht-book" data-code="' + esc(it.code) + '" data-name="' + esc(it.title) + '" data-price="' + Number(it.price) + '">Записатися</button></td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>';
    }).join('');

    box.querySelectorAll('.ht-book').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof addToCart === 'function') addToCart(btn.dataset.code, btn.dataset.name, Number(btn.dataset.price));
        btn.classList.add('added');
        btn.textContent = 'Додано ✓';
        setTimeout(function () { btn.classList.remove('added'); btn.textContent = 'Записатися'; }, 1500);
      });
    });
  }).catch(function () { box.innerHTML = failMsg; });
})();

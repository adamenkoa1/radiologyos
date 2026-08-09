// Токен-залежні підказки для поля ПІБ (одне поле, 3 слова).
// 1-е слово — прізвище (не підказуємо), 2-е — ім'я, 3-є — по батькові.
// Підказки з'являються під час набору; вибір мишею/клавіатурою.
(function () {
  'use strict';

  var NAMES = [
    // чоловічі
    'Олександр','Андрій','Дмитро','Сергій','Іван','Володимир','Микола','Василь','Юрій','Олег',
    'Ігор','Віктор','Максим','Артем','Богдан','Тарас','Роман','Павло','Петро','Михайло',
    'Анатолій','Віталій','Валерій','Євген','Костянтин','Денис','Назар','Ростислав','Ярослав','Владислав',
    'Станіслав','Григорій','Степан','Федір','Леонід','Валентин','Едуард','Руслан','Вадим','Геннадій',
    'Мар’ян','Остап','Любомир','Тимофій','Захар','Матвій','Данило','Кирило','Марко','Гліб',
    'Олексій','Антон','Борис','В’ячеслав','Юхим','Опанас','Пилип','Влас',
    // жіночі
    'Олена','Тетяна','Наталія','Ірина','Оксана','Людмила','Галина','Марія','Ольга','Світлана',
    'Юлія','Вікторія','Анна','Катерина','Валентина','Надія','Любов','Лариса','Алла','Ніна',
    'Віра','Раїса','Зоя','Лідія','Анастасія','Дарія','Софія','Христина','Соломія','Уляна',
    'Мар’яна','Роксолана','Богдана','Яна','Аліна','Діана','Карина','Валерія','Вероніка','Інна',
    'Жанна','Емілія','Злата','Мілана','Поліна','Ангеліна','Олеся','Леся','Оксана'
  ];

  var PATRO = [
    'Олександрович','Олександрівна','Андрійович','Андріївна','Дмитрович','Дмитрівна','Сергійович','Сергіївна',
    'Іванович','Іванівна','Володимирович','Володимирівна','Миколайович','Миколаївна','Васильович','Василівна',
    'Юрійович','Юріївна','Олегович','Олегівна','Ігорович','Ігорівна','Вікторович','Вікторівна',
    'Максимович','Максимівна','Артемович','Артемівна','Богданович','Богданівна','Тарасович','Тарасівна',
    'Романович','Романівна','Павлович','Павлівна','Петрович','Петрівна','Михайлович','Михайлівна',
    'Анатолійович','Анатоліївна','Віталійович','Віталіївна','Валерійович','Валеріївна','Євгенович','Євгенівна',
    'Костянтинович','Костянтинівна','Денисович','Денисівна','Ярославович','Ярославівна','Владиславович','Владиславівна',
    'Григорович','Григорівна','Степанович','Степанівна','Федорович','Федорівна','Леонідович','Леонідівна',
    'Валентинович','Валентинівна','Едуардович','Едуардівна','Русланович','Русланівна','Вадимович','Вадимівна',
    'Геннадійович','Геннадіївна','Тимофійович','Тимофіївна','Захарович','Захарівна','Матвійович','Матвіївна',
    'Данилович','Данилівна','Кирилович','Кирилівна','Маркович','Марківна','Олексійович','Олексіївна',
    'Антонович','Антонівна','Борисович','Борисівна','Пилипович','Пилипівна','Ілліч','Іллівна','Кузьмич','Кузьмівна'
  ];

  var lc = function (s) { return (s || '').toLowerCase(); };

  function attach(input) {
    if (!input || input.dataset.nameSuggest === '1') return;
    input.dataset.nameSuggest = '1';
    input.setAttribute('autocomplete', 'off');

    var list = document.createElement('ul');
    list.className = 'nameSuggest';
    list.hidden = true;
    document.body.appendChild(list);
    var active = -1;
    var items = [];

    function place() {
      var r = input.getBoundingClientRect();
      list.style.left = r.left + 'px';
      list.style.top = (r.bottom + 2) + 'px';
      list.style.width = r.width + 'px';
    }

    function close() { list.hidden = true; active = -1; items = []; }

    function parts() {
      var raw = input.value;
      var endsSpace = /\s$/.test(raw);
      var arr = raw.trim().length ? raw.trim().split(/\s+/) : [];
      var idx = endsSpace ? arr.length : Math.max(arr.length - 1, 0);
      var prefix = endsSpace ? '' : (arr[arr.length - 1] || '');
      return { arr: arr, idx: idx, prefix: prefix };
    }

    function pick(value) {
      var p = parts();
      var arr = p.arr.slice(0, p.idx);
      arr[p.idx] = value;
      // Після імені (idx 1) лишаємо пробіл для по батькові; після по батькові — ні.
      input.value = arr.join(' ') + (p.idx < 2 ? ' ' : '');
      close();
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function render() {
      var p = parts();
      var source = p.idx === 1 ? NAMES : p.idx === 2 ? PATRO : null;
      if (!source) { close(); return; }
      var pre = lc(p.prefix);
      var matches = source.filter(function (s) { return lc(s).indexOf(pre) === 0; }).slice(0, 8);
      if (!matches.length) { close(); return; }
      items = matches;
      active = -1;
      list.innerHTML = matches.map(function (s, i) {
        return '<li data-i="' + i + '">' + s + '</li>';
      }).join('');
      place();
      list.hidden = false;
    }

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    window.addEventListener('scroll', function () { if (!list.hidden) place(); }, true);
    window.addEventListener('resize', function () { if (!list.hidden) place(); });

    list.addEventListener('mousedown', function (e) {
      var li = e.target.closest('li');
      if (li) { e.preventDefault(); pick(items[Number(li.dataset.i)]); }
    });

    input.addEventListener('keydown', function (e) {
      if (list.hidden || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; }
      else if (e.key === 'Enter') { if (active >= 0) { e.preventDefault(); pick(items[active]); return; } }
      else if (e.key === 'Escape') { close(); return; }
      else return;
      Array.prototype.forEach.call(list.children, function (li, i) {
        li.classList.toggle('on', i === active);
      });
    });
  }

  function init() {
    ['patientName', 'militaryPatientName'].forEach(function (id) {
      attach(document.getElementById(id));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

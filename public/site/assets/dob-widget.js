/* RadiologyOS — сегментований віджет дати народження (День / Місяць / Рік).
   Спільний для форми запису (index/price/military) і входу в кабінет, щоб дата
   всюди вводилась однаково й українською, без залежного від локалі
   mm/dd/yyyy. Ховає оригінальний <input type="date"> і синхронізує в нього
   ISO-значення (YYYY-MM-DD). За замовчуванням обмежує вибір повнолітніми (18+),
   бо онлайн-запис доступний від 18 років, а всі збережені заявки — дорослі.

   API: window.enhanceDobSegments(input) · window.adultDobLimit(). */
(function () {
  function adultDobLimit() {
    const today = new Date();
    const limit = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
    const y = limit.getFullYear();
    const m = String(limit.getMonth() + 1).padStart(2, '0');
    const d = String(limit.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function enhanceDobSegments(dobInput) {
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

  window.adultDobLimit = adultDobLimit;
  window.enhanceDobSegments = enhanceDobSegments;
})();

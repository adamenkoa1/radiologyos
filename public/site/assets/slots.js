/* RadiologyOS — вибір вільного часу пацієнтом (підключено до розкладу відділення).
   Тягне реальні вільні слоти обраної послуги з /api/availability, тож обраний
   час одразу узгоджений із зайнятістю апарата та блокуваннями графіка.

   Використання:
     initSlotPicker({
       container: HTMLElement,
       serviceCode: '401',            // код послуги (той самий, що в кошику)
       onPick: ({date, time}) => {}   // '' коли вибір скинуто
     }) */

async function initSlotPicker({ container, serviceCode, onPick }) {
  const pad = (n) => String(n).padStart(2, '0');
  const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  // Наступні робочі дні (Пн–Сб). Недоступні дати сервер поверне порожніми.
  const days = [];
  for (let i = 0; i < 21 && days.length < 12; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (d.getDay() === 0) continue; // неділя — вихідний
    const iso = d.toISOString().slice(0, 10);
    days.push({ iso, label: dayNames[d.getDay()] + ' ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) });
  }
  if (!days.length) {
    container.innerHTML = '<div class="sp-empty">Найближчим часом вільних днів немає. Залиште бажану дату — реєстратура запропонує варіанти.</div>';
    if (onPick) onPick({ date: '', time: '' });
    return;
  }

  let selDay = days[0];
  let selTime = null;
  let times = [];
  let loading = false;

  function render() {
    container.innerHTML = `
      <div class="sp-head">Вільний час${loading ? ' <span class="sp-note">(оновлюю…)</span>' : ' <span class="sp-note">(за розкладом відділення)</span>'}</div>
      <div class="sp-days">${days.map((d) =>
        `<button type="button" class="sp-day ${d.iso === selDay.iso ? 'on' : ''}" data-day="${d.iso}">${d.label}</button>`).join('')}
      </div>
      <div class="sp-times">${loading
        ? '<div class="sp-loading">Перевіряю…</div>'
        : (times.length
          ? times.map((t) => `<button type="button" class="sp-time ${t === selTime ? 'on' : ''}" data-time="${t}">${t}</button>`).join('')
          : '<div class="sp-empty">На цей день вільних слотів немає</div>')}
      </div>
      ${selTime ? `<div class="sp-picked">✓ Обрано: <strong>${selDay.label} о ${selTime}</strong></div>` : ''}`;

    container.querySelectorAll('.sp-day').forEach((b) => b.addEventListener('click', () => {
      selDay = days.find((d) => d.iso === b.dataset.day);
      selTime = null;
      if (onPick) onPick({ date: '', time: '' });
      loadTimes(selDay.iso);
    }));
    container.querySelectorAll('.sp-time').forEach((b) => b.addEventListener('click', () => {
      selTime = b.dataset.time;
      render();
      if (onPick) onPick({ date: selDay.iso, time: selTime });
    }));
  }

  async function loadTimes(iso) {
    loading = true;
    render();
    try {
      const r = await fetch('/api/availability?date=' + encodeURIComponent(iso) + '&serviceCode=' + encodeURIComponent(serviceCode), { cache: 'no-store' });
      const data = await r.json();
      times = r.ok ? (data.times || []) : [];
    } catch (e) {
      times = [];
    }
    loading = false;
    render();
  }

  loadTimes(selDay.iso);
}

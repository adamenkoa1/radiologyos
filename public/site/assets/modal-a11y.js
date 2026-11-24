/* RadiologyOS — доступність вікна «Моя заявка» (головна, прайс, «Військовим»).
   Під час відкриття: вікно видно програмам читання з екрана (aria-hidden="false"), фокус переходить у вікно,
   Tab і Shift+Tab не виходять за його межі, Escape закриває. Після закриття фокус повертається на кнопку,
   що відкрила вікно. Використання: rnModal.open(overlay, closeFn) і rnModal.close(overlay). */
(function () {
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  let active = null; // { overlay, opener, onClose }

  function focusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(el => el.getClientRects().length > 0);
  }

  function open(overlay, onClose) {
    if (!overlay) return;
    overlay.setAttribute('aria-hidden', 'false');
    const opener = active && active.overlay === overlay ? active.opener : document.activeElement;
    active = { overlay, opener, onClose };
    const dialog = overlay.querySelector('[role="dialog"]') || overlay;
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    // Після відмальовування вмісту: спершу кнопка «Закрити», інакше перший доступний елемент або саме вікно.
    setTimeout(() => {
      if (!active || active.overlay !== overlay) return;
      const target = dialog.querySelector('.cart-close') || focusables(dialog)[0] || dialog;
      target.focus({ preventScroll: true });
    }, 0);
  }

  function close(overlay) {
    if (overlay) overlay.setAttribute('aria-hidden', 'true');
    if (!active || (overlay && active.overlay !== overlay)) return;
    const opener = active.opener;
    active = null;
    if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === 'function') {
      opener.focus({ preventScroll: true });
    }
  }

  document.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); active.onClose(); return; }
    if (e.key !== 'Tab') return;
    const list = focusables(active.overlay);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const current = document.activeElement;
    if (!active.overlay.contains(current)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (current === first || !list.includes(current))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus(); }
  });

  window.rnModal = { open, close };
})();

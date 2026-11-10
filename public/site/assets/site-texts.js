/* RadiologyOS — головна: тексти з «Тексти сайту» (CRM › Довідники). Елемент з data-ct="ключ" — редагований текст;
   у HTML лежить початковий текст, з /api/public-content приходять лише змінені. Без сервера лишається вбудований текст.
   Текст вставляється тільки як textContent. У «багатих» полях (data-ct-rich, відповіді FAQ) — мінімальна розмітка, яку
   сторінка будує сама через createElement: **жирний**, [текст посилання](/site/price.html або tel:…) і переноси рядків.
   Режим редагування: сторінка відкрита в CRM у вікні-рамці (/?edit=1) — CRM викликає SiteTexts.startEditing(). */
(function () {
  'use strict';
  var SAFE_HREF = /^(\/(?!\/)[^\s()<>"']*|tel:\+?\d{5,15})$/;
  var CACHE = 'radiologyos_site_texts_v1';

  // «**Цивільним:** див. [прайс](/site/price.html)\n…» → [{t:'b',v}, {t:'text',v}, {t:'a',v,href}, {t:'br'}, …]
  function parse(text) {
    var out = [];
    String(text == null ? '' : text).split('\n').forEach(function (line, i) {
      if (i) out.push({ t: 'br' });
      var re = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]*)\)/g, last = 0, m;
      while ((m = re.exec(line))) {
        if (m.index > last) out.push({ t: 'text', v: line.slice(last, m.index) });
        if (m[1] != null) out.push({ t: 'b', v: m[1] });
        else if (SAFE_HREF.test(m[3])) out.push({ t: 'a', v: m[2], href: m[3] });
        else out.push({ t: 'text', v: m[2] });
        last = re.lastIndex;
      }
      if (last < line.length) out.push({ t: 'text', v: line.slice(last) });
    });
    return out;
  }
  function toPlain(text) {
    return parse(text).map(function (p) { return p.t === 'br' ? ' ' : p.v; }).join('').replace(/\s+/g, ' ').trim();
  }
  var api = window.SiteTexts = { parse: parse, toPlain: toPlain, SAFE_HREF: SAFE_HREF };
  if (typeof document === 'undefined' || !document.querySelectorAll) return;

  var EDIT = /[?&]edit=1(&|$)/.test(location.search) && window.parent !== window;
  var nodes = {}, kinds = {}, original = {}, defaults = {}, applied = {};
  var isRich = function (el) { return el.hasAttribute('data-ct-rich'); };

  function serialize(el, rich) {
    if (!rich) return el.textContent.replace(/\s+/g, ' ').trim();
    var walk = function (node) {
      var out = '';
      Array.prototype.forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) { out += n.nodeValue.replace(/[^\S\n]+/g, ' '); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName, inner;
        if (tag === 'BR') out += '\n';
        else if (tag === 'B' || tag === 'STRONG') { inner = walk(n); out += inner.trim() ? '**' + inner + '**' : inner; }
        else if (tag === 'A') { inner = walk(n); var h = n.getAttribute('href') || ''; out += inner.trim() && SAFE_HREF.test(h) ? '[' + inner + '](' + h + ')' : inner; }
        else if (tag === 'DIV' || tag === 'P') { inner = walk(n); out += (out && out.slice(-1) !== '\n' ? '\n' : '') + inner; }
        else out += walk(n);
      });
      return out;
    };
    return walk(el).split('\n').map(function (l) { return l.replace(/ +/g, ' ').trim(); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function render(el, key, text) {
    while (el.firstChild) el.removeChild(el.firstChild);
    if (text == null) { original[key].forEach(function (n) { el.appendChild(n.cloneNode(true)); }); return; }
    if (kinds[key] !== 'rich') { el.textContent = text; return; }
    parse(text).forEach(function (p) {
      var n;
      if (p.t === 'br') n = document.createElement('br');
      else if (p.t === 'b') { n = document.createElement('b'); n.textContent = p.v; }
      else if (p.t === 'a') { n = document.createElement('a'); n.setAttribute('href', p.href); n.textContent = p.v; }
      else n = document.createTextNode(p.v);
      el.appendChild(n);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-ct]'), function (el) {
    var key = el.getAttribute('data-ct');
    (nodes[key] = nodes[key] || []).push(el);
    if (!(key in kinds)) {
      kinds[key] = isRich(el) ? 'rich' : el.hasAttribute('data-ct-phone') ? 'phone' : el.hasAttribute('data-ct-email') ? 'email' : 'plain';
      original[key] = Array.prototype.slice.call(el.childNodes).map(function (n) { return n.cloneNode(true); });
      defaults[key] = serialize(el, kinds[key] === 'rich');
    }
  });

  // FAQPage JSON-LD у <head> — з тих самих питань і відповідей, що видно на сторінці.
  function syncFaqLd() {
    var box = document.getElementById('faqJsonLd');
    if (!box) return;
    var items = [];
    for (var i = 1; nodes['faq.' + i + '.q'] && nodes['faq.' + i + '.a']; i++) {
      items.push({ '@type': 'Question', name: serialize(nodes['faq.' + i + '.q'][0], false),
        acceptedAnswer: { '@type': 'Answer', text: toPlain(serialize(nodes['faq.' + i + '.a'][0], true)) } });
    }
    if (items.length) box.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items });
  }

  // Телефон відділення («Контакти» на головній) — одне джерело для всіх сторінок: при зміні оновлюються
  // посилання tel:, WhatsApp, Viber, Telegram, номер у текстах, JSON-LD і кнопки запису (d1-bridge.js).
  var digits = function (t) { return String(t || '').replace(/\D/g, ''); };
  var fmtPhone = function (d) { return d.length === 12 ? '+' + d.slice(0, 3) + ' ' + d.slice(3, 5) + ' ' + d.slice(5, 8) + ' ' + d.slice(8, 10) + ' ' + d.slice(10) : '+' + d; };
  var PHONE0 = (function () { var a = document.querySelector('a[href^="tel:"]'); return a ? digits(a.getAttribute('href')) : ''; })();
  var phone = { intl: PHONE0, text: PHONE0 ? fmtPhone(PHONE0) : '' };
  api.phoneIntl = phone.intl; api.phoneText = phone.text;
  function setPhone(text) {
    var d = text ? digits(text) : PHONE0;
    if (!phone.intl || d.length < 10 || d.length > 15) return;
    var t = text || fmtPhone(PHONE0);
    // Старі форми: початковий номер і попередньо встановлений (вузли з початковим текстом могли щойно відновитися).
    var olds = [PHONE0, phone.intl].filter(function (o, i, all) { return o && o !== d && all.indexOf(o) === i; });
    var oldTexts = [fmtPhone(PHONE0), phone.text].filter(function (o, i, all) { return o && o !== t && all.indexOf(o) === i; });
    var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'); };
    var textRe = oldTexts.length ? new RegExp(oldTexts.map(esc).join('|'), 'g') : null;
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
      var h = a.getAttribute('href'), h2 = h;
      olds.forEach(function (o) { h2 = h2.split(o).join(d); });
      if (h2 !== h) a.setAttribute('href', h2);
    });
    if (textRe) {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n, list = [];
      while ((n = walker.nextNode())) { textRe.lastIndex = 0; if (textRe.test(n.nodeValue) && !/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) list.push(n); }
      list.forEach(function (x) { x.nodeValue = x.nodeValue.replace(textRe, t); });
    }
    Array.prototype.forEach.call(document.querySelectorAll('script[type="application/ld+json"]'), function (s) {
      var v = s.textContent;
      olds.forEach(function (o) { v = v.split('+' + o).join('+' + d); });
      if (textRe) v = v.replace(textRe, t);
      if (v !== s.textContent) s.textContent = v;
    });
    phone = { intl: d, text: t };
    api.phoneIntl = d; api.phoneText = t;
  }

  // texts: { key → text } — змінені тексти; ключа немає → вбудований у сторінку текст.
  function apply(texts, force) {
    texts = texts && typeof texts === 'object' ? texts : {};
    var faq = false;
    Object.keys(nodes).forEach(function (key) {
      var v = typeof texts[key] === 'string' && texts[key] ? texts[key] : null;
      if (!force && (applied[key] || null) === v) return;
      applied[key] = v;
      nodes[key].forEach(function (el) { render(el, key, v); });
      if (key.indexOf('faq.') === 0) faq = true;
    });
    if (faq) syncFaqLd();
    setPhone(typeof texts['contact.phone'] === 'string' && texts['contact.phone'] ? texts['contact.phone'] : null);
    setEmail(typeof texts['contact.email'] === 'string' && texts['contact.email'] ? texts['contact.email'] : null);
  }

  // E-mail відділення («Контакти»): адреса в посиланнях mailto:.
  var EMAIL0 = (function () { var a = document.querySelector('a[href^="mailto:"]'); return a ? a.getAttribute('href').slice(7) : ''; })();
  var email = EMAIL0;
  function setEmail(text) {
    var e = text && /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i.test(text) ? text : EMAIL0;
    if (!EMAIL0 || e === email) return;
    Array.prototype.forEach.call(document.querySelectorAll('a[href^="mailto:"]'), function (a) {
      if (a.getAttribute('href') === 'mailto:' + email) a.setAttribute('href', 'mailto:' + e);
    });
    email = e;
  }

  api.keys = function () { return Object.keys(nodes).map(function (k) { return { key: k, kind: kinds[k] }; }); };
  api.defaults = function () { return Object.assign({}, defaults); };
  api.values = function () { var o = {}; Object.keys(nodes).forEach(function (k) { o[k] = serialize(nodes[k][0], kinds[k] === 'rich'); }); return o; };
  api.apply = apply;

  if (!EDIT) {
    try { var c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && c.texts) apply(c.texts); } catch (e) { /* без кешу */ }
    fetch('/api/public-content', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.texts) return;
      apply(d.texts);
      try { localStorage.setItem(CACHE, JSON.stringify({ rev: d.rev, texts: d.texts })); } catch (e) { /* приватний режим */ }
    }).catch(function () {});
    return;
  }

  // ===== Режим редагування (лише в рамці CRM) =====
  document.documentElement.classList.add('ct-edit');
  var css = document.createElement('style');
  css.textContent = [
    '.ct-edit .floating-cart,.ct-edit .fixed{display:none!important}',
    // Форма заявки (шухляда «Моя заявка»): у режимі редагування — внизу сторінки, лише блок кнопок «Записатися через».
    '.ct-edit .cart-overlay{position:static!important;opacity:1!important;pointer-events:auto!important;background:none!important;z-index:auto!important;display:block!important}',
    '.ct-edit .cart-drawer{position:static!important;width:min(960px,calc(100% - 28px))!important;height:auto!important;margin:18px auto 28px!important;padding:0!important;box-shadow:none!important;background:none!important;overflow:visible!important}',
    '.ct-edit .cart-drawer>:not(form),.ct-edit .cart-drawer form>:not(.book-channels),.ct-edit .book-privacy,.ct-edit .book-confirm{display:none!important}',
    '.ct-edit .cart-drawer form::before{content:"Форма заявки (відкривається кнопкою «Моя заявка»)";display:block;margin-bottom:4px;font-weight:800;color:#12303a}',
    '.ct-edit .book-channels-row{flex-wrap:wrap;row-gap:12px}',
    '.ct-edit [data-ct-auto]{background:#e3eef7;border-radius:4px;padding:0 3px;cursor:help}',
    // Варіанти тексту за графіком (напр. вступ прайсу «є запис» / «лише жива черга»): у редакторі видно обидва з підписом.
    '.ct-edit [data-ct-alt]{display:block!important}',
    '.ct-edit [data-ct-alt]::before{content:attr(data-ct-alt);display:block;margin-bottom:4px;font-size:11.5px;font-weight:800;color:#7a8a90}',
    '.ct-edit .ct-email{display:block;flex-basis:100%;font-size:12px;font-weight:600;text-align:center;overflow-wrap:anywhere}',
    '.ct-edit .contact-channel.email{flex-wrap:wrap}',
    '.ct-edit [data-ct]{outline:1.5px dashed rgba(15,107,111,.55);outline-offset:2px;border-radius:4px;cursor:text;transition:none}',
    '.ct-edit [data-ct]:hover{background:rgba(255,226,120,.35)}',
    '.ct-edit [data-ct]:focus{outline:2px solid #0f6b6f;background:#fffbe6;color:#12303a}',
    '.ct-edit [data-ct].ct-dirty{outline:2px solid #d38b00}',
    '.ct-edit [data-ct].ct-flash{animation:ctflash 1.2s ease 2}',
    '@keyframes ctflash{50%{background:#ffe27a}}',
    '.ct-edit [data-ct-rich]{white-space:pre-wrap}',
    '.ct-edit .study-col,.ct-edit .promo-card{transform:none!important;cursor:default}',
    '.ct-edit .study-col .sc-short{display:block!important}',
    '.ct-edit .study-col .sc-more{display:block!important;position:static!important;opacity:1!important;visibility:visible!important;padding:6px 0 0!important;border:0!important;box-shadow:none!important;background:transparent!important}',
    '.ct-edit .study-col .sc-short::before{content:"Коротко: ";font-weight:800;color:#7a8a90}',
    '.ct-edit .study-col .sc-more::before{content:"Повністю: ";font-weight:800;color:#7a8a90}'
  ].join('\n');
  document.head.appendChild(css);

  var cb = {};
  function keyOf(el) { var e = el && el.closest && el.closest('[data-ct]'); return e ? e.getAttribute('data-ct') : null; }
  function setEditable(el, on) {
    if (!on) { el.removeAttribute('contenteditable'); return; }
    try { el.contentEditable = 'plaintext-only'; } catch (e) { /* старий браузер */ }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = true;
  }
  function insertText(t) { if (!document.execCommand('insertText', false, t)) { var s = getSelection(); if (s.rangeCount) { var r = s.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(t)); r.collapse(false); } } }

  api.startEditing = function (callbacks, canEdit) {
    cb = callbacks || {};
    Array.prototype.forEach.call(document.querySelectorAll('details'), function (d) { d.removeAttribute('name'); d.open = true; });
    Array.prototype.forEach.call(document.querySelectorAll('a'), function (a) { a.draggable = false; });
    // Текст, що підставляється автоматично (години з «Графіка роботи»): не редагується, підказка звідки він.
    Array.prototype.forEach.call(document.querySelectorAll('[data-ct-auto]'), function (el) { el.title = 'Підставляється автоматично ' + el.getAttribute('data-ct-auto') + ', тут не змінюється'; });
    Object.keys(nodes).forEach(function (k) { nodes[k].forEach(function (el) { setEditable(el, canEdit !== false); }); });
  };
  api.setText = function (key, text) { (nodes[key] || []).forEach(function (el) { render(el, key, text == null ? null : text); }); };
  api.markDirty = function (key, dirty) { (nodes[key] || []).forEach(function (el) { el.classList.toggle('ct-dirty', !!dirty); }); };
  api.focusKey = function (key) {
    var el = (nodes[key] || [])[0];
    if (!el) return;
    var card = el.closest('.how-card');
    if (card && !card.classList.contains('active')) { var b = document.querySelector('.how-tabs button[data-tab="' + card.id.replace('how-', '') + '"]'); if (b) b.click(); }
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('ct-flash'); void el.offsetWidth; el.classList.add('ct-flash');
  };

  // Посилання й розкривні блоки під час редагування не спрацьовують (клік — щоб поставити курсор).
  document.addEventListener('click', function (e) {
    if (e.target.closest('a, summary')) e.preventDefault();
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
  document.addEventListener('keydown', function (e) {
    var key = keyOf(e.target);
    if (!key) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (kinds[key] === 'rich' && !e.target.closest('summary')) { if (!document.execCommand('insertLineBreak')) insertText('\n'); }
    } else if (e.key === 'Escape') {
      e.target.blur();
    } else if (e.key === ' ' && e.target.closest('summary, a')) {
      e.preventDefault(); insertText(' ');
    }
  }, true);
  document.addEventListener('paste', function (e) {
    var key = keyOf(e.target);
    if (!key) return;
    e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    insertText(kinds[key] === 'rich' ? t.replace(/\r\n?/g, '\n') : t.replace(/\s+/g, ' '));
  }, true);
  document.addEventListener('drop', function (e) { if (keyOf(e.target)) e.preventDefault(); }, true);
  document.addEventListener('input', function (e) {
    var key = keyOf(e.target);
    if (!key || !cb.onChange) return;
    var el = e.target.closest('[data-ct]');
    var v = serialize(el, kinds[key] === 'rich');
    nodes[key].forEach(function (other) { if (other !== el) render(other, key, v); });
    cb.onChange(key, v);
  }, true);
  document.addEventListener('focusin', function (e) { var key = keyOf(e.target); if (key && cb.onFocus) cb.onFocus(key); });
})();

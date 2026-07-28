/**
 * RadiologyOS — бекенд заявок (версія 2: журнал + синхронізація з панеллю).
 *
 * Що вміє:
 *  • приймає заявки з сайту → рядок у Таблиці + лист адміністратору;
 *  • віддає список заявок панелі персоналу (з будь-якого пристрою);
 *  • приймає від панелі оновлення статусу і часу запису.
 *
 * НАЛАШТУВАННЯ (одноразово):
 * 1. sheets.new → назвіть таблицю «Заявки RadiologyOS».
 * 2. Розширення → Apps Script → вставте цей код замість наявного.
 * 3. Впишіть нижче ADMIN_EMAIL (ваша пошта) і SYNC_TOKEN
 *    (будь-який власний код-пароль, латиницею, без пробілів — 
 *    той самий впишете в assets/notify.js на сайті).
 * 4. Зберегти → Deploy → New deployment → Web app →
 *    Execute as: Me; Who has access: Anyone → Deploy → дозволити.
 * 5. URL (…/exec) вставте в assets/notify.js → NOTIFY_ENDPOINT.
 *
 * ЯКЩО ОНОВЛЮЄТЕ ІСНУЮЧИЙ СКРИПТ: Deploy → Manage deployments →
 * олівець → Version: New version → Deploy (URL залишиться той самий).
 */

/* Список можливих отримувачів сповіщень. Впишіть усіх, між ким
   хочете перемикатися (перший — отримувач за замовчуванням).
   Активного адміністратора обирають у панелі персоналу: Налаштування →
   «Сповіщення про заявки». Вибір зберігається тут, у властивостях скрипта. */
var ADMIN_EMAILS = [
  'ВАША_ПОШТА@gmail.com'          // ← додайте інші рядком нижче через кому
];
var SYNC_TOKEN  = 'ЗМІНІТЬ_МЕНЕ';           // ← ваш код-пароль

function activeAdmin_() {
  var saved = PropertiesService.getScriptProperties().getProperty('active_admin');
  return (saved && ADMIN_EMAILS.indexOf(saved) !== -1) ? saved : ADMIN_EMAILS[0];
}

var HEADERS = ['ID','Створено','Пацієнт','Телефон','Категорія',
               'Дослідження','Бажана дата','Коментар','Статус','Дата запису','Час запису','Апарат','Джерело'];

function sheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'update') return handleUpdate_(data);
    if (data.action === 'setAdmin') return handleSetAdmin_(data);
    if (data.action === 'setHours') return handleSetHours_(data);
    if (data.action === 'setApparatus') return handleSetApparatus_(data);
    if (data.action === 'feedback') return handleFeedback_(data);
    if (data.action === 'setPublic') return handleSetPublic_(data);
    return handleSubmit_(data);
  } catch (err) {
    return ContentService.createTextOutput('error');
  }
}

function handleSubmit_(data) {
  if (!data.name || !data.phone || !data.studies) {
    return ContentService.createTextOutput('skip');
  }
  var sh = sheet_();
  sh.appendRow([
    String(data.id || Utilities.getUuid()),
    new Date(),
    String(data.name).slice(0, 200),
    String(data.phone).slice(0, 30),
    String(data.category || '').slice(0, 50),
    String(data.studies).slice(0, 500),
    String(data.desiredDate || '').slice(0, 20),
    String(data.comment || '').slice(0, 500),
    'new', '', '',
    String(data.apparatus || '').slice(0, 10),
    String(data.source || '').slice(0, 50)
  ]);
  MailApp.sendEmail({
    to: activeAdmin_(),
    subject: '🩻 Нова заявка: ' + data.name + ' — ' + String(data.studies).slice(0, 60),
    body: 'Пацієнт: ' + data.name + '\nТелефон: ' + data.phone +
          '\nКатегорія: ' + (data.category || '—') +
          '\nДослідження: ' + data.studies +
          '\nБажана дата: ' + (data.desiredDate || 'не вказана') +
          '\nКоментар: ' + (data.comment || '—') +
          '\n\nЖурнал: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  });
  return ContentService.createTextOutput('ok');
}

function handleUpdate_(data) {
  if (data.token !== SYNC_TOKEN) return ContentService.createTextOutput('denied');
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(data.id)) {
      if (data.status)          sh.getRange(i + 1, 9).setValue(String(data.status).slice(0, 20));
      if ('appointmentDate' in data) sh.getRange(i + 1, 10).setValue(String(data.appointmentDate || ''));
      if ('appointmentTime' in data) sh.getRange(i + 1, 11).setValue(String(data.appointmentTime || ''));
      if ('apparatus' in data)       sh.getRange(i + 1, 12).setValue(String(data.apparatus || ''));
      return ContentService.createTextOutput('ok');
    }
  }
  return ContentService.createTextOutput('notfound');
}


function handleSetAdmin_(data) {
  if (data.token !== SYNC_TOKEN) return ContentService.createTextOutput('denied');
  if (ADMIN_EMAILS.indexOf(data.email) === -1) return ContentService.createTextOutput('unknown');
  PropertiesService.getScriptProperties().setProperty('active_admin', data.email);
  return ContentService.createTextOutput('ok');
}

function handleSetHours_(data) {
  if (data.token !== SYNC_TOKEN) return ContentService.createTextOutput('denied');
  PropertiesService.getScriptProperties().setProperty('work_hours', JSON.stringify(data.hours || {}));
  return ContentService.createTextOutput('ok');
}

function handleSetApparatus_(data) {
  if (data.token !== SYNC_TOKEN) return ContentService.createTextOutput('denied');
  PropertiesService.getScriptProperties().setProperty('apparatus_avail', JSON.stringify(data.availability || {}));
  return ContentService.createTextOutput('ok');
}

function handleFeedback_(data) {
  if (!data.message) return ContentService.createTextOutput('skip');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Звернення');
  if (!sh) {
    sh = ss.insertSheet('Звернення');
    sh.appendRow(['Дата/час', 'Тип', 'Повідомлення', 'Ім\'я', 'Телефон']);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.appendRow([
    new Date(),
    String(data.type || 'звернення').slice(0, 30),
    String(data.message).slice(0, 2000),
    String(data.name || '').slice(0, 100),
    String(data.phone || '').slice(0, 30)
  ]);
  MailApp.sendEmail({
    to: activeAdmin_(),
    subject: '📝 ' + (data.type || 'Звернення') + ' з сайту відділення',
    body: 'Тип: ' + (data.type || '—') + '\n' +
          'Від: ' + (data.name || 'анонімно') + (data.phone ? ' (' + data.phone + ')' : '') + '\n\n' +
          data.message + '\n\nЖурнал: ' + ss.getUrl()
  });
  return ContentService.createTextOutput('ok');
}

function handleSetPublic_(data) {
  if (data.token !== SYNC_TOKEN) return ContentService.createTextOutput('denied');
  PropertiesService.getScriptProperties().setProperty('public_config', JSON.stringify(data.config || {}));
  return ContentService.createTextOutput('ok');
}

function doGet(e) {
  if (!e.parameter || e.parameter.token !== SYNC_TOKEN) {
    return ContentService.createTextOutput('denied');
  }
  if (e.parameter.action === 'public') {
    var pc = PropertiesService.getScriptProperties().getProperty('public_config');
    return ContentService.createTextOutput(pc || '{}').setMimeType(ContentService.MimeType.JSON);
  }

  if (e.parameter.action === 'busy') {
    /* Публічно-безпечна відповідь для вибору часу пацієнтом:
       лише зайняті слоти і графік, жодних імен чи телефонів. */
    var hoursRaw = PropertiesService.getScriptProperties().getProperty('work_hours');
    var hours = hoursRaw ? JSON.parse(hoursRaw) : { start: '08:00', end: '17:00', days: [1,2,3,4,5,6] };
    var vals = sheet_().getDataRange().getValues();
    var busy = [];
    for (var j = 1; j < vals.length; j++) {
      var st = String(vals[j][8] || '');
      if ((st === 'booked' || st === 'done') && vals[j][9]) {
        busy.push({
          date: vals[j][9] instanceof Date ? Utilities.formatDate(vals[j][9], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(vals[j][9]),
          time: String(vals[j][10] || ''),
          apparatus: String(vals[j][11] || 'xray')
        });
      }
    }
    var availRaw = PropertiesService.getScriptProperties().getProperty('apparatus_avail');
    var avail = availRaw ? JSON.parse(availRaw) : null;
    return ContentService.createTextOutput(JSON.stringify({ hours: hours, busy: busy, availability: avail }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (e.parameter.action === 'admins') {
    return ContentService.createTextOutput(JSON.stringify({
      list: ADMIN_EMAILS, active: activeAdmin_()
    })).setMimeType(ContentService.MimeType.JSON);
  }
  var values = sheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    out.push({
      id: String(r[0]),
      createdAt: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      name: String(r[2]), phone: String(r[3]), category: String(r[4]),
      study: String(r[5]),
      desiredDate: r[6] instanceof Date ? Utilities.formatDate(r[6], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[6]),
      comment: String(r[7]),
      status: String(r[8] || 'new'),
      appointmentDate: r[9] instanceof Date ? Utilities.formatDate(r[9], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[9]),
      appointmentTime: String(r[10]),
      apparatus: String(r[11] || '')
    });
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

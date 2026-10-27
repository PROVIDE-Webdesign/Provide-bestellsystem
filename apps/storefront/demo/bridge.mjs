import { AsianKitchenCheckout } from './checkout.mjs';

const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value / 100);
const date = value => new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const statusNames = {submitted:'Eingegangen',accepted:'Angenommen',preparing:'In Zubereitung',ready:'Abholbereit',completed:'Abgeschlossen',rejected:'Abgelehnt',cancelled:'Storniert'};

async function start() {
  const panel = $('[data-checkout-panel-7y="3"]');
  const bridge = window.ASIAN_KITCHEN_ORDERING_BRIDGE;
  if (!panel || !bridge) return;
  const oldContact = panel.querySelector('.order-contact-7c');
  const box = document.createElement('section');
  box.className = 'provide-checkout';
  box.innerHTML = `<h3>Bestellung abschließen</h3>
    <p>Interner Testpilot · Abholung · Zahlung bei Abholung</p>
    <p>Asian Kitchen ist ein fiktives Restaurant. Bitte nur erfundene Test-Kontaktdaten verwenden.</p>
    <form data-provide-form>
      <fieldset data-provide-fields disabled><legend>Deine Kontaktdaten</legend>
      <label>Name<input name="contactName" autocomplete="name" required maxlength="120"></label>
      <label>Telefon mit Landesvorwahl<input name="phoneE164" type="tel" autocomplete="tel" placeholder="+49 …" required pattern="\\+[1-9][0-9]{7,14}"></label>
      <label>E-Mail<input name="email" type="email" autocomplete="email" required maxlength="254"></label>
      <button type="button" class="btn secondary" data-provide-quote>Gesamtpreis prüfen</button>
      <div data-provide-summary hidden></div>
      <label class="provide-check"><input type="checkbox" data-provide-price required> Ich habe Gerichte, Gesamtpreis und Abholzeit geprüft.</label>
      <label class="provide-check"><input type="checkbox" data-provide-privacy required> Ich habe den <a href="#datenschutz">Datenschutzhinweis</a> gelesen.</label>
      <div data-provide-challenge></div>
      <button type="submit" class="btn primary" data-provide-submit disabled>Zahlungspflichtig bestellen</button>
      </fieldset>
    </form>
    <p data-provide-message role="status" aria-live="polite">Bestellverbindung wird geprüft …</p>
    <button type="button" class="btn secondary" data-provide-receipt hidden>Bisherigen Bestellversuch prüfen</button>
    <button type="button" class="btn secondary" data-provide-retry-issue hidden>Sicherheitsprüfung erneut starten</button>
    <button type="button" class="btn secondary" data-provide-new-order hidden>Neue Testbestellung beginnen</button>`;
  if (oldContact) oldContact.replaceWith(box); else panel.prepend(box);
  const triggerTitle = $('[data-checkout-trigger-7y="3"] strong');
  if (triggerTitle) triggerTitle.textContent = 'Bestellung abschließen';
  const triggerSummary = $('[data-checkout-summary-7y="3"]');
  if (triggerSummary) triggerSummary.textContent = 'Kontaktdaten und Bestätigung';
  const message = box.querySelector('[data-provide-message]');
  const fields = box.querySelector('[data-provide-fields]');
  const submit = box.querySelector('[data-provide-submit]');
  const previewButton = box.querySelector('[data-provide-quote]');
  const receiptButton = box.querySelector('[data-provide-receipt]');
  const retryChallenge = box.querySelector('[data-provide-retry-issue]');
  const summary = box.querySelector('[data-provide-summary]');
  const priceAccepted = box.querySelector('[data-provide-price]');
  const privacyAccepted = box.querySelector('[data-provide-privacy]');
  const newOrder = box.querySelector('[data-provide-new-order]');
  let config, manifest;
  try {
    const responses = await Promise.all([
      fetch('/api/asian-kitchen-config',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)}),
      fetch(new URL('./manifest.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(10000)})
    ]);
    if (responses.some(r => !r.ok)) throw Error();
    [config,manifest] = await Promise.all(responses.map(r => r.json()));
    if (!config.enabled || config.restaurantSlug !== manifest.restaurantSlug || config.locationSlug !== manifest.locationSlug || !config.siteKey || !config.privacyNoticeVersion) throw Error();
  } catch {
    message.textContent = 'Die Bestellverbindung ist noch nicht freigeschaltet. Deine Auswahl bleibt erhalten.';
    return;
  }
  let storage = null;
  try { storage = window.localStorage; } catch {}
  const checkout = new AsianKitchenCheckout(config,manifest,{storage});
  const statusKey = `provide:asian-kitchen-status:${checkout.base}`;
  let challenge = '', issueId = crypto.randomUUID(), widgetId = null, access = null;
  let uiBusy = false, statusBusy = false;
  const form = box.querySelector('form');
  const draft = () => bridge.createOrderDraft();
  function controls() {
    const needsChallenge = (!checkout.client.currentIntent || checkout.renewAllowed) && !checkout.client.hasPendingIssue;
    fields.disabled = uiBusy || checkout.completed || checkout.client.missingMetadataWarning;
    previewButton.disabled = uiBusy || checkout.completed || checkout.client.needsReceipt;
    submit.disabled = uiBusy || checkout.completed || !checkout.preview || !priceAccepted.checked || !privacyAccepted.checked || (!challenge && needsChallenge) || checkout.client.needsReceipt;
    receiptButton.hidden = !checkout.client.currentIntent || checkout.completed;
    receiptButton.disabled = uiBusy;
    retryChallenge.hidden = checkout.completed || !!challenge || !needsChallenge;
    retryChallenge.disabled = uiBusy;
    newOrder.hidden = !checkout.completed;
  }
  function invalidate() {
    if (uiBusy || checkout.completed) return;
    checkout.invalidate(); priceAccepted.checked = false; summary.hidden = true; controls();
  }
  function saveAccess(result) {
    access = {orderId:result.orderId,statusAccessToken:result.statusAccessToken,statusAvailableUntil:result.statusAvailableUntil};
    try { storage?.setItem(statusKey,JSON.stringify(access)); }
    catch { message.textContent = 'Bitte diese Seite geöffnet lassen: Der Bestellstatus kann auf diesem Gerät nicht gespeichert werden.'; }
  }
  const statusBox = document.createElement('section');
  statusBox.className = 'provide-checkout provide-order-status'; statusBox.hidden = true;
  statusBox.innerHTML = '<h3>Deine Bestellung</h3><p data-order-state role="status" aria-live="polite"></p><p data-order-number></p><p data-order-total></p><p data-order-time></p><p data-order-refreshed></p><button type="button" class="btn secondary" data-refresh-status>Status aktualisieren</button><p data-status-error role="status"></p>';
  $('#order').prepend(statusBox);
  function showOrder(result) {
    statusBox.hidden = false;
    statusBox.querySelector('[data-order-state]').textContent = statusNames[result.status];
    statusBox.querySelector('[data-order-number]').textContent = `Bestellnummer: ${result.orderNumber || result.orderId}`;
    statusBox.querySelector('[data-order-total]').textContent = `${result.itemCount} Artikel · ${money(result.totalAmountMinor)} · Zahlung bei Abholung`;
    statusBox.querySelector('[data-order-time]').textContent = `${['accepted','preparing','ready','completed'].includes(result.status) ? 'Bestätigte' : 'Gewünschte'} Abholzeit: ${date(result.requestedFor)} Uhr`;
    statusBox.querySelector('[data-order-refreshed]').textContent = `Zuletzt abgerufen: ${new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',timeStyle:'medium'}).format(new Date())}`;
  }
  async function refreshStatus() {
    if (!access || statusBusy) return;
    if (Date.parse(access.statusAvailableUntil) <= Date.now()) {
      statusBox.querySelector('[data-status-error]').textContent = 'Dieser Bestellstatus ist nicht mehr verfügbar.'; return;
    }
    statusBusy = true;
    const button = statusBox.querySelector('[data-refresh-status]'); button.disabled = true;
    try { showOrder(await checkout.status(access)); statusBox.querySelector('[data-status-error]').textContent = ''; }
    catch { statusBox.querySelector('[data-status-error]').textContent = 'Status derzeit nicht erreichbar. Die zuletzt bestätigte Anzeige bleibt stehen.'; }
    finally { statusBusy = false; button.disabled = false; }
  }
  function confirmed(result) {
    saveAccess(result); showOrder(result);
    $('[data-cart-clear-7n]')?.click();
    message.textContent = 'Deine Testbestellung ist eingegangen. Das Restaurant muss sie noch bestätigen.';
    statusBox.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
  }
  async function loadChallenge() {
    challenge = ''; controls();
    const container = box.querySelector('[data-provide-challenge]');
    try {
      if (!window.turnstile) await new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
        script.onload = resolve; script.onerror = reject; document.head.append(script);
      });
      if (!window.turnstile) throw Error();
      if (widgetId !== null) window.turnstile.remove(widgetId);
      issueId = crypto.randomUUID();
      widgetId = window.turnstile.render(container,{
        sitekey:config.siteKey,action:'checkout_issue',cData:issueId,'response-field':false,
        callback:token => {challenge = token; controls();},
        'error-callback':() => {challenge='';message.textContent='Die Sicherheitsprüfung ist derzeit nicht verfügbar. Bitte bewusst erneut starten.';controls();},
        'expired-callback':() => {challenge='';message.textContent='Die Sicherheitsprüfung ist abgelaufen. Bitte erneut starten.';controls();}
      });
    } catch { message.textContent = 'Die Sicherheitsprüfung konnte nicht geladen werden. Deine Auswahl bleibt erhalten.'; }
  }
  bridge.registerAdapter('onlineShop',{execute:(_payload,context) => checkout.submit(_payload,context.customer,context.challenge,context.issueId)});
  previewButton.addEventListener('click',async () => {
    if (uiBusy) return; uiBusy = true; controls(); message.textContent = 'Gesamtpreis und Abholzeit werden geprüft …';
    try {
      const quote = await checkout.quote(draft());
      summary.replaceChildren();
      for (const line of quote.lines) {
        const row = document.createElement('p');
        row.textContent = `${line.quantity} × ${line.name}${line.selectionSnapshot?.variant ? ' · '+line.selectionSnapshot.variant.name : ''}: ${money(line.lineAmountMinor)}`;
        summary.append(row);
      }
      const total = document.createElement('strong'); total.textContent = `Gesamt: ${money(quote.subtotalAmountMinor)}`; summary.append(total);
      const time = document.createElement('p'); time.textContent = `Gewünschte Abholzeit: ${date(checkout.preview.command.requestedFor)} Uhr`; summary.append(time);
      const tax = document.createElement('p'); tax.textContent = quote.taxSummary ? `Enthaltene Steuern: ${money(quote.taxSummary.taxAmountMinor)} (synthetische Testwerte)` : 'Steuerangaben: synthetische Testwerte'; summary.append(tax);
      summary.hidden = false; priceAccepted.checked = false;
      message.textContent = 'Bitte die serverseitig geprüften Gerichte und Preise bestätigen.';
      if (!challenge && (!checkout.client.currentIntent || checkout.renewAllowed) && !checkout.client.hasPendingIssue) await loadChallenge();
    } catch (error) { message.textContent = error.message; }
    finally { uiBusy = false; controls(); }
  });
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (uiBusy || !form.reportValidity() || !checkout.preview || !priceAccepted.checked || !privacyAccepted.checked) return;
    const values = new FormData(form);
    const customer = {contactName:String(values.get('contactName') || '').trim(),phoneE164:String(values.get('phoneE164') || '').trim(),email:String(values.get('email') || '').trim().toLowerCase()};
    uiBusy = true; controls(); message.textContent = 'Bestellung wird übermittelt …';
    try {
      if (!customer.contactName || !customer.phoneE164 || !customer.email) throw Error('Bitte die Kontaktdaten prüfen.');
      const result = await bridge.executeAdapter('onlineShop',{customer,challenge,issueId});
      confirmed(result);
    } catch (error) { message.textContent = error.message + (checkout.client.needsReceipt ? ' Bitte zuerst den bisherigen Bestellversuch prüfen.' : ''); }
    finally { uiBusy = false; controls(); }
  });
  receiptButton.addEventListener('click',async () => {
    if (uiBusy) return; uiBusy = true; controls();
    try {
      const result = await checkout.receipt();
      if (result.state === 'committed') confirmed(result.confirmation);
      else {message.textContent='Es wurde noch keine Bestellung bestätigt. Bitte Preise erneut prüfen und den nächsten Versuch bewusst auslösen.';summary.hidden=true;priceAccepted.checked=false;}
    } catch (error) { message.textContent = error.message; }
    finally { uiBusy = false; controls(); }
  });
  retryChallenge.addEventListener('click',() => loadChallenge());
  newOrder.addEventListener('click',() => {
    checkout.client.complete();checkout.completed=false;checkout.invalidate();checkout.renewAllowed=false;form.reset();challenge='';
    if(widgetId !== null && window.turnstile){window.turnstile.remove(widgetId);widgetId=null;}
    summary.hidden=true;message.textContent='Bitte Gerichte für eine neue Testbestellung auswählen.';controls();
  });
  [priceAccepted,privacyAccepted].forEach(input => input.addEventListener('change',controls));
  $('#order').addEventListener('input',event => {if (!box.contains(event.target)) invalidate();});
  $('#order').addEventListener('change',event => {if (!box.contains(event.target)) invalidate();});
  document.addEventListener('click',event => {
    if (!box.contains(event.target) && event.target.closest?.('#menu,[data-order-cart-7i]')) queueMicrotask(invalidate);
  });
  const pickup = $('[name="order-fulfilment-7x"][value="pickup"]');
  const delivery = $('[name="order-fulfilment-7x"][value="delivery"]');
  if (pickup) {pickup.checked = true;pickup.dispatchEvent(new Event('change',{bubbles:true}));}
  if (delivery) {delivery.disabled=true;const parent=delivery.closest('label');if(parent)parent.hidden=true;}
  document.querySelectorAll('[data-order-route]').forEach(link => {
    if(link.getAttribute('data-order-route') === 'phone'){link.hidden=true;return;}
    link.setAttribute('href','#order');link.setAttribute('aria-label','Onlinebestellung starten');
    const label=link.querySelector('[data-order-route-label]');if(label)label.textContent='Online bestellen';
  });
  const wishesNote=document.createElement('p');wishesNote.textContent='Freie Sonderwünsche sind in diesem Testpiloten noch nicht verfügbar.';
  $('[data-order-cart-7i]')?.append(wishesNote);
  const cart = $('[data-cart-items-7i]');
  const disableWishes = () => cart?.querySelectorAll('textarea').forEach(input => {input.disabled=true;input.setAttribute('aria-label','Sonderwünsche im Piloten noch nicht verfügbar');});
  document.documentElement.classList.add('provide-connected');
  if(cart){new MutationObserver(disableWishes).observe(cart,{childList:true,subtree:true});disableWishes();}
  statusBox.querySelector('[data-refresh-status]').addEventListener('click',refreshStatus);
  try {
    const saved=JSON.parse(storage?.getItem(statusKey) || 'null');
    if(saved && /^[a-f0-9-]{36}$/i.test(saved.orderId) && /^[A-Za-z0-9_-]{43}$/.test(saved.statusAccessToken) && Date.parse(saved.statusAvailableUntil)>Date.now()) {
      access=saved;statusBox.hidden=false;await refreshStatus();
    }
  } catch {}
  message.textContent = checkout.client.needsReceipt ? 'Ein früherer Bestellversuch muss zuerst geprüft werden.' : 'Bitte nur Testdaten verwenden. Deine Auswahl wird vor dem Absenden vom Bestellsystem geprüft.';
  controls();
}
start().catch(() => {
  const message=document.querySelector('[data-provide-message]');
  if(message)message.textContent='Die Bestellverbindung konnte nicht gestartet werden. Bitte später erneut versuchen.';
});

import { CheckoutClient } from './checkout-client.js';
import { parsePublicCatalog } from './contracts/storefront-output.js';
import { parseCartQuote } from './contracts/cart-quote.js';
import { parseGuestPickupOrderConfirmation } from './contracts/checkout.js';
import { parsePublicOrderStatus } from './contracts/order-status.js';
import { mapDraft, draftFingerprint, assertQuoteMatches } from './model.mjs';

/** Uses the existing protected checkout client, including its persistent receipt recovery. */
export class AsianKitchenCheckout {
  constructor(config, manifest, {fetcher = fetch, storage = null, now = () => new Date()} = {}) {
    this.config = config;
    this.manifest = manifest;
    this.fetcher = fetcher;
    this.now = now;
    this.base = `/api/storefront/${manifest.restaurantSlug}/${manifest.locationSlug}`;
    this.client = new CheckoutClient(this.base, fetcher, storage);
    this.preview = null;
    this.busy = false;
    this.completed = false;
    this.renewAllowed = false;
  }
  invalidate() { this.preview = null; }
  async payload(response) {
    if (!response.ok) throw await this.client.error(response);
    return (await response.json()).data;
  }
  async quote(draft) {
    if (this.busy || this.completed || this.client.needsReceipt) throw Error('Bitte zuerst den bisherigen Bestellstatus prüfen.');
    this.busy = true;
    this.preview = null;
    try {
      const catalog = parsePublicCatalog(await this.payload(await this.fetcher(this.base + '/catalog', {cache:'no-store', credentials:'same-origin', signal:AbortSignal.timeout(10000)})));
      const command = mapDraft(draft, catalog, this.manifest, this.now());
      const quote = parseCartQuote(await this.payload(await this.client.request('cart-quote', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...command,fulfillmentType:'pickup'}),signal:AbortSignal.timeout(10000)})));
      if (this.client.missingMetadataWarning) throw Error('Zu einem früheren Bestellversuch fehlen die lokalen Belegdaten. Bitte zuerst im Dashboard prüfen lassen. Es wird keine weitere Bestellung ausgelöst.');
      assertQuoteMatches(quote, command);
      this.preview = {command:{...command,menuVersionId:quote.currentMenuVersionId}, quote, fingerprint:draftFingerprint(draft)};
      return quote;
    } finally { this.busy = false; }
  }
  async submit(draft, customer, challenge, issueId) {
    if (this.busy || this.completed) throw Error('Diese Bestellung wird bereits bearbeitet.');
    if (!this.preview || this.preview.fingerprint !== draftFingerprint(draft)) throw Error('Der Warenkorb wurde geändert. Bitte den Gesamtpreis erneut prüfen.');
    if (Date.parse(this.preview.command.requestedFor) <= this.now().getTime()) throw Error('Die Abholzeit ist verstrichen. Bitte neu auswählen.');
    if (this.client.needsReceipt) throw Error('Bitte zuerst den bisherigen Bestellstatus prüfen.');
    if (this.client.missingMetadataWarning) throw Error('Die Belegdaten eines früheren Versuchs fehlen. Bitte zuerst im Dashboard prüfen lassen.');
    const preview = this.preview;
    this.busy = true;
    try {
      if (this.client.hasPendingIssue) await this.client.retryIssue(AbortSignal.timeout(15000));
      else await this.client.issue(challenge, issueId, this.renewAllowed, AbortSignal.timeout(15000));
      this.renewAllowed = false;
      const raw = await this.payload(await this.client.submit('orders', {...preview.command,customer:{...customer},privacyNoticeVersion:this.config.privacyNoticeVersion}, AbortSignal.timeout(15000)));
      const result = parseGuestPickupOrderConfirmation(raw);
      if (!result || result.requestedFor !== preview.command.requestedFor || result.totalAmountMinor !== preview.quote.subtotalAmountMinor || result.itemCount !== preview.quote.itemCount || result.currency !== preview.quote.currency) throw Error('Die Antwort ist unklar. Bitte den Bestellstatus prüfen.');
      this.completed = true;
      return result;
    } finally { this.busy = false; }
  }
  async receipt() {
    if (this.busy) throw Error('Bitte die laufende Prüfung abwarten.');
    this.busy = true;
    try {
      const receipt = await this.client.receipt(AbortSignal.timeout(15000));
      if (receipt.state === 'committed') {
        const confirmation = receipt.mode === 'orders' && parseGuestPickupOrderConfirmation(receipt.confirmation);
        if (!confirmation) throw Error('Die Bestellung muss über ihren ursprünglichen Bestellweg geprüft werden.');
        this.completed = true;
        return {state:'committed', confirmation};
      }
      this.renewAllowed = receipt.writeExpired === true;
      this.preview = null;
      return receipt;
    } finally { this.busy = false; }
  }
  async status(access) {
    const result = parsePublicOrderStatus(await this.payload(await this.client.request('order-status', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderId:access.orderId,statusAccessToken:access.statusAccessToken}),signal:AbortSignal.timeout(10000)})));
    if (!result || result.orderId !== access.orderId) throw Error('Der Bestellstatus konnte nicht geprüft werden.');
    return result;
  }
}

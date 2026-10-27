import { locationTimeToInstant } from './contracts/location-time.js';

export function wallDate(now = new Date(), timezone = 'Europe/Berlin') {
  return new Intl.DateTimeFormat('sv-SE', {timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit'}).format(now);
}

/** IDs come only from the reviewed manifest; labels and browser prices never identify a product. */
export function mapDraft(draft, catalog, manifest, now = new Date()) {
  if (!draft || draft.fulfilment !== 'pickup') throw Error('Im Piloten ist nur Abholung verfügbar.');
  if (!Array.isArray(draft.items) || !draft.items.length || draft.items.length > 100) throw Error('Bitte zuerst Gerichte auswählen.');
  if (catalog.restaurant.slug !== manifest.restaurantSlug || catalog.location.slug !== manifest.locationSlug)
    throw Error('Der Restaurantanschluss stimmt nicht überein.');
  const requestedFor = locationTimeToInstant(`${wallDate(now, catalog.location.timezone)}T${draft.requestedPickupTime}`, catalog.location.timezone);
  if (!requestedFor || Date.parse(requestedFor) <= now.getTime()) throw Error('Bitte eine zukünftige Abholzeit auswählen.');
  const entries = draft.items.map(item => {
    const mapping = Object.hasOwn(manifest.items, item.id) ? manifest.items[item.id] : null;
    if (!mapping) throw Error('Ein Gericht ist noch nicht an das Bestellsystem angeschlossen.');
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw Error('Bitte die Artikelmenge prüfen.');
    if (String(item.specialRequest || '').trim()) throw Error('Freie Sonderwünsche können im Piloten noch nicht übertragen werden. Bitte den Sonderwunsch entfernen.');
    const variant = item.variant ? mapping.variants.find(v => v.label === item.variant) : null;
    if ((item.variant && !variant) || (!item.variant && mapping.variants.length)) throw Error('Bitte die Variante erneut auswählen.');
    return {item, mapping, variant};
  });
  if (entries.reduce((n,e) => n + e.item.quantity, 0) > 1000) throw Error('Der Warenkorb ist zu groß.');
  const menus = catalog.menus.filter(menu => menu.currency === 'EUR' && entries.every(e => menu.sections.some(s => s.items.some(i => i.id === e.mapping.menuItemId))));
  if (menus.length !== 1) throw Error('Die Asian-Kitchen-Speisekarte ist im Bestellsystem noch nicht eindeutig veröffentlicht.');
  const menu = menus[0];
  const keys = new Set();
  const lines = entries.map(({item, mapping, variant}) => {
    const product = menu.sections.flatMap(s => s.items).find(i => i.id === mapping.menuItemId);
    if (product.availability !== 'available' || !product.configuration?.informationConfirmed) throw Error(`${item.name}: derzeit nicht bestellbar.`);
    if ((product.configuration.optionGroups || []).some(g => g.minSelections > 0)) throw Error(`${item.name}: zusätzliche Auswahl erforderlich.`);
    if (variant && !product.configuration.variants.some(v => v.id === variant.id && v.isActive)) throw Error(`${item.name}: Variante derzeit nicht verfügbar.`);
    if (!variant && product.configuration.variants.length) throw Error(`${item.name}: Bitte eine Variante wählen.`);
    const key = JSON.stringify([mapping.menuItemId, variant?.id || null]);
    if (keys.has(key)) throw Error('Ein Gericht ist doppelt zugeordnet. Bitte den Warenkorb erneut prüfen.');
    keys.add(key);
    return {menuItemId:mapping.menuItemId, quantity:item.quantity, ...(variant ? {variantId:variant.id} : {})};
  });
  return {menuId:menu.id, menuVersionId:menu.versionId, requestedFor, lines};
}

export function draftFingerprint(draft) {
  return JSON.stringify([draft.fulfilment, draft.requestedPickupTime, draft.items.map(i => [i.id,i.variant,i.quantity,i.unitPriceCents,String(i.specialRequest || '')])]);
}

/** A quote must describe exactly this cart, even when the price/menu version changed. */
export function assertQuoteMatches(quote, command) {
  if (!quote || !['current','changed'].includes(quote.status) || quote.currency !== 'EUR') throw Error('Diese Auswahl oder Abholzeit ist derzeit nicht verfügbar.');
  const key = l => JSON.stringify([l.menuItemId,l.variantId || null,[...(l.optionIds || [])].sort(),l.quantity]);
  const requested = command.lines.map(key).sort();
  const returned = quote.lines.map(key).sort();
  if (JSON.stringify(requested) !== JSON.stringify(returned) || quote.deliveryQuote !== null) throw Error('Die Preisprüfung passt nicht zu deinem Warenkorb.');
}

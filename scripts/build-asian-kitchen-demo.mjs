/** Dependency-free Node 24 build. The uploaded original remains a separately hash-bound source. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(root,'apps/storefront/demo');
const out = path.join(root,'apps/storefront/public/asian-kitchen');
const original = await readFile(path.join(demo,'asian-kitchen.html'),'utf8');
const manifest = JSON.parse(await readFile(path.join(demo,'manifest.json'),'utf8'));
if (createHash('sha256').update(original).digest('hex') !== manifest.sourceSha256) throw Error('Asian Kitchen source changed; review menu mapping before building.');
if ((original.match(/data-dish-id="dish-/g) || []).length < 12) throw Error('Missing original menu.');
await mkdir(path.join(out,'contracts'),{recursive:true});
const done = new Set();
async function compileContract(name) {
  if(done.has(name))return;done.add(name);
  const source = await readFile(path.join(root,'packages/contracts/src',name+'.ts'),'utf8');
  const js = stripTypeScriptTypes(source,{mode:'transform'});
  for(const match of js.matchAll(/(?:from\s+|import\s*)["']\.\/([a-z0-9-]+)\.js["']/g))await compileContract(match[1]);
  await writeFile(path.join(out,'contracts',name+'.js'),js);
}
for(const name of ['checkout-protection','storefront-output','cart-quote','checkout','order-status','location-time'])await compileContract(name);
const client = await readFile(path.join(root,'apps/storefront/app/storefront/checkout-client.ts'),'utf8');
if(!client.includes('from "@provide/contracts"'))throw Error('Review checkout client import before building.');
await writeFile(path.join(out,'checkout-client.js'),stripTypeScriptTypes(client.replace('from "@provide/contracts"','from "./contracts/checkout-protection.js"'),{mode:'transform'}));
for(const name of ['model.mjs','checkout.mjs','bridge.mjs','bridge.css','manifest.json'])await writeFile(path.join(out,name),await readFile(path.join(demo,name)));
function replaceOnce(html, from, to) {
  if(html.split(from).length !== 2)throw Error('Original changed at integration point: '+from.slice(0,80));
  return html.replace(from,to);
}
// Preserve the menu HTML/images/layout. Only enable the named adapter and correct the legacy pickup clock.
let html = replaceOnce(original,'onlineShop:"prepared-not-active"','onlineShop:"active"');
const clock = `<script id="provide-pickup-clock">window.PROVIDE_PICKUP_CLOCK=function(){var p={};new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});return {minute:Number(p.hour)*60+Number(p.minute),weekday:new Date(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day))).getUTCDay()};};</script>`;
html = replaceOnce(html,'<script id="ordering-config-7q">',clock+'\n<script id="ordering-config-7q">');
html = replaceOnce(html,'config.orderInformation.openingHours[new Date().getDay()]','config.orderInformation.openingHours[window.PROVIDE_PICKUP_CLOCK().weekday]');
if(html.split('now.getHours() * 60 + now.getMinutes()').length !== 3)throw Error('Review pickup clock integration.');
html = html.replaceAll('now.getHours() * 60 + now.getMinutes()','window.PROVIDE_PICKUP_CLOCK().minute');
html = html.replaceAll('openingHours[now.getDay()]','openingHours[window.PROVIDE_PICKUP_CLOCK().weekday]');
html = replaceOnce(html,'Die Demo wird über Cloudflare Pages bereitgestellt.','Diese zusätzliche Pilotfassung wird über Cloudflare Workers bereitgestellt. Testbestellungen werden im PROVIDE-Bestellsystem mit seiner Supabase-Datenbank verarbeitet.');
html = replaceOnce(html,'Alle Formulare arbeiten ausschließlich im Browser. Die Demo besitzt kein Restaurant-Backend und versendet keine Angaben selbstständig an Asian Kitchen. Eingegebene Namen, Kontaktdaten, Wunschzeiten, Personenzahlen, Lieferadressen und Freitexte werden für Validierung, Vorschau und die vom Nutzer gewählte Übergabe verarbeitet. Erst eine bewusste Aktion kann Inhalte an eine externe App wie WhatsApp oder das E-Mail-Programm übergeben beziehungsweise in die Zwischenablage kopieren.',
  'Die Bestellfunktion dieser internen Pilotfassung ist an das PROVIDE-Bestellsystem angeschlossen. Bitte ausschließlich erfundene Test-Kontaktdaten eingeben. Beim Prüfen des Gesamtpreises werden Gerichtsauswahl und gewünschte Abholzeit an das Bestellsystem übertragen. Nach ausdrücklichem Absenden werden zusätzlich Name, Telefonnummer und E-Mail für die Testbestellung gespeichert und im geschützten Dashboard angezeigt. Reservierung und Gruppenanfrage bleiben die bisherigen Demonstrationsfunktionen; sie werden durch diese Anbindung nicht an ein Restaurant gesendet. Es finden keine echten Restaurantbestellungen oder Onlinezahlungen statt.');
html = replaceOnce(html,'Die Demo setzt selbst keine Cookies und lädt vor einer aktiven Kartenauswahl keine einwilligungsabhängigen Analyse-, Werbe- oder Social-Media-Skripte. Deshalb wird im aktuellen technischen Stand kein allgemeines Cookie-Banner eingesetzt. Diese Bewertung ist bei jeder neuen externen Integration erneut zu prüfen.',
  'Der geschützte Bestellabschluss verwendet ein sicheres, für JavaScript nicht lesbares Sitzungscookie mit einer Laufzeit von bis zu 90 Minuten. Im Browserspeicher bleiben außerdem technische Belegdaten zur Wiederaufnahme eines Bestellversuchs sowie der zeitlich begrenzte Zugriff auf den Bestellstatus. Namen, Telefonnummer und E-Mail werden dort nicht gespeichert. Bei der Sicherheitsprüfung wird Cloudflare Turnstile geladen; dabei entsteht eine Verbindung zu Cloudflare. Diese Prüfung startet erst im Bestellabschluss. Es sind keine Analyse- oder Werbedienste angeschlossen.');
html = replaceOnce(html,'Stand: August 2026. Diese Information beschreibt die technische Demonstrationswebsite.', 'Stand: 27. Oktober 2026. Diese ergänzte Information beschreibt die interne Bestell-Pilotfassung.');
html = replaceOnce(html,'</head>','<link rel="stylesheet" href="./bridge.css">\n</head>');
html = replaceOnce(html,'</body>','<script type="module" src="./bridge.mjs"></script>\n</body>');
await writeFile(path.join(out,'index.html'),html);
console.log(JSON.stringify({status:'built',directory:'apps/storefront/public/asian-kitchen',sourceSha256:manifest.sourceSha256,contractModules:done.size}));

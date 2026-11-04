const shop = "https://provide-bs-storefront-preview.alpaysey.workers.dev";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    const id = env.INTEGRATION_ID,
      title = env.RESTAURANT_NAME;
    const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Test-Speisekarte</title><style>body{font:18px system-ui;background:#f8f6f0;color:#252b24;margin:0}main{max-width:850px;margin:auto;padding:24px}header{background:#334c39;color:white;padding:24px;border-radius:16px}article{background:white;border:1px solid #ddd;border-radius:12px;margin:16px 0;padding:20px}button,select,input{font:inherit;padding:12px;border-radius:8px}button{background:#334c39;color:white;border:0;cursor:pointer;margin:6px}button:disabled{opacity:.5}label{display:block;margin:12px 0}small{display:block}#cart{position:sticky;bottom:0;background:#f8f6f0;border-top:2px solid #334c39;padding:16px}a{color:#334c39}</style><main><header><small>PROVIDE · INTERNE TEST-WEBSITE</small><h1>${title}</h1><p>Speisen auswählen und anschließend im gemeinsamen Checkout bestellen. Nur Testdaten verwenden.</p></header><p id="message" role="status">Speisekarte wird geladen …</p><section id="menu"></section><section id="cart"><p id="summary">Warenkorb leer</p><button id="transfer" disabled>Zum Bestellen</button><a href="${shop}">Zum gemeinsamen Shop</a></section></main><script type="module">
const endpoint=${JSON.stringify(shop + "/api/cart-handoff/" + id)},menuEl=document.querySelector('#menu'),msg=document.querySelector('#message'),button=document.querySelector('#transfer'),summary=document.querySelector('#summary');
let activeMenu=null,cart=[];const money=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:activeMenu?.currency??'EUR'}).format(n/100);
function update(){summary.textContent=cart.length?cart.map(l=>l.name+' × '+l.quantity).join(' · '):'Warenkorb leer';button.disabled=!cart.length;}
function label(text){const e=document.createElement('label');e.textContent=text;return e;}
try{
 const r=await fetch(endpoint,{credentials:'omit'});if(!r.ok)throw Error();const data=await r.json();const catalog=data.data.catalog;
 msg.textContent='Aktuelle Test-Speisekarte. Preise und Verfügbarkeit werden im Checkout erneut geprüft.';
 for(const menu of catalog.menus){const heading=document.createElement('h2');heading.textContent=menu.name??'Speisekarte';menuEl.append(heading);
 for(const section of menu.sections)for(const item of section.items){const card=document.createElement('article'),h=document.createElement('h3'),price=document.createElement('p');h.textContent=item.name;price.textContent=money(item.priceAmountMinor);card.append(h,price);
 const config=item.configuration;let variant=null;const options=[];
 if(config?.variants.length){const l=label('Variante'),s=document.createElement('select');for(const v of config.variants.filter(v=>v.isActive)){const o=document.createElement('option');o.value=v.id;o.textContent=v.name+' ('+money(v.priceDeltaAmountMinor)+')';s.append(o);}l.append(s);card.append(l);variant=s;}
 for(const group of config?.optionGroups??[]){const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=group.name+' ('+group.minSelections+'–'+group.maxSelections+')';box.append(legend);for(const option of group.options.filter(o=>o.isActive)){const l=label(option.name+' ('+money(option.priceDeltaAmountMinor)+')'),c=document.createElement('input');c.type='checkbox';c.value=option.id;l.prepend(c);box.append(l);options.push({input:c,group});}card.append(box);}
 const qty=document.createElement('input');qty.type='number';qty.min='1';qty.max='1000';qty.value='1';qty.setAttribute('aria-label','Menge '+item.name);card.append(qty);
 const add=document.createElement('button');add.textContent=item.availability==='available'?'Hinzufügen':'Nicht verfügbar';add.disabled=item.availability!=='available';add.onclick=()=>{const n=Number(qty.value);if(!Number.isInteger(n)||n<1||n>1000)return;const selected=options.filter(o=>o.input.checked);if(config?.optionGroups.some(g=>{const count=selected.filter(o=>o.group===g).length;return count<g.minSelections||count>g.maxSelections;})){msg.textContent='Bitte die vorgegebene Anzahl an Optionen auswählen.';return;}
 if(activeMenu&&activeMenu.id!==menu.id){msg.textContent='Bitte zuerst den bestehenden Warenkorb abschließen oder die Seite neu laden.';return;}
 const entry={menuItemId:item.id,quantity:n,...(variant?.value?{variantId:variant.value}:{}),...(config?{optionIds:selected.map(o=>o.input.value).sort()}:{}),name:item.name};const key=l=>JSON.stringify([l.menuItemId,l.variantId,l.optionIds]);const existing=cart.find(l=>key(l)===key(entry));if(cart.reduce((s,l)=>s+l.quantity,0)+n>1000||(!existing&&cart.length>=100)){msg.textContent='Der Warenkorb ist zu groß.';return;}activeMenu=menu;if(existing)existing.quantity+=n;else cart.push(entry);update();};card.append(add);menuEl.append(card);}}
}catch{msg.textContent='Die Test-Speisekarte ist gerade nicht verfügbar. Bitte später erneut laden.';}
button.onclick=async()=>{if(!activeMenu||!cart.length)return;button.disabled=true;try{const selection={schemaVersion:1,menuId:activeMenu.id,menuVersionId:activeMenu.versionId,lines:cart.map(({name,...l})=>l)};const r=await fetch(endpoint,{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({action:'create',selection})});if(!r.ok)throw Error();const data=await r.json();const target=new URL(data.data.url);if(target.origin!==${JSON.stringify(shop)})throw Error();window.location.assign(target.href);}catch{msg.textContent='Die Übergabe hat nicht funktioniert. Dein Warenkorb bleibt hier erhalten. Bei geänderter Speisekarte bitte neu laden.';button.disabled=false;}};
</script></html>`;
    return new Response(html, {
      headers: {
        "content-type": "text/html;charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src " +
          shop +
          "; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  },
};

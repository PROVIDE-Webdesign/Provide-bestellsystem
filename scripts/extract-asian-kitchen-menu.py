"""Extract data, never execute the HTML or infer missing business declarations."""
import argparse
import hashlib
import json
import re
import uuid
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path

class Element:
    def __init__(self, tag, attrs=None):
        self.tag, self.attrs, self.children = tag, dict(attrs or []), []
    def descendants(self):
        for x in self.children:
            if isinstance(x, Element):
                yield x
                yield from x.descendants()
    def text(self):
        return ''.join(x.text() if isinstance(x, Element) else x for x in self.children)
    def has_class(self, cls):
        return cls in self.attrs.get('class', '').split()

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element('root'); self.stack = [self.root]
    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs); self.stack[-1].children.append(node)
        if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:
            self.stack.append(node)
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]; break
    def handle_data(self, data): self.stack[-1].children.append(data)

NS = uuid.UUID('a1455d81-1580-45e2-acd6-de0042365001')
def identifier(key): return str(uuid.uuid5(NS, key))
def price(text):
    if not re.fullmatch(r'\d{1,7},\d{2}\s*€', text.strip()): raise ValueError('Invalid source price')
    return int(Decimal(text.strip().replace('€','').replace(',','.')) * 100)
def extract(data):
    parser = Parser(); parser.feed(data.decode('utf-8'))
    sections, items, source_items = [], [], []
    for section in (n for n in parser.root.descendants() if 'data-category-section' in n.attrs):
        key = section.attrs['data-category-section']
        headings = [n for n in section.descendants() if n.tag == 'h3']
        if len(headings) != 1: raise ValueError('Ambiguous category heading')
        sections.append({'key':key, 'name':headings[0].text().strip()})
        for card in (n for n in section.descendants() if n.has_class('dish-card') and 'data-dish-id' in n.attrs):
            source_id = card.attrs['data-dish-id']
            variants = [{'name':n.attrs['value'], 'priceAmountMinor':price(n.attrs['data-price'])}
                        for n in card.descendants() if n.tag == 'input' and n.attrs.get('type') == 'radio' and 'data-price' in n.attrs]
            if len({v['name'] for v in variants}) != len(variants): raise ValueError('Duplicate source variant')
            base = min(v['priceAmountMinor'] for v in variants) if variants else price(card.attrs['data-price'])
            name = card.attrs.get('data-name') or next(n.text().strip() for n in card.descendants() if n.has_class('dish-title'))
            item = {'id':identifier(source_id),'sectionKey':key,'name':name,'description':card.attrs.get('data-desc'),
                    'priceAmountMinor':base,'isActive':True,'configuration':None}
            items.append(item)
            source_items.append({'itemId':item['id'],'sourceId':source_id,'allergenCodes':card.attrs.get('data-allergens','').split(','),
                'variants':[{'id':identifier(source_id+':'+v['name']), 'name':v['name'],'priceDeltaAmountMinor':v['priceAmountMinor']-base,'isActive':True} for v in variants],
                'taxRateBasisPoints':None,'additives':None,'businessInformationConfirmed':False})
    if len(items) != 12 or len({i['id'] for i in items}) != 12: raise ValueError('12.0 R1 source parity failed')
    return {'format':'provide-menu-import-v1','source':{'name':'Asian_Kitchen_Arbeitsblock_12_0_R1.html','sha256':hashlib.sha256(data).hexdigest()},
            'sections':sections,'items':items,'pendingDeclarations':source_items}

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    result=extract(a.source.read_bytes());a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(f"Extracted {len(result['items'])} dishes; all declarations remain unconfirmed")

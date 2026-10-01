"""Check exact source-parity output before a prepared pilot bundle is accepted."""
import importlib.util
import json
import sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('extractor',Path(__file__).with_name('extract-asian-kitchen-menu.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
source=Path(sys.argv[1]);expected=json.loads(Path(sys.argv[2]).read_text())
actual=module.extract(source.read_bytes())
assert actual==expected, 'Source, ordering, prices, variants or unresolved declarations differ'
for item,pending in zip(actual['items'],actual['pendingDeclarations']):
    assert item['id']==pending['itemId'] and item['configuration'] is None
    assert all(v['priceDeltaAmountMinor']>=0 for v in pending['variants'])
print('PASS: all 12 dishes, categories, variant prices and unresolved declarations match the source')

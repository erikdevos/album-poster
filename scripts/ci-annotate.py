# Turns the failures in a node:test log into GitHub annotations (::error), which can be read without
# logging in. Used by the workflows when the browser tests fail. Usage: python3 scripts/ci-annotate.py e2e.log
import re, sys

log = open(sys.argv[1], encoding='utf-8', errors='replace').read().splitlines()
blocks, current = [], None
for line in log:
    if line.startswith('not ok '):
        current = [line]
        blocks.append(current)
    elif current is not None and line.startswith('  ') and not line.startswith('  ...'):
        current.append(line.strip())
    else:
        current = None

def clean(text):
    # annotations are one line; %0A is a new line in one
    return text.replace('%', '%25').replace('\r', '').replace('\n', '%0A')

for block in blocks[:10]:
    keep = [l for l in block if not re.match(r'(duration_ms|type|location|failureType|code|name|stack|operator):', l)]
    print('::error title=%s::%s' % (clean(block[0][:120]), clean('\n'.join(keep)[:900])))
print('%d failing tests' % len(blocks))

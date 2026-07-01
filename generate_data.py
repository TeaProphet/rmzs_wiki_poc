"""
Run this script after each server update to regenerate data/weapons.json from the CSV.
Usage: python generate_data.py
"""
import json, re, os

with open('Статы ЗС_types_fixed.csv', 'rb') as f:
    raw = f.read()
text = raw.decode('mac_cyrillic')
lines = text.split('\r')

def parse_num(s):
    s = s.strip().replace(',', '.')
    if not s or s.lower() == 'n/a' or s == '?':
        return None
    try:
        f = float(s)
        return int(f) if f == int(f) else round(f, 4)
    except:
        return s

weapons = []
for line in lines[1:]:
    if not line.strip():
        continue
    parts = line.split(';')
    if len(parts) < 11:
        continue

    v = parts[1].strip()
    if 'Базовое' in v:
        vtype = 'base'
        vnum = 0
    else:
        m = re.search(r'\d+', v)
        vnum = int(m.group()) if m else 1
        vtype = f'branch_{vnum}'

    name = parts[3].strip()

    w = {
        'family':      parts[0].strip(),
        'variantType': vtype,
        'variantNum':  vnum,
        'file':        parts[2].strip(),
        'name':        name,
        'damage':      parse_num(parts[4]),
        'clipSize':    parse_num(parts[5]),
        'delay':       parse_num(parts[6]),
        'tier':        parse_num(parts[7]),
        'reload':      parse_num(parts[8]),
        'ammo':        parts[9].strip(),
        'dps':         parse_num(parts[10]),
    }
    weapons.append(w)

os.makedirs('data', exist_ok=True)
with open('data/weapons.json', 'w', encoding='utf-8') as f:
    json.dump(weapons, f, ensure_ascii=False, indent=2)

families = sorted(set(w['family'] for w in weapons))
ammos    = sorted(set(w['ammo']   for w in weapons))
tiers    = sorted(set(w['tier']   for w in weapons if isinstance(w['tier'], (int, float))))

print(f'Written {len(weapons)} weapon variants across {len(families)} families')
print(f'Tiers: {tiers}')
print(f'Ammo types: {ammos}')

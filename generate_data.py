"""
Run this script after each server update to regenerate data/weapons.json from the CSV.
Usage: python generate_data.py
"""
import json
import re
import os

def parse_num(s):
    if s is None:
        return None
    s = str(s).strip().replace(',', '.')
    if not s or s.lower() in ('n/a', '?'):
        return None
    try:
        f = float(s)
        return int(f) if f == int(f) else round(f, 4)
    except:
        return s

def build_original_projectiles():
    proj_map = {}
    if not os.path.exists('original_data.csv'):
        return proj_map

    try:
        with open('original_data.csv', 'rb') as f:
            content = f.read().decode('cp1251')
        
        lines = content.split('\r')
        for line in lines:
            if not line.strip() or line.startswith(';'):
                continue
            parts = [p.strip() for p in line.split(';')]
            
            for idx, start_col in enumerate([0, 10, 20, 30]):
                if start_col + 8 >= len(parts):
                    continue
                file_name = parts[start_col]
                name = parts[start_col+1]
                if not file_name or not name:
                    continue
                
                vtype = 'base' if idx == 0 else f'branch_{idx}'
                damage = parse_num(parts[start_col+2])
                delay = parse_num(parts[start_col+4])
                dps = parse_num(parts[start_col+8])
                
                proj_count = 1
                if isinstance(dps, (int, float)) and isinstance(damage, (int, float)) and isinstance(delay, (int, float)) and delay > 0:
                    proj_count = int(round(dps / (damage / delay)))
                    if proj_count <= 0:
                        proj_count = 1
                proj_map[(file_name, vtype)] = proj_count
    except Exception as e:
        print(f"Error parsing original_data.csv for projectiles: {e}")
    return proj_map

def main():
    proj_map = build_original_projectiles()

    with open('Статы ЗС_types_fixed.csv', 'rb') as f:
        raw = f.read()
    text = raw.decode('mac_cyrillic')
    lines = text.split('\r')

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

        file_name = parts[2].strip()
        name = parts[3].strip()
        damage = parse_num(parts[4])
        delay = parse_num(parts[6])
        dps = parse_num(parts[10])
        
        # Determine projectile count:
        # 1. Check original_data.csv lookup map
        # 2. Fall back to current row math if not found
        key = (file_name, vtype)
        if key in proj_map:
            proj_count = proj_map[key]
        else:
            if isinstance(dps, (int, float)) and isinstance(damage, (int, float)) and isinstance(delay, (int, float)) and delay > 0:
                proj_count = int(round(dps / (damage / delay)))
                if proj_count <= 0:
                    proj_count = 1
            else:
                proj_count = 1

        # Explicit overrides for known database/excel errors:
        # 'Blareduct' Zip Gun actually shoots only 1 projectile (the source spreadsheet has a copy-paste error from Blaster)
        if file_name == 'weapon_zs_blareduct':
            proj_count = 1

        # Exclude dps from json output
        w = {
            'family':      parts[0].strip(),
            'variantType': vtype,
            'variantNum':  vnum,
            'file':        file_name,
            'name':        name,
            'damage':      damage,
            'clipSize':    parse_num(parts[5]),
            'delay':       delay,
            'tier':        parse_num(parts[7]),
            'reload':      parse_num(parts[8]),
            'ammo':        parts[9].strip(),
            'projectileCount': proj_count,
        }
        weapons.append(w)

    # Report weapons without a tier
    no_tier = [w for w in weapons if w['tier'] is None]
    if no_tier:
        print("WARNING: Weapons without a tier:")
        for w in no_tier:
            print(f"  - {w['name']} ({w['file']})")

    os.makedirs('data', exist_ok=True)
    with open('data/weapons.json', 'w', encoding='utf-8') as f:
        json.dump(weapons, f, ensure_ascii=False, indent=2)

    print(f'Successfully compiled {len(weapons)} weapons to data/weapons.json.')

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Parse League of Leagues trades CSV into structured JSON.

The CSV has all 5 season blocks side-by-side, each 7 columns wide with a 1-col gap:
  2025-26: cols 0-6  (A-G)
  2024-25: cols 8-14 (I-O)
  2023-24: cols 16-22 (Q-W)
  2022-23: cols 24-30 (Y-AE)
  2021-22: cols 32-38 (AG-AM)

Each trade spans exactly 2 rows:
  Row 1: [trade#, date, owner_a, team_a, players_a_sends, picks_a_sends, context]
  Row 2: [empty,  empty, owner_b, team_b, players_b_sends, picks_b_sends, empty]

Called two ways:
  1. Standalone:  python3 parse_trades.py  → reads rawTrades from data.js, prints JSON
  2. From update.py: parse_trades(csv_text) → pass freshly fetched CSV string directly
"""
import csv, io, json, sys, re

DATA_JS_PATH = '/sessions/fervent-serene-maxwell/mnt/League of Leagues/data.js'

SEASON_BLOCKS = [
    (0,  '2025-26'),
    (8,  '2024-25'),
    (16, '2023-24'),
    (24, '2022-23'),
    (32, '2021-22'),
]

def clean(s):
    s = s.strip()
    if re.match(r'^-+$', s) or s.lower() in ('------', ''):
        return ''
    return s

def parse_sport(ctx):
    ctx = ctx.strip()
    m = re.search(r'\b(NFL|NBA|MLB)\b', ctx, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    if re.search(r'draft', ctx, re.IGNORECASE):
        return 'Draft'
    return ctx or ''

def get_csv_from_datajs():
    """Extract rawTrades template literal from data.js and unescape it."""
    with open(DATA_JS_PATH, encoding='utf-8') as f:
        content = f.read()
    m = re.search(r'rawTrades:\s*`([\s\S]*?)`,', content)
    if not m:
        print("ERROR: rawTrades not found in data.js", file=sys.stderr)
        sys.exit(1)
    raw = m.group(1)
    raw = raw.replace('\\`', '`').replace('\\${', '${').replace('\\\\', '\\')
    return raw

def parse_block(rows, col_start, season_label):
    trades = []
    i = 1  # skip header row
    while i < len(rows):
        row = rows[i]

        def cell(offset):
            idx = col_start + offset
            return row[idx].strip() if idx < len(row) else ''

        trade_num_raw = cell(0)
        try:
            trade_num = int(trade_num_raw)
        except ValueError:
            i += 1
            continue

        date      = cell(1)
        owner_a   = clean(cell(2))
        team_a    = clean(cell(3))
        players_a = clean(cell(4))
        picks_a   = clean(cell(5))
        context   = clean(cell(6))

        j = i + 1
        owner_b = team_b = players_b = picks_b = ''
        if j < len(rows):
            row2 = rows[j]
            def cell2(offset):
                idx = col_start + offset
                return row2[idx].strip() if idx < len(row2) else ''
            owner_b   = clean(cell2(2))
            team_b    = clean(cell2(3))
            players_b = clean(cell2(4))
            picks_b   = clean(cell2(5))

        if not owner_a and not owner_b:
            i += 1
            continue

        sport = parse_sport(context)

        trades.append({
            'num':    trade_num,
            'date':   date,
            'season': season_label,
            'sport':  sport,
            'context': context,
            'side_a': {
                'owner':   owner_a,
                'team':    team_a,
                'players': players_a,
                'picks':   picks_a,
            },
            'side_b': {
                'owner':   owner_b,
                'team':    team_b,
                'players': players_b,
                'picks':   picks_b,
            },
        })
        i += 2

    return trades

def parse_trades(csv_text=None):
    """
    Parse trades and return list of trade dicts.
    csv_text: freshly fetched CSV string from Google Sheets (update.py passes this).
              If None, falls back to reading rawTrades from data.js.
    """
    raw = csv_text if csv_text else get_csv_from_datajs()
    reader = csv.reader(io.StringIO(raw))
    rows = list(reader)
    print(f"  CSV rows: {len(rows)}", file=sys.stderr)

    all_trades = []
    for col_start, season_label in SEASON_BLOCKS:
        block = parse_block(rows, col_start, season_label)
        print(f"  {season_label}: {len(block)} trades", file=sys.stderr)
        all_trades.extend(block)

    print(f"  Total: {len(all_trades)} trades", file=sys.stderr)
    return all_trades

def main():
    all_trades = parse_trades()  # standalone: reads from data.js
    print(json.dumps(all_trades, indent=2))

if __name__ == '__main__':
    main()

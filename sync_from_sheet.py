#!/usr/bin/env python3
"""
League of Leagues — one-command site update.

    python3 sync_from_sheet.py

Pulls the live Google Sheet and rewrites data.js with:
  - the completed 2026 draft board (picks, keepers, cannot-keep)
  - the 2027 future draft board (traded picks)
  - every trade, all seasons

It REFUSES to write if any historical season's trades would change, or if any
draft board from 2021-2025, the standings, or the final rosters would move.
A timestamped backup is written next to data.js before anything changes.
"""
import csv, io, json, os, re, sys, urllib.request, urllib.parse

SITE = os.path.dirname(os.path.abspath(__file__))

ID   = "1JXV5W4bmmyGzZkKwqm94juW7qP8H0WEeg1GFJRK2M34"
SPORT_COLOR = {"NFL":"EAD1DC","NBA":"C9DAF8","MLB":"FFF2CC"}
TRADED_COLOR = "FF9900"

def gviz(**kw):
    q = urllib.parse.urlencode(dict(tqx="out:csv", **kw))
    u = f"https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?{q}"
    return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'Mozilla/5.0'}), timeout=90).read().decode('utf-8','ignore')

def rows(text): return list(csv.reader(io.StringIO(text)))
def norm(s): return re.sub(r'[^a-z0-9]', '', (s or '').lower())

# ---------- player pool (sport + position for every drafted name) ----------
pool = json.load(open(os.path.join(SITE, "draft", "players.json")))
POOL = {}
for p in pool:
    POOL[p["p"].strip().lower()] = p

def lookup(name):
    return POOL.get((name or '').strip().lower())

# ---------- teams ----------
def parse_teams(hdr):
    out = []
    for i in range(2, 14):
        owner, rest = hdr[i].split("\n", 1)
        m = re.match(r'\((.*?)\)\s*(.*)', rest)
        out.append({"col": i, "owner": owner.strip(),
                    "initials": m.group(1).strip(), "team": m.group(2).strip()})
    return out

def label_to_initials(label, teams):
    """'* Triple Threat - Farnia' -> 'FG'."""
    lab = label.strip().lstrip('*').strip()
    team_part = lab.split(' - ')[0]
    owner_part = lab.split(' - ')[-1] if ' - ' in lab else ''
    tn, on = norm(team_part), norm(owner_part)
    for t in teams:
        nt = norm(t["team"])
        if tn and (tn in nt or nt in tn):
            return t["initials"]
    for t in teams:
        no = norm(t["owner"])
        if on and (on in no or no in on):
            return t["initials"]
    return None

# ---------- 2026 completed board ----------
def build_2026():
    r = rows(gviz(gid="733728654"))
    teams = parse_teams(r[0])
    unresolved = []

    picks = []
    for ri in range(1, 33):
        row = r[ri]
        cells = []
        for t in teams:
            raw = row[t["col"]].strip() if t["col"] < len(row) else ''
            if not raw:
                cells.append(None); continue
            parts = raw.split("\n")
            player = parts[0].strip()
            owner_line = parts[1].strip() if len(parts) > 1 else ''
            is_traded = owner_line.startswith('*')
            if player.lower().startswith("supplemental pick"):
                sport, pos = "SUPP", "SUPP"
            else:
                pl = lookup(player)
                if not pl:
                    unresolved.append(player)
                    sport, pos = None, None
                else:
                    sport, pos = pl.get("sport"), pl.get("pos")
            cell = {"player": player, "sport": sport,
                    "color": SPORT_COLOR.get(sport), "pos": pos}
            if is_traded:
                init = label_to_initials(owner_line, teams)
                if not init: unresolved.append("LABEL:" + owner_line)
                cell["traded_from"] = init
            cells.append(cell)
        picks.append({"round": int(row[0]), "dir": row[1].strip(), "picks": cells})

    keepers = []
    for ri in range(33, 42):
        row = r[ri]
        sport = row[14].strip().split()[0] if len(row) > 14 and row[14].strip() else None
        cells = []
        for t in teams:
            nm = row[t["col"]].strip() if t["col"] < len(row) else ''
            if not nm:
                cells.append(None); continue
            pl = lookup(nm)
            sp = pl.get("sport") if pl else sport
            cells.append({"player": nm, "sport": sp, "color": SPORT_COLOR.get(sp),
                          "pos": pl.get("pos") if pl else None, "is_keeper": True})
        keepers.append({"round": ri, "dir": "", "picks": cells,
                        "keeper_num": (ri - 33) % 3 + 1, "keeper_sport": sport})

    supplemental = []
    for ri in range(42, 61):
        row = r[ri]
        supplemental.append({"round": int(row[0]), "dir": row[1].strip(),
                             "picks": [None] * 12})

    cannot_keep = []
    for ri in range(77, 86):
        row = r[ri]
        out = []
        for t in teams:
            nm = row[t["col"]].strip() if t["col"] < len(row) else ''
            if not nm:
                out.append(None); continue
            pl = lookup(nm)
            sp = pl.get("sport") if pl else None
            out.append({"player": nm, "sport": sp, "color": SPORT_COLOR.get(sp)})
        cannot_keep.append(out)

    return {"year": 2026, "is_future": False, "teams": teams, "picks": picks,
            "keepers": keepers, "supplemental": supplemental,
            "cannot_keep": cannot_keep}, unresolved

# ---------- 2027 future board ----------
def build_2027():
    r = rows(gviz(sheet="2027 Draft Board"))
    teams = parse_teams(r[0])
    unresolved = []
    picks = []
    for ri in range(1, 31):
        row = r[ri]
        cells = []
        for t in teams:
            raw = row[t["col"]].strip() if t["col"] < len(row) else ''
            if not raw:
                cells.append(None); continue
            init = label_to_initials(raw, teams)
            if not init: unresolved.append("LABEL:" + raw)
            cells.append({"player": None, "sport": None, "color": TRADED_COLOR,
                          "owned_by": raw.lstrip('*').strip(), "is_traded": True,
                          "traded_to": init})
        picks.append({"round": int(row[0]), "dir": row[1].strip(), "picks": cells})

    supplemental = []
    for ri in range(40, 59):
        row = r[ri]
        supplemental.append({"round": int(row[0]), "dir": row[1].strip(),
                             "picks": [None] * 12})

    return {"year": 2027, "is_future": True, "teams": teams, "picks": picks,
            "keepers": [], "supplemental": supplemental, "cannot_keep": []}, unresolved

# ---------- trades (6 season blocks, 8 cols apart) ----------
SEASON_BLOCKS = [(0,'2026-27'), (8,'2025-26'), (16,'2024-25'),
                 (24,'2023-24'), (32,'2022-23'), (40,'2021-22')]

def clean(s):
    s = (s or '').strip()
    return '' if re.match(r'^-+$', s) else s

def parse_sport(ctx):
    m = re.search(r'\b(NFL|NBA|MLB)\b', ctx or '', re.I)
    if m: return m.group(1).upper()
    if re.search(r'draft', ctx or '', re.I): return 'Draft'
    return (ctx or '').strip()

def build_trades():
    r = rows(gviz(gid="444073537"))
    all_t = []
    counts = {}
    for col, season in SEASON_BLOCKS:
        # verify the block header actually names this season
        hdr = r[0][col+1] if col+1 < len(r[0]) else ''
        if season.split('-')[0] not in hdr:
            print(f"  !! block at col {col} header is {hdr!r}, expected {season}", file=sys.stderr)
        n = 0
        i = 1
        while i < len(r):
            row = r[i]
            c = lambda o: row[col+o].strip() if col+o < len(row) else ''
            try: num = int(c(0))
            except ValueError:
                i += 1; continue
            row2 = r[i+1] if i+1 < len(r) else []
            c2 = lambda o: row2[col+o].strip() if col+o < len(row2) else ''
            oa, ob = clean(c(2)), clean(c2(2))
            if not oa and not ob:
                i += 1; continue
            ctx = clean(c(6))
            all_t.append({"num": num, "date": c(1), "season": season,
                          "sport": parse_sport(ctx), "context": ctx,
                          "side_a": {"owner": oa, "team": clean(c(3)),
                                     "players": clean(c(4)), "picks": clean(c(5))},
                          "side_b": {"owner": ob, "team": clean(c2(3)),
                                     "players": clean(c2(4)), "picks": clean(c2(5))}})
            n += 1; i += 2
        counts[season] = n
    return all_t, counts

HIST_LOCKED = ['2024-25','2023-24','2022-23','2021-22']

def trade_key(t):
    return '|'.join([t['season'], str(t['num']), t['date'],
                     t['side_a']['owner'], t['side_a']['players'], t['side_a']['picks'],
                     t['side_b']['owner'], t['side_b']['players'], t['side_b']['picks']])

def load_datajs(path):
    txt = open(path, encoding='utf-8').read()
    i = txt.index('window.LIVE_DATA')
    i = txt.index('=', i) + 1
    j = txt.rindex('}') + 1
    return json.loads(txt[i:j])

def write_datajs(path, data):
    from datetime import datetime
    hdr = ("// League of Leagues - Auto-generated data file\n"
           "// Updated: %s\n"
           "// DO NOT EDIT - run sync_from_sheet.py to regenerate\n\n"
           % datetime.now().strftime('%B %d, %Y at %I:%M %p'))
    open(path, 'w', encoding='utf-8').write(hdr + 'window.LIVE_DATA = ' + json.dumps(data, indent=1) + ';\n')

def main():
    import shutil
    from datetime import datetime
    dj = os.path.join(SITE, 'data.js')
    D = load_datajs(dj)

    b26, u26 = build_2026()
    b27, u27 = build_2027()
    trades, tcounts = build_trades()

    if u26 or u27:
        print('ABORT - could not resolve:', sorted(set(u26 + u27))[:20]); return 1

    # SAFETY 1 - locked historical trade seasons must come back identical
    for season in HIST_LOCKED:
        old = sorted(trade_key(t) for t in D['parsedTrades'] if t['season'] == season)
        new = sorted(trade_key(t) for t in trades if t['season'] == season)
        if old != new:
            print('ABORT - historical trades changed for', season)
            print('  cached', len(old), '-> live', len(new)); return 1
    print('OK  historical trade seasons unchanged')

    before_boards = json.dumps({y: D['draftBoards'][y] for y in ['2021','2022','2023','2024','2025']}, sort_keys=True)
    before_std    = json.dumps(D.get('standingsData'), sort_keys=True)
    before_rost   = json.dumps(D.get('finalRosters'), sort_keys=True)

    D['draftBoards']['2026'] = b26
    D['draftBoards']['2027'] = b27
    D['parsedTrades'] = trades
    D['updated'] = datetime.now().isoformat()

    # SAFETY 2 - nothing else may move
    after_boards = json.dumps({y: D['draftBoards'][y] for y in ['2021','2022','2023','2024','2025']}, sort_keys=True)
    if (after_boards != before_boards
            or json.dumps(D.get('standingsData'), sort_keys=True) != before_std
            or json.dumps(D.get('finalRosters'), sort_keys=True) != before_rost):
        print('ABORT - untouched data would change'); return 1
    print('OK  2021-2025 boards, standings and final rosters unchanged')

    shutil.copyfile(dj, os.path.join(SITE, 'data.js.bak-' + datetime.now().strftime('%Y%m%d-%H%M%S')))
    write_datajs(dj, D)

    check = load_datajs(dj)
    if json.dumps(check, sort_keys=True) != json.dumps(D, sort_keys=True):
        print('ABORT - written file did not round-trip'); return 1

    filled = sum(1 for r in b26['picks'] for p in r['picks'] if p)
    traded = sum(1 for r in b26['picks'] for p in r['picks'] if p and p.get('traded_from'))
    f27    = sum(1 for r in b27['picks'] for p in r['picks'] if p)
    print('OK  data.js rewritten')
    print('    2026: %d picks (%d traded), %d keepers' % (filled, traded, sum(1 for r in b26['keepers'] for p in r['picks'] if p)))
    print('    2027: %d rounds, %d traded picks' % (len(b27['picks']), f27))
    print('    trades: %d total %s' % (sum(tcounts.values()), tcounts))
    print('\nNow commit and push to publish the site.')
    return 0

if __name__ == '__main__':
    sys.exit(main())

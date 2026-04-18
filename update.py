#!/usr/bin/env python3
"""
=======================================================
  League of Leagues — Google Sheets Update Script
=======================================================
  HOW TO UPDATE YOUR SITE DATA:

  OPTION 1 — Ask Claude in Cowork (recommended):
    Open this folder in Cowork and say:
    "Update the League of Leagues site from the Google Sheet"

  OPTION 2 — Run this script directly:
    python3 update.py

    REQUIREMENTS: Your Google Sheet tabs must be publicly
    accessible. In Google Sheets:
      File → Share → Publish to web → Choose CSV format

  OUTPUT:
    Regenerates data.js next to this script.
    Open index.html in any browser to see updated data.

  HOW IT WORKS:
    index.html loads data.js as a <script> tag.
    parse_drafts.py, parse_standings.py, parse_trades.py
    must be in the same folder as this script.
=======================================================
"""

import urllib.request
import urllib.error
import json
import os
import re
import sys
from datetime import datetime

# ============================================================
#   CONFIGURATION
# ============================================================
SPREADSHEET_ID = "1JXV5W4bmmyGzZkKwqm94juW7qP8H0WEeg1GFJRK2M34"

SHEET_TABS = {
    "standings_overall": "1905868862",
    "trades":            "444073537",
    "draft_2026":        "733728654",
    "draft_2025":        "1867088147",
    "draft_2024":        "64438121",
    "draft_2023":        "705043393",
    "draft_2022":        "1638624110",
    "draft_2021":        "1384131078",
}

DRAFT_YEARS = [2026, 2025, 2024, 2023, 2022, 2021]

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
# ============================================================


def fetch_csv(gid: str) -> str | None:
    url = (
        f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}"
        f"/export?format=csv&gid={gid}"
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (League-of-Leagues-Updater/1.0)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            stripped = text.strip()
            if stripped.startswith("<!DOCTYPE") or stripped.startswith("<html"):
                return None
            return text
    except urllib.error.HTTPError as e:
        if e.code in (302, 401, 403):
            return None
        raise
    except Exception:
        return None


def js_escape(text: str) -> str:
    text = text.replace("\\", "\\\\")
    text = text.replace("`", "\\`")
    text = text.replace("${", "\\${")
    return text


def print_status(icon: str, label: str, detail: str = ""):
    print(f"  {icon}  {label:<32} {detail}")


def main():
    print()
    print("=" * 58)
    print("  🏆  League of Leagues — Data Sync")
    print(f"       {datetime.now().strftime('%A, %B %d %Y  %I:%M %p')}")
    print("=" * 58)
    print()

    results = {}
    succeeded = []
    protected = []
    failed = []

    print("  Fetching sheets from Google…")
    print()

    standings_raw = fetch_csv(SHEET_TABS["standings_overall"])
    if standings_raw:
        results["rawStandings"] = standings_raw
        succeeded.append("standings_overall")
        print_status("✓", "Overall Standings", f"{len(standings_raw):,} chars")
    else:
        results["rawStandings"] = None
        failed.append("standings_overall")
        print_status("✗", "Overall Standings", "failed / protected")

    trades_raw = fetch_csv(SHEET_TABS["trades"])
    if trades_raw:
        results["rawTrades"] = trades_raw
        succeeded.append("trades")
        print_status("✓", "Trades", f"{len(trades_raw):,} chars")
    else:
        results["rawTrades"] = None
        failed.append("trades")
        print_status("✗", "Trades", "failed / protected")

    results["rawDrafts"] = {}
    for year in DRAFT_YEARS:
        key = f"draft_{year}"
        gid = SHEET_TABS.get(key)
        if not gid:
            continue
        raw = fetch_csv(gid)
        if raw:
            results["rawDrafts"][year] = raw
            succeeded.append(key)
            print_status("✓", f"Draft Board {year}", f"{len(raw):,} chars")
        else:
            results["rawDrafts"][year] = None
            protected.append(key)
            print_status("🔒", f"Draft Board {year}", "protected — skipped")

    # --- Run Excel parsers ---
    import subprocess, importlib.util as _ilu
    import json as _json

    draft_boards_json = None
    standings_data_json = None
    parsed_trades_json = None

    PARSE_DRAFTS    = os.path.join(SCRIPT_DIR, "parse_drafts.py")
    PARSE_STANDINGS = os.path.join(SCRIPT_DIR, "parse_standings.py")
    PARSE_TRADES    = os.path.join(SCRIPT_DIR, "parse_trades.py")

    if os.path.exists(PARSE_DRAFTS):
        try:
            out = subprocess.check_output(["python3", PARSE_DRAFTS], stderr=subprocess.DEVNULL)
            draft_boards_json = out.decode("utf-8")
            parsed = _json.loads(draft_boards_json)
            print_status("✓", "Excel Draft Boards", f"{len(parsed)} year(s) parsed")
        except Exception as e:
            print_status("⚠", "Excel Draft Boards", f"parse failed: {e}")

    if os.path.exists(PARSE_STANDINGS):
        try:
            out = subprocess.check_output(["python3", PARSE_STANDINGS], stderr=subprocess.DEVNULL)
            standings_data_json = out.decode("utf-8")
            parsed = _json.loads(standings_data_json)
            print_status("✓", "Excel Standings/Earnings", f"{len(parsed.get('seasons',{}))} season(s) parsed")
        except Exception as e:
            print_status("⚠", "Excel Standings/Earnings", f"parse failed: {e}")

    if os.path.exists(PARSE_TRADES) and results.get("rawTrades"):
        try:
            _spec = _ilu.spec_from_file_location("parse_trades", PARSE_TRADES)
            _pt = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_pt)
            trades_list = _pt.parse_trades(csv_text=results["rawTrades"])
            parsed_trades_json = _json.dumps(trades_list, separators=(',', ':'))
            print_status("✓", "Trades (Google Sheet)", f"{len(trades_list)} trades parsed")
        except Exception as e:
            print_status("⚠", "Trades", f"parse failed: {e}")

    # --- Build data.js ---
    now_iso = datetime.now().isoformat()
    now_str = datetime.now().strftime('%B %d, %Y at %I:%M %p')

    lines = [
        "// League of Leagues — Auto-generated data file",
        f"// Updated: {now_str}",
        "// DO NOT EDIT — run update.py to regenerate",
        "",
        "window.LIVE_DATA = {",
        f'  updated: "{now_iso}",',
    ]

    if results["rawStandings"]:
        lines.append(f"  rawStandings: `{js_escape(results['rawStandings'])}`,")
    else:
        lines.append("  rawStandings: null,")

    if results["rawTrades"]:
        lines.append(f"  rawTrades: `{js_escape(results['rawTrades'])}`,")
    else:
        lines.append("  rawTrades: null,")

    lines.append("  rawDrafts: {")
    for year in DRAFT_YEARS:
        raw = results["rawDrafts"].get(year)
        if raw:
            lines.append(f"    {year}: `{js_escape(raw)}`,")
        else:
            lines.append(f"    {year}: null,")
    lines.append("  },")

    if draft_boards_json:
        lines.append(f"  draftBoards: {draft_boards_json.strip()},")
    else:
        lines.append("  draftBoards: null,")

    if standings_data_json:
        lines.append(f"  standingsData: {standings_data_json.strip()},")
    else:
        lines.append("  standingsData: null,")

    if parsed_trades_json:
        lines.append(f"  parsedTrades: {parsed_trades_json.strip()},")
    else:
        lines.append("  parsedTrades: null,")

    lines.append("};")
    lines.append("")

    js_content = "\n".join(lines)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)

    file_size_kb = os.path.getsize(OUTPUT_FILE) / 1024

    print()
    print("=" * 58)
    print(f"  ✅  {len(succeeded)} tab(s) synced successfully")
    if protected:
        print(f"  🔒  {len(protected)} tab(s) protected (publish sheet to enable)")
    if failed:
        print(f"  ⚠️   {len(failed)} tab(s) failed — check sheet sharing settings")
    print()
    print(f"  📄  Saved: data.js  ({file_size_kb:.0f} KB)")
    print(f"  🌐  Open index.html in your browser to see live data!")
    print("=" * 58)
    print()


if __name__ == "__main__":
    main()

/**
 * League of Leagues — 2026 Live Draft Board
 * ==========================================
 * Mirrors every pick from the draft room into the Master Sheet, laid out like a
 * real draft board: fixed team columns, snake arrows, one pick per cell.
 *
 * SETUP (one time):
 *  1. Master Sheet -> Extensions -> Apps Script
 *  2. Delete everything, paste this file in, save
 *  3. Deploy -> New deployment -> gear -> Web app
 *       Execute as:      Me
 *       Who has access:  Anyone      <- required
 *  4. Deploy, authorize, copy the web app URL
 *  5. Draft room -> Admin -> Google Sheet backup -> paste URL -> Save
 *  6. Click "Send test row" in the draft room to confirm the connection
 */

// ================== CONFIG ==================
var LOG_TAB   = 'Draft Log';
var BOARD_TAB = '2026 Live Draft Board';

// LAYOUT: 'seats' puts each team in a fixed column with snake arrows (matches
//         your 2026 Draft Board). 'pickorder' numbers columns Pick 1..Pick 12.
var LAYOUT = 'seats';

var HEADER_ROW      = 1;   // owner names (row 1), team names (row 2)
var BOARD_FIRST_ROW = 3;   // round 1 goes in row 3 — first pick cell is C3
var ROUND_COL_LEFT  = 1;   // column A — round number
var ARROW_COL_LEFT  = 2;   // column B — direction arrow
var BOARD_FIRST_COL = 3;   // column C — first team column
var TEAMS_ACROSS    = 12;
var ARROW_COL_RIGHT = 15;  // column O
var ROUND_COL_RIGHT = 16;  // column P

// Background colour per sport. Change these hex values to taste.
var SPORT_BG = {
  NFL: '#FCEBEB',   // soft red
  NBA: '#E6F1FB',   // soft blue
  MLB: '#FAEEDA'    // soft amber
};
// Matching dark text so it stays readable on the tint
var SPORT_FG = {
  NFL: '#791F1F',
  NBA: '#0C447C',
  MLB: '#633806'
};
var NO_SPORT_BG = '#F1EFE8';   // used when a pick has no sport recorded
var NO_SPORT_FG = '#2C2C2A';

// Traded picks — marked with the prefix, italics and a note.
// Background is reserved for the sport, so trades are shown by text instead.
var TRADE_PREFIX = '* ';           // marks the ownership line on a traded pick
var TRADE_NOTE   = true;
var OWNER_LINE_COLOR = '#5F5E5A';  // grey for the ownership line underneath
// ============================================

function doPost(e) {
  var out = { ok: true, written: 0, errors: [] };
  try {
    var body = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (body.reset) {
      clearEverything(ss);
      out.reset = true;
      return json(out);
    }

    var picks = body.picks || [];
    var log = getLog(ss);
    var board = ss.getSheetByName(BOARD_TAB);

    for (var i = 0; i < picks.length; i++) {
      var p = picks[i];
      try {
        log.appendRow([
          new Date(p.at || Date.now()), p.overall, p.round, p.slot,
          p.player, p.sport, p.pos,
          p.team, p.owner,
          p.traded ? 'TRADED' : '',
          p.traded ? p.origTeam : '',
          p.auto ? 'auto' : ''
        ]);
        if (board && p.overall > 0) writeToBoard(board, p);
        out.written++;
      } catch (err) {
        out.errors.push('pick ' + p.overall + ': ' + err);
      }
    }
  } catch (err) {
    out.ok = false;
    out.errors.push(String(err));
  }
  return json(out);
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function getLog(ss) {
  var log = ss.getSheetByName(LOG_TAB);
  if (!log) {
    log = ss.insertSheet(LOG_TAB);
    log.appendRow(['Timestamp','Overall','Round','Slot','Player','Sport','Pos',
                   'Drafted by','Owner','Traded?','Original team','Auto-pick?']);
    log.setFrozenRows(1);
  }
  return log;
}

/** Which column does this pick belong in? */
function colFor(p) {
  if (LAYOUT === 'seats') {
    // seatIndex is 1-12 and already accounts for the snake
    return BOARD_FIRST_COL + (p.seatIndex - 1);
  }
  return BOARD_FIRST_COL + (p.slot - 1);
}

function writeToBoard(board, p) {
  var row = BOARD_FIRST_ROW + (p.round - 1);
  var col = colFor(p);
  var cell = board.getRange(row, col);

  var player = String(p.player || '');
  var ownerLine = p.teamLabel || p.team || '';
  if (p.traded) ownerLine = TRADE_PREFIX + ownerLine;

  var text = player + '\n' + ownerLine;
  var fg = SPORT_FG[p.sport] || NO_SPORT_FG;
  var bg = SPORT_BG[p.sport] || NO_SPORT_BG;

  // Player on top in the sport colour, ownership underneath in smaller grey.
  var playerStyle = SpreadsheetApp.newTextStyle()
    .setBold(true).setFontSize(10).setForegroundColor(fg).build();
  var ownerStyle = SpreadsheetApp.newTextStyle()
    .setBold(false).setItalic(!!p.traded).setFontSize(8)
    .setForegroundColor(OWNER_LINE_COLOR).build();

  var rich = SpreadsheetApp.newRichTextValue()
    .setText(text)
    .setTextStyle(0, player.length, playerStyle)
    .setTextStyle(player.length + 1, text.length, ownerStyle)
    .build();

  cell.setRichTextValue(rich);
  cell.setBackground(bg);
  cell.setWrap(true);
  cell.setVerticalAlignment('top');
  cell.setHorizontalAlignment('center');

  if (p.traded && TRADE_NOTE) {
    cell.setNote('TRADED PICK\n' +
                 'Seat belongs to ' + p.origTeam + ' (' + p.origOwner + ')\n' +
                 'Drafted by ' + p.team + ' (' + p.owner + ')\n' +
                 'Round ' + p.round + ' · overall #' + p.overall);
  } else {
    cell.setNote(null);
  }
}

/** Empties the board grid and the Draft Log. Called by the draft room's reset. */
function clearEverything(ss) {
  var board = ss.getSheetByName(BOARD_TAB);
  if (board) {
    var rng = board.getRange(BOARD_FIRST_ROW, BOARD_FIRST_COL, 32, TEAMS_ACROSS);
    rng.clearContent();
    rng.clearNote();
    rng.setFontColor(null);
    rng.setFontStyle('normal');
    rng.setFontWeight('normal');
    rng.setBackground(null);
  }
  var log = ss.getSheetByName(LOG_TAB);
  if (log) {
    var last = log.getLastRow();
    if (last > 1) log.deleteRows(2, last - 1);   // keep the header row
  }
}

/** Same thing, runnable by hand from this editor if you ever need it. */
function clearPicks() {
  clearEverything(SpreadsheetApp.getActiveSpreadsheet());
}

/* ---------------------------------------------------------------
   Each pick arrives with:
     p.player p.sport p.pos
     p.team p.owner            who actually made the pick
     p.origTeam p.origOwner    whose seat that column is
     p.traded                  true if the pick changed hands
     p.round  1-32
     p.slot   1-12  position in the round (pick order)
     p.seatIndex 1-12  fixed seat column, snake already applied
     p.overall 1-384
     p.direction  '--->' or '<---'
--------------------------------------------------------------- */

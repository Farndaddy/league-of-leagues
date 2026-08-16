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
 *  6. Click "Build board layout", then "Send test row"
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

    if (body.setup) {
      buildBoard(ss, body.setup);
      out.setup = true;
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

/** Adds a small colour key under the board. Called by buildBoard. */
function writeLegend(board, rounds) {
  var row = BOARD_FIRST_ROW + rounds + 1;
  board.getRange(row, ROUND_COL_LEFT).setValue('Key').setFontWeight('bold');
  var sports = ['NFL', 'NBA', 'MLB'];
  for (var i = 0; i < sports.length; i++) {
    var c = board.getRange(row, BOARD_FIRST_COL + i);
    c.setValue(sports[i])
     .setBackground(SPORT_BG[sports[i]])
     .setFontColor(SPORT_FG[sports[i]])
     .setHorizontalAlignment('center')
     .setFontWeight('bold');
  }
  board.getRange(row, BOARD_FIRST_COL + 3)
       .setValue('* italic = traded pick')
       .setFontStyle('italic')
       .setFontColor('#5F5E5A');
}

/** Lays out the board: headers, round numbers, snake arrows. Player cells untouched. */
function buildBoard(ss, cfg) {
  var board = ss.getSheetByName(BOARD_TAB) || ss.insertSheet(BOARD_TAB);
  var seats  = cfg.seats  || [];
  var owners = cfg.owners || [];
  var rounds = cfg.rounds || 32;

  board.getRange(HEADER_ROW, ROUND_COL_LEFT).setValue('Rd').setFontWeight('bold');
  board.getRange(HEADER_ROW, ROUND_COL_RIGHT).setValue('Rd').setFontWeight('bold');

  for (var c = 0; c < TEAMS_ACROSS; c++) {
    var label = LAYOUT === 'seats'
      ? (seats[c] || ('Seat ' + (c + 1))) + (owners[c] ? '\n' + owners[c] : '')
      : 'Pick ' + (c + 1);
    board.getRange(HEADER_ROW, BOARD_FIRST_COL + c)
         .setValue(label)
         .setFontWeight('bold')
         .setWrap(true)
         .setHorizontalAlignment('center')
         .setFontSize(9);
    board.setColumnWidth(BOARD_FIRST_COL + c, 110);
  }

  for (var r = 0; r < rounds; r++) {
    var row = BOARD_FIRST_ROW + r;
    var arrow = (r % 2 === 0) ? '--->' : '<---';
    board.getRange(row, ROUND_COL_LEFT).setValue(r + 1)
         .setFontWeight('bold').setHorizontalAlignment('center');
    board.getRange(row, ROUND_COL_RIGHT).setValue(r + 1)
         .setFontWeight('bold').setHorizontalAlignment('center');
    board.getRange(row, ARROW_COL_LEFT).setValue(arrow)
         .setHorizontalAlignment('center').setFontColor('#888780');
    board.getRange(row, ARROW_COL_RIGHT).setValue(arrow)
         .setHorizontalAlignment('center').setFontColor('#888780');
    board.setRowHeight(row, 32);
  }

  board.setColumnWidth(ROUND_COL_LEFT, 36);
  board.setColumnWidth(ARROW_COL_LEFT, 44);
  board.setColumnWidth(ARROW_COL_RIGHT, 44);
  board.setColumnWidth(ROUND_COL_RIGHT, 36);
  board.setRowHeight(HEADER_ROW, 40);
  board.setFrozenRows(HEADER_ROW);
  board.setFrozenColumns(ARROW_COL_LEFT);
  writeLegend(board, rounds);
}

/** Wipes every player cell but leaves the layout. Handy after a mock draft. */
function clearPicks() {
  var board = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOARD_TAB);
  if (!board) return;
  var rng = board.getRange(BOARD_FIRST_ROW, BOARD_FIRST_COL, 32, TEAMS_ACROSS);
  rng.clearContent();
  rng.clearNote();
  rng.setFontColor(null);
  rng.setFontStyle('normal');
  rng.setBackground(null);
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

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

var HEADER_ROW      = 1;   // team names live here
var BOARD_FIRST_ROW = 2;   // round 1 goes in this row
var ROUND_COL_LEFT  = 1;   // column A — round number
var ARROW_COL_LEFT  = 2;   // column B — direction arrow
var BOARD_FIRST_COL = 3;   // column C — first team column
var TEAMS_ACROSS    = 12;
var ARROW_COL_RIGHT = 15;  // column O
var ROUND_COL_RIGHT = 16;  // column P

// Traded picks
var TRADE_PREFIX = '* ';
var TRADE_NOTE   = true;
var TRADE_COLOR  = '#b45309';

var INCLUDE_TEAM_IN_CELL = true;   // second line shows who actually drafted
var TEAM_SEPARATOR = '\n';
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

  var text = p.player;
  if (p.traded) text = TRADE_PREFIX + text;
  if (INCLUDE_TEAM_IN_CELL) text += TEAM_SEPARATOR + p.team;

  var cell = board.getRange(row, col);
  cell.setValue(text);
  cell.setWrap(true);
  cell.setVerticalAlignment('top');
  cell.setHorizontalAlignment('center');
  cell.setFontSize(9);

  if (p.traded) {
    if (TRADE_NOTE) {
      cell.setNote('TRADED PICK\n' +
                   'Seat belongs to ' + p.origTeam + ' (' + p.origOwner + ')\n' +
                   'Drafted by ' + p.team + ' (' + p.owner + ')\n' +
                   'Round ' + p.round + ' · overall #' + p.overall);
    }
    cell.setFontColor(TRADE_COLOR);
    cell.setFontStyle('italic');
    cell.setBackground('#fdf6e7');
  } else {
    cell.setNote(null);
    cell.setFontColor(null);
    cell.setFontStyle('normal');
    cell.setBackground(null);
  }
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

    // faint banding so rows are easy to follow across 12 columns
    if (r % 2 === 1) {
      board.getRange(row, BOARD_FIRST_COL, 1, TEAMS_ACROSS).setBackground('#f8f8f6');
    }
  }

  board.setColumnWidth(ROUND_COL_LEFT, 36);
  board.setColumnWidth(ARROW_COL_LEFT, 44);
  board.setColumnWidth(ARROW_COL_RIGHT, 44);
  board.setColumnWidth(ROUND_COL_RIGHT, 36);
  board.setRowHeight(HEADER_ROW, 40);
  board.setFrozenRows(HEADER_ROW);
  board.setFrozenColumns(ARROW_COL_LEFT);
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

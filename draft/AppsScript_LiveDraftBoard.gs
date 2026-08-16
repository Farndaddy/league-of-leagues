/**
 * League of Leagues — Live Draft Board backup
 * =============================================
 * Receives every pick from the draft room and writes it into the Master Sheet.
 *
 * SETUP (one time):
 *  1. Open the Master Spreadsheet
 *  2. Extensions -> Apps Script
 *  3. Delete whatever is there, paste this whole file in
 *  4. Click Deploy -> New deployment -> gear icon -> Web app
 *       Execute as:        Me
 *       Who has access:    Anyone
 *  5. Deploy, authorize when asked, then COPY THE WEB APP URL
 *  6. Paste that URL into the draft room: Admin tab -> Google Sheet backup
 *
 * Every pick lands in two places:
 *   - "Draft Log"         a running list, newest at the bottom (always works)
 *   - "Live Draft Board"  the grid, one pick per cell (configure below)
 */

// ============ CONFIG — adjust these to match your sheet ============

var LOG_TAB   = 'Draft Log';
var BOARD_TAB = 'Live Draft Board';

// Where the grid starts. Round 1 / Pick 1 goes in this cell.
var BOARD_FIRST_ROW = 2;   // row 2
var BOARD_FIRST_COL = 2;   // column B

// Grid shape: 12 pick columns across, 32 round rows down.
var PICKS_PER_ROUND = 12;

// How a traded pick is marked. Set by you — see notes at the bottom.
var TRADE_PREFIX = '* ';           // e.g. "* Josh Allen"
var TRADE_NOTE   = true;           // also add a cell note saying who it came from

// Write the drafting team's name under the player name?
var INCLUDE_TEAM_IN_CELL = true;
var TEAM_SEPARATOR = '\n';         // player name, newline, team name

// ===================================================================

function doPost(e) {
  var out = { ok: true, written: 0, errors: [] };
  try {
    var body = JSON.parse(e.postData.contents);
    var picks = body.picks || [];
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var log = ss.getSheetByName(LOG_TAB);
    if (!log) {
      log = ss.insertSheet(LOG_TAB);
      log.appendRow(['Timestamp','Overall','Round','Slot','Player','Sport','Pos',
                     'Drafted by','Owner','Traded?','Original team','Auto-pick?']);
      log.setFrozenRows(1);
    }

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

        if (board && p.overall > 0) {
          writeToBoard(board, p);
        }
        out.written++;
      } catch (err) {
        out.errors.push('pick ' + p.overall + ': ' + err);
      }
    }
  } catch (err) {
    out.ok = false;
    out.errors.push(String(err));
  }
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function writeToBoard(board, p) {
  var row = BOARD_FIRST_ROW + (p.round - 1);
  var col = BOARD_FIRST_COL + (p.slot - 1);

  var text = p.player;
  if (p.traded) text = TRADE_PREFIX + text;
  if (INCLUDE_TEAM_IN_CELL) text += TEAM_SEPARATOR + p.team;

  var cell = board.getRange(row, col);
  cell.setValue(text);
  cell.setWrap(true);
  cell.setVerticalAlignment('top');

  if (p.traded) {
    if (TRADE_NOTE) {
      cell.setNote('TRADED PICK\nOriginally ' + p.origTeam + ' (' + p.origOwner + ')' +
                   '\nDrafted by ' + p.team + ' (' + p.owner + ')' +
                   '\nOverall #' + p.overall);
    }
    cell.setFontColor('#b45309');   // amber so traded picks stand out
    cell.setFontStyle('italic');
  } else {
    cell.setFontColor(null);
    cell.setFontStyle('normal');
  }
}

/** Optional: run once from the editor to lay out an empty board grid. */
function setupBoardGrid() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var board = ss.getSheetByName(BOARD_TAB) || ss.insertSheet(BOARD_TAB);
  board.getRange(BOARD_FIRST_ROW - 1, BOARD_FIRST_COL - 1).setValue('Round');
  for (var c = 0; c < PICKS_PER_ROUND; c++) {
    board.getRange(BOARD_FIRST_ROW - 1, BOARD_FIRST_COL + c)
         .setValue('Pick ' + (c + 1)).setFontWeight('bold');
  }
  for (var r = 0; r < 32; r++) {
    board.getRange(BOARD_FIRST_ROW + r, BOARD_FIRST_COL - 1)
         .setValue(r + 1).setFontWeight('bold');
  }
  board.setFrozenRows(BOARD_FIRST_ROW - 1);
  board.setFrozenColumns(BOARD_FIRST_COL - 1);
}

/* ---------------------------------------------------------------
   NOTES ON TRADED PICKS

   Each pick arrives with these fields, so you can mark trades however
   you like by editing writeToBoard() above:

     p.traded      true if this pick changed hands
     p.team        the team that actually made the pick
     p.owner       that team's owner name
     p.origTeam    the team the pick originally belonged to
     p.origOwner   that team's owner name
     p.overall     overall pick number, 1-384
     p.round       1-32
     p.slot        1-12, position within the round

   Right now a traded pick gets: "* Player Name", amber italic text, and a
   hover note naming the original team. Tell me the convention you want and
   I will change this one function — no change to the website needed.
--------------------------------------------------------------- */

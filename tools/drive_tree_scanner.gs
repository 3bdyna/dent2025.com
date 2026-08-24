/**
 * DENT2025 - Google Drive Folder Tree Scanner (RESUMABLE)
 * -------------------------------------------------------
 * Scans a folder + everything inside it, writing the full content tree into:
 *   1. A NEW Google Sheet in your Drive  (for reviewing)
 *   2. A JSON file in your Drive         (for importing later)
 *
 * It NEVER times out: it scans for ~4.5 min, saves progress to a checkpoint
 * file, schedules itself to resume in 1 minute, and repeats until done.
 * You don't need to do anything between runs.
 *
 * SETUP (one time):
 *   1. script.google.com -> New project -> delete default myFunction -> paste this.
 *   2. Enable the Drive API advanced service:
 *        In the editor sidebar, click the "+" puzzle-piece icon (Services)
 *        -> click "+" again -> pick "Drive API" -> Enable.
 *   3. Set ROOT_FOLDER_ID below to the folder you want to scan.
 *   4. Run -> runScanner (accept permissions).
 *   5. Open View -> Logs. It will show progress. When finished it prints
 *      SHEET URL and JSON URL (may take several resume cycles for a huge folder).
 *   6. To restart from scratch later, first run  resetScanner()  then runScanner().
 */

var ROOT_FOLDER_ID = '1DfsBPuIuLaO7ewsoeqht_Flr0n9gBsK3'; // <-- folder to scan
var INCLUDE_FILE_IDS = true;      // add file ID + open URL column
var MAX_RUNTIME_MS = 270000;      // ~4.5 min per run, then pause & resume
var CHECKPOINT_EVERY = 100;       // save progress every N folders
var CHECKPOINT_PREFIX = 'DENT2025_tree_checkpoint';

/* ---------- State helpers (checkpoint file in Drive) ---------- */

function getCheckpointFile() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('dts_cp_id');
  if (id) {
    try { return DriveApp.getFileById(id); } catch (e) {}
  }
  var name = CHECKPOINT_PREFIX + '_' + ROOT_FOLDER_ID;
  var files = DriveApp.getFilesByName(name);
  var f = files.hasNext() ? files.next() : DriveApp.createFile(name, '{}', 'application/json');
  props.setProperty('dts_cp_id', f.getId());
  return f;
}

function loadState() {
  var txt = getCheckpointFile().getBlob().getDataAsString();
  try { var s = JSON.parse(txt); return (s && s.queue) ? s : null; } catch (e) { return null; }
}

function saveState(s) { getCheckpointFile().setContent(JSON.stringify(s)); }

function clearState() {
  PropertiesService.getScriptProperties().deleteProperty('dts_cp_id');
  try { getCheckpointFile().setTrashed(true); } catch (e) {}
}

function initState() {
  return {
    rootName: '',
    queue: [{ id: ROOT_FOLDER_ID, path: '', level: 0 }],
    rows: [],
    counters: { folders: 0, files: 0, totalBytes: 0, deepest: 0 },
    processed: 0
  };
}

/* ---------- Drive API ---------- */

function listChildren(folderId, pageToken) {
  var params = {
    q: "'" + folderId + "' in parents and trashed = false",
    pageSize: 1000,
    fields: 'files(id, name, mimeType, size, createdTime), nextPageToken'
  };
  if (pageToken) params.pageToken = pageToken;
  var res = Drive.Files.list(params);
  return { files: res.files || [], next: res.nextPageToken };
}

function rootNameOf(folderId) {
  try { return Drive.Files.get(folderId, { fields: 'name' }).name; } catch (e) { return ''; }
}

/* ---------- Resume trigger helpers ---------- */

function deleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScanner') ScriptApp.deleteTrigger(t);
  });
}
function scheduleResume() {
  deleteTriggers();
  ScriptApp.newTrigger('runScanner').timeBased().after(60000).create();
}

/* ---------- Main ---------- */

function runScanner() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var state = loadState();
    if (!state) { state = initState(); }
    if (state.rootName === '') state.rootName = rootNameOf(ROOT_FOLDER_ID);

    var start = Date.now();

    while (state.queue.length > 0 && Date.now() - start < MAX_RUNTIME_MS) {
      var item = state.queue.shift();
      var fId = item.id, path = item.path, level = item.level;
      var pageToken = '';
      do {
        var res = listChildren(fId, pageToken);
        res.files.forEach(function (f) {
          var fpath = path === '' ? f.name : path + ' / ' + f.name;
          if (f.mimeType === 'application/vnd.google-apps.folder') {
            state.queue.push({ id: f.id, path: fpath, level: level + 1 });
            state.counters.folders++;
            if (level + 1 > state.counters.deepest) state.counters.deepest = level + 1;
            state.rows.push(rowFor(fpath, level, f.name, 'FOLDER', '', '', f.id));
          } else {
            var size = parseInt(f.size || '0', 10);
            state.counters.files++;
            state.counters.totalBytes += size;
            state.rows.push(rowFor(fpath, level, f.name, 'FILE', size, f.createdTime || '', f.id));
          }
        });
        pageToken = res.next;
      } while (pageToken);
      state.processed++;

      if (state.processed % CHECKPOINT_EVERY === 0) saveState(state);
    }

    if (state.queue.length > 0) {
      saveState(state);
      scheduleResume();
      Logger.log('Paused: scanned ' + state.processed + ' folders so far, ' +
                 state.queue.length + ' folders still queued. Auto-resuming in 1 min...');
    } else {
      finalize(state);
    }
    lock.releaseLock();
  } catch (e) {
    lock.releaseLock();
    saveState(state || initState());
    throw e;
  }
}

/* ---------- Output ---------- */

function rowFor(path, level, name, type, size, created, fileId) {
  return [
    path, level, name, type,
    size === '' ? '' : size,
    size === '' ? '' : humanSize(size),
    created ? new Date(created).toISOString().slice(0, 10) : '',
    fileId,
    INCLUDE_FILE_IDS ? 'https://drive.google.com/open?id=' + fileId : ''
  ];
}

function finalize(state) {
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  var label = (state.rootName || 'root').slice(0, 40);

  var sheet = SpreadsheetApp.create('DENT2025_DriveTree_' + label + '_' + ts);
  var sh = sheet.getSheets()[0];
  sh.setName('Tree');

  var data = [['#', 'Path', 'Level', 'Name', 'Type', 'Size (bytes)', 'Size (human)', 'Modified', 'File ID', 'URL']];
  for (var i = 0; i < state.rows.length; i++) { data.push([i + 1].concat(state.rows[i])); }
  sh.getRange(1, 1, data.length, data[0].length).setValues(data);
  sh.getRange(1, 1, 1, data[0].length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 7);

  var jsonFile = DriveApp.createFile(
    'DENT2025_DriveTree_' + label + '_' + ts + '.json',
    JSON.stringify({ rootName: state.rootName, rootId: ROOT_FOLDER_ID, counters: state.counters, items: state.rows }),
    'application/json'
  );

  deleteTriggers();
  clearState();

  Logger.log('=== SCAN COMPLETE ===');
  Logger.log('Root name : ' + state.rootName);
  Logger.log('Folders   : ' + state.counters.folders);
  Logger.log('Files     : ' + state.counters.files);
  Logger.log('Total data: ' + humanSize(state.counters.totalBytes));
  Logger.log('Deepest   : ' + state.counters.deepest);
  Logger.log('SHEET URL : ' + sheet.getUrl());
  Logger.log('JSON URL  : ' + jsonFile.getUrl());
}

function humanSize(num) {
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  while (num >= 1024 && i < units.length - 1) { num /= 1024; i++; }
  return num.toFixed(1) + ' ' + units[i];
}

/** Run this only if you want to throw away progress and start the scan over. */
function resetScanner() {
  deleteTriggers();
  clearState();
  Logger.log('Checkpoint cleared. Now run runScanner() to start fresh.');
}
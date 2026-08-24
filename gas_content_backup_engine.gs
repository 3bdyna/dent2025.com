/**
 * Dent2025 Content Backup & Rolling Retention Engine
 * 
 * SOURCE FOLDER ID: 12Hwq6vDCKR25otEtq_JVAo-txIVT6oVI
 * TARGET FOLDER: "dent2025 content back ups" (auto-created if missing)
 * 
 * RETENTION POLICY:
 * - 14 Continuous Daily Backups (Days 1 to 14)
 * - 2 Weekly Milestone Backups (Week 3: Days 15-21, Week 4: Days 22-28)
 * - Auto-prunes backups older than 28 days to Google Drive Trash.
 */

// ======================= CONFIGURATION =======================
const SOURCE_FOLDER_ID = '12Hwq6vDCKR25otEtq_JVAo-txIVT6oVI'; // Root Academic Materials Folder
const BACKUP_CONTAINER_NAME = 'dent2025 content back ups';
const TIMEZONE = Session.getScriptTimeZone() || "Asia/Riyadh";
const SECRET_KEY = 'YOUR_SECRET_KEY'; // Key for web-triggered manual backups
// =============================================================

/**
 * ⏰ Trigger 1: Scheduled Daily Backup (Run via Google Time-Driven Trigger at 2:00 AM)
 */
function triggerDailyScheduledBackup() {
  Logger.log("=== Starting Scheduled Daily Backup ===");
  const snapshotFolder = createAcademicSnapshot("Daily");
  applySmartRetentionPolicy();
  Logger.log("=== Daily Backup & Retention Finished ===");
}

/**
 * ⚡ Trigger 2: Manual Backup (Run directly from the Apps Script editor)
 */
function triggerManualBackup() {
  Logger.log("=== Starting Manual On-Demand Backup ===");
  const snapshotFolder = createAcademicSnapshot("Manual");
  applySmartRetentionPolicy();
  Logger.log("=== Manual Snapshot Completed: " + snapshotFolder.getName() + " ===");
  return snapshotFolder;
}

/**
 * 🌐 Trigger 3: One-Click Web Trigger (Open link in browser to trigger backup)
 */
function doGet(e) {
  const authKey = e.parameter.key;
  if (authKey !== SECRET_KEY) {
    return ContentService.createTextOutput("⛔ Unauthorized: Invalid security key.")
      .setMimeType(ContentService.MimeType.TEXT);
  }
  
  const snapshotFolder = triggerManualBackup();
  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    message: "Manual snapshot successfully created and 4-week retention applied.",
    snapshot_name: snapshotFolder.getName(),
    snapshot_url: snapshotFolder.getUrl()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Gets or Automatically Creates the "dent2025 content back ups" Root Folder
 */
function getOrCreateBackupRoot() {
  const folders = DriveApp.getFoldersByName(BACKUP_CONTAINER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  Logger.log("Creating new root backup container: " + BACKUP_CONTAINER_NAME);
  return DriveApp.createFolder(BACKUP_CONTAINER_NAME);
}

/**
 * Resolves the Source Academic Folder
 */
function getSourceFolder() {
  try {
    return DriveApp.getFolderById(SOURCE_FOLDER_ID);
  } catch (e) {
    throw new Error("Could not find source academic folder with ID '" + SOURCE_FOLDER_ID + "': " + e.message);
  }
}

/**
 * Creates the timestamped snapshot folder and recursively copies all content
 */
function createAcademicSnapshot(typeTag) {
  const sourceFolder = getSourceFolder();
  const backupRoot = getOrCreateBackupRoot();
  
  const dateFormatted = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd_hh-mm-a");
  const folderName = `Snapshot_${dateFormatted}_[${typeTag}]_[PreMed_Med_Dent]`;
  
  Logger.log("Creating Snapshot: " + folderName);
  const snapshotFolder = backupRoot.createFolder(folderName);
  
  // Recursively copy all subfolders (Pre-Med, Dentistry, Medicine, etc.)
  copyFolderRecursive(sourceFolder, snapshotFolder);
  
  return snapshotFolder;
}

/**
 * Recursive Copier for folders and files
 */
function copyFolderRecursive(source, target) {
  const files = source.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    file.makeCopy(file.getName(), target);
  }
  
  const subfolders = source.getFolders();
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    // Skip backup container if it's nested inside source by accident
    if (subfolder.getName() === BACKUP_CONTAINER_NAME) continue;
    
    const newTargetSubfolder = target.createFolder(subfolder.getName());
    copyFolderRecursive(subfolder, newTargetSubfolder);
  }
}

/**
 * Smart Retention Engine:
 * - Days 1 to 14: Keep ALL daily/manual backups.
 * - Days 15 to 21 (Week 3): Keep the 1 newest weekly milestone, prune the rest.
 * - Days 22 to 28 (Week 4): Keep the 1 newest weekly milestone, prune the rest.
 * - Days > 28: Prune to Drive Trash.
 */
function applySmartRetentionPolicy() {
  const backupRoot = getOrCreateBackupRoot();
  const folders = backupRoot.getFolders();
  const nowMs = new Date().getTime();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  
  const snapshotList = [];
  
  while (folders.hasNext()) {
    const f = folders.next();
    const name = f.getName();
    if (name.startsWith("Snapshot_")) {
      const createdMs = f.getDateCreated().getTime();
      const ageDays = (nowMs - createdMs) / ONE_DAY_MS;
      snapshotList.push({
        folder: f,
        name: name,
        createdMs: createdMs,
        ageDays: ageDays
      });
    }
  }
  
  // Sort from newest to oldest
  snapshotList.sort((a, b) => b.createdMs - a.createdMs);
  
  let week3Kept = false;
  let week4Kept = false;
  
  for (let item of snapshotList) {
    const age = item.ageDays;
    
    if (age <= 14) {
      // Keep everything in the first 14 days
      continue;
    } else if (age > 14 && age <= 21) {
      // Week 3 Slot: Keep 1 milestone, delete extra daily snapshots
      if (!week3Kept) {
        week3Kept = true;
        if (!item.name.includes("[Weekly-W3]")) {
          item.folder.setName(item.name.replace(/\[(Daily|Manual)\]/, "[Weekly-W3]"));
        }
      } else {
        Logger.log("Pruning extra snapshot from Week 3: " + item.name);
        item.folder.setTrashed(true);
      }
    } else if (age > 21 && age <= 28) {
      // Week 4 Slot: Keep 1 milestone, delete extra daily snapshots
      if (!week4Kept) {
        week4Kept = true;
        if (!item.name.includes("[Weekly-W4]")) {
          item.folder.setName(item.name.replace(/\[(Daily|Manual|Weekly-W3)\]/, "[Weekly-W4]"));
        }
      } else {
        Logger.log("Pruning extra snapshot from Week 4: " + item.name);
        item.folder.setTrashed(true);
      }
    } else {
      // Older than 28 days -> move to trash
      Logger.log("Pruning expired snapshot (> 28 days): " + item.name);
      item.folder.setTrashed(true);
    }
  }
}

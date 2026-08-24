/**
 * Google Apps Script - SafeDeploy Backup Webhook
 * 
 * INSTRUCTIONS:
 * 1. Go to script.google.com and create a NEW, separate project.
 * 2. Paste this code.
 * 3. Click "Deploy" -> "New Deployment". Select "Web App".
 * 4. Execute as: "Me". Who has access: "Anyone".
 * 5. Copy the resulting Web App URL and paste it in `deploy_snapshot.py` as the `GAS_WEBHOOK_URL`.
 */

const TARGET_FOLDER_ID = '1KGKB6-FF9VNkqVr9FoJv1BfcKYX0baSp'; // Your 'website backup snapshots' folder

function doPost(e) {
  try {
    var data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = e.parameter;
      }
    } else {
      data = e.parameter;
    }

    var action = data.action || '';

    if (action === 'upload_file') {
      var folderId = data.folderId || TARGET_FOLDER_ID;
      var filename = data.filename;
      var base64Content = data.fileContent;
      var mimeType = data.mimeType || 'application/octet-stream';

      if (!filename || !base64Content) {
        return responseJSON({ success: false, message: "Missing required parameters: filename or fileContent" });
      }

      var folder = null;
      if (folderId) {
        try {
          folder = DriveApp.getFolderById(folderId);
        } catch (fErr) {
          folder = null;
        }
      }
      if (!folder && typeof TARGET_FOLDER_ID !== 'undefined' && TARGET_FOLDER_ID) {
        try {
          folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
        } catch (fErr) {
          folder = null;
        }
      }
      if (!folder) {
        folder = DriveApp.getRootFolder();
      }

      var decodedBytes = Utilities.base64Decode(base64Content);
      var blob = Utilities.newBlob(decodedBytes, mimeType, filename);
      var newFile = folder.createFile(blob);

      return responseJSON({
        success: true,
        fileId: newFile.getId(),
        fileUrl: newFile.getUrl(),
        downloadUrl: newFile.getDownloadUrl ? newFile.getDownloadUrl() : newFile.getUrl(),
        message: "File uploaded successfully to Google Drive."
      });
    }

    if (action === 'delete_file') {
      var fileId = data.fileId;
      if (!fileId) {
        return responseJSON({ success: false, message: "Missing required parameter: fileId" });
      }
      try {
        var file = DriveApp.getFileById(fileId);
        if (file) {
          file.setTrashed(true);
          return responseJSON({ success: true, message: "Snapshot file moved to trash in Google Drive." });
        }
      } catch (err) {
        return responseJSON({ success: false, message: "Could not find/delete file: " + String(err) });
      }
    }

    if (action === 'list_files') {
      var folderId = data.folderId || TARGET_FOLDER_ID;
      try {
        var folder = DriveApp.getFolderById(folderId);
        var files = folder.getFiles();
        var result = [];
        while (files.hasNext()) {
          var f = files.next();
          result.push({ id: f.getId(), name: f.getName(), url: f.getUrl() });
        }
        return responseJSON({ success: true, files: result, count: result.length });
      } catch (err) {
        return responseJSON({ success: false, message: "Could not list folder: " + String(err) });
      }
    }

    return responseJSON({ success: false, message: "Unknown action. Only 'upload_file', 'delete_file' and 'list_files' are supported." });

  } catch (error) {
    return responseJSON({ success: false, message: "Error: " + error.toString() });
  }
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

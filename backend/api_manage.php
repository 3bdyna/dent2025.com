<?php
// api_manage.php
require_once 'db_connect.php';
require_once __DIR__ . '/../dent2025_rbac.php';
if (file_exists(__DIR__ . '/../history_helpers.php')) {
    require_once __DIR__ . '/../history_helpers.php';
}

// Dynamic table prefix resolution
$table_subs = 'subjects';
$table_links = 'subject_links';
if (isset($pdo) && $pdo) {
    try {
        $check = $pdo->query("SELECT 1 FROM wpr9_subjects LIMIT 1");
        if ($check !== false) {
            $table_subs = 'wpr9_subjects';
            $table_links = 'wpr9_subject_links';
        }
    } catch(Throwable $e) {}
}

function dent2025_pdo_clear_cache($pdo) {
    if (!$pdo) return;
    try {
        $optTable = 'wp_options';
        try {
            $c = $pdo->query("SELECT 1 FROM wpr9_options LIMIT 1");
            if ($c !== false) $optTable = 'wpr9_options';
        } catch (Throwable $t) {}
        $pdo->exec("DELETE FROM {$optTable} WHERE option_name LIKE '_transient_dent2025_data_%'");
        $pdo->exec("DELETE FROM {$optTable} WHERE option_name LIKE '_transient_timeout_dent2025_data_%'");
    } catch(Throwable $e) {}
}

// The Apps Script Webhook URL you provided
$WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbz908qgvF7CSBgoCzA-YAEofJ6kq5RsmZgZoi21bYtqdF_H4pt8cQbfXpYDi2SEYepOCQ/exec";

$action = $_GET['action'] ?? '';
$data = json_decode(file_get_contents("php://input"), true) ?: [];

// 1. Check Auth Action (used by frontend to show/hide edit buttons)
if ($action === 'check_auth' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pass = $data['password'] ?? '';
    $entry = dent2025_get_passkey_info($pass);
    if ($entry) {
        unset($entry['passkey']);
        sendResponse(true, $entry);
    } else {
        sendResponse(false, "Invalid password for this section.");
    }
}

// 2. Manage Passwords Action
if ($action === 'manage_passwords' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pass = $data['password'] ?? '';
    if (!dent2025_check_rbac_permission($pass, 'manage_passwords')) {
        sendResponse(false, "Unauthorized: manage_passwords permission required.");
    }
    $sub_action = $data['sub_action'] ?? ($data['type'] ?? 'list');
    if ($sub_action === 'add') {
        $entry = $data['entry'] ?? $data;
        $res = dent2025_add_password($entry);
        if ($res) {
            sendResponse(true, dent2025_load_passwords());
        } else {
            sendResponse(false, "Failed to add password.");
        }
    }
    if ($sub_action === 'edit' || $sub_action === 'update') {
        $id = $data['id'] ?? ($data['entry']['id'] ?? '');
        $updates = $data['updates'] ?? ($data['entry'] ?? []);
        $res = dent2025_update_password($id, $updates);
        if ($res) {
            sendResponse(true, dent2025_load_passwords());
        } else {
            sendResponse(false, "Failed to update password.");
        }
    }
    if ($sub_action === 'delete') {
        $id = $data['id'] ?? ($data['entry']['id'] ?? '');
        $res = dent2025_delete_password($id);
        if ($res) {
            sendResponse(true, dent2025_load_passwords());
        } else {
            sendResponse(false, "Failed to delete password.");
        }
    }
    sendResponse(true, dent2025_load_passwords());
}

// 3. Add Subject
if ($action === 'add' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pass = $data['password'] ?? '';
    $spec = $data['specialty'] ?? '';
    $year = $data['year'] ?? 0;
    $sem = $data['semester'] ?? 0;
    
    if (!dent2025_check_rbac_permission($pass, 'add_subject', $spec, $year, $sem)) {
        sendResponse(false, "Unauthorized.");
    }
    
    // Call Google Apps Script to create folders
    $ch = curl_init($WEBHOOK_URL);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true); // Important for Google scripts
    curl_setopt($ch, CURLOPT_POSTFIELDS, [
        'specialty' => $spec, 'year' => $year, 'semester' => $sem, 'subjectName' => $data['name'] ?? ''
    ]);
    $response = curl_exec($ch);
    $resData = json_decode($response, true);
    curl_close($ch);
    
    $chapters_id = $resData['chaptersFolderId'] ?? '';
    $materials_id = $resData['materialsFolderId'] ?? '';
    
    $stmt = $pdo->prepare("INSERT INTO {$table_subs} (specialty, year, semester, name, doctor, hours, marks, chapters_folder_id, materials_folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$spec, $year, $sem, $data['name'] ?? '', $data['doctor'] ?? '', $data['hours'] ?? '', $data['marks'] ?? '', $chapters_id, $materials_id]);
    
    dent2025_pdo_clear_cache($pdo);

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($pass) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'add', 'إضافة مادة جديدة (PDO): ' . ($data['name'] ?? ''), $pass_info['label'] ?? '');
    }

    sendResponse(true, "Subject added successfully! Drive folders created.");
}

// 4. Edit Subject
if ($action === 'edit' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pass = $data['password'] ?? '';
    $id = $data['id'] ?? '';
    
    $stmt = $pdo->prepare("SELECT * FROM {$table_subs} WHERE id = ?");
    $stmt->execute([$id]);
    $subject = $stmt->fetch();
    if (!$subject) sendResponse(false, "Subject not found.");
    
    $spec = $subject['specialty'];
    $year = $subject['year'];
    $sem = $subject['semester'];

    $has_core = dent2025_check_rbac_permission($pass, 'edit_core_subject', $spec, $year, $sem);
    $has_basic = dent2025_check_rbac_permission($pass, 'edit_basic_subject', $spec, $year, $sem);

    if (!$has_core && !$has_basic) {
        sendResponse(false, "Unauthorized.");
    }

    $name_changed = isset($data['name']) && trim($data['name']) !== '' && trim($data['name']) !== $subject['name'];
    $chap_changed = isset($data['chapters_folder_id']) && $data['chapters_folder_id'] !== $subject['chapters_folder_id'];
    $mat_changed = isset($data['materials_folder_id']) && $data['materials_folder_id'] !== $subject['materials_folder_id'];

    if (($name_changed || $chap_changed || $mat_changed) && !$has_core) {
        sendResponse(false, "Unauthorized to edit core subject name or drive folder IDs.");
    }

    $name = ($has_core && isset($data['name']) && trim($data['name']) !== '') ? $data['name'] : $subject['name'];
    $doctor = isset($data['doctor']) ? $data['doctor'] : $subject['doctor'];
    $hours = isset($data['hours']) ? $data['hours'] : $subject['hours'];
    $marks = isset($data['marks']) ? $data['marks'] : $subject['marks'];
    $clean_drive_fn = function($str) {
        if (empty($str)) return '';
        $str = trim($str);
        if (preg_match('/folders\/([a-zA-Z0-9_-]+)/', $str, $m)) return $m[1];
        if (preg_match('/id=([a-zA-Z0-9_-]+)/', $str, $m)) return $m[1];
        if (preg_match('/\/d\/([a-zA-Z0-9_-]+)/', $str, $m)) return $m[1];
        return preg_replace('/[^a-zA-Z0-9_-]/', '', $str);
    };

    $chap_id = ($has_core && isset($data['chapters_folder_id'])) ? $clean_drive_fn($data['chapters_folder_id']) : $subject['chapters_folder_id'];
    $mat_id = ($has_core && isset($data['materials_folder_id'])) ? $clean_drive_fn($data['materials_folder_id']) : $subject['materials_folder_id'];

    $stmt = $pdo->prepare("UPDATE {$table_subs} SET name=?, doctor=?, hours=?, marks=?, chapters_folder_id=?, materials_folder_id=? WHERE id=?");
    $stmt->execute([$name, $doctor, $hours, $marks, $chap_id, $mat_id, $id]);
    
    dent2025_pdo_clear_cache($pdo);

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($pass) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'edit', 'تعديل مادة (PDO): ' . $name, $pass_info['label'] ?? '');
    }

    sendResponse(true, "Subject updated successfully.");
}

// 5. Delete Subject
if ($action === 'delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pass = $data['password'] ?? '';
    $id = $data['id'] ?? '';
    
    $stmt = $pdo->prepare("SELECT specialty, year, semester FROM {$table_subs} WHERE id = ?");
    $stmt->execute([$id]);
    $subject = $stmt->fetch();
    if (!$subject) sendResponse(false, "Subject not found.");
    
    if (!dent2025_check_rbac_permission($pass, 'delete_subject', $subject['specialty'], $subject['year'], $subject['semester'])) {
        sendResponse(false, "Unauthorized.");
    }
    
    $stmt = $pdo->prepare("DELETE FROM {$table_subs} WHERE id=?");
    $stmt->execute([$id]);
    
    dent2025_pdo_clear_cache($pdo);

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($pass) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'delete', 'حذف مادة (PDO) ID: ' . $id, $pass_info['label'] ?? '');
    }

    sendResponse(true, "Subject deleted successfully. (Drive folders remain intact).");
}

// 6. Add Link
if ($action === 'add_link' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pass = $data['password'] ?? '';
    $subject_id = $data['subject_id'] ?? '';
    $url = $data['url'] ?? '';
    $title = $data['title'] ?? '';
    
    $stmt = $pdo->prepare("SELECT specialty, year, semester FROM {$table_subs} WHERE id = ?");
    $stmt->execute([$subject_id]);
    $subject = $stmt->fetch();
    if (!$subject) sendResponse(false, "Subject not found.");
    
    if (!dent2025_check_rbac_permission($pass, 'edit_basic_subject', $subject['specialty'], $subject['year'], $subject['semester']) &&
        !dent2025_check_rbac_permission($pass, 'edit_core_subject', $subject['specialty'], $subject['year'], $subject['semester'])) {
        sendResponse(false, "Unauthorized.");
    }
    
    $type = 'link';
    if (strpos(strtolower($url), 'youtube.com') !== false || strpos(strtolower($url), 'youtu.be') !== false) {
        $type = 'youtube';
    } else if (strpos(strtolower($url), 'drive.google.com') !== false) {
        $type = 'drive';
    } else if (strpos(strtolower($url), 't.me') !== false || strpos(strtolower($url), 'telegram') !== false) {
        $type = 'telegram';
    }
    
    $stmt = $pdo->prepare("INSERT INTO {$table_links} (subject_id, url, title, type) VALUES (?, ?, ?, ?)");
    $stmt->execute([$subject_id, $url, $title, $type]);
    
    dent2025_pdo_clear_cache($pdo);

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($pass) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'add', 'إضافة رابط (PDO): ' . $title, $pass_info['label'] ?? '');
    }

    sendResponse(true, "Link added successfully.");
}

// 7. Delete Link
if ($action === 'delete_link' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pass = $data['password'] ?? '';
    $link_id = $data['link_id'] ?? '';
    
    $stmt = $pdo->prepare("SELECT subject_id FROM {$table_links} WHERE id = ?");
    $stmt->execute([$link_id]);
    $link = $stmt->fetch();
    if (!$link) sendResponse(false, "Link not found.");
    
    $stmt = $pdo->prepare("SELECT specialty, year, semester FROM {$table_subs} WHERE id = ?");
    $stmt->execute([$link['subject_id']]);
    $subject = $stmt->fetch();
    
    if (!$subject || (!dent2025_check_rbac_permission($pass, 'edit_basic_subject', $subject['specialty'], $subject['year'], $subject['semester']) &&
        !dent2025_check_rbac_permission($pass, 'edit_core_subject', $subject['specialty'], $subject['year'], $subject['semester']))) {
        sendResponse(false, "Unauthorized.");
    }
    
    $stmt = $pdo->prepare("DELETE FROM {$table_links} WHERE id = ?");
    $stmt->execute([$link_id]);
    
    dent2025_pdo_clear_cache($pdo);

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($pass) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'delete', 'حذف رابط (PDO) ID: ' . $link_id, $pass_info['label'] ?? '');
    }

    sendResponse(true, "Link deleted successfully.");
}

// 8. Edit Link
if ($action === 'edit_link' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $pass = $data['password'] ?? '';
    $link_id = $data['link_id'] ?? '';
    $title = $data['title'] ?? '';
    
    if (empty($title)) {
        sendResponse(false, "Title cannot be empty.");
    }
    
    $stmt = $pdo->prepare("SELECT subject_id FROM {$table_links} WHERE id = ?");
    $stmt->execute([$link_id]);
    $link = $stmt->fetch();
    if (!$link) sendResponse(false, "Link not found.");
    
    $stmt = $pdo->prepare("SELECT specialty, year, semester FROM {$table_subs} WHERE id = ?");
    $stmt->execute([$link['subject_id']]);
    $subject = $stmt->fetch();
    
    if (!$subject || (!dent2025_check_rbac_permission($pass, 'edit_basic_subject', $subject['specialty'], $subject['year'], $subject['semester']) &&
        !dent2025_check_rbac_permission($pass, 'edit_core_subject', $subject['specialty'], $subject['year'], $subject['semester']))) {
        sendResponse(false, "Unauthorized.");
    }
    
    $stmt = $pdo->prepare("UPDATE {$table_links} SET title = ? WHERE id = ?");
    $stmt->execute([$title, $link_id]);
    
    dent2025_pdo_clear_cache($pdo);

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($pass) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'edit', 'تعديل عنوان رابط (PDO) ID: ' . $link_id, $pass_info['label'] ?? '');
    }

    sendResponse(true, "Link updated successfully.");
}

sendResponse(false, "Invalid action");
?>

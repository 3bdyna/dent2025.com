<?php
// announcements_api.php
// Backend for class-specific Announcements/Tasks on the main dashboard
require_once __DIR__ . '/dent2025_rbac.php';
require_once __DIR__ . '/history_helpers.php';

header('Content-Type: application/json');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ['https://dent2025.com', 'https://www.dent2025.com'], true) || (strpos($origin, 'localhost') !== false)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header('Access-Control-Allow-Origin: https://dent2025.com');
}

header('Access-Control-Allow-Methods: GET, POST, DELETE');
header('Access-Control-Allow-Headers: Content-Type');

$dataDir = __DIR__ . '/announcements_data';
if (!file_exists($dataDir)) {
    mkdir($dataDir, 0777, true);
}

// Whitelist specialty so it can never be used for path traversal in filenames
function dent_announcement_specialty($s) {
    $s = (string)$s;
    $valid = ['dentistry', 'medicine', 'pre-med', 'global'];
    return in_array($s, $valid, true) ? $s : '';
}

$method = $_SERVER['REQUEST_METHOD'];

// 1. GET: Send all announcements for a specific class (or all if requested)
if ($method === 'GET') {
    $action = $_GET['action'] ?? 'get';
    
    if ($action === 'get_all') {
        $files = glob("{$dataDir}/announcements_*.json");
        $all_data = [];
        foreach ($files as $file) {
            $basename = basename($file, '.json');
            $parts = explode('_', $basename); // announcements, specialty, year, semester
            if (count($parts) === 4) {
                $content = json_decode(file_get_contents($file), true);
                $all_data[] = [
                    'specialty' => $parts[1],
                    'year' => $parts[2],
                    'semester' => $parts[3],
                    'content' => $content['content'] ?? '',
                    'last_updated' => $content['last_updated'] ?? 0
                ];
            }
        }
        echo json_encode(['success' => true, 'data' => $all_data]);
        exit;
    }

    $specialty = dent_announcement_specialty($_GET['specialty'] ?? '');
    $year = intval($_GET['year'] ?? 0);
    $semester = intval($_GET['semester'] ?? 0);

    if ($specialty === '') {
        echo json_encode(['success' => true, 'data' => ['content' => '']]);
        exit;
    }

    $filename = "{$dataDir}/announcements_{$specialty}_{$year}_{$semester}.json";
    
    if (!file_exists($filename)) {
        echo json_encode(['success' => true, 'data' => ['content' => '']]);
        exit;
    }
    
    $data = json_decode(file_get_contents($filename), true);
    echo json_encode(['success' => true, 'data' => $data]);
    exit;
}

// 2. POST: Update the announcement content, Bulk Actions, Undo
if ($method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $password = $input['password'] ?? '';
    $action = $input['action'] ?? 'update';
    $backupFile = __DIR__ . '/announcements_backup.json';

    // Helper to backup current state
    $createBackup = function() use ($dataDir, $backupFile) {
        $files = glob("{$dataDir}/announcements_*.json");
        $backup = [];
        foreach ($files as $file) {
            $backup[basename($file)] = file_get_contents($file);
        }
        file_put_contents($backupFile, json_encode($backup), LOCK_EX);
    };

    if ($action === 'undo') {
        if (!dent2025_check_rbac_permission($password, 'global_announcements')) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Unauthorized: global_announcements permission required.']);
            exit;
        }
        if (!file_exists($backupFile)) {
            echo json_encode(['success' => false, 'message' => 'No undo history available.']);
            exit;
        }
        $backup = json_decode(file_get_contents($backupFile), true);
        // Clear current directory
        $files = glob("{$dataDir}/announcements_*.json");
        foreach ($files as $file) { unlink($file); }
        // Restore from backup
        foreach ($backup as $basename => $content) {
            file_put_contents("{$dataDir}/{$basename}", $content, LOCK_EX);
        }
        $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
        if (function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('announcements', 'bulk_update', 'التراجع عن تعديلات الإعلانات واستعادتها من التخزين التلقائي', $pass_info['label'] ?? '');
        }
        echo json_encode(['success' => true, 'message' => 'Undo successful!']);
        exit;
    }

    if ($action === 'bulk_clear') {
        if (!dent2025_check_rbac_permission($password, 'global_announcements')) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Unauthorized: global_announcements permission required.']);
            exit;
        }
        $createBackup();
        $files = glob("{$dataDir}/announcements_*.json");
        foreach ($files as $file) {
            $data = ['content' => '', 'last_updated' => time()];
            file_put_contents($file, json_encode($data), LOCK_EX);
        }
        $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
        if (function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('announcements', 'bulk_clear', 'مسح جميع الإعلانات والمهام الكلية', $pass_info['label'] ?? '');
        }
        echo json_encode(['success' => true, 'message' => 'Cleared all announcements!']);
        exit;
    }

    if ($action === 'bulk_update') {
        $contexts = $input['contexts'] ?? [];
        if (empty($contexts)) {
            if (!dent2025_check_rbac_permission($password, 'global_announcements')) {
                http_response_code(403);
                echo json_encode(['success' => false, 'message' => 'Unauthorized: global_announcements permission required.']);
                exit;
            }
        } else {
            foreach ($contexts as $ctx) {
                $s = $ctx['specialty'] ?? null;
                $y = isset($ctx['year']) ? intval($ctx['year']) : null;
                $sem = isset($ctx['semester']) ? intval($ctx['semester']) : null;
                if (!dent2025_check_rbac_permission($password, 'semester_announcements', $s, $y, $sem) &&
                    !dent2025_check_rbac_permission($password, 'global_announcements')) {
                    http_response_code(403);
                    echo json_encode(['success' => false, 'message' => 'Unauthorized for target context']);
                    exit;
                }
            }
        }

        $createBackup();
        $content = $input['content'] ?? '';
        foreach ($contexts as $ctx) {
            $s = dent_announcement_specialty($ctx['specialty'] ?? '');
            if ($s === '') continue;
            $y = intval($ctx['year'] ?? 0);
            $sem = intval($ctx['semester'] ?? 0);
            $filename = "{$dataDir}/announcements_{$s}_{$y}_{$sem}.json";
            
            $data = ['content' => $content, 'last_updated' => time()];
            file_put_contents($filename, json_encode($data), LOCK_EX);
        }
        $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
        if (function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('announcements', 'bulk_update', 'تحديث جماعي للإعلانات والمهام', $pass_info['label'] ?? '');
        }
        echo json_encode(['success' => true, 'message' => 'Bulk update successful!']);
        exit;
    }

    if ($action === 'update') {
        $specialty = dent_announcement_specialty($input['specialty'] ?? '');
        $year = isset($input['year']) ? intval($input['year']) : 0;
        $semester = isset($input['semester']) ? intval($input['semester']) : 0;

        if ($specialty === '') {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Invalid specialty.']);
            exit;
        }

        if ($specialty === 'global') {
            $is_auth = dent2025_check_rbac_permission($password, 'global_announcements');
        } else {
            $is_auth = dent2025_check_rbac_permission($password, 'semester_announcements', $specialty, $year, $semester) ||
                       dent2025_check_rbac_permission($password, 'global_announcements');
        }

        if (!$is_auth) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Wrong Admin Password!']);
            exit;
        }

        $createBackup();
        $filename = "{$dataDir}/announcements_{$specialty}_{$year}_{$semester}.json";
        $content = $input['content'] ?? '';
        $data = ['content' => $content, 'last_updated' => time()];
        file_put_contents($filename, json_encode($data), LOCK_EX);
        $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
        if (function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('announcements', 'edit', "تحديث إعلان الفئة: {$specialty} y{$year} s{$semester}", $pass_info['label'] ?? '');
        }
        echo json_encode(['success' => true, 'message' => 'Announcements updated!']);
        exit;
    }
}
?>

<?php
// history_api.php
// Audit History & Reversible Rollback Engine for Dent2025

if (file_exists(__DIR__ . '/wp-load.php')) {
    require_once __DIR__ . '/wp-load.php';
}
require_once __DIR__ . '/dent2025_rbac.php';
require_once __DIR__ . '/history_helpers.php';

define('LSCACHE_NO_CACHE', true);
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-cache, must-revalidate, max-age=0');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ['https://dent2025.com', 'https://www.dent2025.com'], true) || (strpos($origin, 'localhost') !== false)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header('Access-Control-Allow-Origin: https://dent2025.com');
}

header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Admin-Pass');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$history_dir = dent2025_get_history_dir();
$snapshots_dir = $history_dir . '/snapshots';
$method = $_SERVER['REQUEST_METHOD'];

// Helper function to restore DB subjects and subject_links
function dent2025_restore_db_tables($subjects, $links) {
    if (!is_array($subjects) || empty($subjects)) {
        return false;
    }
    $ctx = function_exists('dent2025_db') ? dent2025_db() : null;
    if ($ctx && isset($ctx['db']) && is_object($ctx['db']) && method_exists($ctx['db'], 'query')) {
        $db = $ctx['db'];
        $table_subs = $ctx['table_subs'];
        $table_links = $ctx['table_links'];

        $clean_subs = str_replace('`', '', $table_subs);
        $clean_links = str_replace('`', '', $table_links);

        $db->query("START TRANSACTION");
        try {
            $db->query("SET FOREIGN_KEY_CHECKS = 0");
            $db->query("DELETE FROM {$table_links}");
            $db->query("DELETE FROM {$table_subs}");
            $db->query("SET FOREIGN_KEY_CHECKS = 1");

            if (is_array($subjects)) {
                foreach ($subjects as $s) {
                    $db->insert($clean_subs, [
                        'id' => $s['id'],
                        'specialty' => $s['specialty'],
                        'year' => $s['year'],
                        'semester' => $s['semester'],
                        'name' => $s['name'],
                        'doctor' => $s['doctor'] ?? '',
                        'hours' => $s['hours'] ?? '',
                        'marks' => $s['marks'] ?? '',
                        'chapters_folder_id' => $s['chapters_folder_id'] ?? '',
                        'materials_folder_id' => $s['materials_folder_id'] ?? '',
                        'created_at' => $s['created_at'] ?? date('Y-m-d H:i:s')
                    ]);
                }
            }

            if (is_array($links)) {
                foreach ($links as $l) {
                    $db->insert($clean_links, [
                        'id' => $l['id'],
                        'subject_id' => $l['subject_id'],
                        'url' => $l['url'],
                        'title' => $l['title'],
                        'type' => $l['type'] ?? 'link',
                        'created_at' => $l['created_at'] ?? date('Y-m-d H:i:s')
                    ]);
                }
            }

            $db->query("COMMIT");
        } catch (Throwable $e) {
            $db->query("ROLLBACK");
            $db->query("SET FOREIGN_KEY_CHECKS = 1");
            return false;
        }

        if (function_exists('dent2025_clear_cache')) {
            dent2025_clear_cache();
        } else {
            $prefix = method_exists($db, 'prefix') ? $db->prefix : 'wpr9_';
            $db->query("DELETE FROM `{$prefix}options` WHERE option_name LIKE '_transient_dent2025_data_%'");
        }
        return true;
    } else {
        // Fallback to PDO if standalone execution
        $db_file = __DIR__ . '/backend/db_connect.php';
        if (file_exists($db_file)) {
            require_once $db_file;
            if (isset($pdo) && $pdo instanceof PDO) {
                $table_subs = 'subjects';
                $table_links = 'subject_links';
                try {
                    $check = $pdo->query("SELECT 1 FROM wpr9_subjects LIMIT 1");
                    if ($check !== false) {
                        $table_subs = 'wpr9_subjects';
                        $table_links = 'wpr9_subject_links';
                    }
                } catch(Throwable $e) {}

                try {
                    $pdo->beginTransaction();
                    $pdo->exec("SET FOREIGN_KEY_CHECKS = 0");
                    $pdo->exec("DELETE FROM {$table_links}");
                    $pdo->exec("DELETE FROM {$table_subs}");

                    if (is_array($subjects)) {
                        $stmt = $pdo->prepare("INSERT INTO {$table_subs} (id, specialty, year, semester, name, doctor, hours, marks, chapters_folder_id, materials_folder_id, created_at) VALUES (:id, :specialty, :year, :semester, :name, :doctor, :hours, :marks, :chapters_folder_id, :materials_folder_id, :created_at)");
                        foreach ($subjects as $s) {
                            $stmt->execute([
                                ':id' => $s['id'],
                                ':specialty' => $s['specialty'],
                                ':year' => $s['year'],
                                ':semester' => $s['semester'],
                                ':name' => $s['name'],
                                ':doctor' => $s['doctor'] ?? '',
                                ':hours' => $s['hours'] ?? '',
                                ':marks' => $s['marks'] ?? '',
                                ':chapters_folder_id' => $s['chapters_folder_id'] ?? '',
                                ':materials_folder_id' => $s['materials_folder_id'] ?? '',
                                ':created_at' => $s['created_at'] ?? date('Y-m-d H:i:s')
                            ]);
                        }
                    }

                    if (is_array($links)) {
                        $stmt2 = $pdo->prepare("INSERT INTO {$table_links} (id, subject_id, url, title, type, created_at) VALUES (:id, :subject_id, :url, :title, :type, :created_at)");
                        foreach ($links as $l) {
                            $stmt2->execute([
                                ':id' => $l['id'],
                                ':subject_id' => $l['subject_id'],
                                ':url' => $l['url'],
                                ':title' => $l['title'],
                                ':type' => $l['type'] ?? 'link',
                                ':created_at' => $l['created_at'] ?? date('Y-m-d H:i:s')
                            ]);
                        }
                    }
                    $pdo->exec("SET FOREIGN_KEY_CHECKS = 1");
                    $pdo->commit();
                } catch (Throwable $rollbackErr) {
                    if ($pdo->inTransaction()) {
                        $pdo->rollBack();
                    }
                    $pdo->exec("SET FOREIGN_KEY_CHECKS = 1");
                    throw $rollbackErr;
                }
            }
        }
    }
}

// 1. GET Requests
if ($method === 'GET') {
    $action = $_GET['action'] ?? 'get_history';

    // Sensitive read actions (snapshots contain full system state incl. passkeys;
    // history/deployments leak audit trails) require a valid admin passkey.
    $AUTH_GET_ACTIONS = ['get_history', 'get_deployments', 'get_snapshot', 'get_manual_snapshots'];
    if (in_array($action, $AUTH_GET_ACTIONS, true)) {
        $get_pass = $_GET['password'] ?? ($_SERVER['HTTP_X_ADMIN_PASS'] ?? '');
        $get_info = !empty($get_pass) ? dent2025_get_passkey_info($get_pass) : null;
        if (!$get_info) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Unauthorized']);
            exit;
        }
    }

    if ($action === 'get_history') {
        $audit_log_file = "{$history_dir}/audit_log.json";
        $logs = [];
        if (file_exists($audit_log_file)) {
            $json = @file_get_contents($audit_log_file);
            $logs = $json ? (json_decode($json, true) ?: []) : [];
        }

        // Filtering
        $category = $_GET['category'] ?? '';
        $search = $_GET['search'] ?? '';

        if ($category || $search) {
            $logs = array_values(array_filter($logs, function($item) use ($category, $search) {
                $match_cat = empty($category) || ($item['category'] ?? '') === $category;
                $match_search = empty($search) ||
                    (stripos($item['description'] ?? '', $search) !== false) ||
                    (stripos($item['passkey_label'] ?? '', $search) !== false) ||
                    (stripos($item['date_formatted'] ?? '', $search) !== false);
                return $match_cat && $match_search;
            }));
        }

        echo json_encode(['success' => true, 'data' => $logs]);
        exit;
    }

    if ($action === 'get_deployments') {
        $deploy_file = "{$history_dir}/deployments.json";
        $deployments = [];
        if (file_exists($deploy_file)) {
            $json = @file_get_contents($deploy_file);
            $deployments = $json ? (json_decode($json, true) ?: []) : [];
        }
        echo json_encode(['success' => true, 'data' => array_reverse($deployments)]);
        exit;
    }

    if ($action === 'get_snapshot') {
        $snap_id = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['snapshot_id'] ?? '');
        $snap_file = "{$snapshots_dir}/{$snap_id}.json";

        if (!file_exists($snap_file)) {
            echo json_encode(['success' => false, 'message' => 'Snapshot file not found']);
            exit;
        }

        $snap_data = json_decode(file_get_contents($snap_file), true);
        if (!$snap_data) {
            echo json_encode(['success' => false, 'message' => 'Invalid snapshot file data']);
            exit;
        }

        $state = $snap_data['state'] ?? [];

        // Live system state for diffing
        $live_state = function_exists('dent2025_capture_system_state') ? dent2025_capture_system_state() : [];

        // Build live diff
        $live_subjects = $live_state['subjects'] ?? [];
        $snap_subjects = $state['subjects'] ?? [];

        $live_sub_map = [];
        foreach ($live_subjects as $s) {
            if (isset($s['id'])) {
                $live_sub_map[$s['id']] = $s;
            }
        }

        $snap_sub_map = [];
        foreach ($snap_subjects as $s) {
            if (isset($s['id'])) {
                $snap_sub_map[$s['id']] = $s;
            }
        }

        $in_snap_only = []; // will be restored if rollback happens
        $in_live_only = []; // will be removed if rollback happens
        $modified_subjects = [];

        foreach ($snap_sub_map as $id => $sub) {
            if (!isset($live_sub_map[$id])) {
                $in_snap_only[] = [
                    'id' => $id,
                    'name' => $sub['name'] ?? '',
                    'doctor' => $sub['doctor'] ?? '',
                    'specialty' => $sub['specialty'] ?? '',
                    'year' => $sub['year'] ?? 0,
                    'semester' => $sub['semester'] ?? 1
                ];
            } else {
                $live_s = $live_sub_map[$id];
                $changed_fields = [];
                foreach (['name', 'doctor', 'hours', 'marks', 'chapters_folder_id', 'materials_folder_id'] as $f) {
                    if (($sub[$f] ?? '') !== ($live_s[$f] ?? '')) {
                        $changed_fields[] = [
                            'field' => $f,
                            'snap_value' => $sub[$f] ?? '',
                            'live_value' => $live_s[$f] ?? ''
                        ];
                    }
                }
                if (!empty($changed_fields)) {
                    $modified_subjects[] = [
                        'id' => $id,
                        'name' => $sub['name'] ?? '',
                        'doctor' => $sub['doctor'] ?? '',
                        'specialty' => $sub['specialty'] ?? '',
                        'year' => $sub['year'] ?? 0,
                        'semester' => $sub['semester'] ?? 1,
                        'changed_fields' => $changed_fields
                    ];
                }
            }
        }

        foreach ($live_sub_map as $id => $sub) {
            if (!isset($snap_sub_map[$id])) {
                $in_live_only[] = [
                    'id' => $id,
                    'name' => $sub['name'] ?? '',
                    'doctor' => $sub['doctor'] ?? '',
                    'specialty' => $sub['specialty'] ?? '',
                    'year' => $sub['year'] ?? 0,
                    'semester' => $sub['semester'] ?? 1
                ];
            }
        }

        $live_diff = [
            'subjects' => [
                'snapshot_count' => count($snap_subjects),
                'live_count' => count($live_subjects),
                'in_snapshot_only' => $in_snap_only,
                'in_live_only' => $in_live_only,
                'modified' => $modified_subjects
            ],
            'links' => [
                'snapshot_count' => count($state['subject_links'] ?? []),
                'live_count' => count($live_state['subject_links'] ?? [])
            ],
            'classes' => [
                'snapshot_count' => count($state['classes'] ?? []),
                'live_count' => count($live_state['classes'] ?? [])
            ],
            'announcements' => [
                'snapshot_count' => count($state['announcements'] ?? []),
                'live_count' => count($live_state['announcements'] ?? [])
            ],
            'events' => [
                'snapshot_count' => count($state['events'] ?? []),
                'live_count' => count($live_state['events'] ?? [])
            ],
            'passwords' => [
                'snapshot_count' => count($state['passwords'] ?? []),
                'live_count' => count($live_state['passwords'] ?? [])
            ]
        ];

        // Return summary metrics along with snapshot data and diff
        $summary = [
            'subjects_count' => count($state['subjects'] ?? []),
            'links_count' => count($state['subject_links'] ?? []),
            'classes_count' => count($state['classes'] ?? []),
            'announcements_count' => count($state['announcements'] ?? []),
            'events_files_count' => count($state['events'] ?? []),
            'passwords_count' => count($state['passwords'] ?? [])
        ];

        // Mask cleartext passkeys if caller lacks full manage_passwords permission
        if (isset($snap_data['state']['passwords']) && is_array($snap_data['state']['passwords'])) {
            $has_pwd_perm = !empty($get_info) && dent2025_check_rbac_permission($get_pass, 'manage_passwords');
            if (!$has_pwd_perm) {
                $snap_data['state']['passwords'] = array_map(function($p) {
                    if (isset($p['passkey'])) $p['passkey'] = '***';
                    return $p;
                }, $snap_data['state']['passwords']);
            }
        }

        echo json_encode([
            'success' => true,
            'summary' => $summary,
            'live_diff' => $live_diff,
            'data' => $snap_data
        ]);
        exit;
    }
    if ($action === 'get_manual_snapshots') {
        $audit_log_file = "{$history_dir}/audit_log.json";
        $logs = [];
        if (file_exists($audit_log_file)) {
            $json = @file_get_contents($audit_log_file);
            $all = $json ? (json_decode($json, true) ?: []) : [];
            $logs = array_values(array_filter($all, function($item) {
                return ($item['action_type'] ?? '') === 'manual_save';
            }));
        }
        echo json_encode(['success' => true, 'data' => $logs]);
        exit;
    }
}

// 2. POST Requests
if ($method === 'POST') {
    $inputRaw = file_get_contents('php://input');
    $input = json_decode($inputRaw, true) ?: [];
    $password = $input['password'] ?? '';
    $action = $input['action'] ?? 'rollback';

    // Verify auth
    $is_auth = dent2025_check_rbac_permission($password, 'manage_passwords');

    if (!$is_auth) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Unauthorized: Full admin permission required.']);
        exit;
    }

    if ($action === 'save_manual_snapshot') {
        $note = trim($input['note'] ?? '');
        if (empty($note)) {
            echo json_encode(['success' => false, 'message' => 'يجب إدخال ملاحظة للحفظ']);
            exit;
        }
        $note = substr(strip_tags($note), 0, 200); // sanitize, max 200 chars

        $passkey_label = $input['passkey_label'] ?? 'الأدمن';
        $metadata = $input['metadata'] ?? null;

        $audit = dent2025_record_audit_event(
            'manual',
            'manual_save',
            $note,
            $passkey_label,
            null,
            $metadata
        );

        echo json_encode([
            'success' => true,
            'message' => 'تم حفظ النقطة',
            'snapshot_id' => $audit['snapshot_id'] ?? null,
            'date_formatted' => $audit['date_formatted'] ?? null
        ]);
        exit;
    }

    if ($action === 'rollback' || $action === 'undo_rollback') {
        $snap_id = preg_replace('/[^a-zA-Z0-9_-]/', '', $input['snapshot_id'] ?? '');

        if (empty($snap_id) && $action === 'undo_rollback') {
            // Find most recent safety backup snapshot
            $audit_log_file = "{$history_dir}/audit_log.json";
            if (file_exists($audit_log_file)) {
                $logs = json_decode(file_get_contents($audit_log_file), true) ?: [];
                foreach ($logs as $l) {
                    if (($l['action_type'] ?? '') === 'safety_backup') {
                        $snap_id = $l['snapshot_id'];
                        break;
                    }
                }
            }
        }

        $snap_file = "{$snapshots_dir}/{$snap_id}.json";
        if (empty($snap_id) || !file_exists($snap_file)) {
            echo json_encode(['success' => false, 'message' => 'Target snapshot not found']);
            exit;
        }

        $target_snapshot = json_decode(file_get_contents($snap_file), true);
        if (!$target_snapshot || !isset($target_snapshot['state'])) {
            echo json_encode(['success' => false, 'message' => 'Invalid target snapshot structure']);
            exit;
        }

        $target_state = $target_snapshot['state'];
        $target_date = $target_snapshot['date_formatted'] ?? date('Y-m-d H:i:s');

        // STEP A: Take Pre-Rollback Safety Snapshot
        $safety_audit = dent2025_record_audit_event(
            'rollback',
            'safety_backup',
            'نسخة احتياطية تلقائية قبل عملية الاستعادة إلى نقطة (' . $target_date . ')',
            'نظام الأمان (Safety Snapshot)'
        );

        // STEP B: Perform Data Restoration
        // 1. Database - Subjects & Subject Links
        dent2025_restore_db_tables($target_state['subjects'] ?? [], $target_state['subject_links'] ?? []);

        // 2. Class Timetables
        $classes_file = __DIR__ . '/dent2025_classes.json';
        file_put_contents($classes_file, json_encode($target_state['classes'] ?? [], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        // 3. Announcements
        $ann_dir = __DIR__ . '/announcements_data';
        if (!file_exists($ann_dir)) {
            mkdir($ann_dir, 0777, true);
        }
        // Clear current announcement files
        $existing_ann_files = glob("{$ann_dir}/announcements_*.json");
        if ($existing_ann_files) {
            foreach ($existing_ann_files as $f) { @unlink($f); }
        }
        // Restore from snapshot
        if (!empty($target_state['announcements']) && is_array($target_state['announcements'])) {
            foreach ($target_state['announcements'] as $filename => $ann_content) {
                file_put_contents("{$ann_dir}/{$filename}", json_encode($ann_content, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            }
        }

        // 4. Timeline Schedule Events
        if (!empty($target_state['events']) && is_array($target_state['events'])) {
            foreach ($target_state['events'] as $filename => $events_content) {
                $target_file = __DIR__ . '/' . basename($filename);
                file_put_contents($target_file, json_encode($events_content, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            }
        }

        // 5. Passkeys & Permissions (Safely restore permissions without overwriting masked passkeys)
        if (!empty($target_state['passwords']) && is_array($target_state['passwords'])) {
            $live_passwords = function_exists('dent2025_load_passwords') ? dent2025_load_passwords(true) : [];
            $live_map = [];
            foreach ($live_passwords as $lp) {
                if (isset($lp['id'])) {
                    $live_map[$lp['id']] = $lp;
                }
            }

            $merged_passwords = [];
            foreach ($target_state['passwords'] as $tp) {
                $t_id = $tp['id'] ?? '';
                $live_entry = $live_map[$t_id] ?? null;

                // If the snapshot entry has a masked passkey (***), preserve the live unmasked passkey
                if (isset($tp['passkey']) && ($tp['passkey'] === '***' || trim($tp['passkey']) === '')) {
                    if ($live_entry && !empty($live_entry['passkey']) && $live_entry['passkey'] !== '***') {
                        $tp['passkey'] = $live_entry['passkey'];
                    }
                }

                // Only retain entries that have a valid (non-masked) passkey
                if (!empty($tp['passkey']) && $tp['passkey'] !== '***') {
                    $merged_passwords[] = $tp;
                }
            }

            if (!empty($merged_passwords)) {
                if (function_exists('dent2025_save_passwords')) {
                    dent2025_save_passwords($merged_passwords);
                } else {
                    file_put_contents(__DIR__ . '/dent2025_passwords.json', json_encode($merged_passwords, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                    if (function_exists('dent2025_load_passwords')) {
                        dent2025_load_passwords(true);
                    }
                }
            }
        }

        // STEP C: Record Audit Log Entry for Rollback Action
        $rollback_desc = ($action === 'undo_rollback')
            ? 'تم التراجع عن الاستعادة وإعادة النظام إلى ما قبل عملية الاستعادة'
            : 'تمت استعادة حالة النظام بالكامل إلى اللقطة المؤرخة (' . $target_date . ')';

        $rollback_audit = dent2025_record_audit_event(
            'rollback',
            $action === 'undo_rollback' ? 'undo_rollback' : 'rollback',
            $rollback_desc,
            'الأدمن (استعادة النظام)'
        );

        echo json_encode([
            'success' => true,
            'message' => $rollback_desc,
            'restored_snapshot_id' => $snap_id,
            'safety_snapshot_id' => $safety_audit['snapshot_id'] ?? null
        ]);
        exit;
    }
}

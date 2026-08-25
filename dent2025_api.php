<?php
// dent2025_api.php
// Standalone API file for Dent2025 WordPress integration
require_once dirname(__FILE__) . '/wp-load.php';
global $wp_query;
if (isset($wp_query)) {
    $wp_query->is_404 = false;
}
status_header(200);
require_once dirname(__FILE__) . '/dent2025_rbac.php';
require_once dirname(__FILE__) . '/history_helpers.php';

define('LSCACHE_NO_CACHE', true); // FORCE LiteSpeed to leave this API alone
header('Content-Type: application/json');
header('Cache-Control: no-cache, must-revalidate, max-age=0'); // Prevent browser/CDN caching

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ['https://dent2025.com', 'https://www.dent2025.com'], true) || (strpos($origin, 'localhost') !== false)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header('Access-Control-Allow-Origin: https://dent2025.com');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Admin-Pass');

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

global $wpdb;

if (!function_exists('dent2025_db')) {
    function dent2025_db() {
        global $wpdb;
        static $active = null;
        if ($active !== null) return $active;
        
        $prefix = !empty($wpdb->prefix) ? $wpdb->prefix : (isset($GLOBALS['table_prefix']) ? $GLOBALS['table_prefix'] : 'wpr9_');
        $prefixed_subs = "`{$prefix}subjects`";
        $prefixed_links = "`{$prefix}subject_links`";
        
        if (isset($wpdb) && is_object($wpdb) && method_exists($wpdb, 'get_var')) {
            $count = $wpdb->get_var("SELECT COUNT(*) FROM {$prefixed_subs}");
            if ($count !== null) {
                $active = ['db' => $wpdb, 'table_subs' => $prefixed_subs, 'table_links' => $prefixed_links];
                return $active;
            }
        }
        
        if (class_exists('wpdb') && defined('DB_USER') && defined('DB_PASSWORD') && defined('DB_NAME')) {
            try {
                $db_host = defined('DB_HOST') ? DB_HOST : 'localhost';
                $dev_db = new wpdb(DB_USER, DB_PASSWORD, DB_NAME, $db_host);
                $dev_db->prefix = $prefix;
                $active = ['db' => $dev_db, 'table_subs' => $prefixed_subs, 'table_links' => $prefixed_links];
                return $active;
            } catch (Exception $e) {}
        }
        
        $active = ['db' => $wpdb, 'table_subs' => $prefixed_subs, 'table_links' => $prefixed_links];
        return $active;
    }
}

function dent2025_table($name) {
    $ctx = dent2025_db();
    if ($name === 'subject_links') return $ctx['table_links'];
    if ($name === 'subjects') return $ctx['table_subs'];
    return '`' . $ctx['db']->prefix . $name . '`';
}

$action = $_GET['action'] ?? '';

// --- GET DATA ---
if ($action === 'data') {
    $specialty = sanitize_text_field($_GET['specialty'] ?? '');
    $year = intval($_GET['year'] ?? 0);
    $semester = intval($_GET['semester'] ?? 0);

    if (empty($specialty) || empty($semester)) {
        echo json_encode(["success" => false, "message" => "Missing parameters"]);
        exit;
    }

    $transient_key = "dent2025_data_{$specialty}_{$year}_{$semester}";
    $cached_data = get_transient($transient_key);
    
    if (false !== $cached_data && !empty($cached_data) && !isset($_GET['nocache'])) {
        echo json_encode(["success" => true, "data" => ["subjects" => $cached_data]]);
        exit;
    }

    $ctx = dent2025_db();
    $db = $ctx['db'];
    $table_subs = $ctx['table_subs'];
    $table_links = $ctx['table_links'];
    $query = $db->prepare("SELECT * FROM {$table_subs} WHERE specialty = %s AND year = %d AND semester = %d ORDER BY created_at ASC", $specialty, $year, $semester);
    $subjects = $db->get_results($query, ARRAY_A);

    if ($subjects && count($subjects) > 0) {
        $subject_ids = array_column($subjects, 'id');
        $placeholders = implode(',', array_fill(0, count($subject_ids), '%d'));
        $links_query = $db->prepare("SELECT * FROM {$table_links} WHERE subject_id IN ($placeholders) ORDER BY created_at DESC", ...$subject_ids);
        $all_links = $db->get_results($links_query, ARRAY_A);
        
        $links_by_sub = [];
        if ($all_links) {
            foreach ($all_links as $l) {
                $links_by_sub[$l['subject_id']][] = $l;
            }
        }
        foreach ($subjects as &$sub) {
            $sub['links'] = $links_by_sub[$sub['id']] ?? [];
        }
    }

    set_transient($transient_key, $subjects ? $subjects : [], 12 * HOUR_IN_SECONDS);

    echo json_encode(["success" => true, "data" => ["subjects" => $subjects ? $subjects : []]]);
    exit;
}

// --- GET CLASSES ---
if ($action === 'get_classes') {
    $specialty = sanitize_text_field($_GET['specialty'] ?? '');
    $year = isset($_GET['year']) ? intval($_GET['year']) : null;
    $semester = isset($_GET['semester']) ? intval($_GET['semester']) : null;
    
    $file_path = dirname(__FILE__) . '/dent2025_classes.json';
    $classes = [];
    if (file_exists($file_path)) {
        $json_data = file_get_contents($file_path);
        if ($json_data) {
            $classes = json_decode($json_data, true);
            if (!is_array($classes)) $classes = [];
        }
    }
    
    if (empty($specialty)) {
        echo json_encode(["success" => true, "data" => $classes]);
        exit;
    }
    
    $filtered = [];
    foreach ($classes as $c) {
        $matchSpec = strtolower(trim($c['specialty'] ?? '')) === strtolower(trim($specialty));
        $matchYear = ($year === null || intval($c['year'] ?? 0) === $year);
        $matchSem = ($semester === null || intval($c['semester'] ?? 0) === $semester);
        if ($matchSpec && $matchYear && $matchSem) {
            $filtered[] = $c;
        }
    }
    
    echo json_encode(["success" => true, "data" => $filtered]);
    exit;
}

// --- STUDY TIMER SERVER SYNC API (PIN BASED) ---

// Per-IP rate limiter for PIN write operations (mitigates brute-force PIN takeover)
function dent2025_study_ratelimit($window = 60, $max = 20, $key_suffix = '') {
    $dir = dirname(__FILE__) . '/dent2025_study_data';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    $file = $dir . '/ratelimit.json';
    
    $ip = 'unknown';
    foreach (array('HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR') as $h) {
        if (!empty($_SERVER[$h])) {
            $ip = trim(explode(',', $_SERVER[$h])[0]);
            if ($ip) break;
        }
    }
    $limit_key = $ip . ($key_suffix ? '_' . $key_suffix : '');

    $now = time();
    $data = [];
    if (file_exists($file)) {
        $json = @file_get_contents($file);
        $data = $json ? (json_decode($json, true) ?: []) : [];
    }
    foreach ($data as $k => $v) {
        $last_time = is_array($v) ? ($v['last_time'] ?? 0) : 0;
        if ($now - $last_time > $window) unset($data[$k]);
    }
    $rec = isset($data[$limit_key]) && is_array($data[$limit_key]) ? $data[$limit_key] : ['count' => 0, 'last_time' => $now];
    if ($rec['count'] >= $max && ($now - $rec['last_time'] <= $window)) return false;
    $data[$limit_key] = ['count' => $rec['count'] + 1, 'last_time' => $now];
    @file_put_contents($file, json_encode($data), LOCK_EX);
    return true;
}

if ($action === 'study_check_pin') {
    if (!dent2025_study_ratelimit(60, 30, 'check_pin')) {
        echo json_encode(["success" => false, "message" => "طلبات متكررة بسرعة، يرجى الانتظار دقيقة."]);
        exit;
    }
    $raw = file_get_contents("php://input");
    $input = json_decode($raw, true) ?: [];
    $pin = preg_replace('/[^0-9]/', '', $_GET['pin'] ?? $input['pin'] ?? '');
    $mode = sanitize_text_field($_GET['mode'] ?? $input['mode'] ?? 'create'); // 'create' or 'sync'

    if (strlen($pin) !== 4) {
        echo json_encode(["success" => false, "message" => "يجب أن يتكون الرمز من 4 أرقام exact"]);
        exit;
    }

    $dir = dirname(__FILE__) . '/dent2025_study_data';
    $file = $dir . '/study_records.json';
    $data = [];

    if (file_exists($file)) {
        $json = file_get_contents($file);
        if ($json) $data = json_decode($json, true) ?: [];
    }

    $exists = isset($data[$pin]);

    if ($mode === 'create') {
        if ($exists && !empty($data[$pin]['logs'])) {
            echo json_encode([
                "success" => false, 
                "message" => "هذا الرمز (4 أرقام) مستخدم بالفعل، يرجى اختيار 4 أرقام أخرى."
            ]);
            exit;
        }
        echo json_encode(["success" => true, "message" => "الرمز متاح", "exists" => false]);
        exit;
    } else {
        // Sync mode: fetching existing data if it exists
        if ($exists) {
            echo json_encode(["success" => true, "message" => "تم العثور على سجل الرمز", "exists" => true, "data" => $data[$pin]]);
        } else {
            echo json_encode(["success" => true, "message" => "رمز جديد، سيتم إنشاء سجل له", "exists" => false, "data" => ["pin" => $pin, "target_minutes" => 120, "logs" => []]]);
        }
        exit;
    }
}

if ($action === 'study_get_data') {
    if (!dent2025_study_ratelimit(60, 40, 'get_data')) {
        echo json_encode(["success" => false, "message" => "طلبات متكررة بسرعة، يرجى الانتظار دقيقة."]);
        exit;
    }
    $pin = preg_replace('/[^0-9]/', '', $_GET['pin'] ?? $_POST['pin'] ?? '');
    if (empty($pin)) {
        echo json_encode(["success" => false, "message" => "PIN required"]);
        exit;
    }

    $dir = dirname(__FILE__) . '/dent2025_study_data';
    $file = $dir . '/study_records.json';
    $data = [];

    if (file_exists($file)) {
        $json = file_get_contents($file);
        if ($json) $data = json_decode($json, true) ?: [];
    }

    $record = $data[$pin] ?? [
        "pin" => $pin,
        "target_minutes" => 120,
        "logs" => []
    ];

    echo json_encode(["success" => true, "data" => $record]);
    exit;
}

if ($action === 'study_sync_data') {
    $raw = file_get_contents("php://input");
    $input = json_decode($raw, true) ?: [];
    $pin = preg_replace('/[^0-9]/', '', $input['pin'] ?? '');

    if (!dent2025_study_ratelimit()) {
        echo json_encode(["success" => false, "message" => "طلبات كثيرة جداً، حاول بعد قليل."]);
        exit;
    }

    if (empty($pin) || strlen($pin) !== 4) {
        echo json_encode(["success" => false, "message" => "الرمز يجب أن يكون 4 أرقام"]);
        exit;
    }

    $dir = dirname(__FILE__) . '/dent2025_study_data';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    $file = $dir . '/study_records.json';

    $data = [];
    if (file_exists($file)) {
        $json = file_get_contents($file);
        if ($json) $data = json_decode($json, true) ?: [];
    }

    $existingLogs = is_array($data[$pin]['logs'] ?? null) ? $data[$pin]['logs'] : [];
    $incomingLogs = is_array($input['logs'] ?? null) ? $input['logs'] : [];

    // Merge logs by unique session ID to prevent cross-device log overwriting
    $logMap = [];
    foreach ($existingLogs as $el) {
        $key = !empty($el['id']) ? $el['id'] : (($el['dateStr'] ?? '') . '_' . ($el['subject'] ?? '') . '_' . ($el['durationSeconds'] ?? ''));
        $logMap[$key] = $el;
    }
    foreach ($incomingLogs as $il) {
        $key = !empty($il['id']) ? $il['id'] : (($il['dateStr'] ?? '') . '_' . ($il['subject'] ?? '') . '_' . ($il['durationSeconds'] ?? ''));
        $logMap[$key] = $il;
    }
    $mergedLogs = array_values($logMap);

    $data[$pin] = [
        "pin" => $pin,
        "target_minutes" => intval($input['target_minutes'] ?? ($data[$pin]['target_minutes'] ?? 120)),
        "logs" => $mergedLogs,
        "last_synced" => time()
    ];

    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    echo json_encode(["success" => true, "message" => "Study data synced successfully"]);
    exit;
}

if ($action === 'study_change_pin') {
    $raw = file_get_contents("php://input");
    $input = json_decode($raw, true) ?: [];
    $old_pin = preg_replace('/[^0-9]/', '', $input['old_pin'] ?? '');
    $new_pin = preg_replace('/[^0-9]/', '', $input['new_pin'] ?? '');
    $mode = sanitize_text_field($input['mode'] ?? 'create');

    if (!dent2025_study_ratelimit(120, 10)) {
        echo json_encode(["success" => false, "message" => "طلبات كثيرة جداً، حاول بعد قليل."]);
        exit;
    }

    if (empty($new_pin) || strlen($new_pin) !== 4) {
        echo json_encode(["success" => false, "message" => "الرمز الجديد يجب أن يتكون من 4 أرقام"]);
        exit;
    }

    $dir = dirname(__FILE__) . '/dent2025_study_data';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    $file = $dir . '/study_records.json';

    $data = [];
    if (file_exists($file)) {
        $json = file_get_contents($file);
        if ($json) $data = json_decode($json, true) ?: [];
    }

    // If creating a brand new PIN and it's already taken by someone else
    if ($mode === 'create' && isset($data[$new_pin]) && $old_pin !== $new_pin && !empty($data[$new_pin]['logs'])) {
        echo json_encode(["success" => false, "message" => "هذا الرمز (4 أرقام) مستخدم بالفعل، يرجى اختيار 4 أرقام أخرى."]);
        exit;
    }

    $existing_record = $data[$old_pin] ?? [
        "pin" => $old_pin,
        "target_minutes" => intval($input['target_minutes'] ?? 120),
        "logs" => is_array($input['logs'] ?? null) ? $input['logs'] : []
    ];

    // Check if new PIN already has logs; if so, merge them without duplicating
    if (isset($data[$new_pin]) && !empty($data[$new_pin]['logs'])) {
        $logMap = [];
        foreach ($data[$new_pin]['logs'] as $el) {
            $key = !empty($el['id']) ? $el['id'] : (($el['dateStr'] ?? '') . '_' . ($el['subject'] ?? '') . '_' . ($el['durationSeconds'] ?? ''));
            $logMap[$key] = $el;
        }
        foreach ($existing_record['logs'] as $il) {
            $key = !empty($il['id']) ? $il['id'] : (($il['dateStr'] ?? '') . '_' . ($il['subject'] ?? '') . '_' . ($il['durationSeconds'] ?? ''));
            $logMap[$key] = $il;
        }
        $data[$new_pin]['logs'] = array_values($logMap);
        $data[$new_pin]['last_synced'] = time();
    } else {
        $data[$new_pin] = [
            "pin" => $new_pin,
            "target_minutes" => $existing_record['target_minutes'],
            "logs" => $existing_record['logs'],
            "last_synced" => time()
        ];
    }

    if (!empty($old_pin) && $old_pin !== $new_pin && isset($data[$old_pin])) {
        unset($data[$old_pin]);
    }

    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    echo json_encode(["success" => true, "pin" => $new_pin, "data" => $data[$new_pin]]);
    exit;
}

// --- HELPER TO CLEAR CACHE ---

function dent2025_clear_cache() {
    global $wpdb;
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_dent2025\_data\_%'");
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_timeout\_dent2025\_data\_%'");
    if (function_exists('do_action')) {
        do_action('litespeed_purge_all');
    }
}

// --- MANAGE DATA (Add/Edit/Delete/Auth/Passkeys) ---
$raw_input = file_get_contents("php://input");
$input = json_decode($raw_input, true) ?: [];
$password = $input['password'] ?? ($_POST['password'] ?? '');

if ($action === 'check_auth') {
    $entry = dent2025_get_passkey_info($password);
    if ($entry) {
        unset($entry['passkey']);
        echo json_encode(["success" => true, "data" => $entry]);
    } else {
        echo json_encode(["success" => false, "message" => "Invalid password"]);
    }
    exit;
}

if ($action === 'manage_passwords') {
    if (!dent2025_check_rbac_permission($password, 'manage_passwords')) {
        echo json_encode(["success" => false, "message" => "Unauthorized: manage_passwords permission required."]);
        exit;
    }
    $sub_action = $input['sub_action'] ?? ($input['type'] ?? 'list');
    if ($sub_action === 'add') {
        $entry = $input['entry'] ?? $input;
        $res = dent2025_add_password($entry);
        if ($res) {
            echo json_encode(["success" => true, "message" => "Password added successfully", "data" => dent2025_load_passwords()]);
        } else {
            echo json_encode(["success" => false, "message" => "Failed to add password"]);
        }
        exit;
    }
    if ($sub_action === 'edit' || $sub_action === 'update') {
        $id = $input['id'] ?? ($input['entry']['id'] ?? '');
        $updates = $input['updates'] ?? ($input['entry'] ?? []);
        $res = dent2025_update_password($id, $updates);
        if ($res) {
            echo json_encode(["success" => true, "message" => "Password updated successfully", "data" => dent2025_load_passwords()]);
        } else {
            echo json_encode(["success" => false, "message" => "Failed to update password"]);
        }
        exit;
    }
    if ($sub_action === 'delete') {
        $id = $input['id'] ?? ($input['entry']['id'] ?? '');
        $res = dent2025_delete_password($id);
        if ($res) {
            echo json_encode(["success" => true, "message" => "Password deleted successfully", "data" => dent2025_load_passwords()]);
        } else {
            echo json_encode(["success" => false, "message" => "Failed to delete password"]);
        }
        exit;
    }
    echo json_encode(["success" => true, "data" => dent2025_load_passwords()]);
    exit;
}

if ($action === 'get_passwords') {
    if (!dent2025_check_rbac_permission($password, 'manage_passwords')) {
        echo json_encode(["success" => false, "message" => "Unauthorized: manage_passwords permission required."]);
        exit;
    }
    echo json_encode(["success" => true, "data" => dent2025_load_passwords()]);
    exit;
}

if ($action === 'save_password') {
    if (!dent2025_check_rbac_permission($password, 'manage_passwords')) {
        echo json_encode(["success" => false, "message" => "Unauthorized: manage_passwords permission required."]);
        exit;
    }
    $entry = $input['entry'] ?? $input;
    $id = $input['id'] ?? ($entry['id'] ?? '');

    $existing = dent2025_load_passwords();
    $found = false;
    if (!empty($id)) {
        foreach ($existing as $p) {
            if (isset($p['id']) && $p['id'] === $id) {
                $found = true;
                break;
            }
        }
    }

    if ($found) {
        $res = dent2025_update_password($id, $entry);
    } else {
        $res = dent2025_add_password($entry);
    }

    if ($res) {
        echo json_encode(["success" => true, "message" => "Password saved successfully", "data" => dent2025_load_passwords()]);
    } else {
        echo json_encode(["success" => false, "message" => "Failed to save password"]);
    }
    exit;
}

if ($action === 'delete_password') {
    if (!dent2025_check_rbac_permission($password, 'manage_passwords')) {
        echo json_encode(["success" => false, "message" => "Unauthorized: manage_passwords permission required."]);
        exit;
    }
    $id = $input['id'] ?? ($input['entry']['id'] ?? '');
    $res = dent2025_delete_password($id);
    if ($res) {
        echo json_encode(["success" => true, "message" => "Password deleted successfully", "data" => dent2025_load_passwords()]);
    } else {
        echo json_encode(["success" => false, "message" => "Failed to delete password"]);
    }
    exit;
}

if ($action === 'save_classes') {
    $specialty = $input['specialty'] ?? null;
    $year = isset($input['year']) ? intval($input['year']) : null;
    $semester = isset($input['semester']) ? intval($input['semester']) : null;

    if (!dent2025_check_rbac_permission($password, 'timetable', $specialty, $year, $semester)) {
        echo json_encode(["success" => false, "message" => "Access Denied. Insufficient timetable permissions."]);
        exit;
    }

    $file_path = dirname(__FILE__) . '/dent2025_classes.json';
    $classes = [];
    if (file_exists($file_path)) {
        $json_data = file_get_contents($file_path);
        if ($json_data) {
            $classes = json_decode($json_data, true);
            if (!is_array($classes)) $classes = [];
        }
    }

    $sub_action = $input['sub_action'] ?? 'add';
    
    if ($sub_action === 'add') {
        $new_class = [
            'id' => uniqid('class_'),
            'specialty' => sanitize_text_field($input['specialty'] ?? ''),
            'year' => intval($input['year'] ?? 0),
            'semester' => intval($input['semester'] ?? 0),
            'day' => sanitize_text_field($input['day'] ?? ''),
            'group_name' => sanitize_text_field($input['group_name'] ?? ''),
            'subject' => sanitize_text_field($input['subject'] ?? ''),
            'start_time' => sanitize_text_field($input['start_time'] ?? ''),
            'end_time' => sanitize_text_field($input['end_time'] ?? ''),
            'type' => sanitize_text_field($input['type'] ?? '')
        ];
        $classes[] = $new_class;
    } else if ($sub_action === 'delete') {
        $id_to_delete = $input['class_id'] ?? '';
        $classes = array_filter($classes, function($c) use ($id_to_delete) {
            return $c['id'] !== $id_to_delete;
        });
        $classes = array_values($classes); // Reindex
    }

    file_put_contents($file_path, json_encode($classes, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('classes', $sub_action === 'delete' ? 'delete' : 'add', ($sub_action === 'delete' ? 'حذف حصة من الجدول الدراسي' : 'إضافة حصة للجدول الدراسي: ') . ($input['subject'] ?? ''), $pass_info['label'] ?? '');
    }
    echo json_encode(["success" => true, "message" => "Classes updated successfully."]);
    exit;
}

if ($action === 'add') {
    $specialty = sanitize_text_field($input['specialty'] ?? '');
    $year = isset($input['year']) ? intval($input['year']) : null;
    $semester = isset($input['semester']) ? intval($input['semester']) : null;

    if (!dent2025_check_rbac_permission($password, 'add_subject', $specialty, $year, $semester)) {
        echo json_encode(["success" => false, "message" => "صلاحية غير كافية: إضافة المواد الجديدة تتطلب صلاحيات add_subject."]);
        exit;
    }

    $name = sanitize_text_field($input['name'] ?? '');
    if (!$name) { echo json_encode(["success"=>false, "message"=>"Name required"]); exit; }
    
    // Call Google Apps Script
    $gas_url = "https://script.google.com/macros/s/AKfycbyGOFQWRmkBmJJ9ItdpzhzY5CgbEPjjI6joodT0GT_Sq--f287fcomqUBqRw-MxaKie/exec";
    $postData = [
        'specialty' => $specialty, 'year' => $year,
        'semester' => $semester, 'subjectName' => $name
    ];
    
    $response = wp_remote_post($gas_url, array(
        'body'    => $postData,
        'timeout' => 60,
        'redirection' => 0
    ));

    if (is_wp_error($response)) {
        echo json_encode(["success" => false, "message" => "Server connection error: " . $response->get_error_message()]);
        exit;
    }

    $status = wp_remote_retrieve_response_code($response);
    if ($status == 302 || $status == 301 || $status == 303) {
        $redirect_url = wp_remote_retrieve_header($response, 'location');
        if ($redirect_url) {
            $response = wp_remote_get($redirect_url, array('timeout' => 60));
        }
    }

    $gas_result = wp_remote_retrieve_body($response);
    $gas_data = json_decode($gas_result, true);

    if (!$gas_data || empty($gas_data['success'])) {
        $error_snippet = substr(strip_tags($gas_result), 0, 100);
        echo json_encode(["success" => false, "message" => "Google Drive Error: " . ($gas_data['message'] ?? $error_snippet)]);
        exit;
    }

    $ctx = dent2025_db();
    $db = $ctx['db'];
    $table_subs = str_replace('`', '', $ctx['table_subs']);

    $db->insert($table_subs, [
        'specialty' => $specialty, 'year' => $year, 'semester' => $semester,
        'name' => $name, 'doctor' => sanitize_text_field($input['doctor'] ?? ''),
        'hours' => sanitize_text_field($input['hours'] ?? ''), 'marks' => sanitize_text_field($input['marks'] ?? ''),
        'chapters_folder_id' => $gas_data['chaptersFolderId'], 'materials_folder_id' => $gas_data['materialsFolderId']
    ]);

    dent2025_clear_cache();

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'add', 'إضافة مادة جديدة: ' . $name, $pass_info['label'] ?? '');
    }

    echo json_encode(["success" => true, "message" => "Subject added successfully!"]);
    exit;
}

if ($action === 'edit') {
    $id = intval($input['id'] ?? 0);
    $ctx = dent2025_db();
    $db = $ctx['db'];
    $table_subs = $ctx['table_subs'];
    $row = $db->get_row($db->prepare("SELECT * FROM {$table_subs} WHERE id = %d", $id));
    if (!$row) {
        echo json_encode(["success" => false, "message" => "المادة غير موجودة."]);
        exit;
    }
    
    $specialty = $row->specialty;
    $year = $row->year;
    $semester = $row->semester;

    // Check permissions
    $has_core_perm = dent2025_check_rbac_permission($password, 'edit_core_subject', $specialty, $year, $semester);
    $has_basic_perm = dent2025_check_rbac_permission($password, 'edit_basic_subject', $specialty, $year, $semester);

    if (!$has_core_perm && !$has_basic_perm) {
        echo json_encode(["success" => false, "message" => "صلاحية غير كافية لتعديل المادة."]);
        exit;
    }

    // Core changes (name, chapters_folder_id, materials_folder_id) require edit_core_subject
    $name_changed = isset($input['name']) && trim($input['name']) !== '' && trim($input['name']) !== $row->name;
    $chap_changed = isset($input['chapters_folder_id']) && $input['chapters_folder_id'] !== $row->chapters_folder_id;
    $mat_changed = isset($input['materials_folder_id']) && $input['materials_folder_id'] !== $row->materials_folder_id;

    if (($name_changed || $chap_changed || $mat_changed) && !$has_core_perm) {
        echo json_encode(["success" => false, "message" => "صلاحية غير كافية لتعديل اسم المادة أو مجلدات درايف (تتطلب صلاحية edit_core_subject)."]);
        exit;
    }

    // Name update
    $new_name = ($has_core_perm && isset($input['name']) && trim($input['name']) !== '') ? sanitize_text_field($input['name']) : $row->name;
    
    // Doctor, hours, marks can be updated by either basic or core permission
    $new_doctor = isset($input['doctor']) ? sanitize_text_field($input['doctor']) : $row->doctor;
    $new_hours = isset($input['hours']) ? sanitize_text_field($input['hours']) : $row->hours;
    $new_marks = isset($input['marks']) ? sanitize_text_field($input['marks']) : $row->marks;

    // Folder IDs (core permission required to change)
    $clean_drive_fn = function($str) {
        if (empty($str)) return '';
        $str = trim($str);
        if (preg_match('/folders\/([a-zA-Z0-9_-]+)/', $str, $m)) return $m[1];
        if (preg_match('/id=([a-zA-Z0-9_-]+)/', $str, $m)) return $m[1];
        if (preg_match('/\/d\/([a-zA-Z0-9_-]+)/', $str, $m)) return $m[1];
        return preg_replace('/[^a-zA-Z0-9_-]/', '', $str);
    };

    $chap_id = ($has_core_perm && isset($input['chapters_folder_id'])) ? $clean_drive_fn($input['chapters_folder_id']) : $row->chapters_folder_id;
    $mat_id = ($has_core_perm && isset($input['materials_folder_id'])) ? $clean_drive_fn($input['materials_folder_id']) : $row->materials_folder_id;

    $update_data = [
        'name' => $new_name,
        'doctor' => $new_doctor,
        'hours' => $new_hours,
        'marks' => $new_marks,
        'chapters_folder_id' => $chap_id,
        'materials_folder_id' => $mat_id
    ];
    
    $db->query($db->prepare("UPDATE {$table_subs} SET name = %s, doctor = %s, hours = %s, marks = %s, chapters_folder_id = %s, materials_folder_id = %s WHERE id = %d", $new_name, $new_doctor, $new_hours, $new_marks, $chap_id, $mat_id, $id));
    
    dent2025_clear_cache();
    
    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'edit', 'تعديل المادة: ' . $new_name, $pass_info['label'] ?? '');
    }

    // Always respond to the browser FIRST so the edit never appears as a connection error.
    echo json_encode(["success" => true, "message" => "Subject updated & synced!"]);
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        if (function_exists('ob_end_flush')) { @ob_end_flush(); }
        @ob_flush();
        flush();
        if (function_exists('ignore_user_abort')) ignore_user_abort(true);
    }

    // Trigger GAS rename if name changed by core admin (background / non-blocking)
    if ($has_core_perm && $row->chapters_folder_id && $new_name !== $row->name) {
        $gas_url = "https://script.google.com/macros/s/AKfycbyGOFQWRmkBmJJ9ItdpzhzY5CgbEPjjI6joodT0GT_Sq--f287fcomqUBqRw-MxaKie/exec";
        $postData = [
            'action' => 'rename',
            'chapters_folder_id' => $row->chapters_folder_id,
            'new_name' => $new_name
        ];
        @wp_remote_post($gas_url, array('body' => $postData, 'timeout' => 5, 'redirection' => 0));
    }
    exit;
}

if ($action === 'delete') {
    $id = intval($input['id'] ?? 0);
    $ctx = dent2025_db();
    $db = $ctx['db'];
    $table_subs = $ctx['table_subs'];
    $row = $db->get_row($db->prepare("SELECT specialty, year, semester FROM {$table_subs} WHERE id = %d", $id));
    $specialty = $row ? $row->specialty : ($input['specialty'] ?? null);
    $year = $row ? $row->year : ($input['year'] ?? null);
    $semester = $row ? $row->semester : ($input['semester'] ?? null);

    if (!dent2025_check_rbac_permission($password, 'delete_subject', $specialty, $year, $semester)) {
        echo json_encode(["success" => false, "message" => "صلاحية غير كافية: حذف المواد يتطلب صلاحيات delete_subject."]);
        exit;
    }
    
    $db->query($db->prepare("DELETE FROM {$table_subs} WHERE id = %d", $id));
    
    dent2025_clear_cache();
    
    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'delete', 'حذف المادة ID: ' . $id, $pass_info['label'] ?? '');
    }

    echo json_encode(["success" => true, "message" => "Subject deleted from database!"]);
    exit;
}

if ($action === 'add_link') {
    $subject_id = intval($input['subject_id'] ?? 0);
    $url = esc_url_raw($input['url'] ?? '');
    $title = sanitize_text_field($input['title'] ?? '');
    
    $ctx = dent2025_db();
    $db = $ctx['db'];
    $table_subs = $ctx['table_subs'];
    $table_links = $ctx['table_links'];

    $row = $db->get_row($db->prepare("SELECT specialty, year, semester FROM {$table_subs} WHERE id = %d", $subject_id));
    if (!$row) {
        echo json_encode(["success" => false, "message" => "Subject not found"]);
        exit;
    }
    
    if (!dent2025_check_rbac_permission($password, 'edit_basic_subject', $row->specialty, $row->year, $row->semester) &&
        !dent2025_check_rbac_permission($password, 'edit_core_subject', $row->specialty, $row->year, $row->semester)) {
        echo json_encode(["success" => false, "message" => "Unauthorized"]);
        exit;
    }
    
    $type = 'link';
    if (strpos(strtolower($url), 'youtube.com') !== false || strpos(strtolower($url), 'youtu.be') !== false) {
        $type = 'youtube';
    } else if (strpos(strtolower($url), 'drive.google.com') !== false) {
        $type = 'drive';
    } else if (strpos(strtolower($url), 't.me') !== false || strpos(strtolower($url), 'telegram') !== false) {
        $type = 'telegram';
    }
    
    $inserted = $db->query($db->prepare("INSERT INTO {$table_links} (subject_id, url, title, type) VALUES (%d, %s, %s, %s)", $subject_id, $url, $title, $type));
    
    dent2025_clear_cache();

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'add', 'إضافة رابط مادة: ' . $title, $pass_info['label'] ?? '');
    }

    echo json_encode(["success" => true, "message" => "Link added successfully"]);
    exit;
}

if ($action === 'delete_link') {
    $link_id = intval($input['link_id'] ?? 0);
    $ctx = dent2025_db();
    $db = $ctx['db'];
    $table_links = $ctx['table_links'];
    $table_subs = $ctx['table_subs'];

    $link = $db->get_row($db->prepare("SELECT subject_id FROM {$table_links} WHERE id = %d", $link_id));
    if (!$link) {
        echo json_encode(["success" => false, "message" => "Link not found"]);
        exit;
    }
    
    $row = $db->get_row($db->prepare("SELECT specialty, year, semester FROM {$table_subs} WHERE id = %d", $link->subject_id));
    if (!$row || (!dent2025_check_rbac_permission($password, 'edit_basic_subject', $row->specialty, $row->year, $row->semester) &&
        !dent2025_check_rbac_permission($password, 'edit_core_subject', $row->specialty, $row->year, $row->semester))) {
        echo json_encode(["success" => false, "message" => "Unauthorized"]);
        exit;
    }
    
    $db->query($db->prepare("DELETE FROM {$table_links} WHERE id = %d", $link_id));
    dent2025_clear_cache();

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'delete', 'حذف رابط المادة ID: ' . $link_id, $pass_info['label'] ?? '');
    }

    echo json_encode(["success" => true, "message" => "Link deleted successfully"]);
    exit;
}

if ($action === 'edit_link') {
    $link_id = intval($input['link_id'] ?? 0);
    $title = sanitize_text_field($input['title'] ?? '');
    $ctx = dent2025_db();
    $db = $ctx['db'];
    $table_links = $ctx['table_links'];
    $table_subs = $ctx['table_subs'];

    $link = $db->get_row($db->prepare("SELECT subject_id FROM {$table_links} WHERE id = %d", $link_id));
    if (!$link) {
        echo json_encode(["success" => false, "message" => "Link not found"]);
        exit;
    }
    
    $row = $db->get_row($db->prepare("SELECT specialty, year, semester FROM {$table_subs} WHERE id = %d", $link->subject_id));
    if (!$row || (!dent2025_check_rbac_permission($password, 'edit_basic_subject', $row->specialty, $row->year, $row->semester) &&
        !dent2025_check_rbac_permission($password, 'edit_core_subject', $row->specialty, $row->year, $row->semester))) {
        echo json_encode(["success" => false, "message" => "Unauthorized"]);
        exit;
    }
    
    $db->query($db->prepare("UPDATE {$table_links} SET title = %s WHERE id = %d", $title, $link_id));
    dent2025_clear_cache();

    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('subjects', 'edit', 'تعديل عنوان رابط المادة ID: ' . $link_id, $pass_info['label'] ?? '');
    }

    echo json_encode(["success" => true, "message" => "Link updated successfully"]);
    exit;
}

if ($action === 'sync_drive') {
    echo json_encode(["success" => false, "message" => "Sync disabled for safety."]);
    exit;
}

echo json_encode(["success" => false, "message" => "Invalid action."]);


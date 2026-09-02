<?php
// schedule_backend.php
// New backend for the semester timeline schedule.
require_once __DIR__ . '/dent2025_rbac.php';
require_once __DIR__ . '/history_helpers.php';

define('LSCACHE_NO_CACHE', true);
header('Content-Type: application/json');
header('Cache-Control: no-cache, must-revalidate, max-age=0');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ['https://dent2025.com', 'https://www.dent2025.com'], true) || (strpos($origin, 'localhost') !== false)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header('Access-Control-Allow-Origin: https://dent2025.com');
}

header('Access-Control-Allow-Methods: GET, POST, DELETE');
header('Access-Control-Allow-Headers: Content-Type');

$method = $_SERVER['REQUEST_METHOD'];

$globalFile = __DIR__ . '/schedule_events.json';

// Get schedule_id (from GET or POST)
$scheduleId = '';
if ($method === 'GET') {
    $scheduleId = $_GET['schedule_id'] ?? '';
} else {
    // For POST/DELETE, it will be in the JSON body
    $inputRaw = file_get_contents('php://input');
    $input = json_decode($inputRaw, true) ?: [];
    $scheduleId = $input['schedule_id'] ?? '';
}

// Clean schedule ID to prevent directory traversal
$scheduleId = preg_replace('/[^a-zA-Z0-9_-]/', '', $scheduleId);

$dataFile = $globalFile;
if (!empty($scheduleId) && $scheduleId !== 'global') {
    $dataFile = __DIR__ . "/schedule_events_{$scheduleId}.json";
}

// Initialize if global doesn't exist
if (!file_exists($globalFile)) {
    file_put_contents($globalFile, json_encode([]), LOCK_EX);
}

// 1. GET: Fetch all events
if ($method === 'GET') {
    $globalData = json_decode(file_get_contents($globalFile), true);
    if (!is_array($globalData)) $globalData = [];
    
    // Tag global events
    foreach ($globalData as &$ev) {
        $ev['is_global'] = true;
        $ev['schedule_id'] = 'global';
    }
    unset($ev);

    $mergedData = [];

    if ($scheduleId === 'all') {
        $mergedData = $globalData;
        $files = glob(__DIR__ . '/schedule_events_*.json');
        foreach ($files as $file) {
            $basename = basename($file, '.json');
            $subScheduleId = str_replace('schedule_events_', '', $basename);
            if (empty($subScheduleId) || $subScheduleId === 'events' || $subScheduleId === 'backup') continue;
            
            $localData = json_decode(file_get_contents($file), true);
            if (is_array($localData)) {
                $specialty = null; $year = null; $semester = null;
                if (preg_match('/^([a-zA-Z-]+)_(?:y)?(\d+)_(?:s)?(\d+)$/', $subScheduleId, $m)) {
                    $code = strtolower($m[1]);
                    if ($code === 'dent' || $code === 'dentistry') $specialty = 'dentistry';
                    elseif ($code === 'med' || $code === 'medicine') $specialty = 'medicine';
                    elseif ($code === 'pre' || $code === 'pre-med') $specialty = 'pre-med';
                    else $specialty = $m[1];

                    $year = intval($m[2]);
                    $semester = intval($m[3]);
                }

                foreach ($localData as $ev) {
                    $ev['is_global'] = false;
                    $ev['schedule_id'] = $subScheduleId;
                    if ($specialty !== null) $ev['specialty'] = $specialty;
                    if ($year !== null) $ev['year'] = $year;
                    if ($semester !== null) $ev['semester'] = $semester;
                    $mergedData[] = $ev;
                }
            }
        }
    } else {
        $mergedData = $globalData;

        if ($dataFile !== $globalFile && file_exists($dataFile)) {
            $localData = json_decode(file_get_contents($dataFile), true);
            if (is_array($localData)) {
                $specialty = null; $year = null; $semester = null;
                if (preg_match('/^([a-zA-Z-]+)_(?:y)?(\d+)_(?:s)?(\d+)$/', $scheduleId, $m)) {
                    $code = strtolower($m[1]);
                    if ($code === 'dent' || $code === 'dentistry') $specialty = 'dentistry';
                    elseif ($code === 'med' || $code === 'medicine') $specialty = 'medicine';
                    elseif ($code === 'pre' || $code === 'pre-med') $specialty = 'pre-med';
                    else $specialty = $m[1];

                    $year = intval($m[2]);
                    $semester = intval($m[3]);
                }

                foreach ($localData as $ev) {
                    $ev['is_global'] = false;
                    $ev['schedule_id'] = $scheduleId;
                    if ($specialty !== null) $ev['specialty'] = $specialty;
                    if ($year !== null) $ev['year'] = $year;
                    if ($semester !== null) $ev['semester'] = $semester;
                    $mergedData[] = $ev;
                }
            }
        }
    }
    
    // Sort events by date ascending
    usort($mergedData, function($a, $b) {
        return strtotime($a['date']) - strtotime($b['date']);
    });
    
    echo json_encode(['success' => true, 'data' => $mergedData]);
    exit;
}

// Only GET is permitted without auth. POST and DELETE need it.
if (!isset($input)) {
    $inputRaw = file_get_contents('php://input');
    $input = json_decode($inputRaw, true) ?: [];
}

if ($method === 'POST' || $method === 'DELETE') {
    $password = $input['password'] ?? '';
    // is_global = true ONLY if explicitly set to true AND no specific schedule_id is given,
    // OR if the schedule_id is literally 'global' or empty.
    // A non-empty, non-global schedule_id always means per-class, never global.
    $explicit_is_global = isset($input['is_global']) && $input['is_global'] === true;
    $is_global = ($explicit_is_global && (empty($scheduleId) || $scheduleId === 'global'))
                 || $scheduleId === 'global'
                 || empty($scheduleId);

    if ($is_global) {
        $is_auth = dent2025_check_rbac_permission($password, 'global_events');
    } else {
        $specialty = $input['specialty'] ?? null;
        $year = isset($input['year']) ? intval($input['year']) : null;
        $semester = isset($input['semester']) ? intval($input['semester']) : null;

        if ($specialty === null || $year === null || $semester === null) {
            if (preg_match('/^([a-zA-Z-]+)_(?:y)?(\d+)_(?:s)?(\d+)$/', $scheduleId, $m)) {
                $code = strtolower($m[1]);
                if ($code === 'dent' || $code === 'dentistry') $specialty = 'dentistry';
                elseif ($code === 'med' || $code === 'medicine') $specialty = 'medicine';
                elseif ($code === 'pre' || $code === 'pre-med') $specialty = 'pre-med';
                else $specialty = $m[1];

                $year = intval($m[2]);
                $semester = intval($m[3]);
            }
        }

        $is_auth = dent2025_check_rbac_permission($password, 'semester_events', $specialty, $year, $semester) ||
                   dent2025_check_rbac_permission($password, 'global_events');
    }

    if (!$is_auth) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
}

// 2. POST: Add or Edit an event
if ($method === 'POST') {
    $data = file_exists($dataFile) ? json_decode(file_get_contents($dataFile), true) : [];
    if (!is_array($data)) $data = [];

    $id = $input['id'] ?? uniqid('evt_');
    $action = $input['action'] ?? 'add'; // 'add', 'edit', or 'delete'

    if ($action === 'delete') {
        $deleteId = $input['id'] ?? '';
        $deleted = false;
        if ($deleteId) {
            if (file_exists($dataFile)) {
                $data = json_decode(file_get_contents($dataFile), true) ?: [];
                $origCount = count($data);
                $data = array_values(array_filter($data, function($ev) use ($deleteId) {
                    return ($ev['id'] ?? '') !== $deleteId;
                }));
                if (count($data) < $origCount) {
                    file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
                    $deleted = true;
                }
            }

            if (!$deleted && $dataFile !== $globalFile && file_exists($globalFile)) {
                if (dent2025_check_rbac_permission($password, 'global_events')) {
                    $gData = json_decode(file_get_contents($globalFile), true) ?: [];
                    $origCount = count($gData);
                    $gData = array_values(array_filter($gData, function($ev) use ($deleteId) {
                        return ($ev['id'] ?? '') !== $deleteId;
                    }));
                    if (count($gData) < $origCount) {
                        file_put_contents($globalFile, json_encode($gData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
                        $deleted = true;
                    }
                }
            }
        }
        
        $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
        if (function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('events', 'delete', 'حذف حدث من التقويم ID: ' . $deleteId, $pass_info['label'] ?? '');
        }

        echo json_encode(['success' => true, 'message' => 'Event deleted!']);
        exit;
    }

    $newEvent = [
        'id' => $id,
        'date' => $input['date'] ?? '',
        'end_date' => $input['end_date'] ?? null,
        'hijri' => $input['hijri'] ?? '',
        'title' => $input['title'] ?? '',
        'type' => $input['type'] ?? 'other',
        'schedule_id' => $is_global ? 'global' : ($scheduleId ?: 'global'),
        'is_global' => $is_global,
        'specialty' => $is_global ? null : ($input['specialty'] ?? null),
        'year' => $is_global ? null : (isset($input['year']) ? intval($input['year']) : null),
        'semester' => $is_global ? null : (isset($input['semester']) ? intval($input['semester']) : null)
    ];

    if ($action === 'edit') {
        foreach ($data as $key => $ev) {
            if ($ev['id'] === $id) {
                $data[$key] = $newEvent;
                break;
            }
        }
    } else {
        $data[] = $newEvent;
    }

    file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        $act_label = ($action === 'edit') ? 'تعديل حدث بالتقويم: ' : 'إضافة حدث جديد بالتقويم: ';
        dent2025_record_audit_event('events', $action === 'edit' ? 'edit' : 'add', $act_label . ($input['title'] ?? ''), $pass_info['label'] ?? '');
    }
    echo json_encode(['success' => true, 'message' => 'Event saved!']);
    exit;
}

// 3. DELETE: Remove an event
if ($method === 'DELETE') {
    $id = $input['id'] ?? '';
    $deleted = false;
    if ($id) {
        if (file_exists($dataFile)) {
            $data = json_decode(file_get_contents($dataFile), true) ?: [];
            $origCount = count($data);
            $data = array_values(array_filter($data, function($ev) use ($id) {
                return ($ev['id'] ?? '') !== $id;
            }));
            if (count($data) < $origCount) {
                file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
                $deleted = true;
            }
        }

        if (!$deleted && $dataFile !== $globalFile && file_exists($globalFile)) {
            if (dent2025_check_rbac_permission($password, 'global_events')) {
                $gData = json_decode(file_get_contents($globalFile), true) ?: [];
                $origCount = count($gData);
                $gData = array_values(array_filter($gData, function($ev) use ($id) {
                    return ($ev['id'] ?? '') !== $id;
                }));
                if (count($gData) < $origCount) {
                    file_put_contents($globalFile, json_encode($gData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
                    $deleted = true;
                }
            }
        }
    }
    
    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('events', 'delete', 'حذف حدث من التقويم ID: ' . $id, $pass_info['label'] ?? '');
    }

    echo json_encode(['success' => true, 'message' => 'Event deleted!']);
    exit;
}
?>

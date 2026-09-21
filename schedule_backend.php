<?php
// schedule_backend.php
// New backend for the semester timeline schedule.
require_once __DIR__ . '/dent2025_rbac.php';
require_once __DIR__ . '/history_helpers.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$has_auth = !empty($_GET['password']) || !empty($_POST['password']);
$is_nocache = !empty($_GET['nocache']) || !empty($_GET['_t']);

if ($method === 'GET' && !$has_auth && !$is_nocache) {
    header('Cache-Control: public, max-age=60, stale-while-revalidate=120');
} else {
    if (!defined('LSCACHE_NO_CACHE')) {
        define('LSCACHE_NO_CACHE', true);
    }
    header('Cache-Control: no-cache, no-store, must-revalidate, max-age=0');
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ['https://dent2025.com', 'https://www.dent2025.com'], true) || (strpos($origin, 'localhost') !== false)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    header('Access-Control-Allow-Origin: https://dent2025.com');
}

header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Helper function to parse cohort context from a schedule ID
if (!function_exists('dent2025_parse_schedule_id')) {
    function dent2025_parse_schedule_id($id) {
        if (preg_match('/^([a-zA-Z-]+)_(?:y)?(\d+)_(?:s)?(\d+)$/', (string)$id, $m)) {
            $code = strtolower($m[1]);
            $specialty = match($code) {
                'dent', 'dentistry' => 'dentistry',
                'med', 'medicine' => 'medicine',
                'pre', 'pre-med' => 'pre-med',
                default => $m[1]
            };
            return [
                'specialty' => $specialty,
                'year' => intval($m[2]),
                'semester' => intval($m[3])
            ];
        }
        return null;
    }
}

$globalFile = __DIR__ . '/schedule_events.json';

// Get schedule_id (from GET or POST)
$scheduleId = '';
if ($method === 'GET') {
    $scheduleId = $_GET['schedule_id'] ?? '';
    // If empty or legacy 'global', default to primary cohort: dentistry_y3_s1
    if (empty($scheduleId) || $scheduleId === 'global') {
        $scheduleId = 'dentistry_y3_s1';
    }
} else {
    // For POST/DELETE, it will be in the JSON body
    $inputRaw = file_get_contents('php://input');
    $input = json_decode($inputRaw, true) ?: [];
    $scheduleId = $input['schedule_id'] ?? '';
}

// Clean schedule ID to prevent directory traversal
$scheduleId = preg_replace('/[^a-zA-Z0-9_-]/', '', $scheduleId);

$dataFile = $globalFile;
if (!empty($scheduleId) && $scheduleId !== 'global' && $scheduleId !== 'global_only') {
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
                $parsed = dent2025_parse_schedule_id($subScheduleId);
                $specialty = $parsed['specialty'] ?? null;
                $year = $parsed['year'] ?? null;
                $semester = $parsed['semester'] ?? null;

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
                $parsed = dent2025_parse_schedule_id($scheduleId);
                $specialty = $parsed['specialty'] ?? null;
                $year = $parsed['year'] ?? null;
                $semester = $parsed['semester'] ?? null;

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
        $dataFile = $globalFile;
        $is_auth = dent2025_check_rbac_permission($password, 'global_events');
    } else {
        $specialty = $input['specialty'] ?? null;
        $year = isset($input['year']) ? intval($input['year']) : null;
        $semester = isset($input['semester']) ? intval($input['semester']) : null;

        if ($specialty === null || $year === null || $semester === null) {
            $parsed = dent2025_parse_schedule_id($scheduleId);
            if ($parsed) {
                $specialty = $parsed['specialty'];
                $year = $parsed['year'];
                $semester = $parsed['semester'];
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

    $title = trim($input['title'] ?? '');
    $date = trim($input['date'] ?? '');
    $endDate = !empty($input['end_date']) ? trim($input['end_date']) : null;
    $hijri = trim($input['hijri'] ?? '');
    $type = !empty($input['type']) ? trim($input['type']) : 'other';
    $typeLabel = !empty($input['type_label']) ? trim($input['type_label']) : null;

    if (empty($title) || empty($date)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'العنوان وتاريخ البداية مطلوبان (Title and start date are required)']);
        exit;
    }

    if ($action === 'edit') {
        $editId = trim($input['id'] ?? '');
        if (empty($editId)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'معرّف الحدث مطلوب (Event ID is required)']);
            exit;
        }

        $found = false;
        $targetFileToSave = $dataFile;

        if (file_exists($dataFile)) {
            $data = json_decode(file_get_contents($dataFile), true) ?: [];
            foreach ($data as $key => $ev) {
                if (($ev['id'] ?? '') === $editId) {
                    $evIsGlobal = !empty($ev['is_global']) || ($dataFile === $globalFile);
                    $updatedEvent = [
                        'id' => $editId,
                        'date' => $date,
                        'hijri' => $hijri,
                        'title' => $title,
                        'type' => $type
                    ];
                    if ($typeLabel !== null) {
                        $updatedEvent['type_label'] = $typeLabel;
                    } elseif (isset($ev['type_label'])) {
                        $updatedEvent['type_label'] = $ev['type_label'];
                    }
                    if ($endDate !== null) {
                        $updatedEvent['end_date'] = $endDate;
                    }
                    if (!$evIsGlobal) {
                        $updatedEvent['schedule_id'] = $ev['schedule_id'] ?? ($scheduleId ?: 'global');
                        $updatedEvent['is_global'] = false;
                        $updatedEvent['specialty'] = $ev['specialty'] ?? ($specialty ?? ($input['specialty'] ?? null));
                        $updatedEvent['year'] = $ev['year'] ?? (isset($year) ? $year : (isset($input['year']) ? intval($input['year']) : null));
                        $updatedEvent['semester'] = $ev['semester'] ?? (isset($semester) ? $semester : (isset($input['semester']) ? intval($input['semester']) : null));
                    } else {
                        $updatedEvent['schedule_id'] = 'global';
                        $updatedEvent['is_global'] = true;
                    }
                    $data[$key] = $updatedEvent;
                    $found = true;
                    break;
                }
            }
            if ($found) {
                file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
            }
        }

        // Fallback: If not found in dataFile and dataFile is not globalFile, check globalFile
        if (!$found && $dataFile !== $globalFile && file_exists($globalFile)) {
            if (dent2025_check_rbac_permission($password, 'global_events')) {
                $gData = json_decode(file_get_contents($globalFile), true) ?: [];
                foreach ($gData as $key => $ev) {
                    if (($ev['id'] ?? '') === $editId) {
                        $updatedEvent = [
                            'id' => $editId,
                            'date' => $date,
                            'hijri' => $hijri,
                            'title' => $title,
                            'type' => $type
                        ];
                        if ($typeLabel !== null) {
                            $updatedEvent['type_label'] = $typeLabel;
                        } elseif (isset($ev['type_label'])) {
                            $updatedEvent['type_label'] = $ev['type_label'];
                        }
                        if ($endDate !== null) {
                            $updatedEvent['end_date'] = $endDate;
                        }
                        $gData[$key] = $updatedEvent;
                        $found = true;
                        break;
                    }
                }
                if ($found) {
                    file_put_contents($globalFile, json_encode($gData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
                }
            }
        }

        if (!$found) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'الحدث غير موجود (Event not found)']);
            exit;
        }

        $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
        if (function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('events', 'edit', 'تعديل حدث بالتقويم: ' . $title, $pass_info['label'] ?? '');
        }
        echo json_encode(['success' => true, 'message' => 'تم تعديل الحدث بنجاح!']);
        exit;
    }

    $newEvent = [
        'id' => $id,
        'date' => $date,
        'hijri' => $hijri,
        'title' => $title,
        'type' => $type,
        'schedule_id' => $is_global ? 'global' : ($scheduleId ?: 'global'),
        'is_global' => $is_global
    ];
    if ($typeLabel !== null) {
        $newEvent['type_label'] = $typeLabel;
    }
    if ($endDate !== null) {
        $newEvent['end_date'] = $endDate;
    }
    if (!$is_global) {
        $newEvent['specialty'] = $specialty ?? ($input['specialty'] ?? null);
        $newEvent['year'] = isset($year) ? $year : (isset($input['year']) ? intval($input['year']) : null);
        $newEvent['semester'] = isset($semester) ? $semester : (isset($input['semester']) ? intval($input['semester']) : null);
    }

    $data[] = $newEvent;

    file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    $pass_info = function_exists('dent2025_get_passkey_info') ? dent2025_get_passkey_info($password) : null;
    if (function_exists('dent2025_record_audit_event')) {
        dent2025_record_audit_event('events', 'add', 'إضافة حدث جديد بالتقويم: ' . $title, $pass_info['label'] ?? '');
    }
    echo json_encode(['success' => true, 'message' => 'تمت إضافة الحدث بنجاح!']);
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

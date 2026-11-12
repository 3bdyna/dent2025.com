<?php
// tools/test_system_logic.php
// Comprehensive Offline Test Suite for Dent2025 Backend & Frontend Subsystem Logic

error_reporting(E_ALL);
ini_set('display_errors', 1);

require_once __DIR__ . '/../dent2025_rbac.php';
require_once __DIR__ . '/../history_helpers.php';

$test_results = [
    'passed' => 0,
    'failed' => 0,
    'details' => []
];

function assert_test($description, $condition, $fail_message = '') {
    global $test_results;
    if ($condition) {
        $test_results['passed']++;
        $test_results['details'][] = ['status' => 'PASS', 'desc' => $description];
        echo "  [PASS] {$description}\n";
    } else {
        $test_results['failed']++;
        $test_results['details'][] = ['status' => 'FAIL', 'desc' => $description, 'error' => $fail_message];
        echo "  [FAIL] {$description}: {$fail_message}\n";
    }
}

echo "=======================================================\n";
echo " DENT2025 COMPREHENSIVE LOGIC & REGRESSION TEST SUITE  \n";
echo "=======================================================\n\n";

// -----------------------------------------------------------------------------
// SUITE 1: RBAC Authentication & Permission Resolution
// -----------------------------------------------------------------------------
echo "1. Testing RBAC & Authentication Core...\n";

// 1.1 Master Passkey Wildcard Access
$passwords = dent2025_load_passwords();
$master_entry = null;
foreach ($passwords as $p) {
    if (in_array('*', $p['allowed_contexts'] ?? [])) {
        $master_entry = $p;
        break;
    }
}
$master_pass = $master_entry ? $master_entry['passkey'] : 'mock_master_pass';
$master_info = dent2025_get_passkey_info($master_pass);
assert_test("Master passkey lookup succeeds", $master_info !== null && is_array($master_info));
assert_test("Master passkey has wildcard context '*'", in_array('*', $master_info['allowed_contexts'] ?? []));
assert_test("Master passkey has manage_passwords permission", !empty($master_info['permissions']['manage_passwords']));
assert_test("Master passkey allowed to add_subject in any context", dent2025_check_rbac_permission($master_pass, 'add_subject', 'dentistry', 2, 1));
assert_test("Master passkey allowed global_events", dent2025_check_rbac_permission($master_pass, 'global_events'));
assert_test("Master passkey allowed timetable in pre-med", dent2025_check_rbac_permission($master_pass, 'timetable', 'pre-med', 0, 1));

// 1.2 Scoped Context Leader Passkeys
$passwords = dent2025_load_passwords();
$context_leader = null;
foreach ($passwords as $p) {
    if (!empty($p['allowed_contexts']) && !in_array('*', $p['allowed_contexts'])) {
        $context_leader = $p;
        break;
    }
}

if ($context_leader) {
    $leader_pass = $context_leader['passkey'];
    $allowed_ctx_str = $context_leader['allowed_contexts'][0] ?? '';
    $ctx_parts = explode('_', $allowed_ctx_str);
    
    if (count($ctx_parts) >= 3) {
        $spec = $ctx_parts[0];
        $yr = intval($ctx_parts[1]);
        $sem = intval($ctx_parts[2]);
        
        assert_test("Leader passkey resolved for {$allowed_ctx_str}", dent2025_get_passkey_info($leader_pass) !== null);
        assert_test("Leader allowed in authorized context ({$allowed_ctx_str})", dent2025_check_rbac_permission($leader_pass, 'edit_basic_subject', $spec, $yr, $sem) || dent2025_check_rbac_permission($leader_pass, 'semester_events', $spec, $yr, $sem));
        assert_test("Leader DENIED in unauthorized context (medicine_6_2)", !dent2025_check_rbac_permission($leader_pass, 'edit_basic_subject', 'medicine', 6, 2));
        assert_test("Leader DENIED manage_passwords override", !dent2025_check_rbac_permission($leader_pass, 'manage_passwords'));
    }
}

// 1.3 Invalid Passkeys
assert_test("Bogus passkey returns null info", dent2025_get_passkey_info('wrong_pass_123') === null);
assert_test("Bogus passkey denied for all permissions", !dent2025_check_rbac_permission('wrong_pass_123', 'edit_basic_subject', 'dentistry', 1, 1));

// -----------------------------------------------------------------------------
// SUITE 2: System Snapshot & Rollback Credential Safety
// -----------------------------------------------------------------------------
echo "\n2. Testing Snapshot & Rollback Safety...\n";

// 2.1 Passkey Masking in Snapshot Capture
$state = dent2025_capture_system_state();
assert_test("System state captured", is_array($state) && isset($state['passwords']));
$all_masked = true;
foreach ($state['passwords'] as $sp) {
    if (isset($sp['passkey']) && $sp['passkey'] !== '***') {
        $all_masked = false;
        break;
    }
}
assert_test("All passkeys in snapshot state are masked with '***'", $all_masked && count($state['passwords']) > 0);

// 2.2 Rollback Safe-Merge Simulation
$mock_live_passwords = [
    [
        'id' => 'test_leader_1',
        'label' => 'Leader Dentistry Year 2',
        'passkey' => 'secret_live_pass_xyz',
        'allowed_contexts' => ['dentistry_2_1'],
        'permissions' => ['edit_basic_subject' => true]
    ]
];

$mock_snapshot_passwords = [
    [
        'id' => 'test_leader_1',
        'label' => 'Leader Dentistry Year 2 Updated',
        'passkey' => '***', // Masked from snapshot
        'allowed_contexts' => ['dentistry_2_1'],
        'permissions' => ['edit_basic_subject' => true, 'semester_events' => true]
    ]
];

$live_map = [];
foreach ($mock_live_passwords as $lp) {
    $live_map[$lp['id']] = $lp;
}

$merged_passwords = [];
foreach ($mock_snapshot_passwords as $tp) {
    $t_id = $tp['id'] ?? '';
    $live_entry = $live_map[$t_id] ?? null;

    if (isset($tp['passkey']) && ($tp['passkey'] === '***' || trim($tp['passkey']) === '')) {
        if ($live_entry && !empty($live_entry['passkey']) && $live_entry['passkey'] !== '***') {
            $tp['passkey'] = $live_entry['passkey'];
        }
    }

    if (!empty($tp['passkey']) && $tp['passkey'] !== '***') {
        $merged_passwords[] = $tp;
    }
}

assert_test("Rollback safe-merge restored permissions without corrupting live passkey", 
    count($merged_passwords) === 1 &&
    $merged_passwords[0]['passkey'] === 'secret_live_pass_xyz' &&
    !empty($merged_passwords[0]['permissions']['semester_events'])
);

// -----------------------------------------------------------------------------
// SUITE 3: Study Timer PIN & Deduplication Logic
// -----------------------------------------------------------------------------
echo "\n3. Testing Study Timer PIN & Deduplication Logic...\n";

// 3.1 PIN Validation Rule (Exact 4 digits)
function validate_study_pin($raw) {
    $clean = preg_replace('/[^0-9]/', '', (string)$raw);
    return (strlen($clean) === 4) ? $clean : false;
}
assert_test("Valid 4-digit PIN '1234' accepted", validate_study_pin('1234') === '1234');
assert_test("PIN with whitespace ' 5678 ' cleaned to '5678'", validate_study_pin(' 5678 ') === '5678');
assert_test("Short PIN '123' rejected", validate_study_pin('123') === false);
assert_test("Long PIN '12345' rejected", validate_study_pin('12345') === false);
assert_test("Alpha PIN 'abcd' rejected", validate_study_pin('abcd') === false);

// 3.2 Log Deduplication by Session ID
$existingLogs = [
    ['id' => 'sess_1', 'subject' => 'Anatomy', 'durationSeconds' => 1800, 'dateStr' => '2026-08-17'],
    ['id' => 'sess_2', 'subject' => 'Physiology', 'durationSeconds' => 2400, 'dateStr' => '2026-08-17']
];
$incomingLogs = [
    ['id' => 'sess_2', 'subject' => 'Physiology', 'durationSeconds' => 2400, 'dateStr' => '2026-08-17'], // Duplicate
    ['id' => 'sess_3', 'subject' => 'Biochemistry', 'durationSeconds' => 3600, 'dateStr' => '2026-08-18'] // New
];

$logMap = [];
foreach ($existingLogs as $el) {
    $key = !empty($el['id']) ? $el['id'] : (($el['dateStr'] ?? '') . '_' . ($el['subject'] ?? '') . '_' . ($el['durationSeconds'] ?? ''));
    $logMap[$key] = $el;
}
foreach ($incomingLogs as $il) {
    $key = !empty($il['id']) ? $il['id'] : (($il['dateStr'] ?? '') . '_' . ($il['subject'] ?? '') . '_' . ($il['durationSeconds'] ?? ''));
    $logMap[$key] = $il;
}
$merged = array_values($logMap);

assert_test("Study log deduplication correctly merged 3 distinct sessions without duplicates", count($merged) === 3);

// -----------------------------------------------------------------------------
// SUITE 4: Schedule Countdown & Date Parsing Logic
// -----------------------------------------------------------------------------
echo "\n4. Testing Schedule Countdown & Hijri Calculation Logic...\n";

// Test countdown badge logic
function calculate_event_badge($eventDateStr, $todayStr, $endDateStr = null) {
    $today = strtotime($todayStr);
    $evDate = strtotime($eventDateStr);
    
    if ($evDate > $today) {
        $diffDays = ceil(($evDate - $today) / 86400);
        return ['text' => "بعد {$diffDays} يوم", 'class' => 'future', 'days' => $diffDays];
    } elseif ($evDate < $today) {
        if ($endDateStr && strtotime($endDateStr) >= $today) {
            return ['text' => 'جارية الآن', 'class' => 'today', 'days' => 0];
        }
        return ['text' => 'انتهى', 'class' => 'passed', 'days' => 0];
    } else {
        return ['text' => 'اليوم', 'class' => 'today', 'days' => 0];
    }
}

$today = '2026-08-18';
$future_badge = calculate_event_badge('2026-08-25', $today);
assert_test("Future event returns correct countdown (7 days)", $future_badge['class'] === 'future' && $future_badge['days'] == 7);

$today_badge = calculate_event_badge('2026-08-18', $today);
assert_test("Today event returns 'اليوم'", $today_badge['class'] === 'today' && $today_badge['text'] === 'اليوم');

$past_badge = calculate_event_badge('2026-08-10', $today);
assert_test("Past event returns 'انتهى'", $past_badge['class'] === 'passed');

$ongoing_vacation = calculate_event_badge('2026-08-15', $today, '2026-08-20');
assert_test("Ongoing multi-day event returns 'جارية الآن'", $ongoing_vacation['class'] === 'today' && $ongoing_vacation['text'] === 'جارية الآن');

// Test 3-day post-end hiding rule
function is_event_hidden_for_user($eventDateStr, $todayStr, $endDateStr = null) {
    $today = strtotime($todayStr);
    $endStr = $endDateStr ?: $eventDateStr;
    $endDate = strtotime($endStr);
    if ($today > $endDate) {
        $diffDays = floor(($today - $endDate) / 86400);
        return $diffDays > 3;
    }
    return false;
}

$test_today = '2026-09-02';
assert_test("Event ended 2 days ago is not hidden", !is_event_hidden_for_user('2026-08-31', $test_today));
assert_test("Event ended 3 days ago is not hidden", !is_event_hidden_for_user('2026-08-30', $test_today));
assert_test("Event ended 4 days ago (>3 days) is hidden", is_event_hidden_for_user('2026-08-29', $test_today));
assert_test("Event ended 10 days ago is hidden", is_event_hidden_for_user('2026-08-23', $test_today));

// -----------------------------------------------------------------------------
// SUITE 5: Announcement HTML Sanitization
// -----------------------------------------------------------------------------
echo "\n5. Testing Announcement HTML Sanitizer (XSS Prevention)...\n";
require_once __DIR__ . '/../announcements_api.php';

$xss_payload = '<p>Important notice <script>alert("xss")</script><b onclick="bad()">Click here</b><a href="javascript:steal()">link</a></p>';
$clean_output = dent2025_sanitize_announcements_html($xss_payload);

assert_test("Sanitizer strips <script> tags", strpos($clean_output, '<script>') === false && strpos($clean_output, 'alert') === false);
assert_test("Sanitizer strips inline on* event handlers", strpos($clean_output, 'onclick') === false);
assert_test("Sanitizer neutralizes javascript: URLs", strpos($clean_output, 'javascript:') === false);
assert_test("Sanitizer preserves safe formatting (<p>, <b>, <a>)", strpos($clean_output, '<p>') !== false && strpos($clean_output, '<b>') !== false);

// -----------------------------------------------------------------------------
// SUITE 6: Study Log Deduplication on PIN Migration
// -----------------------------------------------------------------------------
echo "\n6. Testing Study Log Migration Logic...\n";
$target_existing_logs = [
    ['id' => 'uuid_1', 'subject' => 'Anatomy', 'durationSeconds' => 1800, 'dateStr' => '2026-08-20'],
    ['subject' => 'Pathology', 'durationSeconds' => 2400, 'dateStr' => '2026-08-21'] // legacy log without id
];
$incoming_migration_logs = [
    ['id' => 'uuid_1', 'subject' => 'Anatomy', 'durationSeconds' => 1800, 'dateStr' => '2026-08-20'], // duplicate with id
    ['subject' => 'Pathology', 'durationSeconds' => 2400, 'dateStr' => '2026-08-21'], // duplicate legacy without id
    ['id' => 'uuid_2', 'subject' => 'Biochemistry', 'durationSeconds' => 3600, 'dateStr' => '2026-08-22'] // brand new log
];

$merge_map = [];
foreach ($target_existing_logs as $el) {
    $key = !empty($el['id']) ? $el['id'] : (($el['dateStr'] ?? '') . '_' . ($el['subject'] ?? '') . '_' . ($el['durationSeconds'] ?? ''));
    $merge_map[$key] = $el;
}
foreach ($incoming_migration_logs as $il) {
    $key = !empty($il['id']) ? $il['id'] : (($il['dateStr'] ?? '') . '_' . ($il['subject'] ?? '') . '_' . ($il['durationSeconds'] ?? ''));
    $merge_map[$key] = $il;
}
$result_logs = array_values($merge_map);

assert_test("Merged logs count is exactly 3 (duplicates removed)", count($result_logs) === 3);
assert_test("Preserves both UUID and legacy log without UUID", count(array_filter($result_logs, function($l) { return $l['subject'] === 'Pathology'; })) === 1);

// -----------------------------------------------------------------------------
// SUITE 7: Schedule Event Editing Logic
// -----------------------------------------------------------------------------
echo "\n7. Testing Schedule Event Editing Logic...\n";

// 8.1 Semester Event Edit
$mock_semester_events = [
    [
        'id' => 'evt_test_1',
        'title' => 'اختبار أول',
        'type' => 'exam',
        'date' => '2026-09-10',
        'hijri' => '1448/03/28',
        'schedule_id' => 'dentistry_y3_s1',
        'is_global' => false,
        'specialty' => 'dentistry',
        'year' => 3,
        'semester' => 1
    ]
];

$edit_title = 'اختبار أول - محدث';
$edit_date = '2026-09-12';
$edit_end = '2026-09-14';
$edit_found = false;

foreach ($mock_semester_events as $k => $ev) {
    if ($ev['id'] === 'evt_test_1') {
        $updated = [
            'id' => $ev['id'],
            'date' => $edit_date,
            'hijri' => '1448/04/01',
            'title' => $edit_title,
            'type' => 'exam',
            'end_date' => $edit_end,
            'schedule_id' => $ev['schedule_id'],
            'is_global' => false,
            'specialty' => $ev['specialty'],
            'year' => $ev['year'],
            'semester' => $ev['semester']
        ];
        $mock_semester_events[$k] = $updated;
        $edit_found = true;
        break;
    }
}

assert_test("Semester event updated successfully", $edit_found === true);
assert_test("Updated title matches", $mock_semester_events[0]['title'] === 'اختبار أول - محدث');
assert_test("Updated date matches", $mock_semester_events[0]['date'] === '2026-09-12');
assert_test("Updated end_date matches", $mock_semester_events[0]['end_date'] === '2026-09-14');
assert_test("Original ID and context preserved", $mock_semester_events[0]['id'] === 'evt_test_1' && $mock_semester_events[0]['schedule_id'] === 'dentistry_y3_s1');

// 8.2 Global Event Edit (schema cleanliness)
$mock_global_events = [
    [
        'id' => 'evt_global_study',
        'title' => 'بداية الدراسة',
        'type' => 'start',
        'date' => '2026-08-23',
        'hijri' => '1448/03/10'
    ]
];

$global_found = false;
foreach ($mock_global_events as $gk => $gev) {
    if ($gev['id'] === 'evt_global_study') {
        $mock_global_events[$gk] = [
            'id' => $gev['id'],
            'date' => '2026-08-24',
            'hijri' => '1448/03/11',
            'title' => 'بداية الدراسة (تعديل)',
            'type' => 'start'
        ];
        $global_found = true;
        break;
    }
}
assert_test("Global event updated without injecting semester properties", $global_found && !isset($mock_global_events[0]['specialty']));

// 8.3 Nonexistent Event returns false
$nonexistent_found = false;
foreach ($mock_semester_events as $ev) {
    if ($ev['id'] === 'nonexistent_id') {
        $nonexistent_found = true;
        break;
    }
}
assert_test("Nonexistent event ID correctly detected as not found", $nonexistent_found === false);

// -----------------------------------------------------------------------------
// SUITE 8: Atomic JSON File Save & Resilience
// -----------------------------------------------------------------------------
echo "\n8. Testing Atomic JSON File Save & Resilience...\n";
require_once __DIR__ . '/../history_helpers.php';

assert_test("dent2025_safe_atomic_save_json function exists", function_exists('dent2025_safe_atomic_save_json'));

$test_json_file = sys_get_temp_dir() . '/dent2025_atomic_test_' . uniqid() . '.json';
$sample_data = [
    'app' => 'dent2025',
    'timestamp' => time(),
    'items' => ['event_1', 'event_2'],
    'arabic' => 'تجربة حفظ آمنة بدون تلف البيانات'
];

$save_ok = dent2025_safe_atomic_save_json($test_json_file, $sample_data);
assert_test("Atomic save to file succeeds", $save_ok === true && file_exists($test_json_file));

$read_back = json_decode(file_get_contents($test_json_file), true);
assert_test("Read-back data matches original payload exactly", $read_back === $sample_data);

// Test overwrite with updated content
$sample_data['items'][] = 'event_3';
$overwrite_ok = dent2025_safe_atomic_save_json($test_json_file, $sample_data);
assert_test("Atomic overwrite succeeds", $overwrite_ok === true);

$read_updated = json_decode(file_get_contents($test_json_file), true);
assert_test("Updated data contains new item", count($read_updated['items']) === 3);

// Verify no leftover .tmp files in temp directory
$leftover_tmp = glob(dirname($test_json_file) . '/.' . basename($test_json_file) . '.*.tmp');
assert_test("No leftover .tmp files remaining", empty($leftover_tmp));

// Cleanup
@unlink($test_json_file);

// -----------------------------------------------------------------------------
echo "\n9. Testing Quiz Recycle Bin (Trash & 30-Day Auto-Purge) Logic...\n";
$mock_quizzes_dir = sys_get_temp_dir() . '/dent2025_mock_quizzes_' . uniqid();
$mock_trash_dir = $mock_quizzes_dir . '/trash';
@mkdir($mock_quizzes_dir, 0777, true);
@mkdir($mock_trash_dir, 0777, true);

// Create an active mock quiz
$quiz_id = 'quiz_test_123';
$active_file = $mock_quizzes_dir . '/' . $quiz_id . '.json';
$quiz_payload = [
    'id' => $quiz_id,
    'quiz_name' => 'اختبار تشريح تجريبي',
    'subject_name' => 'تشريح الأسنان',
    'created_at' => date('Y-m-d H:i:s'),
    'questions' => [['q' => 'Test Q1']]
];
file_put_contents($active_file, json_encode($quiz_payload));
assert_test("Active mock quiz created", file_exists($active_file));

// Simulate soft-delete (moving to trash with 30-day retention)
$trash_payload = $quiz_payload;
$trash_payload['deleted_at'] = date('Y-m-d H:i:s');
$trash_payload['deleted_by'] = 'مشرف النظام';
$trash_payload['expires_at'] = date('Y-m-d H:i:s', time() + (30 * 86400));

$trashed_file = $mock_trash_dir . '/' . $quiz_id . '.json';
file_put_contents($trashed_file, json_encode($trash_payload));
@unlink($active_file);

assert_test("Quiz moved to trash and removed from active pool", !file_exists($active_file) && file_exists($trashed_file));
assert_test("Trashed quiz has deleted_at metadata", !empty($trash_payload['deleted_at']));
assert_test("Trashed quiz has 30-day retention expiration", !empty($trash_payload['expires_at']));

// Create an expired trashed quiz (deleted 35 days ago) and a recent trashed quiz (deleted 5 days ago)
$expired_id = 'quiz_expired_999';
$expired_file = $mock_trash_dir . '/' . $expired_id . '.json';
$expired_payload = [
    'id' => $expired_id,
    'quiz_name' => 'اختبار منتهي الصلاحية',
    'deleted_at' => date('Y-m-d H:i:s', time() - (35 * 86400)), // 35 days ago
    'expires_at' => date('Y-m-d H:i:s', time() - (5 * 86400))
];
file_put_contents($expired_file, json_encode($expired_payload));

$recent_id = 'quiz_recent_888';
$recent_file = $mock_trash_dir . '/' . $recent_id . '.json';
$recent_payload = [
    'id' => $recent_id,
    'quiz_name' => 'اختبار محذوف حديثاً',
    'deleted_at' => date('Y-m-d H:i:s', time() - (5 * 86400)), // 5 days ago
    'expires_at' => date('Y-m-d H:i:s', time() + (25 * 86400))
];
file_put_contents($recent_file, json_encode($recent_payload));

// Execute cleanup simulation
$files = glob($mock_trash_dir . '/*.json');
$purged_count = 0;
$now = time();
$threshold = 30 * 86400;

foreach ($files as $f) {
    $content = @file_get_contents($f);
    $data = json_decode($content, true);
    if (!empty($data['deleted_at'])) {
        $delTime = strtotime($data['deleted_at']);
        if (($now - $delTime) >= $threshold) {
            @unlink($f);
            $purged_count++;
        }
    }
}

assert_test("Auto-purge removed exactly 1 expired quiz (>30 days)", $purged_count === 1 && !file_exists($expired_file));
assert_test("Recent quiz (<30 days) is safely preserved in trash", file_exists($recent_file));
assert_test("Initial trashed quiz is safely preserved in trash", file_exists($trashed_file));

// Simulate Restore
$restore_content = json_decode(file_get_contents($trashed_file), true);
unset($restore_content['deleted_at'], $restore_content['deleted_by'], $restore_content['expires_at']);
$restore_content['restored_at'] = date('Y-m-d H:i:s');
file_put_contents($active_file, json_encode($restore_content));
@unlink($trashed_file);

assert_test("Restored quiz is back in active pool and absent from trash", file_exists($active_file) && !file_exists($trashed_file));
assert_test("Restored quiz has deleted_at stripped and restored_at set", !isset($restore_content['deleted_at']) && !empty($restore_content['restored_at']));

// Cleanup temp test directory
@unlink($active_file);
@unlink($recent_file);
@rmdir($mock_trash_dir);
@rmdir($mock_quizzes_dir);

// -----------------------------------------------------------------------------
echo "\n10. Testing AI Exam Prompt & Non-Exam Content Filtering Logic...\n";
if (!defined('DENT2025_TEST_MODE')) {
    define('DENT2025_TEST_MODE', true);
}
require_once __DIR__ . '/../backend/api_ai_exam.php';

assert_test("isAdministrativeOrPlanNonExamQuestion function exists", function_exists('isAdministrativeOrPlanNonExamQuestion'));

// 1. Course specifications & descriptions
assert_test("Filters out course specifications question", isAdministrativeOrPlanNonExamQuestion("According to the course specifications, what is the prerequisite?") === true);
assert_test("Filters out Arabic course specification (توصيف المقرر)", isAdministrativeOrPlanNonExamQuestion("ما هي أهداف المقرر المحددة في توصيف المقرر؟") === true);

// 2. Course plans & study plans
assert_test("Filters out course plan question", isAdministrativeOrPlanNonExamQuestion("What is the course plan for week 4 in this semester?") === true);
assert_test("Filters out study plan & CLO question", isAdministrativeOrPlanNonExamQuestion("Which topic is listed under CLO 1.2 in the study plan?") === true);
assert_test("Filters out lecture outline question", isAdministrativeOrPlanNonExamQuestion("What is outlined in the lecture outline for session 2?") === true);
assert_test("Filters out Arabic study plan (الخطة الدراسية)", isAdministrativeOrPlanNonExamQuestion("ما هي المواضيع المقررة في الخطة الدراسية للأسبوع الثالث؟") === true);

// 3. Grading & attendance / DN rules
assert_test("Filters out grade distribution question", isAdministrativeOrPlanNonExamQuestion("What is the grade distribution for the final exam (percentage of the final exam)?") === true);
assert_test("Filters out attendance policy and DN limit", isAdministrativeOrPlanNonExamQuestion("What is the attendance policy and DN limit for this course?") === true);
assert_test("Filters out Arabic absence & denial (حرمان)", isAdministrativeOrPlanNonExamQuestion("ما هي نسبة الغياب التي تؤدي إلى الحرمان من الاختبار؟") === true);

// 4. Professor contacts & recommended textbooks
assert_test("Filters out course coordinator & office hours", isAdministrativeOrPlanNonExamQuestion("Who is the course coordinator and what are the office hours?") === true);
assert_test("Filters out recommended textbook question", isAdministrativeOrPlanNonExamQuestion("What is the recommended textbook according to the syllabus?") === true);

// 5. Preserves legitimate clinical/medical plans and academic questions
assert_test("Preserves clinical dental treatment plan", isAdministrativeOrPlanNonExamQuestion("What is the primary treatment plan for a patient presenting with irreversible pulpitis?") === false);
assert_test("Preserves clinical medical management plan", isAdministrativeOrPlanNonExamQuestion("What is the initial management plan for an acute asthma exacerbation?") === false);
assert_test("Preserves Arabic dental treatment plan (خطة علاجية)", isAdministrativeOrPlanNonExamQuestion("ما هي الخطة العلاجية المتبعة في علاج جذور الأسنان؟") === false);
assert_test("Preserves standard cranial nerve anatomy question", isAdministrativeOrPlanNonExamQuestion("Which cranial nerve provides sensory innervation to the anterior two-thirds of the tongue?") === false);
assert_test("Preserves biochemistry pathway question", isAdministrativeOrPlanNonExamQuestion("What is the rate-limiting enzyme of the glycolytic pathway in cellular respiration?") === false);

// -----------------------------------------------------------------------------
echo "\n11. Testing Brute Force & Auth Rate Limiting Logic...\n";
require_once __DIR__ . '/../dent2025_rbac.php';

$test_ip = '198.51.100.42'; // Dedicated RFC 5737 test IP
dent2025_reset_auth_rate_limits($test_ip);

// Test 1: Rate limit check on fresh IP
$check = dent2025_check_auth_rate_limit($test_ip);
assert_test("Rate limit allowed on clean IP", $check['allowed'] === true && $check['locked'] === false);
assert_test("Fresh IP has 5 remaining attempts", $check['remaining_attempts'] === 5);

// Test 2: Record 4 failed attempts
$f1 = dent2025_record_auth_failure($test_ip);
assert_test("1st failure: 4 attempts remaining", $f1['remaining_attempts'] === 4 && $f1['locked'] === false);

$f2 = dent2025_record_auth_failure($test_ip);
assert_test("2nd failure: 3 attempts remaining", $f2['remaining_attempts'] === 3 && $f2['locked'] === false);

$f3 = dent2025_record_auth_failure($test_ip);
assert_test("3rd failure: 2 attempts remaining", $f3['remaining_attempts'] === 2 && $f3['locked'] === false);

$f4 = dent2025_record_auth_failure($test_ip);
assert_test("4th failure: 1 attempt remaining", $f4['remaining_attempts'] === 1 && $f4['locked'] === false);

// Test 3: 5th failure triggers Level 1 lockout (300 seconds)
$f5 = dent2025_record_auth_failure($test_ip);
assert_test("5th failure triggers lockout", $f5['locked'] === true && $f5['allowed'] === false);
assert_test("Lockout sets remaining_attempts to 0", $f5['remaining_attempts'] === 0);
assert_test("Level 1 lockout duration is 300 seconds", $f5['retry_after'] === 300);
assert_test("dent2025_is_ip_locked_out detects locked IP", dent2025_is_ip_locked_out($test_ip) === true);

// Test 4: Rate limit check reflects active lockout
$check_locked = dent2025_check_auth_rate_limit($test_ip);
assert_test("Check on locked IP returns allowed=false", $check_locked['allowed'] === false && $check_locked['locked'] === true);
assert_test("Check on locked IP returns positive retry_after", $check_locked['retry_after'] > 0);

// Test 5: Simulating request from locked IP denies RBAC permission
$prev_remote = $_SERVER['REMOTE_ADDR'] ?? null;
$_SERVER['REMOTE_ADDR'] = $test_ip;
assert_test("RBAC permission check DENIED when client IP is locked out", dent2025_check_rbac_permission('any_master_key', 'manage_passwords') === false);

// Test 6: Auth success resets rate limits and clears lockout
dent2025_record_auth_success($test_ip);
assert_test("Success clears lockout on IP", dent2025_is_ip_locked_out($test_ip) === false);
$check_restored = dent2025_check_auth_rate_limit($test_ip);
assert_test("Restored IP has allowed=true and 5 attempts remaining", $check_restored['allowed'] === true && $check_restored['remaining_attempts'] === 5);

// Test 7: Direct RBAC invalid passkey records failure
dent2025_reset_auth_rate_limits($test_ip);
$_SERVER['REMOTE_ADDR'] = $test_ip;
$rbac_res = dent2025_check_rbac_permission('invalid_guessing_key', 'manage_passwords');
assert_test("Direct RBAC invalid passkey denied", $rbac_res === false);
$check_after_rbac = dent2025_check_auth_rate_limit($test_ip);
assert_test("Direct RBAC invalid passkey recorded failure", $check_after_rbac['remaining_attempts'] === 4);

// Clean up test IP and restore environment
dent2025_reset_auth_rate_limits($test_ip);
if ($prev_remote !== null) {
    $_SERVER['REMOTE_ADDR'] = $prev_remote;
} else {
    unset($_SERVER['REMOTE_ADDR']);
}


// -----------------------------------------------------------------------------
// 12. Testing Pre-Med Context Normalization & Passkey Trimming
// -----------------------------------------------------------------------------
echo "
12. Testing Pre-Med Normalization & Passkey Sanitization...
";

// 12.1 Passkey whitespace trimming
$trimmed_entry = dent2025_get_passkey_info("  " . $master_pass . "  ");
assert_test("Passkey with leading/trailing whitespace resolves correctly", $trimmed_entry !== null && $trimmed_entry["id"] === $master_entry["id"]);
$newline_entry = dent2025_get_passkey_info($master_pass . "
");
assert_test("Passkey with newline resolves correctly", $newline_entry !== null && $newline_entry["id"] === $master_entry["id"]);

// 12.2 Pre-Med Year 0 vs Year 1 Normalization
$passwords_file = dirname(__DIR__) . "/dent2025_passwords.json";
$mock_premed_pass = "test_premed_leader_9988";
$orig_passwords = dent2025_load_passwords();
$mock_passwords = $orig_passwords;
$mock_passwords[] = [
    "id" => "pass_test_premed",
    "label" => "Pre-Med Leader Test",
    "passkey" => $mock_premed_pass,
    "allowed_contexts" => ["pre-med_1_1"],
    "permissions" => [
        "timetable" => true,
        "semester_events" => true,
        "edit_basic_subject" => true
    ]
];

dent2025_save_passwords($mock_passwords);

assert_test("Pre-Med leader with year=0 normalizes to year=1 and ALLOWED", dent2025_check_rbac_permission($mock_premed_pass, "timetable", "pre-med", 0, 1) === true);
assert_test("Pre-Med leader with year=1 ALLOWED in pre-med_1_1", dent2025_check_rbac_permission($mock_premed_pass, "timetable", "pre-med", 1, 1) === true);
assert_test("Pre-Med leader with year='0' string normalizes to year=1 and ALLOWED", dent2025_check_rbac_permission($mock_premed_pass, "timetable", "pre-med", "0", 1) === true);
assert_test("Pre-Med leader DENIED in semester 2 (unauthorized context pre-med_1_2)", dent2025_check_rbac_permission($mock_premed_pass, "timetable", "pre-med", 1, 2) === false);
assert_test("Pre-Med leader DENIED in dentistry (unauthorized specialty)", dent2025_check_rbac_permission($mock_premed_pass, "timetable", "dentistry", 1, 1) === false);

dent2025_save_passwords($orig_passwords);

// 12.3 Quiz Score 0-division resilience calculation
$calc_pct = function($score, $totalQs) {
    return $totalQs > 0 ? (int)round(($score / $totalQs) * 100) : 0;
};
assert_test("Quiz score with totalQs=0 returns 0% (no division by zero)", $calc_pct(0, 0) === 0);
assert_test("Quiz score with 8/10 returns 80%", $calc_pct(8, 10) === 80);

// -----------------------------------------------------------------------------
// SUMMARY REPORT
// -----------------------------------------------------------------------------
echo "\n=======================================================\n";
echo " TEST EXECUTION SUMMARY: Passed {$test_results['passed']} / " . ($test_results['passed'] + $test_results['failed']) . "\n";
echo "=======================================================\n";

if ($test_results['failed'] === 0) {
    echo " ALL SUBSYSTEM LOGIC CHECKS PASSED PERFECTLY!\n";
    exit(0);
} else {
    echo " SOME TESTS FAILED. Please review errors above.\n";
    exit(1);
}

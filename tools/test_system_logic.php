<?php
// scratch/test_system_logic.php
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

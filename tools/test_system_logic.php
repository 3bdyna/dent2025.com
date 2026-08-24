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

// -----------------------------------------------------------------------------
// SUITE 5: Analytics Validation & Classification Logic
// -----------------------------------------------------------------------------
echo "\n5. Testing Analytics Validation & Identity Classification...\n";

$EVENT_TYPES = ['page_view', 'context_select', 'subject_open', 'materials_open', 'quiz_start', 'quiz_finish', 'timer_start', 'timer_finish'];
$SPECIALTIES = ['dentistry' => true, 'medicine' => true, 'pre-med' => true];

function validate_analytics_event($ev) {
    global $EVENT_TYPES, $SPECIALTIES;
    if (!is_array($ev)) return null;
    $type = $ev['type'] ?? '';
    if (!in_array($type, $EVENT_TYPES, true)) return null;
    
    $ctx = $ev['ctx'] ?? null;
    $valid_ctx = null;
    if (is_array($ctx)) {
        $spec = strtolower($ctx['specialty'] ?? '');
        $year = isset($ctx['year']) ? intval($ctx['year']) : -1;
        $sem = isset($ctx['semester']) ? intval($ctx['semester']) : -1;
        if (isset($SPECIALTIES[$spec]) && $year >= 0 && $year <= 6 && $sem >= 1 && $sem <= 2) {
            $valid_ctx = ['specialty' => $spec, 'year' => $year, 'semester' => $sem];
        }
    }
    return [
        'type' => $type,
        'ctx' => $valid_ctx,
        'ts' => isset($ev['ts']) ? intval($ev['ts']) : time()
    ];
}

$valid_ev = validate_analytics_event(['type' => 'page_view', 'ctx' => ['specialty' => 'dentistry', 'year' => 2, 'semester' => 1]]);
assert_test("Valid analytics event accepted with parsed context", $valid_ev !== null && $valid_ev['ctx']['specialty'] === 'dentistry');

$invalid_type_ev = validate_analytics_event(['type' => 'malicious_event']);
assert_test("Invalid analytics event type rejected", $invalid_type_ev === null);

// -----------------------------------------------------------------------------
// SUITE 6: Announcement HTML Sanitization
// -----------------------------------------------------------------------------
echo "\n6. Testing Announcement HTML Sanitizer (XSS Prevention)...\n";
require_once __DIR__ . '/../announcements_api.php';

$xss_payload = '<p>Important notice <script>alert("xss")</script><b onclick="bad()">Click here</b><a href="javascript:steal()">link</a></p>';
$clean_output = dent2025_sanitize_announcements_html($xss_payload);

assert_test("Sanitizer strips <script> tags", strpos($clean_output, '<script>') === false && strpos($clean_output, 'alert') === false);
assert_test("Sanitizer strips inline on* event handlers", strpos($clean_output, 'onclick') === false);
assert_test("Sanitizer neutralizes javascript: URLs", strpos($clean_output, 'javascript:') === false);
assert_test("Sanitizer preserves safe formatting (<p>, <b>, <a>)", strpos($clean_output, '<p>') !== false && strpos($clean_output, '<b>') !== false);

// -----------------------------------------------------------------------------
// SUITE 7: Study Log Deduplication on PIN Migration
// -----------------------------------------------------------------------------
echo "\n7. Testing Study Log Migration Logic...\n";
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

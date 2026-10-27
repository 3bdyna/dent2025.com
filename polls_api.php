<?php
// polls_api.php
// Dent2025 Standalone REST API for Inline Academic Polls & Student Feedback
require_once __DIR__ . '/dent2025_rbac.php';

if (!headers_sent()) {
    header('Content-Type: application/json; charset=UTF-8');

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (in_array($origin, ['https://dent2025.com', 'https://www.dent2025.com'], true) || (strpos($origin, 'localhost') !== false)) {
        header("Access-Control-Allow-Origin: $origin");
    } else {
        header('Access-Control-Allow-Origin: https://dent2025.com');
    }

    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$dataDir = __DIR__ . '/polls_data';
if (!file_exists($dataDir)) {
    @mkdir($dataDir, 0777, true);
}
$pollsFile = $dataDir . '/polls.json';

// Helper to load polls atomically
function dent_load_polls_data($pollsFile) {
    if (!file_exists($pollsFile)) {
        return ['polls' => []];
    }
    $content = file_get_contents($pollsFile);
    if (empty($content)) {
        return ['polls' => []];
    }
    $decoded = json_decode($content, true);
    return is_array($decoded) && isset($decoded['polls']) ? $decoded : ['polls' => []];
}

// Helper to save polls atomically
function dent_save_polls_data($pollsFile, $data) {
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return file_put_contents($pollsFile, $json, LOCK_EX) !== false;
}

// Client IP resolver
function dent_get_client_ip() {
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        return $_SERVER['HTTP_CF_CONNECTING_IP'];
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ips = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        return trim($ips[0]);
    }
    return $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
}

// Client voter fingerprint hash
function dent_get_voter_hash() {
    $ip = dent_get_client_ip();
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? 'unknown';
    return hash('sha256', $ip . '_' . $ua . '_dent2025_poll_salt');
}

// Format public poll output (stripping voter hashes)
function dent_format_public_poll($poll, $voterHash = '') {
    $total = (int)($poll['total_votes'] ?? 0);
    $votes = $poll['votes'] ?? [];
    $percentages = [];
    
    foreach ($votes as $count) {
        $percentages[] = $total > 0 ? (int)round(($count / $total) * 100) : 0;
    }

    $voterHashes = $poll['voter_hashes'] ?? [];
    $hasVoted = !empty($voterHash) && in_array($voterHash, $voterHashes, true);

    return [
        'id' => $poll['id'],
        'question' => $poll['question'],
        'badge' => $poll['badge'] ?? '',
        'sub_badge' => $poll['sub_badge'] ?? '',
        'options' => $poll['options'] ?? [],
        'votes' => $hasVoted ? $votes : array_fill(0, count($poll['options']), 0),
        'percentages' => $percentages,
        'total_votes' => $total,
        'specialty' => $poll['specialty'] ?? 'dentistry',
        'year' => (int)($poll['year'] ?? 0),
        'semester' => (int)($poll['semester'] ?? 1),
        'status' => $poll['status'] ?? 'published',
        'has_voted' => $hasVoted,
        'created_at' => $poll['created_at'] ?? time(),
        'expires_at' => isset($poll['expires_at']) ? (int)$poll['expires_at'] : 0
    ];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$voterHash = dent_get_voter_hash();

// -------------------------------------------------------------
// 1. GET Requests: get_active_poll, get_all_polls
// -------------------------------------------------------------
if ($method === 'GET') {
    $action = $_GET['action'] ?? 'get_active_poll';

    // 1A. Get active poll for current visitor/cohort
    if ($action === 'get_active_poll') {
        header('Cache-Control: no-cache, no-store, must-revalidate');

        $specialty = strtolower(trim((string)($_GET['specialty'] ?? 'dentistry')));
        $year = (int)($_GET['year'] ?? 3);
        $semester = (int)($_GET['semester'] ?? 1);
        $isTestingFlag = !empty($_GET['test']) || !empty($_GET['test_poll']) || !empty($_GET['preview']);
        $pass = trim((string)($_GET['pass'] ?? ''));

        // Check if admin is authenticated via passkey
        $isAdmin = false;
        if (!empty($pass)) {
            $isAdmin = dent2025_check_rbac_permission($pass, 'semester_announcements', $specialty, $year, $semester);
        }

        $canViewTestingPolls = $isTestingFlag || $isAdmin;

        $data = dent_load_polls_data($pollsFile);
        $activePoll = null;
        $now = time();

        // Expiration check (0 means never expires)
        $now = time();
        $polls = array_reverse($data['polls']);
        foreach ($polls as $poll) {
            $status = $poll['status'] ?? 'published';
            if ($status === 'archived') {
                continue;
            }

            // Expiration check (expires_at = 0 or empty means permanent)
            if (!empty($poll['expires_at']) && (int)$poll['expires_at'] > 0 && $now > (int)$poll['expires_at']) {
                continue;
            }

            // Stealth check: if status is testing, hide unless testing flag/admin
            if ($status === 'testing' && !$canViewTestingPolls) {
                continue;
            }

            // Cohort scoping check (or 'all')
            $pollSpec = strtolower($poll['specialty'] ?? '');
            $pollYear = (int)($poll['year'] ?? 0);
            $pollSem = (int)($poll['semester'] ?? 0);

            $match = ($pollSpec === 'all') || 
                     ($pollSpec === $specialty && ($pollYear === 0 || $pollYear === $year) && ($pollSem === 0 || $pollSem === $semester));

            if ($match) {
                $activePoll = $poll;
                break;
            }
        }

        if ($activePoll) {
            echo json_encode([
                'success' => true,
                'data' => dent_format_public_poll($activePoll, $voterHash)
            ], JSON_UNESCAPED_UNICODE);
        } else {
            echo json_encode([
                'success' => true,
                'data' => null,
                'message' => 'No active poll available'
            ], JSON_UNESCAPED_UNICODE);
        }
        exit;
    }

    // 1B. Get all polls for admin dashboard
    if ($action === 'get_all_polls') {
        $pass = trim((string)($_GET['pass'] ?? ''));
        if (!dent2025_check_rbac_permission($pass, 'semester_announcements') && !dent2025_check_rbac_permission($pass, 'global_announcements')) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Unauthorized passkey'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $data = dent_load_polls_data($pollsFile);
        $list = [];
        foreach ($data['polls'] as $p) {
            $list[] = [
                'id' => $p['id'],
                'question' => $p['question'],
                'badge' => $p['badge'] ?? '',
                'sub_badge' => $p['sub_badge'] ?? '',
                'options' => $p['options'] ?? [],
                'votes' => $p['votes'] ?? [],
                'total_votes' => $p['total_votes'] ?? 0,
                'specialty' => $p['specialty'] ?? 'dentistry',
                'year' => $p['year'] ?? 0,
                'semester' => $p['semester'] ?? 1,
                'status' => $p['status'] ?? 'published',
                'created_at' => $p['created_at'] ?? 0,
                'expires_at' => $p['expires_at'] ?? 0
            ];
        }

        echo json_encode(['success' => true, 'data' => array_reverse($list)], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

// -------------------------------------------------------------
// 2. POST Requests: vote, save_poll, delete_poll
// -------------------------------------------------------------
if ($method === 'POST') {
    $rawInput = file_get_contents('php://input');
    $body = json_decode($rawInput, true);
    if (!is_array($body)) {
        $body = $_POST;
    }

    $action = $body['action'] ?? $_GET['action'] ?? '';

    // 2A. Student Vote Submission
    if ($action === 'vote') {
        $pollId = trim((string)($body['poll_id'] ?? ''));
        $optIdx = isset($body['option_index']) ? (int)$body['option_index'] : -1;

        if (empty($pollId) || $optIdx < 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Missing poll_id or option_index'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $data = dent_load_polls_data($pollsFile);
        if (!isset($data['polls'][$pollId])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Poll not found'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $poll = &$data['polls'][$pollId];

        // Status check
        if (($poll['status'] ?? '') === 'archived') {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'هذا الاستطلاع مغلق حالياً'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Expiry check
        if (!empty($poll['expires_at']) && time() > (int)$poll['expires_at']) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'انتهى وقت التصويت لهذا الاستطلاع'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Check if option index exists
        if (!isset($poll['options'][$optIdx])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid option index'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Duplicate vote check via fingerprint hash
        if (!isset($poll['voter_hashes']) || !is_array($poll['voter_hashes'])) {
            $poll['voter_hashes'] = [];
        }

        if (in_array($voterHash, $poll['voter_hashes'], true)) {
            echo json_encode([
                'success' => false,
                'already_voted' => true,
                'error' => 'لقد قمت بالتصويت مسبقاً في هذا الاستطلاع',
                'data' => dent_format_public_poll($poll, $voterHash)
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Record vote
        if (!isset($poll['votes'][$optIdx])) {
            $poll['votes'][$optIdx] = 0;
        }
        $poll['votes'][$optIdx]++;
        $poll['total_votes'] = (int)($poll['total_votes'] ?? 0) + 1;
        $poll['voter_hashes'][] = $voterHash;

        dent_save_polls_data($pollsFile, $data);

        echo json_encode([
            'success' => true,
            'message' => 'تم تسجيل تصويتك بنجاح',
            'data' => dent_format_public_poll($poll, $voterHash)
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // 2B. Admin Save/Update Poll
    if ($action === 'save_poll') {
        $pass = trim((string)($body['pass'] ?? ''));
        $specialty = strtolower(trim((string)($body['specialty'] ?? 'dentistry')));
        $year = (int)($body['year'] ?? 3);
        $semester = (int)($body['semester'] ?? 1);

        if (!dent2025_check_rbac_permission($pass, 'semester_announcements', $specialty, $year, $semester) &&
            !dent2025_check_rbac_permission($pass, 'global_announcements')) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'صلاحية غير كافية لحفظ الاستطلاع'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $question = trim((string)($body['question'] ?? ''));
        $options = $body['options'] ?? [];
        if (!is_array($options)) $options = [];

        // Clean options
        $cleanOptions = [];
        foreach ($options as $opt) {
            $cleaned = trim((string)$opt);
            if (!empty($cleaned)) {
                $cleanOptions[] = $cleaned;
            }
        }

        if (empty($question) || count($cleanOptions) < 2) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'يجب كتابة السؤال وإدخال خيارين على الأقل'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $pollId = trim((string)($body['id'] ?? ''));
        if (empty($pollId)) {
            $pollId = 'poll_' . date('Ymd_His') . '_' . substr(md5(uniqid('', true)), 0, 5);
        }

        $durationHours = isset($body['duration_hours']) ? (int)$body['duration_hours'] : 24;
        $expiresAt = ($durationHours > 0) ? (time() + ($durationHours * 3600)) : 0;

        $status = in_array($body['status'] ?? '', ['testing', 'published', 'archived'], true) ? $body['status'] : 'testing';

        $data = dent_load_polls_data($pollsFile);

        $existing = $data['polls'][$pollId] ?? null;
        $votes = $existing ? ($existing['votes'] ?? []) : array_fill(0, count($cleanOptions), 0);
        $voterHashes = $existing ? ($existing['voter_hashes'] ?? []) : [];
        $totalVotes = $existing ? ($existing['total_votes'] ?? 0) : 0;

        // Ensure vote array matches new option count
        if (count($votes) !== count($cleanOptions)) {
            $votes = array_pad(array_slice($votes, 0, count($cleanOptions)), count($cleanOptions), 0);
        }

        $data['polls'][$pollId] = [
            'id' => $pollId,
            'question' => $question,
            'badge' => trim((string)($body['badge'] ?? '')),
            'sub_badge' => trim((string)($body['sub_badge'] ?? '')),
            'options' => $cleanOptions,
            'votes' => $votes,
            'total_votes' => $totalVotes,
            'voter_hashes' => $voterHashes,
            'specialty' => $specialty,
            'year' => $year,
            'semester' => $semester,
            'status' => $status,
            'created_at' => $existing['created_at'] ?? time(),
            'expires_at' => $expiresAt
        ];

        dent_save_polls_data($pollsFile, $data);

        echo json_encode([
            'success' => true,
            'message' => 'تم حفظ الاستطلاع بنجاح (' . ($status === 'testing' ? 'وضع التجربة' : 'منشور') . ')',
            'data' => $data['polls'][$pollId]
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // 2C. Admin Delete Poll
    if ($action === 'delete_poll') {
        $pass = trim((string)($body['pass'] ?? ''));
        $pollId = trim((string)($body['id'] ?? ''));

        if (!dent2025_check_rbac_permission($pass, 'semester_announcements') &&
            !dent2025_check_rbac_permission($pass, 'global_announcements')) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'صلاحية غير كافية لحذف الاستطلاع'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $data = dent_load_polls_data($pollsFile);
        if (isset($data['polls'][$pollId])) {
            unset($data['polls'][$pollId]);
            dent_save_polls_data($pollsFile, $data);
            echo json_encode(['success' => true, 'message' => 'تم حذف الاستطلاع بنجاح'], JSON_UNESCAPED_UNICODE);
        } else {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'الاستطلاع غير موجود'], JSON_UNESCAPED_UNICODE);
        }
        exit;
    }
}

http_response_code(400);
echo json_encode(['success' => false, 'error' => 'Invalid action or request'], JSON_UNESCAPED_UNICODE);

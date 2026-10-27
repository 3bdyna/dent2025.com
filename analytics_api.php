<?php
// analytics_api.php — First-party Visitor & Dwell-Time Analytics for Dent2025
// Tracks unique visitors, arrival timestamps, device types, and exact session duration.

if (!headers_sent()) {
    header('Content-Type: application/json; charset=utf-8');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (in_array($origin, ['https://dent2025.com', 'https://www.dent2025.com'], true) || (strpos($origin, 'localhost') !== false)) {
        header("Access-Control-Allow-Origin: $origin");
    } else {
        header('Access-Control-Allow-Origin: https://dent2025.com');
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$dataDir = __DIR__ . '/analytics_data';
if (!file_exists($dataDir)) {
    @mkdir($dataDir, 0775, true);
}

$action = $_GET['action'] ?? ($_POST['action'] ?? 'report');

function dent_detect_device($ua) {
    if (preg_match('/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i', $ua)) {
        return 'Tablet';
    }
    if (preg_match('/(mobi|ipod|iphone|android|blackberry|opera mini|iemobile)/i', $ua)) {
        return 'Mobile';
    }
    return 'Desktop';
}

if ($action === 'track') {
    $rawInput = file_get_contents('php://input');
    if (empty($rawInput)) {
        echo json_encode(['ok' => false, 'error' => 'empty body']);
        exit;
    }

    $data = json_decode($rawInput, true);
    if (!is_array($data) || empty($data['sid'])) {
        echo json_encode(['ok' => false, 'error' => 'invalid payload']);
        exit;
    }

    $sid = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)$data['sid']);
    $anonId = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)($data['id'] ?? ''));
    $fp = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)($data['fp'] ?? ''));
    $events = is_array($data['events'] ?? null) ? $data['events'] : [];

    if (empty($sid)) {
        echo json_encode(['ok' => false, 'error' => 'missing session id']);
        exit;
    }

    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $device = dent_detect_device($ua);
    $country = $_SERVER['HTTP_CF_IPCOUNTRY'] ?? 'Unknown';
    $today = gmdate('Y-m-d');
    $filePath = $dataDir . '/sessions_' . $today . '.json';

    // Thread-safe update using file lock
    $fpHandle = fopen($filePath, 'c+');
    if ($fpHandle && flock($fpHandle, LOCK_EX)) {
        $size = filesize($filePath);
        $content = $size > 0 ? fread($fpHandle, $size) : '';
        $sessions = json_decode($content, true);
        if (!is_array($sessions)) {
            $sessions = [];
        }

        $session = $sessions[$sid] ?? [
            'sid' => $sid,
            'anon_id' => $anonId,
            'device' => $device,
            'country' => $country,
            'start_time' => null,
            'last_time' => null,
            'duration_sec' => 0,
            'paths' => [],
            'specialty' => null,
            'year' => null
        ];

        // Process incoming events to update dwell time & visited paths
        $nowMs = round(microtime(true) * 1000);
        foreach ($events as $ev) {
            $evTs = (is_numeric($ev['ts'] ?? null)) ? (int)$ev['ts'] : $nowMs;
            if ($session['start_time'] === null || $evTs < $session['start_time']) {
                $session['start_time'] = $evTs;
            }
            if ($session['last_time'] === null || $evTs > $session['last_time']) {
                $session['last_time'] = $evTs;
            }
            if (!empty($ev['path'])) {
                $p = substr((string)$ev['path'], 0, 80);
                if (!in_array($p, $session['paths'], true)) {
                    $session['paths'][] = $p;
                }
            }
            if (!empty($ev['ctx']['specialty'])) {
                $session['specialty'] = substr((string)$ev['ctx']['specialty'], 0, 30);
            }
            if (!empty($ev['ctx']['year'])) {
                $session['year'] = (int)$ev['ctx']['year'];
            }
        }

        if ($session['start_time'] !== null && $session['last_time'] !== null) {
            $session['duration_sec'] = max(0, round(($session['last_time'] - $session['start_time']) / 1000));
        }

        $sessions[$sid] = $session;

        // Keep maximum 5000 sessions per file to keep memory small
        if (count($sessions) > 5000) {
            $sessions = array_slice($sessions, -5000, null, true);
        }

        ftruncate($fpHandle, 0);
        rewind($fpHandle);
        fwrite($fpHandle, json_encode($sessions));
        fflush($fpHandle);
        flock($fpHandle, LOCK_UN);
        fclose($fpHandle);
    }

    echo json_encode(['ok' => true]);
    exit;
}

if ($action === 'report') {
    $date = preg_replace('/[^0-9\-]/', '', (string)($_GET['date'] ?? gmdate('Y-m-d')));
    $filePath = $dataDir . '/sessions_' . $date . '.json';
    
    $sessions = [];
    if (file_exists($filePath)) {
        $raw = file_get_contents($filePath);
        $sessions = json_decode($raw, true) ?: [];
    }

    $uniqueUsers = [];
    $devices = ['Desktop' => 0, 'Mobile' => 0, 'Tablet' => 0];
    $durations = [];
    $totalDuration = 0;
    $countries = [];

    foreach ($sessions as $s) {
        $uid = $s['anon_id'] ?: $s['sid'];
        $uniqueUsers[$uid] = true;

        $dev = $s['device'] ?? 'Desktop';
        $devices[$dev] = ($devices[$dev] ?? 0) + 1;

        $dur = (int)($s['duration_sec'] ?? 0);
        $durations[] = $dur;
        $totalDuration += $dur;

        $c = $s['country'] ?? 'Unknown';
        $countries[$c] = ($countries[$c] ?? 0) + 1;
    }

    $sessionCount = count($sessions);
    $avgDuration = $sessionCount > 0 ? round($totalDuration / $sessionCount) : 0;
    sort($durations);
    $medianDuration = $sessionCount > 0 ? $durations[(int)floor($sessionCount / 2)] : 0;

    // Format recent sessions list (latest 30)
    $recent = array_values(array_slice($sessions, -30));
    usort($recent, function($a, $b) {
        return ($b['last_time'] ?? 0) <=> ($a['last_time'] ?? 0);
    });

    foreach ($recent as &$r) {
        if (!empty($r['start_time'])) {
            $r['started_at_utc'] = gmdate('Y-m-d H:i:s', (int)($r['start_time'] / 1000));
        }
        $sec = (int)$r['duration_sec'];
        $r['duration_formatted'] = $sec >= 60 ? floor($sec / 60) . 'm ' . ($sec % 60) . 's' : $sec . 's';
    }
    unset($r);

    echo json_encode([
        'date' => $date,
        'metrics' => [
            'total_unique_people' => count($uniqueUsers),
            'total_sessions' => $sessionCount,
            'average_time_stayed_seconds' => $avgDuration,
            'average_time_formatted' => $avgDuration >= 60 ? floor($avgDuration / 60) . 'm ' . ($avgDuration % 60) . 's' : $avgDuration . 's',
            'median_time_stayed_seconds' => $medianDuration,
            'devices' => $devices,
            'countries' => $countries
        ],
        'recent_sessions' => $recent
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

echo json_encode(['ok' => false, 'error' => 'unknown action']);

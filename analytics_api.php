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

if ($action === 'range' || $action === 'report_range') {
    $days = max(1, min(180, (int)($_GET['days'] ?? 14)));
    $startDateStr = preg_replace('/[^0-9\-]/', '', (string)($_GET['start'] ?? ''));
    $endDateStr = preg_replace('/[^0-9\-]/', '', (string)($_GET['end'] ?? gmdate('Y-m-d')));

    $endTs = !empty($endDateStr) ? strtotime($endDateStr . ' 12:00:00 UTC') : time();
    $startTs = !empty($startDateStr) ? strtotime($startDateStr . ' 12:00:00 UTC') : ($endTs - (($days - 1) * 86400));

    // Load Cloudflare historical data if available (covers pre-telemetry period prior to Oct 27)
    $cfHistory = [];
    $cfHistoryFile = $dataDir . '/cloudflare_history.json';
    if (file_exists($cfHistoryFile)) {
        $rawCf = file_get_contents($cfHistoryFile);
        $cfHistory = json_decode($rawCf, true) ?: [];
    }

    $arabicDays = [
        'Sunday' => 'الأحد',
        'Monday' => 'الإثنين',
        'Tuesday' => 'الثلاثاء',
        'Wednesday' => 'الأربعاء',
        'Thursday' => 'الخميس',
        'Friday' => 'الجمعة',
        'Saturday' => 'السبت'
    ];

    $results = [];
    $totalStudentsSum = 0;
    $peakStudents = 0;
    $totalDwellSecSum = 0;
    $daysWithDwell = 0;

    for ($t = $endTs; $t >= $startTs; $t -= 86400) {
        $curDate = gmdate('Y-m-d', $t);
        $curFile = $dataDir . '/sessions_' . $curDate . '.json';
        $dayEn = gmdate('l', $t);
        $dayAr = $arabicDays[$dayEn] ?? $dayEn;

        if (file_exists($curFile)) {
            // Tier 1: First-party verified telemetry
            $raw = file_get_contents($curFile);
            $sessions = json_decode($raw, true) ?: [];

            $uniqueUsers = [];
            $totalDur = 0;
            $validSessions = 0;

            foreach ($sessions as $s) {
                $paths = $s['paths'] ?? [];
                if (!empty($paths)) {
                    $nonOspe = array_filter($paths, function($p) {
                        return stripos((string)$p, '/ospe') === false;
                    });
                    if (empty($nonOspe)) {
                        continue;
                    }
                }

                $uid = $s['anon_id'] ?: $s['sid'];
                $uniqueUsers[$uid] = true;

                $rawDur = (int)($s['duration_sec'] ?? 0);
                $dur = min(3600, $rawDur);
                $totalDur += $dur;
                $validSessions++;
            }

            $studentCount = count($uniqueUsers);
            $avgDuration = $validSessions > 0 ? round($totalDur / $validSessions) : 0;
            $avgFormatted = $avgDuration >= 60 ? floor($avgDuration / 60) . 'm ' . ($avgDuration % 60) . 's' : $avgDuration . 's';

            $totalStudentsSum += $studentCount;
            if ($studentCount > $peakStudents) {
                $peakStudents = $studentCount;
            }
            if ($studentCount > 0) {
                $totalDwellSecSum += $avgDuration;
                $daysWithDwell++;
            }

            $results[] = [
                'date' => $curDate,
                'day' => $dayEn,
                'day_ar' => $dayAr,
                'verified_students' => $studentCount,
                'average_time_stayed_seconds' => $avgDuration,
                'average_time_formatted' => $avgFormatted,
                'source' => 'telemetry'
            ];
        } elseif (isset($cfHistory[$curDate])) {
            // Tier 2: Cloudflare historical dataset
            $cf = $cfHistory[$curDate];
            $studentCount = (int)($cf['estimated_students'] ?? $cf['cf_visits'] ?? 0);
            $totalStudentsSum += $studentCount;
            if ($studentCount > $peakStudents) {
                $peakStudents = $studentCount;
            }

            $results[] = [
                'date' => $curDate,
                'day' => $dayEn,
                'day_ar' => $dayAr,
                'verified_students' => $studentCount,
                'average_time_stayed_seconds' => null,
                'average_time_formatted' => '--',
                'page_views' => (int)($cf['page_views'] ?? 0),
                'source' => 'cloudflare'
            ];
        } else {
            // No activity recorded
            $results[] = [
                'date' => $curDate,
                'day' => $dayEn,
                'day_ar' => $dayAr,
                'verified_students' => 0,
                'average_time_stayed_seconds' => 0,
                'average_time_formatted' => '--',
                'source' => 'none'
            ];
        }
    }

    $overallAvgDwellSec = $daysWithDwell > 0 ? round($totalDwellSecSum / $daysWithDwell) : 0;
    $overallAvgDwellFormatted = $overallAvgDwellSec >= 60 ? floor($overallAvgDwellSec / 60) . 'm ' . ($overallAvgDwellSec % 60) . 's' : $overallAvgDwellSec . 's';

    echo json_encode([
        'ok' => true,
        'days' => count($results),
        'summary' => [
            'today_students' => $results[0]['verified_students'] ?? 0,
            'peak_students' => $peakStudents,
            'total_attendance' => $totalStudentsSum,
            'average_daily_dwell' => $overallAvgDwellFormatted
        ],
        'data' => $results
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
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
        // Exclude /ospe/ admin testing sessions
        $paths = $s['paths'] ?? [];
        if (!empty($paths)) {
            $nonOspe = array_filter($paths, function($p) {
                return stripos((string)$p, '/ospe') === false;
            });
            if (empty($nonOspe)) {
                continue;
            }
        }

        $uid = $s['anon_id'] ?: $s['sid'];
        $uniqueUsers[$uid] = true;

        $dev = $s['device'] ?? 'Desktop';
        $devices[$dev] = ($devices[$dev] ?? 0) + 1;

        // Cap individual session duration at 3600s (60 min) to eliminate background tab / idle skew
        $rawDur = (int)($s['duration_sec'] ?? 0);
        $dur = min(3600, $rawDur);
        $durations[] = $dur;
        $totalDuration += $dur;

        $c = $s['country'] ?? 'Unknown';
        $countries[$c] = ($countries[$c] ?? 0) + 1;
    }

    $sessionCount = count($durations);
    $avgDuration = $sessionCount > 0 ? round($totalDuration / $sessionCount) : 0;
    sort($durations);
    $medianDuration = $sessionCount > 0 ? $durations[(int)floor($sessionCount / 2)] : 0;
    $medianFormatted = $medianDuration >= 60 ? floor($medianDuration / 60) . 'm ' . ($medianDuration % 60) . 's' : $medianDuration . 's';

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
            'median_time_formatted' => $medianFormatted,
            'devices' => $devices,
            'countries' => $countries
        ],
        'recent_sessions' => $recent
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

echo json_encode(['ok' => false, 'error' => 'unknown action']);

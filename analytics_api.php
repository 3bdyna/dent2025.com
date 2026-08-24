<?php
// analytics_api.php
// Dent2025 First-Party Analytics Backend (file-based JSON storage)
// Public: action=track (batched events, rate limited) | action=health
// Admin (RBAC master-only, manage_passwords): overview, trend, ctx_heatmap,
//   subjects, timer_patterns, funnel, retention, identity, raw, config, rollup_now
require_once __DIR__ . '/dent2025_rbac.php';

define('LSCACHE_NO_CACHE', true);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate, max-age=0');
header('Access-Control-Allow-Origin: https://dent2025.com');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

$ACTION_WHITELIST = array(
    'track', 'health',
    'overview', 'trend', 'ctx_heatmap', 'subjects', 'timer_patterns', 'funnel',
    'retention', 'identity', 'raw', 'config', 'rollup_now'
);
$EVENT_TYPES = array(
    'page_view', 'context_select', 'subject_open', 'materials_open',
    'quiz_start', 'quiz_finish', 'quiz_wrong',
    'timer_start', 'timer_pause', 'timer_finish', 'timer_reset', 'schedule_view'
);
$SPECIALTIES = array('dentistry' => true, 'medicine' => true, 'pre-med' => true);

function dent2025_a_dir() {
    static $dir = null;
    if ($dir === null) {
        $dir = __DIR__ . '/dent2025_analytics_data';
        foreach (array('', '/raw', '/dau', '/rollups', '/rate') as $sub) {
            $p = $dir . $sub;
            if (!is_dir($p)) @mkdir($p, 0777, true);
        }
    }
    return $dir;
}

function dent2025_a_config() {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $defaults = array(
        'track_enabled' => true,
        'new_window_days' => 7,
        'established_days' => 2,
        'established_sessions' => 2,
        'merge_window_days' => 7,
        'allow_fp_merge' => true,
        'raw_retention_days' => 30,
        'hourly_retention_days' => 31,
        'daily_retention_days' => 365,
        'weekly_retention_weeks' => 90,
        'dau_retention_days' => 365,
        'max_events_per_batch' => 50,
        'rate_limit_events_per_min' => 120,
        'quiz_pass_threshold' => 60
    );
    $file = dent2025_a_dir() . '/config.json';
    $saved = array();
    if (file_exists($file)) {
        $raw = file_get_contents($file);
        $parsed = $raw ? json_decode($raw, true) : null;
        if (is_array($parsed)) $saved = $parsed;
    }
    $cfg = array_merge($defaults, $saved);
    return $cfg;
}

function dent2025_a_save_config($new) {
    $file = dent2025_a_dir() . '/config.json';
    return file_put_contents($file, json_encode($new, JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
}

function dent2025_a_read_json($file) {
    if (!file_exists($file)) return null;
    $raw = file_get_contents($file);
    if ($raw === false || trim($raw) === '') return null;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

function dent2025_a_write_json($file, $data) {
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    $encoded = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($encoded === false) return false;
    $tmp = $file . '.tmp.' . uniqid(mt_rand(), true);
    if (@file_put_contents($tmp, $encoded, LOCK_EX) === false) {
        return false;
    }
    return @rename($tmp, $file);
}

function dent2025_a_client_ip() {
    foreach (array('HTTP_X_FORWARDED_FOR', 'HTTP_CF_CONNECTING_IP', 'REMOTE_ADDR') as $h) {
        if (!empty($_SERVER[$h])) {
            $ip = trim(explode(',', $_SERVER[$h])[0]);
            if ($ip) return $ip;
        }
    }
    return 'unknown';
}

function dent2025_a_sanitize($v, $maxLen) {
    if (!is_string($v)) return '';
    $v = preg_replace('/[^a-zA-Z0-9_\-]/', '', $v);
    return substr($v, 0, $maxLen);
}

function dent2025_a_rate_limit($cfg) {
    $ip = dent2025_a_client_ip();
    $bucket = date('Y-m-d-H-i');
    $rateDir = dent2025_a_dir() . '/rate';
    $files = glob($rateDir . '/rate_*.json');
    $totalRecent = 0;
    $now = time();
    foreach ($files as $f) {
        if (($now - filemtime($f)) > 120) @unlink($f);
    }
    $current = $rateDir . '/rate_' . md5($ip) . '_' . $bucket . '.json';
    $count = 0;
    if (file_exists($current)) {
        $d = dent2025_a_read_json($current);
        if (is_array($d)) $count = intval($d['count'] ?? 0);
    }
    if ($count >= $cfg['rate_limit_events_per_min']) {
        return false;
    }
    dent2025_a_write_json($current, array('ip' => md5($ip), 'bucket' => $bucket, 'count' => $count + 1));
    // Count events (batches may contain several events): approximate via batch size check upstream
    return true;
}

function dent2025_a_validate_event($ev, $cfg) {
    global $EVENT_TYPES, $SPECIALTIES;
    if (!is_array($ev)) return null;
    $type = $ev['type'] ?? '';
    if (!in_array($type, $EVENT_TYPES, true)) return null;
    $rawTs = isset($ev['ts']) ? intval($ev['ts']) : time();
    if ($rawTs > 20000000000) {
        $rawTs = intval($rawTs / 1000);
    }
    $valid = array(
        'ts' => $rawTs,
        'id' => dent2025_a_sanitize($ev['id'] ?? '', 64) ?: null,
        'sid' => dent2025_a_sanitize($ev['sid'] ?? '', 40) ?: null,
        'fp' => dent2025_a_sanitize($ev['fp'] ?? '', 40) ?: null,
        'type' => $type,
        'ident' => null, // assigned server-side
        'path' => substr(preg_replace('/[^a-zA-Z0-9\/\_\-\.\p{Arabic}\s]/u', '', $ev['path'] ?? ''), 0, 200) ?: null
    );
    // ctx
    $ctx = $ev['ctx'] ?? null;
    if (is_array($ctx)) {
        $spec = strtolower($ctx['specialty'] ?? '');
        $year = isset($ctx['year']) ? intval($ctx['year']) : -1;
        $sem = isset($ctx['semester']) ? intval($ctx['semester']) : -1;
        if (isset($SPECIALTIES[$spec]) && $year >= 0 && $year <= 6 && $sem >= 1 && $sem <= 2) {
            $valid['ctx'] = array('specialty' => $spec, 'year' => $year, 'semester' => $sem);
        }
    }
    $sub = $ev['subject'] ?? '';
    if (is_string($sub)) $valid['subject'] = substr($sub, 0, 120);
    if (isset($ev['value']) && is_numeric($ev['value'])) {
        $v = floatval($ev['value']);
        if ($type === 'quiz_finish') $v = min(100, max(0, $v));
        elseif ($v >= 0 && $v < 864000) $valid['value'] = round($v, 1);
    }
    return $valid;
}

function dent2025_a_profiles_file() {
    return dent2025_a_dir() . '/profiles.json';
}
function dent2025_a_ghost_file() {
    return dent2025_a_dir() . '/ghost.json';
}
function dent2025_a_raw_file_for($ts) {
    return dent2025_a_dir() . '/raw/raw_' . date('Y-m-d-H', $ts) . '.json';
}
function dent2025_a_dau_file($ts) {
    return dent2025_a_dir() . '/dau/dau_' . date('Y-m-d', $ts) . '.json';
}

function dent2025_a_update_profiles_mem(&$profiles, &$ghost, $ev, $cfg) {
    $now = $ev['ts'] > time() ? time() : $ev['ts'];
    $today = date('Y-m-d', $now);
    $fp = $ev['fp'];
    $id = $ev['id'];
    $sid = $ev['sid'];

    if ($id) {
        if (!isset($profiles[$id])) {
            $mergedFrom = dent2025_a_try_fp_merge($profiles, $id, $fp, $now, $cfg);
            $profiles[$id] = array(
                'first_seen' => $now,
                'last_seen' => $now,
                'sessions' => 1,
                'active_dates' => array($today),
                'fps' => $fp ? array($fp => 1) : array(),
                'sids' => $sid ? array($sid => 1) : array(),
                'merged_from' => $mergedFrom,
                'is_admin' => false
            );
            if ($mergedFrom && isset($profiles[$mergedFrom])) {
                $old = $profiles[$mergedFrom];
                $old['merged_into'] = $id;
                $profiles[$id]['first_seen'] = min($id ? $old['first_seen'] : $now, $now);
                $profiles[$id]['sessions'] = intval($old['sessions']) + 1;
                $profiles[$id]['active_dates'] = array_values(array_unique(array_merge($old['active_dates'], $profiles[$id]['active_dates'])));
                $profiles[$id]['fps'] = array_merge($old['fps'], $profiles[$id]['fps']);
                $profiles[$id]['sids'] = array_merge($old['sids'], $profiles[$id]['sids']);
                $profiles[$id]['merged_from'] = $old['merged_from'] ?: $mergedFrom;
                unset($profiles[$mergedFrom]);
            }
        } else {
            $p = &$profiles[$id];
            $p['last_seen'] = $now;
            if ($sid && empty($p['sids'][$sid])) {
                $p['sessions'] = intval($p['sessions'] ?? 1) + 1;
            }
            if (empty($p['active_dates']) || end($p['active_dates']) !== $today) {
                $p['active_dates'][] = $today;
                if (count($p['active_dates']) > 366) $p['active_dates'] = array_slice($p['active_dates'], -366);
            }
            if ($fp) $p['fps'][$fp] = intval($p['fps'][$fp] ?? 0) + 1;
            if ($sid) $p['sids'][$sid] = 1;
            // auto-merge: new id seen -> absorb id that matches this fp (secondary)
            dent2025_a_absorb_id_alias($profiles, $id, $fp, $sid, $now, $cfg);
            unset($p);
        }
    } else {
        // anon event -> ghost coalescing
        $key = $fp ? ('ghost_' . $fp) : ('ghost_sid_' . $sid);
        if ($key === 'ghost_sid_') return; // nothing identifiable
        if (!isset($ghost[$key])) {
            $ghost[$key] = array('first_seen' => $now, 'last_seen' => $now, 'sessions' => 1, 'active_dates' => array($today));
        } else {
            $g = &$ghost[$key];
            $g['last_seen'] = $now;
            if (empty($g['active_dates']) || end($g['active_dates']) !== $today) {
                $g['sessions'] = intval($g['sessions'] ?? 1) + 1;
                $g['active_dates'][] = $today;
                if (count($g['active_dates']) > 366) $g['active_dates'] = array_slice($g['active_dates'], -366);
            }
            unset($g);
        }
    }
}

function dent2025_a_update_profiles($ev, $cfg) {
    $profiles = dent2025_a_read_json(dent2025_a_profiles_file());
    if (!is_array($profiles)) $profiles = array();
    $ghost = dent2025_a_read_json(dent2025_a_ghost_file());
    if (!is_array($ghost)) $ghost = array();
    dent2025_a_update_profiles_mem($profiles, $ghost, $ev, $cfg);
    if (!empty($ev['id'])) {
        dent2025_a_write_json(dent2025_a_profiles_file(), $profiles);
    } else {
        dent2025_a_write_json(dent2025_a_ghost_file(), $ghost);
    }
}

// A brand-new id arrives; see if an existing profile shares its fingerprint and was
// recently active but NOT currently active (>= 2h). If so, it's almost certainly the
// same user whose localStorage cookie was cleared/rotated -> absorb history.
function dent2025_a_try_fp_merge($profiles, $id, $fp, $now, $cfg) {
    if (!$cfg['allow_fp_merge'] || !$fp) return null;
    foreach ($profiles as $pid => $p) {
        if ($pid === $id) continue;
        if (isset($p['fps'][$fp])) {
            $last = intval($p['last_seen'] ?? 0);
            $age = $now - $last;
            if ($age >= 7200 && $age < ($cfg['merge_window_days'] * 86400)) {
                return $pid;
            }
        }
    }
    return null;
}

// Lock a rotating id to the same fingerprint alias set (secondary merge).
function dent2025_a_absorb_id_alias($profiles, $id, $fp, $sid, $now, $cfg) {
    if (!$cfg['allow_fp_merge'] || !$fp) return;
    foreach ($profiles as $pid => $p) {
        if ($pid === $id) continue;
        if (isset($p['fps'][$fp])) {
            $age = $now - intval($p['last_seen'] ?? 0);
            if ($age >= 0 && $age < 300) {
                // both ids active within 5 min with same fp: concurrent tabs, keep separate
                return;
            }
            $profiles[$pid]['merged_into'] = $id;
            // Note: profile becomes alias; queries treat it via merged_into
        }
    }
}

function dent2025_a_classify_ident($id, $cfg, $profiles = null) {
    if (empty($id)) return 'anon';
    if ($profiles === null) {
        $profiles = dent2025_a_read_json(dent2025_a_profiles_file());
    }
    $p = is_array($profiles) && isset($profiles[$id]) ? $profiles[$id] : null;
    if (!$p) return 'new';
    if (!empty($p['merged_into'])) return 'anon'; // absorbed alias
    $daysAge = floor((time() - intval($p['first_seen'])) / 86400);
    $sessions = intval($p['sessions'] ?? 1);
    if ($daysAge >= $cfg['established_days'] && $sessions >= $cfg['established_sessions']) {
        return 'established';
    }
    return 'new';
}

function dent2025_a_record_dau_mem(&$dauCache, $ev, $now) {
    $dateKey = date('Y-m-d', $now);
    if (!isset($dauCache[$dateKey])) {
        $file = dent2025_a_dau_file($now);
        $d = dent2025_a_read_json($file);
        $dauCache[$dateKey] = is_array($d) ? $d : array('ids' => array(), 'fps' => array());
    }
    if (!empty($ev['id'])) $dauCache[$dateKey]['ids'][$ev['id']] = true;
    if (!empty($ev['fp'])) $dauCache[$dateKey]['fps'][$ev['fp']] = true;
}

function dent2025_a_record_dau($ev, $now) {
    $file = dent2025_a_dau_file($now);
    $dau = dent2025_a_read_json($file);
    if (!is_array($dau)) $dau = array('ids' => array(), 'fps' => array());
    if (!empty($ev['id'])) $dau['ids'][$ev['id']] = true;
    if (!empty($ev['fp'])) $dau['fps'][$ev['fp']] = true;
    dent2025_a_write_json($file, $dau);
}

// ---------------------------------------------------------------
// ROLLUP ENGINE
// ---------------------------------------------------------------
function dent2025_a_rollup_file($level, $ts, $cfg) {
    $dir = dent2025_a_dir() . '/rollups';
    if ($level === 'hourly') return $dir . '/hourly_' . date('Y-m', $ts) . '.json';
    return $dir . '/' . $level . '.json';
}

function dent2025_a_rollup_keys($ts) {
    return array(
        'daily' => date('Y-m-d', $ts),
        'hourly' => date('Y-m-d', $ts) . '-' . date('H', $ts)
    );
}

function dent2025_a_accumulate_event(&$bucket, $ev, $cfg, $key) {
    $ident = $ev['ident'];
    if (!$ident) return;
    $type = $ev['type'];
    // totals
    $bucket['totals']['all'] = ($bucket['totals']['all'] ?? 0) + 1;
    $bucket['totals'][$ident] = ($bucket['totals'][$ident] ?? 0) + 1;
    // events by type, per ident
    $bucket['events'][$type] = $bucket['events'][$type] ?? array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0);
    $bucket['events'][$type]['all']++;
    $bucket['events'][$type][$ident]++;
    // ctx
    if (!empty($ev['ctx'])) {
        $spec = $ev['ctx']['specialty'];
        $cy = $ev['ctx']['year'];
        $cs = $ev['ctx']['semester'];
        $ck = $spec . '_' . $cy . '_' . $cs;
        $bucket['ctx'][$ck] = $bucket['ctx'][$ck] ?? array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0);
        $bucket['ctx'][$ck]['all']++;
        $bucket['ctx'][$ck][$ident]++;
    }
    // subjects, per ident
    if (!empty($ev['subject'])) {
        $sn = $ev['subject'];
        if (!isset($bucket['subjects'][$sn])) {
            $bucket['subjects'][$sn] = array(
                'opens' => array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0),
                'materials' => array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0),
                'quizzes' => array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0),
                'timer_s' => array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0),
                'timer_n' => array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0)
            );
        }
        if ($type === 'subject_open') {
            $bucket['subjects'][$sn]['opens']['all']++;
            $bucket['subjects'][$sn]['opens'][$ident]++;
        } elseif ($type === 'materials_open') {
            $bucket['subjects'][$sn]['materials']['all']++;
            $bucket['subjects'][$sn]['materials'][$ident]++;
        } elseif ($type === 'quiz_finish') {
            $bucket['subjects'][$sn]['quizzes']['all']++;
            $bucket['subjects'][$sn]['quizzes'][$ident]++;
        } elseif ($type === 'timer_finish') {
            $v = intval($ev['value'] ?? 0);
            $bucket['subjects'][$sn]['timer_s']['all'] += $v;
            $bucket['subjects'][$sn]['timer_s'][$ident] += $v;
            $bucket['subjects'][$sn]['timer_n']['all']++;
            $bucket['subjects'][$sn]['timer_n'][$ident]++;
        }
    }
    // timer, per ident
    if (in_array($type, array('timer_start', 'timer_pause', 'timer_finish'), true)) {
        foreach (array('established', 'new', 'anon') as $i) {
            $bucket['timer'][$i] = $bucket['timer'][$i] ?? array('sessions' => 0, 'seconds' => 0);
        }
        if ($type === 'timer_start' || $type === 'timer_finish') $bucket['timer'][$ident]['sessions']++;
        if ($type === 'timer_finish') $bucket['timer'][$ident]['seconds'] += intval($ev['value'] ?? 0);
    }
    // quiz, per ident
    if (in_array($type, array('quiz_start', 'quiz_finish', 'quiz_wrong'), true)) {
        foreach (array('established', 'new', 'anon') as $i) {
            $bucket['quiz'][$i] = $bucket['quiz'][$i] ?? array('attempts' => 0, 'passed' => 0, 'wrong' => 0, 'score_sum' => 0, 'score_n' => 0);
        }
        if ($type === 'quiz_start') $bucket['quiz'][$ident]['attempts']++;
        elseif ($type === 'quiz_finish') {
            $sc = intval($ev['value'] ?? 0);
            $bucket['quiz'][$ident]['score_sum'] += $sc;
            $bucket['quiz'][$ident]['score_n']++;
            if ($sc >= intval($cfg['quiz_pass_threshold'])) $bucket['quiz'][$ident]['passed']++;
        } elseif ($type === 'quiz_wrong') $bucket['quiz'][$ident]['wrong']++;
    }
    // funnel, per ident
    $fstep = null;
    if ($type === 'page_view') $fstep = 'visit';
    elseif ($type === 'context_select') $fstep = 'context_select';
    elseif ($type === 'subject_open') $fstep = 'subject_open';
    elseif ($type === 'materials_open') $fstep = 'materials_open';
    elseif ($type === 'quiz_finish') $fstep = 'quiz_finish';
    if ($fstep) {
        $bucket['funnel'][$fstep] = $bucket['funnel'][$fstep] ?? array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0);
        $bucket['funnel'][$fstep]['all']++;
        $bucket['funnel'][$fstep][$ident]++;
    }
}

function dent2025_a_rollup_cursor_file() {
    return dent2025_a_dir() . '/rollup_cursor.json';
}

// Per-hour watermark offsets so a partially-filled current hour can be folded
// repeatedly without double counting (idempotent incremental fold).
function dent2025_a_offsets_file() {
    return dent2025_a_dir() . '/rollup_offsets.json';
}

function dent2025_a_load_offsets() {
    $d = dent2025_a_read_json(dent2025_a_offsets_file());
    return is_array($d) ? $d : array();
}

function dent2025_a_fold_hour($hourTs, $cfg, $offset) {
    $rawFile = dent2025_a_raw_file_for($hourTs);
    $events = dent2025_a_read_json($rawFile);
    if (!is_array($events) || count($events) === 0) {
        return 0;
    }
    $total = count($events);
    if ($offset >= $total) return $total;
    $newEvents = array_slice($events, $offset);
    if (count($newEvents) === 0) return $total;

    // Cache rollup files keyed by their absolute filename so events spanning
    // multiple timestamps within a raw file fold into the correct bucket.
    $fileCache = array();
    $getRollup = function ($level, $ts) use (&$fileCache, $cfg) {
        $path = dent2025_a_rollup_file($level, $ts, $cfg);
        if (!isset($fileCache[$path])) {
            $fileCache[$path] = dent2025_a_read_json($path);
            if (!is_array($fileCache[$path])) $fileCache[$path] = array();
        }
        return $path;
    };

    foreach ($newEvents as $ev) {
        if (empty($ev['ident'])) continue;
        $evTs = intval($ev['ts'] ?? $hourTs);
        if ($evTs > 99999999999) $evTs = intval($evTs / 1000); // ms -> s safety
        if (!$evTs) $evTs = $hourTs;
        $hKey = date('Y-m-d', $evTs) . '-' . date('H', $evTs);
        $dKey = date('Y-m-d', $evTs);
        $wKey = date('o-W', $evTs);
        $mKey = date('Y-m', $evTs);

        $hPath = $getRollup('hourly', $evTs);
        $fileCache[$hPath][$hKey] = $fileCache[$hPath][$hKey] ?? array();
        dent2025_a_accumulate_event($fileCache[$hPath][$hKey], $ev, $cfg, $hKey);

        $dPath = $getRollup('daily', $evTs);
        $fileCache[$dPath][$dKey] = $fileCache[$dPath][$dKey] ?? array();
        dent2025_a_accumulate_event($fileCache[$dPath][$dKey], $ev, $cfg, $dKey);

        $wPath = $getRollup('weekly', $evTs);
        $fileCache[$wPath][$wKey] = $fileCache[$wPath][$wKey] ?? array();
        dent2025_a_accumulate_event($fileCache[$wPath][$wKey], $ev, $cfg, $wKey);

        $mPath = $getRollup('monthly', $evTs);
        $fileCache[$mPath][$mKey] = $fileCache[$mPath][$mKey] ?? array();
        dent2025_a_accumulate_event($fileCache[$mPath][$mKey], $ev, $cfg, $mKey);
    }
    foreach ($fileCache as $path => $data) {
        dent2025_a_write_json($path, $data);
    }
    return $total;
}

function dent2025_a_ensure_rollups($cfg) {
    $cursorFile = dent2025_a_rollup_cursor_file();
    $offsets = dent2025_a_load_offsets();
    $cursor = 0;
    $c = dent2025_a_read_json($cursorFile);
    if (is_array($c)) $cursor = intval($c['rolled_up_to'] ?? 0);
    $nowHour = strtotime(date('Y-m-d H:00:00')); // start of current hour
    // Fold from cursor+1 hour up through the CURRENT hour (so today's data shows live).
    $start = max($cursor + 3600, $nowHour - 96 * 3600);
    if ($cursor === 0) $start = $nowHour - 48 * 3600;
    $h = $start;
    while ($h <= $nowHour) {
        $key = dent2025_a_rollup_keys($h)['hourly'];
        $offset = isset($offsets[$key]) ? intval($offsets[$key]) : 0;
        $total = dent2025_a_fold_hour($h, $cfg, $offset);
        if ($total > 0) $offsets[$key] = $total;
        $h += 3600;
    }
    dent2025_a_write_json($cursorFile, array('rolled_up_to' => $nowHour, 'updated_at' => time()));
    // Prune offsets for hours that no longer exist (they were fully folded & removed)
    foreach (array_keys($offsets) as $k) {
        if (!file_exists(dent2025_a_raw_file_for(strtotime(str_replace('-', ' ', $k) . ':00')))) {
            // keep offsets for current-hour style files; drop only when file truly gone AND old
            if (strtotime(substr($k, 0, 10)) < strtotime('-7 days')) unset($offsets[$k]);
        }
    }
    dent2025_a_write_json(dent2025_a_offsets_file(), $offsets);
    dent2025_a_gc($cfg);
}

function dent2025_a_gc($cfg) {
    $dir = dent2025_a_dir();
    // raw
    $cutRaw = strtotime('-' . intval($cfg['raw_retention_days']) . ' days');
    foreach (glob($dir . '/raw/raw_*.json') as $f) {
        if (filemtime($f) < $cutRaw) @unlink($f);
    }
    // hourly rollups
    $cutH = strtotime('-' . intval($cfg['hourly_retention_days']) . ' days');
    foreach (glob($dir . '/rollups/hourly_*.json') as $f) {
        if (filemtime($f) < $cutH) @unlink($f);
    }
    // daily
    $cutD = strtotime('-' . intval($cfg['daily_retention_days']) . ' days');
    if (file_exists($dir . '/rollups/daily.json')) {
        $dData = dent2025_a_read_json($dir . '/rollups/daily.json');
        if (is_array($dData)) {
            $changed = false;
            foreach (array_keys($dData) as $k) {
                if (strtotime($k) < $cutD) { unset($dData[$k]); $changed = true; }
            }
            if ($changed) dent2025_a_write_json($dir . '/rollups/daily.json', $dData);
        }
    }
    // weekly
    if (file_exists($dir . '/rollups/weekly.json')) {
        $wData = dent2025_a_read_json($dir . '/rollups/weekly.json');
        if (is_array($wData)) {
            $changed = false;
            foreach (array_keys($wData) as $k) {
                $yr = intval(substr($k, 0, 4)); $wk = intval(substr($k, 5));
                if ($yr < date('Y') - 2) { unset($wData[$k]); $changed = true; }
            }
            if ($changed) dent2025_a_write_json($dir . '/rollups/weekly.json', $wData);
        }
    }
    // dau
    $cutDau = strtotime('-' . intval($cfg['dau_retention_days']) . ' days');
    foreach (glob($dir . '/dau/dau_*.json') as $f) {
        if (filemtime($f) < $cutDau) @unlink($f);
    }
    // rate files already cleaned inline
}

// ---------------------------------------------------------------
// IDENTITY FILTER HELPERS
// ---------------------------------------------------------------
function dent2025_a_filters_from_input($cfg) {
    $incl = function($k, $def = 1) {
        $v = $_GET[$k] ?? $_POST[$k] ?? $def;
        return (in_array(strtolower($v), array('0', 'false', 'no', ''), true) || $v === false) ? false : (bool)$v;
    };
    return array(
        'incl_est' => $incl('incl_est', 1),
        'incl_new' => $incl('incl_new', 1),
        'incl_anon' => $incl('incl_anon', 1),
        'anon_separate' => $incl('anon_separate', 0)
    );
}

function dent2025_a_ident_active($ident, $filters) {
    if ($ident === 'established') return $filters['incl_est'];
    if ($ident === 'new') return $filters['incl_new'];
    return $filters['incl_anon'];
}

function dent2025_a_sum_selector($bucket, $filters, $selector = null) {
    // Returns selected all/est/new/anon counts for a bucket or bucket array
    $sum = 0;
    if (is_array($bucket)) {
        foreach (array('established', 'new', 'anon') as $i) {
            if (dent2025_a_ident_active($i, $filters)) {
                if ($selector !== null && isset($bucket[$selector]) && is_array($bucket[$selector])) {
                    $sum += intval($bucket[$selector][$i] ?? 0);
                } elseif ($selector === null) {
                    $sum += intval($bucket[$i] ?? 0);
                }
            }
        }
    }
    return $sum;
}

// Sum a per-identity breakdown dict {all, established, new, anon} honoring filters.
function dent2025_a_ident_sum($d, $filters) {
    $sum = 0;
    if (!is_array($d)) return 0;
    foreach (array('established', 'new', 'anon') as $i) {
        if (dent2025_a_ident_active($i, $filters)) $sum += intval($d[$i] ?? 0);
    }
    return $sum;
}

function dent2025_a_date_range() {
    $from = isset($_GET['from']) ? preg_replace('/[^0-9\-]/', '', $_GET['from']) : '';
    $to = isset($_GET['to']) ? preg_replace('/[^0-9\-]/', '', $_GET['to']) : '';
    if ($from) $from = date('Y-m-d', strtotime($from));
    if ($to) $to = date('Y-m-d', strtotime($to));
    return array($from, $to);
}

function dent2025_a_period() {
    $p = $_GET['period'] ?? 'day';
    return in_array($p, array('hour', 'day', 'week', 'month'), true) ? $p : 'day';
}

// ---------------------------------------------------------------
// ADMIN AUTH
// ---------------------------------------------------------------
function dent2025_a_require_admin() {
    $pass = isset($_POST['password']) ? $_POST['password'] : ($_GET['password'] ?? '');
    if (!$pass || !dent2025_check_rbac_permission($pass, 'manage_passwords')) {
        http_response_code(403);
        echo json_encode(array('success' => false, 'message' => 'Unauthorized'));
        exit;
    }
}

// ---------------------------------------------------------------
// HANDLER
// ---------------------------------------------------------------
$action = isset($_POST['action']) ? $_POST['action'] : ($_GET['action'] ?? '');
$action = in_array($action, $ACTION_WHITELIST, true) ? $action : '';

if ($method === 'POST' && $action === 'track') {
    $cfg = dent2025_a_config();
    if (empty($cfg['track_enabled'])) {
        echo json_encode(array('success' => true)); // silently accept but drop
        exit;
    }
    $inputRaw = file_get_contents('php://input');
    $input = json_decode($inputRaw, true) ?: array();
    $events = $input['events'] ?? array();
    if (!is_array($events) || count($events) === 0) {
        echo json_encode(array('success' => false, 'message' => 'No events'));
        exit;
    }
    if (count($events) > intval($cfg['max_events_per_batch'])) {
        $events = array_slice($events, 0, intval($cfg['max_events_per_batch']));
    }
    // rate limit: per minute bucket
    $ip = dent2025_a_client_ip();
    $bucket = date('Y-m-d-H-i');
    $rateFile = dent2025_a_dir() . '/rate/rate_' . md5($ip) . '_' . $bucket . '.json';
    $rateCount = 0;
    $rd = dent2025_a_read_json($rateFile);
    if (is_array($rd)) $rateCount = intval($rd['count'] ?? 0);
    if ($rateCount + count($events) > intval($cfg['rate_limit_events_per_min'])) {
        http_response_code(429);
        echo json_encode(array('success' => false, 'message' => 'Rate limited'));
        exit;
    }
    dent2025_a_write_json($rateFile, array('ip' => md5($ip), 'bucket' => $bucket, 'count' => $rateCount + count($events)));

    $id = dent2025_a_sanitize($input['id'] ?? '', 64) ?: null;
    $sid = dent2025_a_sanitize($input['sid'] ?? '', 40) ?: null;
    $fp = dent2025_a_sanitize($input['fp'] ?? '', 40) ?: null;

    $validEvents = array();
    $rawFile = dent2025_a_raw_file_for(time());
    $existing = dent2025_a_read_json($rawFile);
    if (!is_array($existing)) $existing = array();

    $profiles = dent2025_a_read_json(dent2025_a_profiles_file());
    if (!is_array($profiles)) $profiles = array();
    $ghost = dent2025_a_read_json(dent2025_a_ghost_file());
    if (!is_array($ghost)) $ghost = array();
    $dauCache = array();

    $now = time();
    $hasProfilesMod = false;
    $hasGhostMod = false;

    foreach ($events as $ev) {
        $v = dent2025_a_validate_event($ev, $cfg);
        if (!$v) continue;
        $evTs = isset($ev['ts']) ? intval($ev['ts']) : $now;
        if ($evTs > 99999999999) $evTs = intval($evTs / 1000); // ms -> s
        if ($evTs <= 0) $evTs = $now;
        if ($evTs > $now) $evTs = $now;                       // future ts clamp
        if ($evTs < $now - 30 * 86400) $evTs = $now;          // stale clamp
        $v['ts'] = $evTs;
        $v['id'] = $v['id'] ?: $id;
        $v['sid'] = $v['sid'] ?: $sid;
        $v['fp'] = $v['fp'] ?: $fp;
        $v['ident'] = dent2025_a_classify_ident($v['id'], $cfg, $profiles);
        // Alias-absorbed ids become anon bucket (they were merged away)
        $existing[] = $v;
        $validEvents[] = $v;
        dent2025_a_update_profiles_mem($profiles, $ghost, $v, $cfg);
        if (!empty($v['id'])) $hasProfilesMod = true;
        else $hasGhostMod = true;
        dent2025_a_record_dau_mem($dauCache, $v, $v['ts']);
    }
    if (count($validEvents) > 0) {
        dent2025_a_write_json($rawFile, $existing);
        if ($hasProfilesMod) {
            dent2025_a_write_json(dent2025_a_profiles_file(), $profiles);
        }
        if ($hasGhostMod) {
            dent2025_a_write_json(dent2025_a_ghost_file(), $ghost);
        }
        foreach ($dauCache as $dDate => $dData) {
            $dauFile = dent2025_a_dir() . '/dau/dau_' . $dDate . '.json';
            dent2025_a_write_json($dauFile, $dData);
        }
    }
    echo json_encode(array('success' => true, 'received' => count($validEvents)));
    exit;
}

if ($action === 'health') {
    $dir = dent2025_a_dir();
    $rawFiles = glob($dir . '/raw/raw_*.json');
    $dauFiles = glob($dir . '/dau/dau_*.json');
    $size = 0;
    foreach (glob($dir . '/**/*.json') as $f) $size += filesize($f);
    $latest = 0;
    if ($rawFiles) {
        $latestFile = end($rawFiles);
        $d = dent2025_a_read_json($latestFile);
        if (is_array($d) && count($d) > 0) $latest = intval($d[count($d) - 1]['ts'] ?? 0);
    }
    echo json_encode(array(
        'success' => true,
        'data' => array(
            'storage_bytes' => $size,
            'raw_shards' => count($rawFiles),
            'dau_shards' => count($dauFiles),
            'latest_event_ts' => $latest,
            'profile_count' => count(dent2025_a_read_json(dent2025_a_profiles_file()) ?: array())
        )
    ));
    exit;
}

// ------------- Admin endpoints -------------
if (in_array($action, array('overview', 'trend', 'ctx_heatmap', 'subjects', 'timer_patterns',
    'funnel', 'retention', 'identity', 'raw', 'config', 'rollup_now'), true)) {
    dent2025_a_require_admin();
    $cfg = dent2025_a_config();
    dent2025_a_ensure_rollups($cfg);
    $filters = dent2025_a_filters_from_input($cfg);
    list($from, $to) = dent2025_a_date_range();
    if (!$from) $from = date('Y-m-d', strtotime('-30 days'));
    if (!$to) $to = date('Y-m-d');
    $fromTs = strtotime($from . ' 00:00:00');
    $toTs = strtotime($to . ' 23:59:59');

    $dailyFile = dent2025_a_dir() . '/rollups/daily.json';
    $daily = dent2025_a_read_json($dailyFile);
    if (!is_array($daily)) $daily = array();

    $dauDir = dent2025_a_dir() . '/dau';
    $profiles = dent2025_a_read_json(dent2025_a_profiles_file());
    if (!is_array($profiles)) $profiles = array();
    $ghost = dent2025_a_read_json(dent2025_a_ghost_file());
    if (!is_array($ghost)) $ghost = array();

    if ($action === 'overview') {
        $today = date('Y-m-d');
        $todayBucket = $daily[$today] ?? array();
        $todayTotals = $todayBucket['totals'] ?? array();
        $statsToday = array(
            'all' => dent2025_a_ident_sum($todayTotals, $filters),
            'established' => dent2025_a_ident_active('established', $filters) ? intval($todayTotals['established'] ?? 0) : 0,
            'new' => dent2025_a_ident_active('new', $filters) ? intval($todayTotals['new'] ?? 0) : 0,
            'anon' => dent2025_a_ident_active('anon', $filters) ? intval($todayTotals['anon'] ?? 0) : 0
        );

        // active distinct in 24h/7d/30d from dau files
        $active = array('24h' => array('est' => 0, 'new' => 0, 'anon' => 0, 'total' => 0), '7d' => array('est' => 0, 'new' => 0, 'anon' => 0, 'total' => 0), '30d' => array('est' => 0, 'new' => 0, 'anon' => 0, 'total' => 0));
        $seenIds = array(array(), array(), array());
        $seenFps = array(array(), array(), array());
        // Track which fingerprints belong to identified profiles so anon-DAU does not
        // double count the same visitor (id-derived + fp-derived).
        $knownFps = array();
        foreach ($profiles as $pid => $p) {
            if (!empty($p['merged_into'])) continue;
            foreach ((array)($p['fps'] ?? array()) as $fp => $cnt) {
                if ($fp !== '') $knownFps[$fp] = true;
            }
        }
        foreach (glob($dauDir . '/dau_*.json') as $f) {
            $day = basename($f, '.json');
            $day = substr($day, 4);
            $dayTs = strtotime($day);
            if (!$dayTs) continue;
            $dau = dent2025_a_read_json($f);
            if (!is_array($dau)) continue;
            for ($w = 0; $w < 3; $w++) {
                $windowDays = $w === 0 ? 1 : ($w === 1 ? 7 : 30);
                $windowStartTs = strtotime('-' . ($windowDays - 1) . ' days', $toTs);
                $windowLabel = $w === 0 ? '24h' : ($w === 1 ? '7d' : '30d');
                if ($dayTs >= $windowStartTs) {
                    foreach (array_keys($dau['ids'] ?? array()) as $pid) {
                        if (!isset($seenIds[$w][$pid])) {
                            $seenIds[$w][$pid] = true;
                            $cls = dent2025_a_classify_ident($pid, $cfg);
                            $key = $cls === 'established' ? 'est' : $cls;
                            if (isset($active[$windowLabel][$key]) && dent2025_a_ident_active($cls, $filters)) $active[$windowLabel][$key]++;
                        }
                    }
                    foreach (array_keys($dau['fps'] ?? array()) as $fp) {
                        if (isset($knownFps[$fp])) continue; // already counted via id
                        if (!isset($seenFps[$w][$fp])) {
                            $seenFps[$w][$fp] = true;
                            if (dent2025_a_ident_active('anon', $filters)) $active[$windowLabel]['anon']++;
                        }
                    }
                }
            }
        }
        foreach ($active as $k => &$v) {
            $v['total'] = $v['est'] + $v['new'] + $v['anon'];
        }
        unset($v);

        // study & quiz aggregates over range, per ident
        $timerAgg = array('seconds' => 0, 'sessions' => 0);
        $quizAgg = array('attempts' => 0, 'passed' => 0, 'wrong' => 0);
        $pdViews = 0;
        foreach ($daily as $day => $b) {
            if (strtotime($day) < $fromTs || strtotime($day) > $toTs) continue;
            $pdViews += dent2025_a_ident_sum($b['events']['page_view'] ?? array(), $filters);
            foreach (array('established', 'new', 'anon') as $i) {
                if (!dent2025_a_ident_active($i, $filters)) continue;
                $tb = $b['timer'][$i] ?? array();
                $qb = $b['quiz'][$i] ?? array();
                $timerAgg['seconds'] += intval($tb['seconds'] ?? 0);
                $timerAgg['sessions'] += intval($tb['sessions'] ?? 0);
                $quizAgg['attempts'] += intval($qb['attempts'] ?? 0);
                $quizAgg['passed'] += intval($qb['passed'] ?? 0);
                $quizAgg['wrong'] += intval($qb['wrong'] ?? 0);
            }
        }
        $anonShare = 0;
        $viewsAll = dent2025_a_sum_selector($todayBucket['totals'] ?? array(), $filters);
        $viewsAnon = dent2025_a_ident_active('anon', $filters) ? intval($todayBucket['totals']['anon'] ?? 0) : 0;
        if ($viewsAll > 0) $anonShare = round($viewsAnon / $viewsAll * 100, 1);

        echo json_encode(array(
            'success' => true,
            'filters' => $filters,
            'data' => array(
                'today' => $statsToday,
                'active' => $active,
                'page_views_range' => $pdViews,
                'study' => array('hours' => round($timerAgg['seconds'] / 3600, 1), 'seconds' => $timerAgg['seconds'], 'sessions' => $timerAgg['sessions'], 'avg_session_s' => $timerAgg['sessions'] > 0 ? round($timerAgg['seconds'] / $timerAgg['sessions']) : 0),
                'quiz' => array('attempts' => $quizAgg['attempts'], 'passed' => $quizAgg['passed'], 'pass_rate' => $quizAgg['attempts'] > 0 ? round($quizAgg['passed'] / $quizAgg['attempts'] * 100, 1) : 0, 'wrong' => $quizAgg['wrong']),
                'anon_share_pct' => $anonShare,
                'range' => array('from' => $from, 'to' => $to)
            )
        ));
        exit;
    }

    if ($action === 'ctx_heatmap') {
        $out = array();
        $ctxNames = array('dentistry' => 'طب الأسنان', 'medicine' => 'الطب البشري', 'pre-med' => 'التحضيري');
        $agg = array();
        foreach ($daily as $day => $b) {
            if (strtotime($day) < $fromTs || strtotime($day) > $toTs) continue;
            $ctxs = $b['ctx'] ?? array();
            foreach ($ctxs as $ck => $cb) {
                $agg[$ck] = $agg[$ck] ?? array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0);
                $agg[$ck]['all'] += intval($cb['all'] ?? 0);
                $agg[$ck]['established'] += intval($cb['established'] ?? 0);
                $agg[$ck]['new'] += intval($cb['new'] ?? 0);
                $agg[$ck]['anon'] += intval($cb['anon'] ?? 0);
            }
        }
        foreach ($agg as $ck => $cb) {
            $parts = explode('_', $ck);
            $spec = $parts[0];
            $year = isset($parts[1]) ? intval($parts[1]) : null;
            $sem = isset($parts[2]) ? intval($parts[2]) : null;
            $selected = 0;
            foreach (array('established', 'new', 'anon') as $i) {
                if (dent2025_a_ident_active($i, $filters)) $selected += intval($cb[$i] ?? 0);
            }
            $out[] = array(
                'key' => $ck,
                'specialty' => $spec,
                'specialty_label' => $ctxNames[$spec] ?? $spec,
                'year' => $year,
                'semester' => $sem,
                'all' => intval($cb['all'] ?? 0),
                'established' => intval($cb['established'] ?? 0),
                'new' => intval($cb['new'] ?? 0),
                'anon' => intval($cb['anon'] ?? 0),
                'selected' => $selected
            );
        }
        usort($out, function($a, $b) { return $b['selected'] - $a['selected']; });
        echo json_encode(array('success' => true, 'data' => $out));
        exit;
    }

    if ($action === 'subjects') {
        $agg = array();
        foreach ($daily as $day => $b) {
            if (strtotime($day) < $fromTs || strtotime($day) > $toTs) continue;
            foreach (($b['subjects'] ?? array()) as $sn => $sb) {
                $agg[$sn] = $agg[$sn] ?? array('opens' => 0, 'materials' => 0, 'quizzes' => 0, 'timer_s' => 0, 'timer_n' => 0);
                $agg[$sn]['opens'] += dent2025_a_ident_sum($sb['opens'] ?? array(), $filters);
                $agg[$sn]['materials'] += dent2025_a_ident_sum($sb['materials'] ?? array(), $filters);
                $agg[$sn]['quizzes'] += dent2025_a_ident_sum($sb['quizzes'] ?? array(), $filters);
                $agg[$sn]['timer_s'] += dent2025_a_ident_sum($sb['timer_s'] ?? array(), $filters);
                $agg[$sn]['timer_n'] += dent2025_a_ident_sum($sb['timer_n'] ?? array(), $filters);
            }
        }
        $out = array();
        foreach ($agg as $sn => $sb) {
            $opens = intval($sb['opens']);
            $materials = intval($sb['materials']);
            $abandon = $opens > 0 ? round(max(0, ($opens - $materials)) / $opens * 100, 1) : 0;
            $out[] = array(
                'name' => $sn,
                'opens' => $opens,
                'materials' => $materials,
                'quizzes' => intval($sb['quizzes']),
                'hours' => round(intval($sb['timer_s']) / 3600, 2),
                'timer_n' => intval($sb['timer_n']),
                'abandon_rate' => $abandon
            );
        }
        usort($out, function($a, $b) { return $b['opens'] - $a['opens']; });
        echo json_encode(array('success' => true, 'data' => $out));
        exit;
    }

    if ($action === 'trend') {
        $period = dent2025_a_period();
        $seriesSrc = null;
        if ($period === 'hour') {
            $src = array();
            foreach (glob(dent2025_a_dir() . '/rollups/hourly_*.json') as $f) {
                $m = dent2025_a_read_json($f);
                if (is_array($m)) $src = array_merge($src, $m);
            }
            ksort($src);
            $seriesSrc = $src;
        } elseif ($period === 'week') {
            $src = dent2025_a_read_json(dent2025_a_dir() . '/rollups/weekly.json');
            if (!is_array($src)) $src = array();
            ksort($src);
            $seriesSrc = $src;
        } elseif ($period === 'month') {
            $src = dent2025_a_read_json(dent2025_a_dir() . '/rollups/monthly.json');
            if (!is_array($src)) $src = array();
            ksort($src);
            $seriesSrc = $src;
        } else {
            $src = $daily;
            ksort($src);
            $seriesSrc = $src;
        }
        $labels = array(); $series = array('all' => array(), 'established' => array(), 'new' => array(), 'anon' => array());
        foreach ($seriesSrc as $key => $b) {
            // key filtering by period type
            $keyTs = ('hour' === $period) ? strtotime(substr($key, 0, 10) . ' ' . substr($key, 11, 2) . ':00:00') : strtotime(substr($key, 0, 10));
            if (!$keyTs) continue;
            if ('week' === $period) {
                $keyTs = strtotime(substr($key, 0, 4) . '-W' . sprintf('%02d', intval(substr($key, 5))) . '-1');
                if (!$keyTs) continue;
            }
            if ($keyTs < $fromTs || $keyTs > $toTs) continue;
            $labels[] = $key;
            $series['all'][] = dent2025_a_sum_selector($b['totals'] ?? array(), $filters);
            $series['established'][] = dent2025_a_ident_active('established', $filters) ? intval($b['totals']['established'] ?? 0) : 0;
            $series['new'][] = dent2025_a_ident_active('new', $filters) ? intval($b['totals']['new'] ?? 0) : 0;
            $series['anon'][] = dent2025_a_ident_active('anon', $filters) ? intval($b['totals']['anon'] ?? 0) : 0;
        }
        echo json_encode(array('success' => true, 'data' => array('period' => $period, 'labels' => $labels, 'series' => $series)));
        exit;
    }

    if ($action === 'timer_patterns') {
        // 24h curve + weekday curve from hourly data within range
        $hourSrc = array();
        foreach (glob(dent2025_a_dir() . '/rollups/hourly_*.json') as $f) {
            $m = dent2025_a_read_json($f);
            if (is_array($m)) $hourSrc = array_merge($hourSrc, $m);
        }
        $hours24 = array(); for ($i = 0; $i < 24; $i++) $hours24['hour_' . $i] = array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0);
        $weekday = array(); foreach (array(0,1,2,3,4,5,6) as $d) $weekday['d' . $d] = array('all' => 0, 'established' => 0, 'new' => 0, 'anon' => 0);
        $monthAgg = array();
        $totalSec = 0; $totalSess = 0;
        foreach (glob(dent2025_a_dir() . '/rollups/hourly_*.json') as $f) {
            $m = dent2025_a_read_json($f);
            if (!is_array($m)) continue;
            foreach ($m as $hkey => $b) {
                $t = strtotime(substr($hkey, 0, 10) . ' ' . substr($hkey, 11, 2) . ':00:00');
                if (!$t || $t < $fromTs || $t > $toTs) continue;
                $H = intval(date('H', $t));
                $w = intval(date('w', $t));
                // aggregate per-ident seconds
                $bSecs = array('established' => 0, 'new' => 0, 'anon' => 0);
                $bSess = array('established' => 0, 'new' => 0, 'anon' => 0);
                foreach (array('established', 'new', 'anon') as $i) {
                    $bSecs[$i] = intval($b['timer'][$i]['seconds'] ?? 0);
                    $bSess[$i] = intval($b['timer'][$i]['sessions'] ?? 0);
                }
                $totalSec += dent2025_a_ident_sum($bSecs, $filters);
                $totalSess += dent2025_a_ident_sum($bSess, $filters);
                foreach (array('established', 'new', 'anon') as $i) {
                    $hours24['hour_' . $H][$i] += $bSecs[$i];
                    $weekday['d' . $w][$i] += $bSecs[$i];
                }
                $mk = date('Y-m', $t);
                $monthAgg[$mk] = ($monthAgg[$mk] ?? 0) + dent2025_a_ident_sum($bSecs, $filters);
            }
        }
        foreach ($hours24 as $k => &$hb) {
            $hb['all'] = 0;
            foreach (array('established', 'new', 'anon') as $i) if (dent2025_a_ident_active($i, $filters)) $hb['all'] += intval($hb[$i]);
            $hb['seconds'] = $hb['all'];
        }
        unset($hb);
        foreach ($weekday as $k => &$wb) {
            $wb['all'] = 0;
            foreach (array('established', 'new', 'anon') as $i) if (dent2025_a_ident_active($i, $filters)) $wb['all'] += intval($wb[$i]);
            $wb['seconds'] = $wb['all'];
        }
        unset($wb);
        ksort($monthAgg);
        ksort($hours24);
        ksort($weekday);
        echo json_encode(array(
            'success' => true,
            'data' => array(
                'hours_24' => $hours24,
                'weekday' => $weekday,
                'monthly' => $monthAgg,
                'total_hours' => round($totalSec / 3600, 1),
                'avg_session_s' => $totalSess > 0 ? round($totalSec / $totalSess) : 0
            )
        ));
        exit;
    }

    if ($action === 'funnel') {
        $steps = array('visit' => 0, 'context_select' => 0, 'subject_open' => 0, 'materials_open' => 0, 'quiz_finish' => 0);
        $stepsNames = array(
            'visit' => 'زيارة الموقع',
            'context_select' => 'اختيار التخصص/السنة/الفصل',
            'subject_open' => 'فتح مادة',
            'materials_open' => 'فتح مصادر/روابط المادة',
            'quiz_finish' => 'إنهاء اختبار'
        );
        foreach ($daily as $day => $b) {
            if (strtotime($day) < $fromTs || strtotime($day) > $toTs) continue;
            $fb = $b['funnel'] ?? array();
            foreach (array_keys($steps) as $k) {
                $steps[$k] += dent2025_a_ident_sum($fb[$k] ?? array(), $filters);
            }
        }
        // Also include today's not-yet-rolled hours via raw (best effort): fold ensures processed. Fine as-is.
        $out = array();
        $prev = $steps['visit'];
        foreach (array_keys($steps) as $k) {
            $conv = $prev > 0 ? round($steps[$k] / $prev * 100, 1) : 0;
            $out[] = array(
                'key' => $k,
                'label' => $stepsNames[$k],
                'count' => $steps[$k],
                'conversion_from_prev' => $conv,
                'dropoff' => $k === 'visit' ? null : round(100 - $conv, 1)
            );
            $prev = $steps[$k];
        }
        echo json_encode(array('success' => true, 'data' => $out));
        exit;
    }

    if ($action === 'retention') {
        // D1/D7: for each profile active within range, do they have active_dates 1/7 days later
        $d1 = array('n' => 0, 'ret' => 0);
        $d7 = array('n' => 0, 'ret' => 0);
        $streakDist = array();
        $cohorts = array();
        $profileSeen = array();
        foreach ($profiles as $pid => $p) {
            if (!empty($p['merged_into'])) continue;
            $cls = dent2025_a_classify_ident($pid, $cfg);
            if (!dent2025_a_ident_active($cls, $filters)) continue;
            $dates = $p['active_dates'] ?? array();
            if (!is_array($dates) || count($dates) === 0) continue;
            $startTs = strtotime($dates[0]);
            if ($startTs < $fromTs || $startTs > $toTs) continue;
            $profileSeen[] = $pid;
            // D1
            $d1['n']++;
            if (in_array(date('Y-m-d', $startTs + 86400), $dates, true)) $d1['ret']++;
            // D7
            $d7['n']++;
            $ret7 = false;
            for ($x = 2; $x <= 7; $x++) {
                if (in_array(date('Y-m-d', $startTs + $x * 86400), $dates, true)) { $ret7 = true; break; }
            }
            if ($ret7) $d7['ret']++;
            // streak: max consecutive in dates
            $maxStreak = 1; $cur = 1;
            sort($dates);
            for ($i = 1; $i < count($dates); $i++) {
                if (strtotime($dates[$i]) - strtotime($dates[$i - 1]) === 86400) { $cur++; if ($cur > $maxStreak) $maxStreak = $cur; }
                else $cur = 1;
            }
            $streakDist[$maxStreak] = intval($streakDist[$maxStreak] ?? 0) + 1;
            // cohort by ISO week of first_seen
            $wk = date('o-W', $startTs);
            $cohorts[$wk] = $cohorts[$wk] ?? array('size' => 0, 'ret1' => 0, 'ret3' => 0);
            $cohorts[$wk]['size']++;
            if (in_array(date('Y-m-d', $startTs + 7 * 86400), $dates, true)) $cohorts[$wk]['ret1']++;
            if (in_array(date('Y-m-d', $startTs + 21 * 86400), $dates, true)) $cohorts[$wk]['ret3']++;
        }
        ksort($streakDist);
        ksort($cohorts);
        $cohortOut = array();
        foreach ($cohorts as $wk => $c) {
            $cohortOut[] = array(
                'week' => $wk,
                'size' => $c['size'],
                'ret_week1_pct' => $c['size'] > 0 ? round($c['ret1'] / $c['size'] * 100, 1) : 0,
                'ret_week3_pct' => $c['size'] > 0 ? round($c['ret3'] / $c['size'] * 100, 1) : 0
            );
        }
        echo json_encode(array(
            'success' => true,
            'data' => array(
                'd1' => $d1['n'] > 0 ? round($d1['ret'] / $d1['n'] * 100, 1) : 0,
                'd7' => $d7['n'] > 0 ? round($d7['ret'] / $d7['n'] * 100, 1) : 0,
                'profiles_seen' => count($profileSeen),
                'streak_distribution' => $streakDist,
                'cohorts' => array_slice(array_reverse($cohortOut), 0, 12)
            )
        ));
        exit;
    }

    if ($action === 'identity') {
        $est = 0; $new = 0; $anonProfiles = 0;
        foreach ($profiles as $pid => $p) {
            if (!empty($p['merged_into'])) { $anonProfiles++; continue; }
            $cls = dent2025_a_classify_ident($pid, $cfg);
            if ($cls === 'established') $est++;
            else $new++;
        }
        // anon events today from totals
        $today = date('Y-m-d');
        $tb = $daily[$today] ?? array();
        $anonEventsToday = dent2025_a_ident_active('anon', $filters) ? intval($tb['totals']['anon'] ?? 0) : 0;
        echo json_encode(array(
            'success' => true,
            'data' => array(
                'established' => $est,
                'new' => $new,
                'anon_devices_estim' => count($ghost),
                'anon_aliases_merged' => $anonProfiles,
                'anon_events_today' => $anonEventsToday,
                'total_profiles' => count($profiles)
            )
        ));
        exit;
    }

    if ($action === 'raw') {
        $page = max(1, intval($_GET['page'] ?? 1));
        $limit = min(200, max(10, intval($_GET['limit'] ?? 50)));
        $events = array();
        $files = glob(dent2025_a_dir() . '/raw/raw_*.json');
        rsort($files);
        $files = array_slice($files, 0, 72); // last 3 days of hourly shards
        foreach ($files as $f) {
            $d = dent2025_a_read_json($f);
            if (is_array($d)) $events = array_merge($events, $d);
        }
        usort($events, function($a, $b) { return intval($b['ts']) - intval($a['ts']); });
        // filter
        $typeFilter = $_GET['type'] ?? '';
        $identFilter = $_GET['ident'] ?? '';
        if ($typeFilter || $identFilter) {
            $events = array_values(array_filter($events, function($e) use ($typeFilter, $identFilter) {
                if ($typeFilter && ($e['type'] ?? '') !== $typeFilter) return false;
                if ($identFilter && ($e['ident'] ?? '') !== $identFilter) return false;
                return true;
            }));
        }
        $total = count($events);
        $offset = ($page - 1) * $limit;
        $pageEvents = array_slice($events, $offset, $limit);
        echo json_encode(array('success' => true, 'data' => array('total' => $total, 'page' => $page, 'events' => $pageEvents)));
        exit;
    }

    if ($action === 'rollup_now') {
        dent2025_a_ensure_rollups($cfg);
        echo json_encode(array('success' => true, 'message' => 'Rollup complete up to ' . date('Y-m-d H:00')));
        exit;
    }

    if ($action === 'config') {
        if ($method === 'POST') {
            if (!function_exists('dent2025_record_audit_event') && file_exists(__DIR__ . '/history_helpers.php')) {
                require_once __DIR__ . '/history_helpers.php';
            }
            $changes = array();
            $allow = array('track_enabled', 'new_window_days', 'established_days', 'established_sessions', 'merge_window_days', 'allow_fp_merge', 'quiz_pass_threshold');
            foreach ($allow as $k) {
                if (isset($_POST[$k])) {
                    $v = $_POST[$k];
                    if (in_array($k, array('track_enabled', 'allow_fp_merge'), true)) {
                        $cfg[$k] = (in_array(strtolower($v), array('1', 'true', 'on', 'yes', ''), true) && $v !== false) ? true : (in_array(strtolower($v), array('0', 'false', 'off', 'no'), true) ? false : (bool)$v);
                    } elseif (in_array($k, array('new_window_days', 'established_days', 'established_sessions', 'merge_window_days'), true)) {
                        $cfg[$k] = max(1, min(60, intval($v)));
                    } elseif ($k === 'quiz_pass_threshold') {
                        $cfg[$k] = max(1, min(100, intval($v)));
                    }
                    $changes[] = $k;
                }
            }
            dent2025_a_save_config($cfg);
            if (function_exists('dent2025_record_audit_event')) {
                @dent2025_record_audit_event('analytics', 'edit', 'تعديل إعدادات التحليلات: ' . implode(', ', $changes));
            }
            echo json_encode(array('success' => true, 'data' => $cfg));
        } else {
            $safe = array();
            foreach (array('track_enabled', 'new_window_days', 'established_days', 'established_sessions', 'merge_window_days', 'allow_fp_merge', 'quiz_pass_threshold', 'raw_retention_days', 'rate_limit_events_per_min') as $k) {
                $safe[$k] = $cfg[$k] ?? null;
            }
            echo json_encode(array('success' => true, 'data' => $safe));
        }
        exit;
    }
}

http_response_code(400);
echo json_encode(array('success' => false, 'message' => 'Bad request'));
exit;
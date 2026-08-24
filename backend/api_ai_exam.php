<?php
/**
 * api_ai_exam.php
 * Handles PDF extraction, Gemini AI Generation, and saving Quizzes.
 * 100% Native to Dent2025 Server.
 */

error_reporting(0);
@ini_set('display_errors', 0);
@ini_set('max_execution_time', 300);
@set_time_limit(300);
@ini_set('memory_limit', '512M');
define('LSCACHE_NO_CACHE', true);
header('Cache-Control: no-cache, must-revalidate, max-age=0');

require_once 'db_connect.php';
// db_connect.php already handles: Content-Type, CORS, OPTIONS preflight, and $pdo setup

require_once __DIR__ . '/../dent2025_rbac.php';

$action = $_GET['action'] ?? '';
$RAW_INPUT = file_get_contents('php://input');
$JSON_INPUT = json_decode($RAW_INPUT, true) ?: [];

/**
 * Read the admin passkey from request body, POST, GET, or X-Admin-Pass header.
 */
function ai_exam_read_passkey() {
    global $JSON_INPUT;
    if (!empty($JSON_INPUT['password'])) return $JSON_INPUT['password'];
    if (!empty($_POST['password'])) return $_POST['password'];
    if (!empty($_GET['password'])) return $_GET['password'];
    if (!empty($_SERVER['HTTP_X_ADMIN_PASS'])) return $_SERVER['HTTP_X_ADMIN_PASS'];
    return '';
}

$AI_MASTER_ACTIONS = [
    'test_keys', 'gemini_status', 'add_gemini_key', 'edit_gemini_key', 'delete_gemini_key', 
    'get_gemini_keys', 'save_cache_settings', 'clear_cache', 'get_cache_stats',
    'prewarm_cache', 'check_prewarm_job', 'get_prewarm_subjects', 'prewarm_subject', 
    'scan_cache_catalog', 'prewarm_single_file'
];

if (in_array($action, $AI_MASTER_ACTIONS, true)) {
    $ai_pass = ai_exam_read_passkey();
    if (!dent2025_check_rbac_permission($ai_pass, 'manage_passwords')) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'Unauthorized: manage_passwords permission required.']);
        exit;
    }
} elseif ($action === 'delete_quiz') {
    $ai_pass = ai_exam_read_passkey();
    if (!dent2025_check_rbac_permission($ai_pass, 'delete_subject') && !dent2025_check_rbac_permission($ai_pass, 'manage_passwords')) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'Unauthorized: delete_subject or admin permission required.']);
        exit;
    }
} elseif ($action === 'rename_quiz') {
    $ai_pass = ai_exam_read_passkey();
    if (!dent2025_check_rbac_permission($ai_pass, 'edit_core_subject') && !dent2025_check_rbac_permission($ai_pass, 'manage_passwords')) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'Unauthorized: edit_core_subject or admin permission required.']);
        exit;
    }
} elseif ($action === 'save') {
    $ai_pass = ai_exam_read_passkey();
    $ai_info = !empty($ai_pass) ? dent2025_get_passkey_info($ai_pass) : null;
    if (!$ai_info) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'Unauthorized: Admin access required.']);
        exit;
    }
}

/**
 * Check and enforce daily rate limit (3 exams/day per IP) with admin/leader passkey bypass.
 */
function ai_exam_check_daily_rate_limit($maxExamsPerDay = 3) {
    $pass = ai_exam_read_passkey();
    if (!empty($pass)) {
        $info = dent2025_get_passkey_info($pass);
        if ($info !== null) {
            return ['allowed' => true, 'remaining' => 999, 'is_admin' => true];
        }
    }

    $dataDir = __DIR__ . '/../dent2025_analytics_data';
    if (!is_dir($dataDir)) @mkdir($dataDir, 0777, true);
    $limitFile = $dataDir . '/exam_generation_limits.json';

    $ip = 'unknown';
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $h) {
        if (!empty($_SERVER[$h])) {
            $ip = trim(explode(',', $_SERVER[$h])[0]);
            if ($ip) break;
        }
    }

    $ipKey = md5($ip);
    $now = time();
    $window = 86400; // 24 hours

    $data = [];
    if (file_exists($limitFile)) {
        $json = @file_get_contents($limitFile);
        if ($json) $data = json_decode($json, true) ?: [];
    }

    // Cleanup old records
    foreach ($data as $k => $rec) {
        if (!is_array($rec) || ($now - ($rec['start_time'] ?? 0) > $window)) {
            unset($data[$k]);
        }
    }

    $userRec = $data[$ipKey] ?? ['count' => 0, 'start_time' => $now];
    if ($now - ($userRec['start_time'] ?? 0) > $window) {
        $userRec = ['count' => 0, 'start_time' => $now];
    }

    if ($userRec['count'] >= $maxExamsPerDay) {
        return [
            'allowed' => false,
            'remaining' => 0,
            'message' => 'لقد وصلت للحد اليومي لإنشاء الاختبارات (3 اختبارات يومياً). يمكنك المحاولة غداً أو التدرب على الاختبارات الجاهزة في بنك الأسئلة.'
        ];
    }

    $userRec['count']++;
    $data[$ipKey] = $userRec;
    @file_put_contents($limitFile, json_encode($data), LOCK_EX);

    return [
        'allowed' => true,
        'remaining' => max(0, $maxExamsPerDay - $userRec['count'])
    ];
}

// LiteSpeed optimization header
header('X-LiteSpeed-Abort-On-Done: 0');
header('X-LiteSpeed-No-Abort: 1');

function getAiExamSubjectsTable($pdo) {
    static $tableName = null;
    if ($tableName !== null) return $tableName;
    $tableName = 'subjects';
    if ($pdo) {
        try {
            $check = $pdo->query("SELECT 1 FROM wpr9_subjects LIMIT 1");
            if ($check !== false) $tableName = 'wpr9_subjects';
        } catch (Throwable $e) {}
    }
    return $tableName;
}

function getAiExamSubjectLinksTable($pdo) {
    static $tableName = null;
    if ($tableName !== null) return $tableName;
    $tableName = 'subject_links';
    if ($pdo) {
        try {
            $check = $pdo->query("SELECT 1 FROM wpr9_subject_links LIMIT 1");
            if ($check !== false) $tableName = 'wpr9_subject_links';
        } catch (Throwable $e) {}
    }
    return $tableName;
}

// Primary and fallback Gemini models
$GEMINI_MODELS = [
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
];

/**
 * Load Gemini API Keys objects from JSON store.
 * Returns array of objects: [ ['id' => '...', 'label' => '...', 'key' => '...'], ... ]
 */
function getGeminiKeyEntries() {
    $dataDir = __DIR__ . '/gemini_keys_data';
    if (!is_dir($dataDir)) {
        @mkdir($dataDir, 0777, true);
    }
    $keysFile = $dataDir . '/gemini_keys.json';
    if (file_exists($keysFile)) {
        $content = file_get_contents($keysFile);
        $entries = json_decode($content, true);
        if (is_array($entries) && !empty($entries)) {
            return $entries;
        }
    }
    
    // Default seed keys (using verified active keys)
    $defaultEntries = [
        [
            'id' => 'gem_key_1',
            'label' => 'مفتاح Gemini الأساسي #1',
            'key' => 'AIzaSyDap8UYkbp71Z0C51UI5md8QwozKRmsHtw',
            'created_at' => date('Y-m-d H:i:s')
        ],
        [
            'id' => 'gem_key_2',
            'label' => 'مفتاح Gemini الاحتياطي #2',
            'key' => 'AIzaSyCAlmt06IIVQkMlnDmm7X4m-PK3ighhGvY',
            'created_at' => date('Y-m-d H:i:s')
        ]
    ];
    @file_put_contents($keysFile, json_encode($defaultEntries, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    return $defaultEntries;
}

function saveGeminiKeyEntries($entries) {
    $dataDir = __DIR__ . '/gemini_keys_data';
    if (!is_dir($dataDir)) {
        @mkdir($dataDir, 0777, true);
    }
    $keysFile = $dataDir . '/gemini_keys.json';
    return file_put_contents($keysFile, json_encode($entries, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function getGeminiRawApiKeys() {
    $entries = getGeminiKeyEntries();
    $rawKeys = [];
    foreach ($entries as $e) {
        if (!empty($e['key']) && is_string($e['key'])) {
            $rawKeys[] = trim($e['key']);
        }
    }
    return !empty($rawKeys) ? $rawKeys : ['AIzaSyDap8UYkbp71Z0C51UI5md8QwozKRmsHtw'];
}

$API_KEYS = getGeminiRawApiKeys();

// --- HELPER FUNCTION: CLEAN AND CONDENSE EXTRACTED TEXT ---
function cleanAndCondenseExtractedText($rawText, $maxChars = 800000) {
    if (empty($rawText)) return '';

    // Normalize line breaks
    $text = str_replace(["\r\n", "\r"], "\n", $rawText);

    // Remove common PDF/slide footer/header noise (e.g., "Page 1 of 50", slide copyright lines)
    $text = preg_replace('/^(Page\s+\d+\s+(of\s+\d+)?|\d+\s*\/\s*\d+|Copyright\s+.*|All\s+rights\s+reserved.*)$/mi', '', $text);

    // Remove repeated non-alphanumeric separator lines (e.g. "--------------------", "================")
    $text = preg_replace('/^[\s\-_=\*\.]{4,}$/m', '', $text);

    // Collapse 3+ consecutive newlines into 2
    $text = preg_replace('/\n{3,}/', "\n\n", $text);

    // Collapse multiple spaces/tabs into single space
    $text = preg_replace('/[ \t]{2,}/', ' ', $text);

    $text = trim($text);

    if (mb_strlen($text) > $maxChars) {
        $text = mb_substr($text, 0, $maxChars);
    }

    return $text;
}

/**
 * Fast streaming PDF stream extractor.
 * Reads PDF binary in 1MB chunks, decompresses /FlateDecode text streams on the fly,
 * and terminates as soon as $maxChars is reached without exhausting RAM or CPU.
 * Handles files from 100KB to 200MB+ safely in < 2 seconds.
 */
function extractTextFromPdfStreamFile($filePath, $maxChars = 800000) {
    if (!file_exists($filePath) || filesize($filePath) < 50) {
        return '';
    }

    $handle = @fopen($filePath, 'rb');
    if (!$handle) return '';

    $extracted = '';
    $buffer = '';
    $totalExtractedLen = 0;

    while (!feof($handle) && $totalExtractedLen < $maxChars) {
        $chunk = fread($handle, 1048576); // 1MB buffer
        if ($chunk === false) break;
        $buffer .= $chunk;

        while (true) {
            $streamStart = strpos($buffer, "stream\r\n");
            $offset = 8;
            if ($streamStart === false) {
                $streamStart = strpos($buffer, "stream\n");
                $offset = 7;
            }

            if ($streamStart === false) {
                if (strlen($buffer) > 128) {
                    $buffer = substr($buffer, -64);
                }
                break;
            }

            $streamEnd = strpos($buffer, "endstream", $streamStart + $offset);
            if ($streamEnd === false) {
                $buffer = substr($buffer, $streamStart);
                break;
            }

            $streamData = substr($buffer, $streamStart + $offset, $streamEnd - ($streamStart + $offset));
            $buffer = substr($buffer, $streamEnd + 9);

            // Skip large binary/image streams (PDF text streams are never > 1.5MB)
            if (strlen($streamData) > 1500000) {
                continue;
            }

            $uncompressed = @gzuncompress($streamData);
            if ($uncompressed === false) {
                $uncompressed = @gzinflate($streamData);
            }

            if ($uncompressed !== false && strlen($uncompressed) > 10) {
                $textBlock = '';
                if (preg_match_all('/\(([^)]*)\)\s*Tj/', $uncompressed, $m)) {
                    foreach ($m[1] as $item) {
                        $textBlock .= $item . ' ';
                    }
                }
                if (preg_match_all('/\[([^\]]*)\]\s*TJ/', $uncompressed, $m)) {
                    foreach ($m[1] as $arrayBlock) {
                        if (preg_match_all('/\(([^)]*)\)/', $arrayBlock, $subM)) {
                            foreach ($subM[1] as $subItem) {
                                $textBlock .= $subItem;
                            }
                            $textBlock .= ' ';
                        }
                    }
                }
                if (empty(trim($textBlock)) && strlen($uncompressed) > 40) {
                    if (preg_match_all('/[a-zA-Z0-9\s\-\,\.\:\;\?\!\(\)\/]{6,}/', $uncompressed, $m)) {
                        $textBlock = implode(' ', $m[0]);
                    }
                }

                if (!empty(trim($textBlock))) {
                    $cleaned = preg_replace('/[^\x20-\x7E\x{0600}-\x{06FF}\s]/u', ' ', $textBlock);
                    $cleaned = preg_replace('/\s+/', ' ', $cleaned);
                    if (strlen(trim($cleaned)) > 15) {
                        $extracted .= " " . $cleaned;
                        $totalExtractedLen = strlen($extracted);
                        if ($totalExtractedLen >= $maxChars) {
                            break 2;
                        }
                    }
                }
            }
        }
    }

    @fclose($handle);
    return trim($extracted);
}

// --- STREAM DOWNLOAD GOOGLE DRIVE FILE TO DISK (HANDLES VIRUS INTERSTITIAL & LARGE FILES) ---
function downloadGoogleDriveFileToDisk($driveLink, $destPath) {
    if (empty($driveLink)) return ['success' => false, 'message' => 'No Drive URL provided.'];
    $driveLink = trim($driveLink);
    $fileId = '';

    if (preg_match('#(?:docs\.google\.com/(?:document|presentation|spreadsheets)/d/|drive\.google\.com/file/d/|drive\.google\.com/open\?id=|[?&]id=)([-\w]{15,})#i', $driveLink, $m)) {
        $fileId = $m[1];
    } elseif (preg_match('#/d/([-\w]{15,})#i', $driveLink, $m)) {
        $fileId = $m[1];
    } elseif (preg_match('/^[-\w]{15,}$/', $driveLink)) {
        $fileId = $driveLink;
    } elseif (preg_match('/[-\w]{20,}/', $driveLink, $m)) {
        $fileId = $m[0];
    }

    if (empty($fileId)) {
        return ['success' => false, 'message' => 'Invalid Google Drive link format.'];
    }

    $cookieFile = sys_get_temp_dir() . '/' . uniqid('gcook_') . '.txt';
    $downloadUrls = [
        "https://drive.google.com/uc?export=download&id=" . $fileId,
        "https://drive.google.com/uc?export=download&confirm=t&id=" . $fileId,
        "https://drive.usercontent.google.com/download?id=" . $fileId . "&export=download&confirm=t"
    ];

    $downloaded = false;
    foreach ($downloadUrls as $url) {
        $fp = fopen($destPath, 'wb');
        if (!$fp) break;

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_FILE, $fp);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile);
        curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieFile);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        fclose($fp);

        $fileSize = file_exists($destPath) ? filesize($destPath) : 0;
        if ($fileSize > 2000) {
            // Check if returned content is Google virus warning HTML page
            $headSample = file_get_contents($destPath, false, null, 0, 4096);
            if (preg_match('/confirm=([0-9A-Za-z_]+)/', $headSample, $cm)) {
                $confirmToken = $cm[1];
                $confirmUrl = "https://drive.google.com/uc?export=download&confirm=" . $confirmToken . "&id=" . $fileId;
                
                $fp2 = fopen($destPath, 'wb');
                $ch2 = curl_init($confirmUrl);
                curl_setopt($ch2, CURLOPT_FILE, $fp2);
                curl_setopt($ch2, CURLOPT_FOLLOWLOCATION, true);
                curl_setopt($ch2, CURLOPT_COOKIEJAR, $cookieFile);
                curl_setopt($ch2, CURLOPT_COOKIEFILE, $cookieFile);
                curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 5);
                curl_setopt($ch2, CURLOPT_TIMEOUT, 15);
                curl_setopt($ch2, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                curl_setopt($ch2, CURLOPT_SSL_VERIFYPEER, false);
                curl_exec($ch2);
                curl_close($ch2);
                fclose($fp2);
                $fileSize = filesize($destPath);
            } elseif (preg_match('/<form\s+id="download-form"\s+action="([^"]+)"/i', $headSample, $fm)) {
                $formAction = html_entity_decode($fm[1]);
                $fp3 = fopen($destPath, 'wb');
                $ch3 = curl_init($formAction);
                curl_setopt($ch3, CURLOPT_FILE, $fp3);
                curl_setopt($ch3, CURLOPT_FOLLOWLOCATION, true);
                curl_setopt($ch3, CURLOPT_COOKIEJAR, $cookieFile);
                curl_setopt($ch3, CURLOPT_COOKIEFILE, $cookieFile);
                curl_setopt($ch3, CURLOPT_CONNECTTIMEOUT, 5);
                curl_setopt($ch3, CURLOPT_TIMEOUT, 15);
                curl_setopt($ch3, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                curl_setopt($ch3, CURLOPT_SSL_VERIFYPEER, false);
                curl_exec($ch3);
                curl_close($ch3);
                fclose($fp3);
                $fileSize = filesize($destPath);
            }
        }

        if ($fileSize > 2000) {
            $headCheck = file_get_contents($destPath, false, null, 0, 100);
            if (strpos($headCheck, '%PDF') !== false || strpos($headCheck, 'PK') !== false || $fileSize > 500000) {
                $downloaded = true;
                break;
            }
        }
    }

    @unlink($cookieFile);
    if (!$downloaded || !file_exists($destPath) || filesize($destPath) < 500) {
        return ['success' => false, 'message' => 'Could not download file from Google Drive.'];
    }

    return ['success' => true, 'file_path' => $destPath, 'file_size' => filesize($destPath)];
}

// --- GEMINI FILE CACHE HELPERS (REUSES UPLOADED FILES FOR 40 HOURS) ---
function getGeminiFileCacheStore() {
    $cacheFile = __DIR__ . '/gemini_keys_data/gemini_file_cache.json';
    if (!file_exists($cacheFile)) return [];
    $data = json_decode(@file_get_contents($cacheFile), true);
    return is_array($data) ? $data : [];
}

function saveGeminiFileCacheStore($store) {
    $dir = __DIR__ . '/gemini_keys_data';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    $cacheFile = $dir . '/gemini_file_cache.json';
    @file_put_contents($cacheFile, json_encode($store, JSON_PRETTY_PRINT));
}

function getGeminiCachedFile($cacheKey, $apiKey) {
    if (empty($cacheKey) || empty($apiKey)) return null;
    $store = getGeminiFileCacheStore();
    if (!isset($store[$cacheKey])) return null;

    $item = $store[$cacheKey];
    $createdAt = $item['created_at'] ?? 0;
    if (time() - $createdAt > 40 * 3600) {
        unset($store[$cacheKey]);
        saveGeminiFileCacheStore($store);
        return null;
    }

    $fileName = $item['file_name'] ?? '';
    if (!empty($fileName)) {
        $chkCh = curl_init("https://generativelanguage.googleapis.com/v1beta/" . $fileName . "?key=" . $apiKey);
        curl_setopt($chkCh, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($chkCh, CURLOPT_TIMEOUT, 6);
        curl_setopt($chkCh, CURLOPT_SSL_VERIFYPEER, false);
        $chkResp = curl_exec($chkCh);
        $httpCode = curl_getinfo($chkCh, CURLINFO_HTTP_CODE);
        curl_close($chkCh);
        if ($httpCode === 200 && !empty($chkResp)) {
            $chkData = json_decode($chkResp, true);
            if (($chkData['state'] ?? '') === 'ACTIVE') {
                return $item;
            }
        }
    }

    unset($store[$cacheKey]);
    saveGeminiFileCacheStore($store);
    return null;
}

function setGeminiCachedFile($cacheKey, $fileUri, $fileName, $apiKey) {
    if (empty($cacheKey) || empty($fileUri)) return;
    $store = getGeminiFileCacheStore();
    $store[$cacheKey] = [
        'uri' => $fileUri,
        'file_name' => $fileName,
        'created_at' => time(),
        'api_key' => $apiKey
    ];
    saveGeminiFileCacheStore($store);
}

// --- 6-MONTH PERSISTENT LOCAL TEXT CACHE (180 DAYS) ---
function getLocalDocumentTextCache($fileId) {
    if (empty($fileId)) return null;
    $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $fileId);
    $cacheDir = __DIR__ . '/gemini_keys_data/text_cache';
    $cacheFile = $cacheDir . '/' . $cleanId . '.txt';
    if (!file_exists($cacheFile)) return null;

    // 180-Day TTL (6 months)
    if (time() - filemtime($cacheFile) > 180 * 86400) {
        @unlink($cacheFile);
        return null;
    }

    $content = @file_get_contents($cacheFile);
    return (!empty($content) && strlen(trim($content)) > 150) ? $content : null;
}

function setLocalDocumentTextCache($fileId, $text, $meta = []) {
    if (empty($fileId) || empty(trim($text)) || strlen(trim($text)) <= 150) return;
    $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $fileId);
    $cacheDir = __DIR__ . '/gemini_keys_data/text_cache';
    if (!is_dir($cacheDir)) @mkdir($cacheDir, 0777, true);
    $cacheFile = $cacheDir . '/' . $cleanId . '.txt';
    @file_put_contents($cacheFile, $text);

    // Persist file and subject metadata
    $metaStore = getCacheMetaStore();
    if (!isset($metaStore['files_meta']) || !is_array($metaStore['files_meta'])) {
        $metaStore['files_meta'] = [];
    }
    $existing = $metaStore['files_meta'][$cleanId] ?? [];
    $metaStore['files_meta'][$cleanId] = [
        'subject_name' => $meta['subject_name'] ?? ($existing['subject_name'] ?? 'مادة دراسية'),
        'file_name' => $meta['file_name'] ?? ($existing['file_name'] ?? ('ملف ' . substr($cleanId, 0, 8) . '.pdf')),
        'subject_id' => $meta['subject_id'] ?? ($existing['subject_id'] ?? null),
        'size_bytes' => strlen($text),
        'cached_at' => date('Y-m-d H:i:s')
    ];

    // Remove from uncached list if present
    if (isset($metaStore['uncached_files']) && is_array($metaStore['uncached_files'])) {
        $metaStore['uncached_files'] = array_values(array_filter($metaStore['uncached_files'], function($u) use ($cleanId) {
            return ($u['file_id'] ?? '') !== $cleanId;
        }));
    }
    saveCacheMetaStore($metaStore);
}

// --- CACHE METADATA & SYSTEM STATS ---
function getCacheMetaStore() {
    $metaFile = __DIR__ . '/gemini_keys_data/cache_meta.json';
    if (file_exists($metaFile)) {
        $data = json_decode(file_get_contents($metaFile), true);
        if (is_array($data)) return $data;
    }
    return [
        'auto_prewarm_on_upload' => true,
        'periodic_schedule' => 'weekly',
        'last_prewarm_time' => null,
        'last_prewarm_stats' => null,
        'files_meta' => [],
        'uncached_files' => []
    ];
}

function saveCacheMetaStore($data) {
    $dataDir = __DIR__ . '/gemini_keys_data';
    if (!is_dir($dataDir)) @mkdir($dataDir, 0777, true);
    file_put_contents($dataDir . '/cache_meta.json', json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function getSystemCacheStats() {
    $cacheDir = __DIR__ . '/gemini_keys_data/text_cache';
    $count = 0;
    $totalBytes = 0;
    $cachedFiles = [];
    $meta = getCacheMetaStore();
    $filesMeta = $meta['files_meta'] ?? [];

    if (is_dir($cacheDir)) {
        $files = glob($cacheDir . '/*.txt');
        if ($files) {
            $count = count($files);
            foreach ($files as $f) {
                $cleanId = basename($f, '.txt');
                $sz = filesize($f);
                $totalBytes += $sz;
                $m = $filesMeta[$cleanId] ?? [];
                $cachedFiles[] = [
                    'file_id' => $cleanId,
                    'subject_name' => $m['subject_name'] ?? 'مادة دراسية',
                    'file_name' => $m['file_name'] ?? ('ملف ' . substr($cleanId, 0, 8) . '.pdf'),
                    'subject_id' => $m['subject_id'] ?? null,
                    'size_bytes' => $sz,
                    'mtime' => $m['cached_at'] ?? date('Y-m-d H:i:s', filemtime($f)),
                    'size_formatted' => ($sz > 1048576) ? round($sz / 1048576, 2) . ' MB' : round($sz / 1024, 1) . ' KB'
                ];
            }
        }
    }

    $geminiStore = getGeminiFileCacheStore();
    $geminiCount = count($geminiStore);

    $sizeFormatted = ($totalBytes > 1048576) 
        ? round($totalBytes / 1048576, 2) . ' MB' 
        : round($totalBytes / 1024, 1) . ' KB';

    $uncached = $meta['uncached_files'] ?? [];
    $catalogSummary = $meta['catalog_summary'] ?? [
        'total_subjects' => 103,
        'subjects_with_files' => 8,
        'total_drive_files' => $count + count($uncached),
        'cached_count' => $count,
        'uncached_count' => count($uncached)
    ];

    return [
        'text_cache_count' => $count,
        'text_cache_size_bytes' => $totalBytes,
        'text_cache_size_formatted' => $sizeFormatted,
        'gemini_cached_files_count' => $geminiCount,
        'cache_dir_path' => 'backend/gemini_keys_data/text_cache/',
        'settings' => $meta,
        'catalog_summary' => $catalogSummary,
        'uncached_files' => $uncached,
        'cached_files' => array_reverse($cachedFiles)
    ];
}

// --- GEMINI FILE API RESUMABLE CHUNKED UPLOADER ---
function uploadPdfToGeminiFileApi($filePath, $apiKey, $displayName = 'Textbook Document', $cacheKey = null) {
    if (!empty($cacheKey)) {
        $cached = getGeminiCachedFile($cacheKey, $apiKey);
        if ($cached !== null) {
            return [
                'success' => true,
                'file_uri' => $cached['uri'],
                'file_name' => $cached['file_name'],
                'size_bytes' => filesize($filePath),
                'from_cache' => true
            ];
        }
    }

    if (!file_exists($filePath) || filesize($filePath) < 50) {
        return ['success' => false, 'message' => 'File not found or empty.'];
    }

    $fileSize = filesize($filePath);
    $startUrl = "https://generativelanguage.googleapis.com/upload/v1beta/files?key=" . $apiKey;

    // Step 1: Initiate resumable upload session
    $headers = [
        'X-Goog-Upload-Protocol: resumable',
        'X-Goog-Upload-Command: start',
        'X-Goog-Upload-Header-Content-Length: ' . $fileSize,
        'X-Goog-Upload-Header-Content-Type: application/pdf',
        'Content-Type: application/json'
    ];
    $body = json_encode(['file' => ['display_name' => substr($displayName, 0, 60)]]);

    $ch = curl_init($startUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || empty($response)) {
        return ['success' => false, 'message' => "Failed to initiate Gemini upload (HTTP $httpCode)."];
    }

    $uploadUrl = '';
    if (preg_match('/X-Goog-Upload-URL:\s*([^\r\n]+)/i', $response, $m)) {
        $uploadUrl = trim($m[1]);
    }
    if (empty($uploadUrl)) {
        if (preg_match('/upload_id=([^\r\n\s]+)/i', $response, $m)) {
            $uploadUrl = "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=" . trim($m[1]) . "&key=" . $apiKey;
        }
    }

    if (empty($uploadUrl)) {
        return ['success' => false, 'message' => "Could not extract Gemini upload URL."];
    }

    // Step 2: Upload file in 8MB chunks
    $chunkSize = 8 * 1024 * 1024;
    $offset = 0;
    $handle = fopen($filePath, 'rb');
    if (!$handle) {
        return ['success' => false, 'message' => "Could not open local file for reading."];
    }

    $finalJson = null;
    while ($offset < $fileSize) {
        $chunk = fread($handle, $chunkSize);
        if ($chunk === false) break;
        $chunkLen = strlen($chunk);
        $isLast = ($offset + $chunkLen) >= $fileSize;
        $cmd = $isLast ? 'upload, finalize' : 'upload';

        $chunkHeaders = [
            'Content-Length: ' . $chunkLen,
            'X-Goog-Upload-Offset: ' . $offset,
            'X-Goog-Upload-Command: ' . $cmd,
            'Content-Type: application/pdf'
        ];

        $ch = curl_init($uploadUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $chunk);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $chunkHeaders);
        curl_setopt($ch, CURLOPT_TIMEOUT, 120);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        $chunkResp = curl_exec($ch);
        curl_close($ch);

        if ($isLast) {
            $finalJson = json_decode($chunkResp, true);
        }

        $offset += $chunkLen;
    }
    fclose($handle);

    if (empty($finalJson) || empty($finalJson['file']['uri'])) {
        return ['success' => false, 'message' => 'Upload to Gemini completed but received invalid file info.'];
    }

    $fileUri = $finalJson['file']['uri'];
    $fileName = $finalJson['file']['name'];
    $fileState = $finalJson['file']['state'] ?? 'ACTIVE';

    // Step 3: Wait if file is in PROCESSING state
    $waitAttempts = 0;
    while ($fileState === 'PROCESSING' && $waitAttempts < 12) {
        sleep(3);
        $waitAttempts++;
        $chkCh = curl_init("https://generativelanguage.googleapis.com/v1beta/" . $fileName . "?key=" . $apiKey);
        curl_setopt($chkCh, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($chkCh, CURLOPT_TIMEOUT, 15);
        curl_setopt($chkCh, CURLOPT_SSL_VERIFYPEER, true);
        $chkResp = curl_exec($chkCh);
        curl_close($chkCh);
        if ($chkResp) {
            $chkData = json_decode($chkResp, true);
            $fileState = $chkData['state'] ?? 'ACTIVE';
        }
    }

    if (!empty($cacheKey)) {
        setGeminiCachedFile($cacheKey, $fileUri, $fileName, $apiKey);
    }

    return [
        'success' => true,
        'file_uri' => $fileUri,
        'file_name' => $fileName,
        'size_bytes' => $fileSize
    ];
}

function deleteGeminiFile($fileNameOrUri, $apiKey) {
    if (empty($fileNameOrUri) || empty($apiKey)) return;
    $fileName = $fileNameOrUri;
    if (strpos($fileName, 'files/') !== false) {
        if (preg_match('#files/[a-zA-Z0-9_-]+#', $fileName, $m)) {
            $fileName = $m[0];
        }
    }
    $delUrl = "https://generativelanguage.googleapis.com/v1beta/" . $fileName . "?key=" . $apiKey;
    $ch = curl_init($delUrl);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    @curl_exec($ch);
    @curl_close($ch);
}

// --- HELPER FUNCTION: EXTRACT DIRECT UPLOADED FILE ---
function performDirectUploadedFileExtraction($fileItem) {
    if (empty($fileItem) || empty($fileItem['data'])) {
        return ['success' => false, 'message' => 'No file data received.'];
    }

    $fileName = $fileItem['name'] ?? 'uploaded_file';
    $fileType = $fileItem['type'] ?? '';
    $rawBase64 = $fileItem['data'];

    // Max 25MB base64 string upload limit guard
    if (strlen($rawBase64) > 25 * 1024 * 1024) {
        return ['success' => false, 'message' => "حجم الملف يتجاوز الحد المسموح (20MB): $fileName"];
    }

    // Strip data URI prefix if present
    if (preg_match('/^data:([^;]+);base64,/', $rawBase64, $m)) {
        if (empty($fileType)) $fileType = $m[1];
        $rawBase64 = substr($rawBase64, strlen($m[0]));
    }

    $binaryData = @base64_decode($rawBase64, true);
    if ($binaryData === false || strlen($binaryData) < 32) {
        return ['success' => false, 'message' => "Invalid base64 payload for file: $fileName"];
    }

    $isImage = (strpos($fileType, 'image/') !== false) || preg_match('/\.(jpg|jpeg|png|webp|gif)$/i', $fileName);
    $isPdf = (strpos($fileType, 'pdf') !== false) || preg_match('/\.pdf$/i', $fileName);

    if ($isImage) {
        $sanitized = sanitizeGeminiImagePayload($binaryData);
        if ($sanitized !== null) {
            return [
                'success' => true,
                'data' => [
                    'text' => '',
                    'images' => [$sanitized]
                ]
            ];
        }
        return ['success' => false, 'message' => "Could not decode image file: $fileName"];
    }

    if ($isPdf) {
        $tempPdf = sys_get_temp_dir() . '/' . uniqid('up_pdf_') . '.pdf';
        $tempTxt = sys_get_temp_dir() . '/' . uniqid('up_txt_') . '.txt';
        file_put_contents($tempPdf, $binaryData);
        $fileSizeBytes = strlen($binaryData);

        // 1. Tier 1: Fast Native Streaming Stream Extractor
        $extractedText = extractTextFromPdfStreamFile($tempPdf, 800000);

        // 2. Binary pdftotext fallback if available
        if (empty(trim($extractedText))) {
            $binPath = __DIR__ . '/bin/pdftotext';
            if (file_exists($binPath)) {
                $cmd = escapeshellarg($binPath) . " -f 1 -l 200 " . escapeshellarg($tempPdf) . " " . escapeshellarg($tempTxt);
                @exec($cmd);
                if (file_exists($tempTxt) && filesize($tempTxt) > 20) {
                    $extractedText = file_get_contents($tempTxt);
                    @unlink($tempTxt);
                }
            }
        }

        if (strlen(trim($extractedText)) > 150) {
            @unlink($tempPdf);
            return [
                'success' => true,
                'data' => [
                    'text' => cleanAndCondenseExtractedText($extractedText),
                    'images' => []
                ]
            ];
        }

        // Tier 2: Scanned PDF from direct upload -> keep temp file for Gemini File API
        return [
            'success' => true,
            'data' => [
                'text' => '',
                'is_scanned_pdf' => true,
                'local_pdf_path' => $tempPdf,
                'size_bytes' => $fileSizeBytes,
                'images' => []
            ]
        ];
    }

    // Default plain text fallback
    $plain = $binaryData;
    if (!@mb_check_encoding($binaryData, 'UTF-8')) {
        $converted = @iconv('UTF-8', 'UTF-8//IGNORE', $binaryData);
        if ($converted !== false && strlen($converted) > 5) {
            $plain = $converted;
        }
    }
    if (strlen(trim($plain)) > 10) {
        return [
            'success' => true,
            'data' => [
                'text' => cleanAndCondenseExtractedText($plain),
                'images' => []
            ]
        ];
    }

    return ['success' => false, 'message' => "Unsupported file type for: $fileName"];
}

// --- HELPER FUNCTION: EXTRACT TEXT FROM DRIVE PDF ---
function performDriveExtraction($driveLink, $meta = []) {
    if (empty($driveLink)) return ['success' => false, 'message' => "No Drive URL provided."];

    $fileId = '';
    if (preg_match('#(?:docs\.google\.com/(?:document|presentation|spreadsheets)/d/|drive\.google\.com/file/d/|drive\.google\.com/open\?id=|[?&]id=)([-\w]{15,})#i', $driveLink, $m)) {
        $fileId = $m[1];
    } elseif (preg_match('#/d/([-\w]{15,})#i', $driveLink, $m)) {
        $fileId = $m[1];
    } elseif (preg_match('/^[-\w]{15,}$/', $driveLink)) {
        $fileId = $driveLink;
    }

    // Check 6-Month Local Document Text Cache first (0.001s instant retrieval!)
    if (!empty($fileId)) {
        $cachedText = getLocalDocumentTextCache($fileId);
        if ($cachedText !== null) {
            return [
                'success' => true,
                'data' => [
                    'text' => cleanAndCondenseExtractedText($cachedText),
                    'images' => [],
                    'from_cache' => true,
                    'cache_type' => 'local_text_180d'
                ]
            ];
        }
    }

    $apiKeys = getGeminiRawApiKeys();
    $cacheKey = !empty($fileId) ? 'gdrive_' . $fileId : null;

    // Check Gemini File API Cache first (0.05s response if already uploaded!)
    if (!empty($cacheKey) && !empty($apiKeys)) {
        $cached = getGeminiCachedFile($cacheKey, $apiKeys[0]);
        if ($cached !== null) {
            return [
                'success' => true,
                'data' => [
                    'text' => '',
                    'is_scanned_pdf' => true,
                    'gemini_file_uri' => $cached['uri'],
                    'gemini_file_name' => $cached['file_name'],
                    'cache_key' => $cacheKey,
                    'from_cache' => true,
                    'images' => []
                ]
            ];
        }
    }

    $tempPdf = sys_get_temp_dir() . '/' . uniqid('pdf_') . '.pdf';
    $downloadRes = downloadGoogleDriveFileToDisk($driveLink, $tempPdf);
    
    if (!$downloadRes['success']) {
        @unlink($tempPdf);
        return ['success' => false, 'message' => $downloadRes['message'] ?? "Could not download this Drive file."];
    }

    $fileSizeBytes = filesize($tempPdf);
    $binPath = __DIR__ . '/bin/pdftotext';
    $tempTxt = sys_get_temp_dir() . '/' . uniqid('txt_') . '.txt';
    $extractedText = '';

    // Fast-check first 1.5MB for font/text streams before doing heavy full-file decompression
    $headCheck = file_get_contents($tempPdf, false, null, 0, 1572864);
    $hasFontOrText = (strpos($headCheck, '/Font') !== false) || (strpos($headCheck, 'Tj') !== false) || (strpos($headCheck, 'TJ') !== false) || (strpos($headCheck, 'BT') !== false);

    if ($hasFontOrText || $fileSizeBytes < 10485760) {
        // Tier 1: Fast Native Streaming Stream Extractor (Up to 800,000 chars)
        $extractedText = extractTextFromPdfStreamFile($tempPdf, 800000);

        // Binary pdftotext fallback if available
        if (empty(trim($extractedText)) && file_exists($binPath)) {
            $cmd = escapeshellarg($binPath) . " -f 1 -l 200 " . escapeshellarg($tempPdf) . " " . escapeshellarg($tempTxt);
            @exec($cmd);
            if (file_exists($tempTxt) && filesize($tempTxt) > 50) {
                $extractedText = file_get_contents($tempTxt);
                @unlink($tempTxt);
            }
        }

        // Office zip fallback (PPTX, DOCX, XLSX)
        if (empty(trim($extractedText)) && class_exists('ZipArchive')) {
            $zip = new ZipArchive();
            if ($zip->open($tempPdf) === true) {
                $xmlText = '';
                for ($i = 0; $i < $zip->numFiles; $i++) {
                    $entryName = $zip->getNameIndex($i);
                    if (strpos($entryName, 'ppt/slides/slide') !== false || strpos($entryName, 'word/document.xml') !== false || strpos($entryName, 'xl/sharedStrings.xml') !== false || strpos($entryName, 'word/text/') !== false) {
                        $xmlContent = $zip->getFromIndex($i);
                        $xmlText .= " " . strip_tags($xmlContent);
                    }
                }
                $zip->close();
                if (strlen(trim($xmlText)) > 50) {
                    $extractedText = $xmlText;
                }
            }
        }
    }

    // If substantial text is found (> 150 chars), Tier 1 is satisfied!
    if (strlen(trim($extractedText)) > 150) {
        @unlink($tempPdf);
        if (!empty($fileId)) {
            setLocalDocumentTextCache($fileId, $extractedText, $meta);
        }
        return [
            'success' => true,
            'data' => [
                'text' => cleanAndCondenseExtractedText($extractedText),
                'images' => []
            ]
        ];
    }

    // Tier 2: Scanned / Image-based PDF (e.g. 90MB textbook or scanned handwritten notes)
    $apiKeys = getGeminiRawApiKeys();
    if (!empty($apiKeys) && file_exists($tempPdf)) {
        $displayName = !empty($meta['file_name']) ? $meta['file_name'] : 'Scanned Course Document';
        $upRes = uploadPdfToGeminiFileApi($tempPdf, $apiKeys[0], $displayName, $cacheKey);
        @unlink($tempPdf);

        if ($upRes['success']) {
            if (!empty($fileId)) {
                setLocalDocumentTextCache($fileId, "[DOCUMENT_TYPE: SCANNED_PDF_IMAGE_BASED]\n[GEMINI_FILE_URI: {$upRes['file_uri']}]\n[GEMINI_FILE_NAME: {$upRes['file_name']}]", $meta);
            }
            return [
                'success' => true,
                'data' => [
                    'text' => '',
                    'is_scanned_pdf' => true,
                    'gemini_file_uri' => $upRes['file_uri'],
                    'gemini_file_name' => $upRes['file_name'],
                    'cache_key' => $cacheKey,
                    'images' => []
                ]
            ];
        }
    }

    @unlink($tempPdf);
    return [
        'success' => true,
        'data' => [
            'text' => '',
            'is_scanned_pdf' => true,
            'cache_key' => $cacheKey,
            'size_bytes' => $fileSizeBytes,
            'images' => []
        ]
    ];
}

// --- ACTION 1: EXTRACT TEXT FROM DRIVE PDF ---
if ($action === 'extract') {
    $driveLink = $_GET['url'] ?? '';
    $res = performDriveExtraction($driveLink);
    sendResponse($res['success'], $res['data'] ?? $res['message']);
}

// Helper function to recursively scrape Google Drive embedded folderview
function fetchDriveFolderRecursive($folderId, $prefix = '', $depth = 0) {
    if ($depth > 2) return [];
    $url = "https://drive.google.com/embeddedfolderview?id=" . urlencode($folderId) . "#list";
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 6);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    $html = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || empty($html)) {
        return [];
    }
    
    $results = [];
    if (preg_match_all('/<div class="flip-entry"[^>]*id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">(.*?)<\/div>/i', $html, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $m) {
            $entryId = $m[1];
            $link = $m[2];
            $title = html_entity_decode(trim($m[3]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            
            if (strpos($link, 'embeddedfolderview') !== false || strpos($link, 'folders') !== false) {
                // Subfolder -> Recursively fetch up to depth 2
                if ($depth < 2) {
                    $subResults = fetchDriveFolderRecursive($entryId, $prefix, $depth + 1);
                    $results = array_merge($results, $subResults);
                }
            } else {
                // File
                $results[] = [
                    'id' => $entryId,
                    'name' => $title,
                    'url' => 'https://drive.google.com/file/d/' . $entryId . '/view'
                ];
            }
        }
    }
    return $results;
}

// --- ACTION 1.5: LIST CHAPTERS NATIVELY FROM GOOGLE DRIVE ---
if ($action === 'list_chapters') {
    $folderId = $_GET['folder_id'] ?? '';
    
    if (preg_match('/folders\/([a-zA-Z0-9_-]+)/', $folderId, $matches)) {
        $folderId = $matches[1];
    } elseif (preg_match('/id=([a-zA-Z0-9_-]+)/', $folderId, $matches)) {
        $folderId = $matches[1];
    }
    
    if (empty($folderId)) {
        sendResponse(false, "No valid folder ID provided.");
    }
    
    $files = fetchDriveFolderRecursive($folderId);
    sendResponse(true, $files);
}

function sanitizeGeminiImagePayload($imageInput) {
    if (empty($imageInput)) {
        return null;
    }

    $rawData = null;
    $mimeType = null;

    if (is_array($imageInput)) {
        if (!empty($imageInput['data']) && is_string($imageInput['data'])) {
            $rawData = $imageInput['data'];
            $mimeType = $imageInput['mimeType'] ?? null;
        }
    } elseif (is_string($imageInput)) {
        $rawData = $imageInput;
    }

    if ($rawData === null) {
        return null;
    }

    if (is_string($rawData) && preg_match('/^data:(image\/[^;]+);base64,/', $rawData, $matches)) {
        $mimeType = $matches[1];
        $rawData = substr($rawData, strlen($matches[0]));
    }

    if (is_string($rawData) && preg_match('/^[A-Za-z0-9\/\+=]+$/', $rawData)) {
        $decoded = @base64_decode($rawData, true);
        if ($decoded !== false && strlen($decoded) > 64) {
            $rawData = $decoded;
        }
    }

    if (!is_string($rawData) || strlen($rawData) < 64) {
        return null;
    }

    if ($mimeType === null) {
        if (strncmp($rawData, "\xFF\xD8\xFF", 3) === 0) {
            $mimeType = 'image/jpeg';
        } elseif (strncmp($rawData, "\x89PNG\r\n\x1a\n", 8) === 0) {
            $mimeType = 'image/png';
        } elseif (strncmp($rawData, "GIF87a", 6) === 0 || strncmp($rawData, "GIF89a", 6) === 0) {
            $mimeType = 'image/gif';
        } elseif (strncmp($rawData, "RIFF", 4) === 0 && substr($rawData, 8, 4) === 'WEBP') {
            $mimeType = 'image/webp';
        }
    }

    if ($mimeType === null && function_exists('getimagesizefromstring')) {
        $info = @getimagesizefromstring($rawData);
        if ($info !== false && !empty($info['mime'])) {
            $mimeType = $info['mime'];
        }
    }

    if ($mimeType === null) {
        return null;
    }

    if (function_exists('imagecreatefromstring')) {
        $resource = @imagecreatefromstring($rawData);
        if ($resource === false) {
            return null;
        }
        @imagedestroy($resource);
    }

    $encoded = base64_encode($rawData);
    if (strlen($encoded) > 1800000) {
        return null;
    }

    return [
        'mimeType' => $mimeType,
        'data' => $encoded
    ];
}

function extractValidImagesFromPdfBytes($rawBytes) {
    if (!is_string($rawBytes) || strlen($rawBytes) < 64) {
        return [];
    }

    $validImages = [];
    
    $offset = 0;
    while (($pos = strpos($rawBytes, "\xFF\xD8\xFF", $offset)) !== false) {
        $endPos = strpos($rawBytes, "\xFF\xD9", $pos);
        if ($endPos !== false) {
            $endPos += 2;
            $candidate = substr($rawBytes, $pos, $endPos - $pos + 1);
            
            if (strlen($candidate) >= 8000) {
                $sanitized = sanitizeGeminiImagePayload($candidate);
                if ($sanitized !== null) {
                    $validImages[] = $sanitized;
                }
            }
            
            if (count($validImages) >= 8) {
                break;
            }
            $offset = $endPos + 1;
        } else {
            $offset = $pos + 3;
        }
    }

    return $validImages;
}

function extractImagesFromPdfViaZip($pdfPath) {
    $validImages = [];
    
    if (!class_exists('ZipArchive')) {
        return $validImages;
    }
    
    $zip = new ZipArchive();
    if ($zip->open($pdfPath) !== true) {
        return $validImages;
    }
    
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if (preg_match('/\.(jpg|jpeg|png|gif)$/i', $name)) {
            $data = $zip->getFromIndex($i);
            if ($data !== false && strlen($data) >= 8000) {
                $sanitized = sanitizeGeminiImagePayload($data);
                if ($sanitized !== null) {
                    $validImages[] = $sanitized;
                    if (count($validImages) >= 8) {
                        break;
                    }
                }
            }
        }
    }
    
    $zip->close();
    return $validImages;
}

function extractImagesFromPdfViaImageMagick($pdfPath) {
    $validImages = [];
    
    $outBase = sys_get_temp_dir() . '/page_%d.jpg';
    $commands = [
        'convert ' . escapeshellarg($pdfPath . '[0-7]') . ' -quality 85 jpg:' . escapeshellarg($outBase),
        'magick ' . escapeshellarg($pdfPath . '[0-7]') . ' -quality 85 jpg:' . escapeshellarg($outBase)
    ];
    
    foreach ($commands as $cmd) {
        @exec($cmd . ' 2>&1', $output, $exitCode);
        if ($exitCode === 0 || $exitCode === 1) {
            for ($i = 0; $i < 8; $i++) {
                $file = sys_get_temp_dir() . '/page_' . $i . '.jpg';
                if (file_exists($file)) {
                    $data = file_get_contents($file);
                    if ($data !== false && strlen($data) >= 8000) {
                        $sanitized = sanitizeGeminiImagePayload($data);
                        if ($sanitized !== null) {
                            $validImages[] = $sanitized;
                        }
                    }
                    @unlink($file);
                } else {
                    break;
                }
            }
            if (!empty($validImages)) {
                break;
            }
        }
    }
    
    return $validImages;
}

function extractImagesFromPdfViaGhostScript($pdfPath) {
    $validImages = [];
    
    $outputPattern = sys_get_temp_dir() . '/gs_page_%03d.jpg';
    $cmd = 'gs -q -dNOPAUSE -dBATCH -dSAFER -sDEVICE=jpeg -dJPEGQ=85 -dFirstPage=1 -dLastPage=8 -sOutputFile=' . escapeshellarg($outputPattern) . ' ' . escapeshellarg($pdfPath) . ' 2>&1';
    
    @exec($cmd, $output, $exitCode);
    
    if ($exitCode === 0 || $exitCode === 1) {
        for ($i = 1; $i <= 8; $i++) {
            $file = sys_get_temp_dir() . '/gs_page_' . str_pad($i, 3, '0', STR_PAD_LEFT) . '.jpg';
            if (file_exists($file)) {
                $data = file_get_contents($file);
                if ($data !== false && strlen($data) >= 8000) {
                    $sanitized = sanitizeGeminiImagePayload($data);
                    if ($sanitized !== null) {
                        $validImages[] = $sanitized;
                    }
                }
                @unlink($file);
            } else {
                break;
            }
        }
    }
    
    return $validImages;
}

function performGeminiSingleBatch($data, $API_KEYS, $batchNum = 1, $totalBatches = 1) {
    global $GEMINI_MODELS;
    $hasFileUri = !empty($data['gemini_file_uri']);
    $modelsToTry = $hasFileUri ? ['gemini-flash-latest', 'gemini-2.5-flash'] : (!empty($GEMINI_MODELS) ? $GEMINI_MODELS : ['gemini-2.5-flash', 'gemini-flash-latest']);

    $mode = $data['mode'] ?? 'ai_generation';
    $isPastExamFilter = ($mode === 'past_exam_filter');
    $text = $data['text'] ?? '';
    $geminiFileUri = $data['gemini_file_uri'] ?? null;
    $difficulty = $data['difficulty'] ?? 'medium';
    $numQuestions = (int)($data['numQuestions'] ?? 10);
    $pageRange = $data['pageRange'] ?? '';
    $focusArea = $data['focusArea'] ?? '';
    $opts = $data['options'] ?? [];
    $includeExcept = !empty($opts['except']);
    $includeStatements = !empty($opts['statements']);
    $includeCases = !empty($opts['cases']);
    $questionTypes = $opts['questionTypes'] ?? 'mcq';
    $targetChapters = $data['targetChapters'] ?? [];

    if (empty($text) && empty($data['images']) && empty($geminiFileUri)) {
        return ['success' => false, 'message' => "No text, files, or past exam images provided for generation."];
    }

    $spec = strtolower(trim($data['specialty'] ?? ''));
    $subjectTitle = trim($data['subjectName'] ?? '');
    
    if ($spec === 'pre-med' || strpos($spec, 'pre') !== false) {
        $persona = "Act as an expert university professor and lead examiner for Pre-Medical students (Year 1 foundation sciences: English, Biology, Chemistry, Physics, Biostatistics, and Medical Terminology).";
    } elseif ($spec === 'dentistry') {
        $persona = "Act as an expert university professor and clinical examiner for Dental Medicine & Surgery students.";
    } elseif ($spec === 'medicine') {
        $persona = "Act as an expert university professor and clinical examiner for Human Medicine & Clinical Sciences students.";
    } else {
        $persona = "Act as an expert academic university professor and examiner for medical, dental, and pre-med students.";
    }

    $languageRules = "CRITICAL LANGUAGE & ACADEMIC FORMATTING RULES:\n";
    $languageRules .= "1. MATCH SOURCE LANGUAGE STRICTLY:\n";
    $languageRules .= "   - If the source material/subject is in ENGLISH (e.g. Dentistry, Medicine, Pre-Med, English Books, Biology, Anatomy, Physiology, Chemistry, etc.), the question text, options (e.g. ['A. Option 1', 'B. Option 2', 'C. Option 3', 'D. Option 4']), and correctAnswer (e.g. 'A') MUST BE 100% IN ENGLISH. Do NOT translate English source content into Arabic questions.\n";
    $languageRules .= "   - If and only if the source material is in ARABIC (e.g. Islamic Culture, Arabic language), the questions, options, and answers should be in Arabic.\n";
    $languageRules .= "   - The 'explanation' field should ALWAYS be a clear, high-yield educational breakdown in Arabic (explaining why the correct answer is right and why tricky distractors are incorrect).\n";

    if ($isPastExamFilter) {
        $targetChaptersStr = !empty($targetChapters) ? implode("\n- ", $targetChapters) : 'All Selected Course Topics';
        $prompt = $persona . "\n";
        $prompt .= "You are provided with real past examination papers (photos, scans, or text) from university tests.\n";
        $prompt .= "You are given the list of TARGET CHAPTERS / LECTURES that the student is currently studying:\n";
        $prompt .= "- " . $targetChaptersStr . "\n\n";
        $prompt .= "CRITICAL TASK & CURATION RULES:\n";
        $prompt .= "1. FULL EXAM PAPER SCAN: Carefully examine every single question across the entire provided past exam material from start to finish.\n";
        $prompt .= "2. TARGET TOPIC MATCHING: Extract every question that belongs to any of the TARGET CHAPTERS listed above (up to {$numQuestions} questions).\n";
        $prompt .= "3. STRICT TOPIC FILTERING: If a question belongs to ANY OTHER CHAPTER NOT IN THE TARGET LIST, COMPLETELY DISCARD IT.\n";
        $prompt .= "4. OCR & TYPO CLEANING: Intelligently fix scanning artifacts, misread letters, and typographical errors in past exam stems without altering the academic meaning.\n";
        $prompt .= "5. VERIFIED ANSWER DEDUCTION: Ignore any handwritten student scribbles or pencil marks on scanned exams. Scientifically verify the 100% accurate correct answer.\n";
        $prompt .= "6. NON-MCQ CONVERSION & ASTERISK (*) RULE: If a question was fill-in-the-blank, matching, or short-answer, convert it into a standard 4-option MCQ with plausible distractors and prefix the question with an asterisk '*'.\n";
        $prompt .= $languageRules . "\n";
        if ($pageRange) $prompt .= "PAGE / UNIT CONSTRAINT: Focus questions strictly on pages / unit: " . $pageRange . ".\n";
        if ($focusArea) $prompt .= "Additional student focus: " . $focusArea . "\n";
        $prompt .= "\nCRITICAL: Return ONLY a raw JSON array matching this exact schema:\n";
        $prompt .= '[{"type": "mcq|tf", "question": "Question text in English (or Arabic if source is Arabic)", "options":["A. Choice 1", "B. Choice 2", "C. Choice 3", "D. Choice 4"], "correctAnswer": "A", "explanation": "شرح مفصل للإجابة باللغة العربية مع توضيح سبب صحة الخيار", "assignedChapter": "Target Chapter"}]';
        if (!empty($text)) $prompt .= "\n\nPast Exam Text/Data:\n" . $text;
    } else {
        $difficultyInstructions = "";
        if ($difficulty === 'easy') {
            $difficultyInstructions = "DIFFICULTY LEVEL: EASY (Foundational Recall & Core Concepts).\n- Focus on core definitions, basic classifications, standard terminology, and primary high-yield facts.";
        } elseif ($difficulty === 'hard') {
            $difficultyInstructions = "DIFFICULTY LEVEL: HARD (Advanced & In-Depth Clinical Thinking).\n- Focus on subtle distinctions, tricky clinical distractors, mechanisms, and clinical problem-solving.";
        } else {
            $difficultyInstructions = "DIFFICULTY LEVEL: MEDIUM (Standard University Exam Level).\n- Focus on conceptual understanding, mechanisms, comparative analysis, and standard examination questions.";
        }

        $promptInstructions = "- Include standard MCQs (4 options: A, B, C, D).\n";
        if ($includeExcept) $promptInstructions .= "- Include 'EXCEPT' or 'NOT' questions (capitalize negative words clearly).\n";
        if ($includeStatements) $promptInstructions .= "- Include 'Statement 1 & 2' (Two statements) questions.\n";
        if ($includeCases) $promptInstructions .= "- Include Clinical Vignettes / Applied Case scenarios appropriate for the subject.\n";
        if (strpos($questionTypes, 'truefalse') !== false) $promptInstructions .= "- Include True/False questions.\n";

        $prompt = $persona . "\n";
        if ($subjectTitle) $prompt .= "Target Subject: " . $subjectTitle . "\n";
        $prompt .= "Create exactly {$numQuestions} UNIQUE, high-yield academic questions based STRICTLY on the source document text/slides.\n";
        if ($totalBatches > 1) {
            $prompt .= "This is BATCH {$batchNum} of {$totalBatches}. Ensure all questions in this batch are completely distinct and cover diverse topics across the material.\n";
        }

        $subjectLower = strtolower($subjectTitle);
        $domainGuidance = "";

        if (preg_match('/english|reading|writing|eap|grammar|esl|ielts|vocabulary/i', $subjectLower)) {
            $domainGuidance = "STRICT SUBJECT DOMAIN (Academic English / EAP):\n- Focus on reading comprehension, vocabulary in context, synthesis, paragraph structure, thesis/hypothesis formulation, grammar, and transition/discourse markers.\n- Do NOT drift into unrelated clinical domains (e.g. patient empathy/ethics) unless explicitly taught in the text.";
        } elseif (preg_match('/islamic|fiqh|hadith|tafseer|quran|arabic|لغة عربية|ثقافة إسلامية|فقه|عقيدة/i', $subjectLower)) {
            $domainGuidance = "STRICT SUBJECT DOMAIN (Islamic Studies & Arabic Language):\n- All questions, choices, and explanations must be 100% in pure Arabic.\n- Focus on key rulings (أحكام), linguistic rules (قواعد نحوية وبلاغية), principles (أصول), and classical textual comprehension.";
        } elseif (preg_match('/chem|physic|math|biostat|calculus|organic|bio-stat/i', $subjectLower)) {
            $domainGuidance = "STRICT SUBJECT DOMAIN (Physical Sciences, Chemistry, & Biostatistics):\n- Focus on quantitative principles, molecular structures, functional groups, reaction mechanisms, physical laws, statistical tests, and formula applications with exact numerical clarity.";
        } elseif (preg_match('/dent|oral|prostho|endo|perio|ortho|operative|dental|amelo|tooth|teeth/i', $subjectLower)) {
            $domainGuidance = "STRICT SUBJECT DOMAIN (Dental Medicine & Surgery):\n- Focus on dental anatomy, oral histological landmarks, operative techniques, dental biomaterials, diagnostic signs, treatment protocols, and clinical dental case scenarios.";
        } else {
            $domainGuidance = "STRICT SUBJECT DOMAIN (Medical, Biomedical, & Clinical Sciences):\n- Focus on anatomical structures, physiological pathways, disease pathophysiology, diagnostic criteria, pharmacological mechanisms, and applied clinical cases.";
        }

        $previousQuestionStems = $data['previousQuestionStems'] ?? [];
        if (!empty($previousQuestionStems) && is_array($previousQuestionStems)) {
            $prompt .= "\nCRITICAL ANTI-DUPLICATION & CONCEPT DIVERSITY (DO NOT RE-TEST THESE CONCEPTS):\n";
            $prompt .= "The following questions/concepts have ALREADY been generated in earlier batches:\n";
            foreach (array_slice($previousQuestionStems, -20) as $prevStem) {
                $prompt .= "- " . $prevStem . "\n";
            }
            $prompt .= "DO NOT duplicate, rephrase, or re-test any of the concepts, mechanisms, transition markers, or definitions listed above.\n";
            $prompt .= "You MUST test completely distinct topics, structures, reactions, vocabulary, and units from across the document.\n";
        }

        $prompt .= "\nDOCUMENT COVERAGE & PROPORTIONAL DISTRIBUTION:\n";
        $prompt .= "- Systematically traverse the entire source material from beginning, middle, to end.\n";
        $prompt .= "- Distribute questions evenly across all major units, lectures, or sections. Do NOT cluster questions in the first few pages.\n";

        $prompt .= "\n" . $domainGuidance . "\n";

        $prompt .= "\nGRAMMAR & LINGUISTIC UNAMBIGUITY:\n";
        $prompt .= "- Avoid dialect-dependent rules or controversial regional nuances (such as British vs. American collective noun subject-verb agreement, e.g. 'the team is' vs 'the team are').\n";
        $prompt .= "- All grammar, science, and syntax questions must test universally accepted, unambiguous academic facts where exactly one choice is unequivocally correct.\n";

        $prompt .= "\nCONTENT QUALITY & HIGH-YIELD TARGETING:\n";
        $prompt .= "- Focus on meaningful academic concepts: mechanisms of action, diagnostic criteria, clinical classifications, cause-and-effect relationships, and distinctions.\n";
        $prompt .= "- Avoid trivial filler (e.g. textbook author bios, publication years, or isolated meaningless numbers).\n";

        $prompt .= "\nDISTRACTOR QUALITY & REALISM:\n";
        $prompt .= "- All 4 options (A, B, C, D) must be plausible, grammatically parallel, and of comparable length.\n";
        $prompt .= "- Distractors must represent realistic student misconceptions or closely related scientific concepts, NOT obviously ridiculous or fake statements.\n";
        $prompt .= "- Distribute the correct answer uniformly across A, B, C, and D.\n";

        $prompt .= "\nSTRICT FIELD ISOLATION (NO ARABIC IN QUESTION/OPTIONS):\n";
        $prompt .= "- The 'question' string and 'options' array must contain ONLY the English question and 4 choices.\n";
        $prompt .= "- NEVER output Arabic text, notes, or prefixes like 'توضيح الإجابة:' inside the 'question' or 'options' fields.\n";
        $prompt .= "- ALL Arabic explanations must strictly live inside the 'explanation' property.\n";

        $prompt .= "\n" . $difficultyInstructions . "\n";
        $prompt .= $languageRules . "\n";
        if ($pageRange) $prompt .= "PAGE / UNIT CONSTRAINT: Focus questions strictly on pages / unit: " . $pageRange . ". Do not generate questions outside these pages/units.\n";
        if ($focusArea) $prompt .= "Focus specifically on: " . $focusArea . "\n";
        $prompt .= $promptInstructions;
        $prompt .= "\nCRITICAL: Return ONLY a raw JSON array without markdown blocks. Format must be exactly:\n";
        $prompt .= '[{"type": "mcq|tf", "question": "Question text in English (or Arabic if source is Arabic)", "options":["A. Choice 1", "B. Choice 2", "C. Choice 3", "D. Choice 4"], "correctAnswer": "A", "explanation": "شرح مفصل للإجابة باللغة العربية مع توضيح سبب صحة الخيار وتفنيد الخيارات الخاطئة", "assignedChapter": "Chapter / Unit Name"}]';
        if (!empty($text)) $prompt .= "\n\nSource Document Text:\n" . $text;
    }

    $parts = [];
    if (!empty($geminiFileUri)) {
        $parts[] = [
            "fileData" => [
                "mimeType" => "application/pdf",
                "fileUri" => $geminiFileUri
            ]
        ];
    }
    $validImages = [];
    if (!empty($data['images']) && is_array($data['images'])) {
        foreach ($data['images'] as $b64Img) {
            $sanitized = sanitizeGeminiImagePayload($b64Img);
            if ($sanitized !== null) $validImages[] = $sanitized;
            if (count($validImages) >= 16) break;
        }
    }

    foreach ($validImages as $imageData) {
        $parts[] = [
            "inlineData" => [
                "mimeType" => $imageData['mimeType'],
                "data" => $imageData['data']
            ]
        ];
    }
    $parts[] = ["text" => $prompt];

    $payload = json_encode([
        "contents" => [
            ["parts" => $parts]
        ],
        "generationConfig" => [
            "temperature" => ($difficulty === 'hard') ? 0.45 : 0.3,
            "maxOutputTokens" => 8192,
            "responseMimeType" => "application/json"
        ]
    ]);

    $response = false;
    $httpCode = 0;
    $usedKeyIndex = -1;
    $usedApiKey = '';
    $latencyMs = 0;
    $lastErrorMsg = '';

    foreach ($modelsToTry as $modelName) {
        foreach ($API_KEYS as $index => $apiKey) {
            $url = "https://generativelanguage.googleapis.com/v1beta/models/" . urlencode($modelName) . ":generateContent?key=" . $apiKey;
            $reqResult = postGeminiRequest($url, $payload, 100);
            $response = $reqResult['response'];
            $httpCode = $reqResult['http_code'];
            $latencyMs = $reqResult['latency_ms'];
            $usedKeyIndex = $index;
            $usedApiKey = $apiKey;

            if ($httpCode === 200 && !empty($response)) {
                $jsonRes = json_decode($response, true);
                if (!isset($jsonRes['error'])) {
                    break 2;
                } else {
                    $lastErrorMsg = $jsonRes['error']['message'] ?? 'Unknown API Error';
                }
            } else {
                $lastErrorMsg = "HTTP $httpCode: " . substr(strval($response), 0, 150);
            }
        }
    }

    recordGeminiUsage($usedKeyIndex, $usedApiKey, $httpCode, $response, $latencyMs, $numQuestions);

    if ($httpCode !== 200 || empty($response)) {
        return ['success' => false, 'message' => "Gemini API Error: " . $lastErrorMsg];
    }

    $jsonRes = json_decode($response, true);
    if (isset($jsonRes['error'])) {
        return ['success' => false, 'message' => "Gemini Error: " . $jsonRes['error']['message']];
    }

    $rawContent = $jsonRes['candidates'][0]['content']['parts'][0]['text'] ?? '';
    $cleanJson = preg_replace('/^```(?:json)?\s*/im', '', $rawContent);
    $cleanJson = preg_replace('/\s*```$/m', '', $cleanJson);
    $cleanJson = trim($cleanJson);

    // Multi-strategy resilient JSON extraction
    $parsedQuestions = json_decode($cleanJson, true);

    // Strategy 2: Remove trailing commas
    if (!$parsedQuestions) {
        $noTrailingCommas = preg_replace('/,\s*([\]\}])/m', '$1', $cleanJson);
        $parsedQuestions = json_decode($noTrailingCommas, true);
    }

    // Strategy 3: Repair truncated array bracket closure
    if (!$parsedQuestions) {
        $lastBrace = strrpos($cleanJson, '}');
        if ($lastBrace !== false) {
            $repaired = substr($cleanJson, 0, $lastBrace + 1) . "\n]";
            $firstBracket = strpos($repaired, '[');
            if ($firstBracket !== false) {
                $repaired = substr($repaired, $firstBracket);
                $parsedQuestions = json_decode($repaired, true);
            }
        }
    }

    // Strategy 4: Direct regex extraction of individual question objects
    if (!$parsedQuestions) {
        if (preg_match_all('/\{\s*"type"\s*:\s*"[^"]+"[\s\S]*?"explanation"\s*:\s*"[^"]*"(?:\s*,\s*"assignedChapter"\s*:\s*"[^"]*")?\s*\}/', $cleanJson, $objMatches)) {
            $parsedQuestions = [];
            foreach ($objMatches[0] as $rawObj) {
                $item = json_decode($rawObj, true);
                if ($item && !empty($item['question'])) {
                    $parsedQuestions[] = $item;
                }
            }
        }
    }

    // Strategy 5: Wrapper object unpacking
    if (is_array($parsedQuestions) && !isset($parsedQuestions[0])) {
        if (!empty($parsedQuestions['questions']) && is_array($parsedQuestions['questions'])) {
            $parsedQuestions = $parsedQuestions['questions'];
        } elseif (!empty($parsedQuestions['quiz']) && is_array($parsedQuestions['quiz'])) {
            $parsedQuestions = $parsedQuestions['quiz'];
        } elseif (!empty($parsedQuestions['data']) && is_array($parsedQuestions['data'])) {
            $parsedQuestions = $parsedQuestions['data'];
        }
    }

    if (!is_array($parsedQuestions) || empty($parsedQuestions)) {
        return ['success' => false, 'message' => "Failed to parse questions JSON from model response."];
    }

    $validated = [];
    foreach ($parsedQuestions as $q) {
        if (!is_array($q)) continue;
        $qText = trim($q['question'] ?? '');
        if (empty($qText)) continue;
        
        $opts = $q['options'] ?? [];
        if (!is_array($opts) || count($opts) < 2) {
            $opts = ['أ', 'ب', 'ج', 'د'];
        }

        // Leaked Arabic Explanation / Artifact Sanitizer
        // If question or options are in English but contain accidental Arabic explanation notes (e.g. "توضيح الإجابة: ..."),
        // strip them from question & options and ensure they are captured in explanation.
        $leakedArabicNotes = [];
        if (preg_match('/[a-zA-Z]{4,}/', $qText)) {
            // Check if question stem has leaked Arabic prefix/suffix
            if (preg_match('/(?:توضيح|الشرح|ملاحظة|تفسير)[\s\S]*?[\x{0600}-\x{06FF}]+/u', $qText, $arabicMatch)) {
                $leakedArabicNotes[] = trim($arabicMatch[0]);
                $qText = trim(str_replace($arabicMatch[0], '', $qText));
            }

            // Check each option for leaked Arabic explanation
            $cleanOpts = [];
            foreach ($opts as $optStr) {
                if (preg_match('/(?:توضيح|الشرح|ملاحظة|تفسير)[\s\S]*?[\x{0600}-\x{06FF}]+/u', $optStr, $optArabicMatch)) {
                    $leakedArabicNotes[] = trim($optArabicMatch[0]);
                    $optStr = trim(str_replace($optArabicMatch[0], '', $optStr));
                }
                $cleanOpts[] = $optStr;
            }
            $opts = $cleanOpts;
        }
        
        $correct = trim($q['correctAnswer'] ?? '');
        $resolvedCorrect = null;

        if (!empty($correct)) {
            // 1. Direct exact match
            if (in_array($correct, $opts)) {
                $resolvedCorrect = $correct;
            } else {
                // 2. Map single letters (A, B, C, D / أ, ب, ج, د) to corresponding option index
                $letterMap = ['A' => 0, 'B' => 1, 'C' => 2, 'D' => 3, 'E' => 4, 'F' => 5];
                $arLetterMap = ['أ' => 0, 'ا' => 0, 'ب' => 1, 'ج' => 2, 'د' => 3, 'هـ' => 4, 'ه' => 4];
                $upper = strtoupper(trim(preg_replace('/[\.\)\:\-\s]+$/', '', $correct)));

                if (isset($letterMap[$upper]) && isset($opts[$letterMap[$upper]])) {
                    $resolvedCorrect = $opts[$letterMap[$upper]];
                } elseif (isset($arLetterMap[$correct]) && isset($opts[$arLetterMap[$correct]])) {
                    $resolvedCorrect = $opts[$arLetterMap[$correct]];
                } else {
                    // 3. Prefix/Substring matching
                    foreach ($opts as $optItem) {
                        $cleanOpt = trim(preg_replace('/^[a-zA-Z0-9\x{0600}-\x{06FF}][\.\)\:\-\s]+/u', '', $optItem));
                        $cleanCorr = trim(preg_replace('/^[a-zA-Z0-9\x{0600}-\x{06FF}][\.\)\:\-\s]+/u', '', $correct));
                        if (!empty($cleanCorr) && (stripos($optItem, $cleanCorr) !== false || stripos($cleanOpt, $cleanCorr) !== false)) {
                            $resolvedCorrect = $optItem;
                            break;
                        }
                    }
                }
            }
        }

        if (empty($resolvedCorrect)) {
            $resolvedCorrect = $opts[0];
        }
        $correct = $resolvedCorrect;

        $explanation = trim($q['explanation'] ?? 'توضيح الإجابة الصحيحة بناءً على المحتوى المعتمد.');
        if (!empty($leakedArabicNotes)) {
            $explanation = implode(" - ", $leakedArabicNotes) . "\n" . $explanation;
        }

        $validated[] = [
            'type' => $q['type'] ?? 'mcq',
            'question' => $qText,
            'options' => $opts,
            'correctAnswer' => $correct,
            'explanation' => $explanation,
            'assignedChapter' => trim($q['assignedChapter'] ?? ($data['chapterName'] ?? 'عام'))
        ];
    }

    return ['success' => true, 'data' => ['questions' => $validated]];
}

function performGeminiGeneration($data, $API_KEYS, $jobFileCallback = null) {
    $mode = $data['mode'] ?? 'ai_generation';
    $isPastExamFilter = ($mode === 'past_exam_filter');
    $targetNum = (int)($data['numQuestions'] ?? ($isPastExamFilter ? 200 : 10));
    if ($targetNum <= 0) $targetNum = 10;
    if ($targetNum > 200) $targetNum = 200;

    // For past exam filtering, run in single comprehensive pass
    if ($isPastExamFilter || $targetNum <= 20) {
        $singlePayload = $data;
        $singlePayload['numQuestions'] = $targetNum;
        return performGeminiSingleBatch($singlePayload, $API_KEYS, 1, 1);
    }

    // For large question counts (e.g. 30, 50, 60, 100), partition into chunks of 20 with cross-batch memory
    $batchSize = 20;
    $totalBatches = (int)ceil($targetNum / $batchSize);
    $allQuestions = [];
    $seenQuestions = [];
    $alreadyGeneratedStems = [];

    for ($b = 1; $b <= $totalBatches; $b++) {
        $currentBatchTarget = min($batchSize, $targetNum - count($allQuestions));
        if ($currentBatchTarget <= 0) break;

        $batchPayload = $data;
        $batchPayload['numQuestions'] = $currentBatchTarget;
        $batchPayload['previousQuestionStems'] = $alreadyGeneratedStems;

        if ($jobFileCallback && is_callable($jobFileCallback)) {
            $jobFileCallback($b, $totalBatches, count($allQuestions));
        }

        $batchRes = performGeminiSingleBatch($batchPayload, $API_KEYS, $b, $totalBatches);
        if ($batchRes['success'] && !empty($batchRes['data']['questions'])) {
            foreach ($batchRes['data']['questions'] as $q) {
                $qTextClean = strtolower(trim(preg_replace('/[^a-zA-Z0-9]/', ' ', $q['question'])));
                $words = array_filter(explode(' ', $qTextClean), function($w) { return strlen($w) > 3; });
                $stemSignature = implode(' ', array_slice($words, 0, 8));
                $qKey = md5($stemSignature . '_' . trim($q['correctAnswer']));

                if (!isset($seenQuestions[$qKey])) {
                    $seenQuestions[$qKey] = true;
                    $allQuestions[] = $q;
                    $alreadyGeneratedStems[] = substr($q['question'], 0, 100) . " (Answer: " . $q['correctAnswer'] . ")";
                }
            }
        }
    }

    if (empty($allQuestions)) {
        return ['success' => false, 'message' => "Failed to generate questions across batches."];
    }

    return ['success' => true, 'data' => ['questions' => $allQuestions]];
}

// --- ACTION 2: GENERATE QUIZ VIA GEMINI ---
if ($action === 'generate' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $res = performGeminiGeneration($data, getGeminiRawApiKeys());
    sendResponse($res['success'], $res['data'] ?? $res['message']);
}

// --- RECORD GEMINI USAGE HELPER ---
function recordGeminiUsage($keyIndex, $apiKey, $httpCode, $response, $latencyMs, $numQuestions = 0) {
    $dataDir = __DIR__ . '/gemini_keys_data';
    if (!is_dir($dataDir)) {
        @mkdir($dataDir, 0777, true);
    }
    
    $maskedKey = !empty($apiKey) ? (substr($apiKey, 0, 8) . '...' . substr($apiKey, -4)) : 'N/A';
    $usageFile = $dataDir . '/gemini_usage_log.json';
    $statsFile = $dataDir . '/gemini_daily_stats.json';
    
    $logs = file_exists($usageFile) ? json_decode(file_get_contents($usageFile), true) : [];
    if (!is_array($logs)) $logs = [];
    
    $stats = file_exists($statsFile) ? json_decode(file_get_contents($statsFile), true) : [];
    if (!is_array($stats)) $stats = [];
    
    $today = date('Y-m-d');
    if (!isset($stats[$today])) {
        $stats[$today] = [
            'total_requests' => 0,
            'total_prompt_tokens' => 0,
            'total_candidates_tokens' => 0,
            'total_tokens' => 0,
            'by_key' => []
        ];
    }
    
    $jsonRes = is_string($response) ? json_decode($response, true) : (is_array($response) ? $response : []);
    $usageMeta = $jsonRes['usageMetadata'] ?? [];
    $promptTokens = intval($usageMeta['promptTokenCount'] ?? 0);
    $candidatesTokens = intval($usageMeta['candidatesTokenCount'] ?? 0);
    $totalTokens = intval($usageMeta['totalTokenCount'] ?? 0);
    
    $statusText = ($httpCode === 200) ? 'active' : (($httpCode === 429) ? 'quota_exhausted' : 'invalid');
    
    $stats[$today]['total_requests']++;
    $stats[$today]['total_prompt_tokens'] += $promptTokens;
    $stats[$today]['total_candidates_tokens'] += $candidatesTokens;
    $stats[$today]['total_tokens'] += $totalTokens;
    
    if (!isset($stats[$today]['by_key'][$keyIndex])) {
        $stats[$today]['by_key'][$keyIndex] = [
            'requests' => 0,
            'prompt_tokens' => 0,
            'candidates_tokens' => 0,
            'total_tokens' => 0,
            'last_latency' => 0,
            'status' => 'unknown'
        ];
    }
    
    $stats[$today]['by_key'][$keyIndex]['requests']++;
    $stats[$today]['by_key'][$keyIndex]['prompt_tokens'] += $promptTokens;
    $stats[$today]['by_key'][$keyIndex]['candidates_tokens'] += $candidatesTokens;
    $stats[$today]['by_key'][$keyIndex]['total_tokens'] += $totalTokens;
    $stats[$today]['by_key'][$keyIndex]['last_latency'] = $latencyMs;
    $stats[$today]['by_key'][$keyIndex]['status'] = $statusText;
    
    $logEntry = [
        'id' => 'log_' . uniqid(),
        'timestamp' => date('Y-m-d H:i:s'),
        'date' => $today,
        'key_index' => $keyIndex,
        'key_masked' => $maskedKey,
        'http_code' => $httpCode,
        'status' => $statusText,
        'prompt_tokens' => $promptTokens,
        'candidates_tokens' => $candidatesTokens,
        'total_tokens' => $totalTokens,
        'latency_ms' => $latencyMs,
        'num_questions' => $numQuestions
    ];
    
    array_unshift($logs, $logEntry);
    if (count($logs) > 100) {
        $logs = array_slice($logs, 0, 100);
    }
    
    @file_put_contents($usageFile, json_encode($logs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    @file_put_contents($statsFile, json_encode($stats, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// --- ACTION 6: GEMINI STATUS FOR ADMIN DASHBOARD ---
if ($action === 'gemini_status') {
    $dataDir = __DIR__ . '/gemini_keys_data';
    $statsFile = $dataDir . '/gemini_daily_stats.json';
    $usageFile = $dataDir . '/gemini_usage_log.json';
    $healthFile = $dataDir . '/gemini_health_cache.json';

    $today = date('Y-m-d');
    $stats = file_exists($statsFile) ? json_decode(file_get_contents($statsFile), true) : [];
    $logs = file_exists($usageFile) ? json_decode(file_get_contents($usageFile), true) : [];
    $health = file_exists($healthFile) ? json_decode(file_get_contents($healthFile), true) : [];

    $todayStats = $stats[$today] ?? [
        'total_requests' => 0,
        'total_prompt_tokens' => 0,
        'total_candidates_tokens' => 0,
        'total_tokens' => 0,
        'by_key' => []
    ];

    $entries = getGeminiKeyEntries();
    $keysList = [];
    $activeCount = 0;
    $exhaustedCount = 0;
    $invalidCount = 0;

    foreach ($entries as $index => $entry) {
        $apiKey = $entry['key'] ?? '';
        $keyId = $entry['id'] ?? ('gem_key_' . ($index + 1));
        $label = $entry['label'] ?? ('مفتاح Gemini #' . ($index + 1));
        $maskedKey = !empty($apiKey) ? (substr($apiKey, 0, 8) . '...' . substr($apiKey, -4)) : 'N/A';

        $keyStats = $todayStats['by_key'][$index] ?? [
            'requests' => 0,
            'prompt_tokens' => 0,
            'candidates_tokens' => 0,
            'total_tokens' => 0,
            'last_latency' => 0,
            'status' => 'unknown'
        ];

        $healthInfo = $health[$index] ?? null;
        $status = $healthInfo ? $healthInfo['status'] : ($keyStats['status'] !== 'unknown' ? $keyStats['status'] : 'active');
        $latency = $healthInfo ? $healthInfo['latency_ms'] : $keyStats['last_latency'];
        $lastTested = $healthInfo ? $healthInfo['last_tested'] : null;

        if ($status === 'active') $activeCount++;
        elseif ($status === 'quota_exhausted') $exhaustedCount++;
        elseif ($status === 'invalid') $invalidCount++;
        else $activeCount++;

        $keysList[] = [
            'id' => $keyId,
            'index' => $index,
            'label' => $label,
            'key_masked' => $maskedKey,
            'status' => $status,
            'requests_today' => $keyStats['requests'],
            'tokens_today' => $keyStats['total_tokens'],
            'rpd_limit' => 1500,
            'latency_ms' => $latency,
            'last_tested' => $lastTested,
            'created_at' => $entry['created_at'] ?? ''
        ];
    }

    sendResponse(true, [
        'summary' => [
            'total_requests_today' => $todayStats['total_requests'],
            'total_tokens_today' => $todayStats['total_tokens'],
            'active_keys' => $activeCount,
            'exhausted_keys' => $exhaustedCount,
            'invalid_keys' => $invalidCount,
            'total_keys' => count($entries)
        ],
        'keys' => $keysList,
        'recent_logs' => array_slice($logs, 0, 50)
    ]);
}

// --- ACTION 7: TEST GEMINI KEYS HEALTH ---
if ($action === 'test_keys') {
    global $GEMINI_MODELS;
    $targetModel = !empty($GEMINI_MODELS[0]) ? $GEMINI_MODELS[0] : 'gemini-2.5-flash';
    $targetIndex = isset($_GET['key_index']) ? intval($_GET['key_index']) : -1;
    $dataDir = __DIR__ . '/gemini_keys_data';
    if (!is_dir($dataDir)) @mkdir($dataDir, 0777, true);
    $healthFile = $dataDir . '/gemini_health_cache.json';

    $health = file_exists($healthFile) ? json_decode(file_get_contents($healthFile), true) : [];
    if (!is_array($health)) $health = [];

    $entries = getGeminiKeyEntries();
    $testResults = [];

    foreach ($entries as $index => $entry) {
        if ($targetIndex >= 0 && $index !== $targetIndex) {
            continue;
        }
        $apiKey = $entry['key'] ?? '';
        if (empty($apiKey)) continue;

        $testPayload = json_encode([
            "contents" => [
                ["parts" => [["text" => "ping"]]]
            ],
            "generationConfig" => ["maxOutputTokens" => 1]
        ]);

        $url = "https://generativelanguage.googleapis.com/v1beta/models/" . urlencode($targetModel) . ":generateContent?key=" . $apiKey;
        $reqResult = postGeminiRequest($url, $testPayload, 15);

        $httpCode = $reqResult['http_code'];
        $latencyMs = $reqResult['latency_ms'];
        $status = ($httpCode === 200) ? 'active' : (($httpCode === 429) ? 'quota_exhausted' : 'invalid');

        $health[$index] = [
            'id' => $entry['id'] ?? ('gem_key_' . ($index + 1)),
            'index' => $index,
            'label' => $entry['label'] ?? ('مفتاح Gemini #' . ($index + 1)),
            'key_masked' => substr($apiKey, 0, 8) . '...' . substr($apiKey, -4),
            'http_code' => $httpCode,
            'status' => $status,
            'latency_ms' => $latencyMs,
            'last_tested' => date('Y-m-d H:i:s')
        ];

        $testResults[] = $health[$index];
    }

    @file_put_contents($healthFile, json_encode($health, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    sendResponse(true, ['tested' => $testResults]);
}

// --- ACTION 7.1: ADD A NEW GEMINI API KEY ---
if ($action === 'add_gemini_key' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $key = trim($data['key'] ?? '');
    $label = trim($data['label'] ?? '');

    if (empty($key)) {
        sendResponse(false, "يرجى إدخال رمز مفتاح Gemini API.");
    }
    if (strlen($key) < 15) {
        sendResponse(false, "رمز مفتاح Gemini قصير جداً وغير صالح.");
    }

    $entries = getGeminiKeyEntries();
    foreach ($entries as $e) {
        if (($e['key'] ?? '') === $key) {
            sendResponse(false, "هذا المفتاح مضاف مسبقاً في النظام.");
        }
    }

    if (empty($label)) {
        $label = 'مفتاح Gemini #' . (count($entries) + 1);
    }

    // Quick verification ping
    global $GEMINI_MODELS;
    $targetModel = !empty($GEMINI_MODELS[0]) ? $GEMINI_MODELS[0] : 'gemini-flash-latest';
    $testPayload = json_encode([
        "contents" => [["parts" => [["text" => "ping"]]]],
        "generationConfig" => ["maxOutputTokens" => 1]
    ]);
    $url = "https://generativelanguage.googleapis.com/v1beta/models/" . urlencode($targetModel) . ":generateContent?key=" . $key;
    $reqResult = postGeminiRequest($url, $testPayload, 15);
    $httpCode = $reqResult['http_code'];

    $newEntry = [
        'id' => 'gem_key_' . uniqid(),
        'label' => $label,
        'key' => $key,
        'created_at' => date('Y-m-d H:i:s')
    ];

    $entries[] = $newEntry;
    saveGeminiKeyEntries($entries);

    // Update health cache
    $dataDir = __DIR__ . '/gemini_keys_data';
    $healthFile = $dataDir . '/gemini_health_cache.json';
    $health = file_exists($healthFile) ? json_decode(file_get_contents($healthFile), true) : [];
    if (!is_array($health)) $health = [];
    $newIndex = count($entries) - 1;
    $health[$newIndex] = [
        'id' => $newEntry['id'],
        'index' => $newIndex,
        'label' => $label,
        'key_masked' => substr($key, 0, 8) . '...' . substr($key, -4),
        'http_code' => $httpCode,
        'status' => ($httpCode === 200) ? 'active' : (($httpCode === 429) ? 'quota_exhausted' : 'invalid'),
        'latency_ms' => $reqResult['latency_ms'],
        'last_tested' => date('Y-m-d H:i:s')
    ];
    @file_put_contents($healthFile, json_encode($health, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    sendResponse(true, [
        'message' => ($httpCode === 200) ? 'تمت إضافة المفتاح واختباره بنجاح وهو نشط (Active)!' : 'تمت إضافة المفتاح ولكن اختبار الاتصال أرجع كود: ' . $httpCode,
        'entry' => $newEntry,
        'http_code' => $httpCode
    ]);
}

// --- ACTION 7.2: EDIT AN EXISTING GEMINI API KEY ---
if ($action === 'edit_gemini_key' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $index = isset($data['index']) ? intval($data['index']) : -1;
    $id = $data['id'] ?? '';
    $key = isset($data['key']) ? trim($data['key']) : null;
    $label = isset($data['label']) ? trim($data['label']) : null;

    $entries = getGeminiKeyEntries();
    $targetIndex = -1;

    if ($index >= 0 && $index < count($entries)) {
        $targetIndex = $index;
    } elseif (!empty($id)) {
        foreach ($entries as $i => $e) {
            if (($e['id'] ?? '') === $id) {
                $targetIndex = $i;
                break;
            }
        }
    }

    if ($targetIndex === -1) {
        sendResponse(false, "المفتاح المطلوب تعديله غير موجود.");
    }

    if ($key !== null && $key !== '' && strpos($key, '...') === false) {
        if (strlen($key) < 15) {
            sendResponse(false, "رمز مفتاح Gemini قصير جداً وغير صالح.");
        }
        $entries[$targetIndex]['key'] = $key;
    }

    if ($label !== null && !empty($label)) {
        $entries[$targetIndex]['label'] = $label;
    }

    $entries[$targetIndex]['updated_at'] = date('Y-m-d H:i:s');
    saveGeminiKeyEntries($entries);

    // Re-test edited key
    global $GEMINI_MODELS;
    $targetModel = !empty($GEMINI_MODELS[0]) ? $GEMINI_MODELS[0] : 'gemini-flash-latest';
    $testedKey = $entries[$targetIndex]['key'];
    $testPayload = json_encode([
        "contents" => [["parts" => [["text" => "ping"]]]],
        "generationConfig" => ["maxOutputTokens" => 1]
    ]);
    $url = "https://generativelanguage.googleapis.com/v1beta/models/" . urlencode($targetModel) . ":generateContent?key=" . $testedKey;
    $reqResult = postGeminiRequest($url, $testPayload, 15);
    $httpCode = $reqResult['http_code'];

    $dataDir = __DIR__ . '/gemini_keys_data';
    $healthFile = $dataDir . '/gemini_health_cache.json';
    $health = file_exists($healthFile) ? json_decode(file_get_contents($healthFile), true) : [];
    if (!is_array($health)) $health = [];
    $health[$targetIndex] = [
        'id' => $entries[$targetIndex]['id'] ?? ('gem_key_' . ($targetIndex + 1)),
        'index' => $targetIndex,
        'label' => $entries[$targetIndex]['label'] ?? ('مفتاح Gemini #' . ($targetIndex + 1)),
        'key_masked' => substr($testedKey, 0, 8) . '...' . substr($testedKey, -4),
        'http_code' => $httpCode,
        'status' => ($httpCode === 200) ? 'active' : (($httpCode === 429) ? 'quota_exhausted' : 'invalid'),
        'latency_ms' => $reqResult['latency_ms'],
        'last_tested' => date('Y-m-d H:i:s')
    ];
    @file_put_contents($healthFile, json_encode($health, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    sendResponse(true, [
        'message' => 'تم حفظ التعديلات واختبار المفتاح بنجاح.',
        'entry' => $entries[$targetIndex]
    ]);
}

// --- ACTION 7.3: DELETE A GEMINI API KEY ---
if ($action === 'delete_gemini_key' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput, true);
    $index = isset($data['index']) ? intval($data['index']) : -1;
    $id = $data['id'] ?? '';

    $entries = getGeminiKeyEntries();
    if (count($entries) <= 1) {
        sendResponse(false, "لا يمكن حذف المفتاح الأخير. يجب الإبقاء على مفتاح واحد على الأقل للذكاء الاصطناعي.");
    }

    $targetIndex = -1;
    if ($index >= 0 && $index < count($entries)) {
        $targetIndex = $index;
    } elseif (!empty($id)) {
        foreach ($entries as $i => $e) {
            if (($e['id'] ?? '') === $id) {
                $targetIndex = $i;
                break;
            }
        }
    }

    if ($targetIndex === -1) {
        sendResponse(false, "المفتاح المطلوب حذفه غير موجود.");
    }

    $deleted = array_splice($entries, $targetIndex, 1);
    saveGeminiKeyEntries($entries);

    // Rebuild health cache indices
    $dataDir = __DIR__ . '/gemini_keys_data';
    $healthFile = $dataDir . '/gemini_health_cache.json';
    if (file_exists($healthFile)) {
        @unlink($healthFile);
    }

    sendResponse(true, [
        'message' => 'تم حذف المفتاح بنجاح.',
        'remaining_count' => count($entries)
    ]);
}

// --- POST GEMINI REQUEST HELPER (SAFE FOR cURL AND STREAM CONTEXT) ---
function postGeminiRequest($url, $payload, $timeout = 15) {
    $startTime = microtime(true);
    $response = false;
    $httpCode = 0;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);
        if ($httpCode === 0 && !empty($curlErr)) {
            $response = json_encode(['error' => ['message' => "cURL Network/Timeout ($curlErr)"]]);
        }
    } else {
        $opts = [
            'http' => [
                'method'  => 'POST',
                'header'  => "Content-Type: application/json\r\n",
                'content' => $payload,
                'timeout' => $timeout,
                'ignore_errors' => true
            ],
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false
            ]
        ];
        $context  = stream_context_create($opts);
        $response = @file_get_contents($url, false, $context);
        
        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $header) {
                if (preg_match('#HTTP/[0-9\.]+\s+([0-9]+)#i', $header, $m)) {
                    $httpCode = intval($m[1]);
                    break;
                }
            }
        }
    }

    $latencyMs = round((microtime(true) - $startTime) * 1000);
    return [
        'response' => $response,
        'http_code' => $httpCode,
        'latency_ms' => $latencyMs
    ];
}

// --- ACTION 3: SAVE QUIZ TO DB & JSON ---
if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $subjectId = $data['subjectId'] ?? '';
    $subjectName = $data['subjectName'] ?? 'مادة دراسية';
    $chapterName = $data['chapterName'] ?? 'المحاضرة العامة';
    $quizName = $data['quizName'] ?? 'اختبار تجريبي';
    $typesSummary = $data['typesSummary'] ?? 'خيارات متعددة';
    $questions = $data['questions'] ?? [];
    $specialty = $data['specialty'] ?? '';
    $year = isset($data['year']) ? intval($data['year']) : null;
    $semester = isset($data['semester']) ? intval($data['semester']) : null;
    $mode = $data['mode'] ?? 'ai_generation';
    $difficulty = $data['difficulty'] ?? 'medium';

    if (empty($subjectId) || empty($questions)) sendResponse(false, "Missing data.");

    $quizzesDir = __DIR__ . '/../quizzes_data';
    if (!is_dir($quizzesDir)) mkdir($quizzesDir, 0777, true);

    $quizId = 'quiz_' . uniqid() . '_' . bin2hex(random_bytes(2));
    $filePath = $quizzesDir . '/' . $quizId . '.json';

    $quizData = [
        'id' => $quizId,
        'subject_id' => $subjectId,
        'subject_name' => $subjectName,
        'chapter_name' => $chapterName,
        'specialty' => $specialty,
        'year' => $year,
        'semester' => $semester,
        'quiz_name' => $quizName,
        'types_summary' => $typesSummary,
        'creation_mode' => $mode,
        'difficulty' => $difficulty,
        'created_at' => date('Y-m-d H:i:s'),
        'questions' => $questions
    ];

    file_put_contents($filePath, json_encode($quizData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    // Save link to subject_links table if table exists
    if ($pdo) {
        try {
            $tableLinks = getAiExamSubjectLinksTable($pdo);
            $stmt = $pdo->prepare("INSERT INTO {$tableLinks} (subject_id, url, title, type) VALUES (?, ?, ?, 'quiz')");
            $stmt->execute([$subjectId, $quizId, $quizName]);
        } catch (Throwable $e) {}
    }

    sendResponse(true, ["message" => "Quiz saved!", "quizId" => $quizId]);
}

// --- ACTION 4: GET QUIZ ---
if ($action === 'get') {
    $rawQuizId = $_GET['id'] ?? '';
    $quizId = preg_replace('/[^a-zA-Z0-9_-]/', '', $rawQuizId);
    if (empty($quizId)) sendResponse(false, "Missing or invalid quiz ID.");
    
    $filePath = __DIR__ . '/../quizzes_data/' . $quizId . '.json';
    if (!file_exists($filePath) || basename($filePath) !== ($quizId . '.json')) sendResponse(false, "Quiz not found.");
    
    $quizData = json_decode(file_get_contents($filePath), true);
    sendResponse(true, $quizData);
}

// --- ACTION 5: LIST ALL SAVED QUIZZES ---
if ($action === 'list_quizzes') {
    try {
        $subjectId = $_GET['subject_id'] ?? '';
        $specialty = $_GET['specialty'] ?? '';
        $year = (isset($_GET['year']) && $_GET['year'] !== '') ? intval($_GET['year']) : null;
        $semester = (isset($_GET['semester']) && $_GET['semester'] !== '') ? intval($_GET['semester']) : null;

        $quizzesDir = __DIR__ . '/../quizzes_data';
        if (!is_dir($quizzesDir)) {
            @mkdir($quizzesDir, 0777, true);
        }
        
        $files = glob($quizzesDir . '/*.json');
        if (!is_array($files)) {
            $files = [];
        }
        
        $list = [];
        $subjectMetaCache = [];
        foreach ($files as $f) {
            $fileContent = @file_get_contents($f);
            if (!$fileContent) continue;
            
            $data = json_decode($fileContent, true);
            if (!is_array($data)) continue;
            
            $dataSubjectId = (string)($data['subject_id'] ?? '');
            if ($subjectId && $dataSubjectId !== (string)$subjectId) {
                continue;
            }

            $resolvedSpecialty = $data['specialty'] ?? '';
            $resolvedYear = isset($data['year']) ? intval($data['year']) : null;
            $resolvedSemester = isset($data['semester']) ? intval($data['semester']) : null;

            if ((empty($resolvedSpecialty) || $resolvedYear === null || $resolvedSemester === null) && $dataSubjectId !== '') {
                if (!array_key_exists($dataSubjectId, $subjectMetaCache)) {
                    $subjectMetaCache[$dataSubjectId] = null;
                    if (isset($pdo) && $pdo !== null) {
                        try {
                            $tableSubs = getAiExamSubjectsTable($pdo);
                            $stmt = $pdo->prepare("SELECT specialty, year, semester FROM {$tableSubs} WHERE id = ? LIMIT 1");
                            $stmt->execute([$dataSubjectId]);
                            $subjectMetaCache[$dataSubjectId] = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
                        } catch (Throwable $e) {
                            $subjectMetaCache[$dataSubjectId] = null;
                        }
                    }
                }

                if (is_array($subjectMetaCache[$dataSubjectId])) {
                    if (empty($resolvedSpecialty)) $resolvedSpecialty = $subjectMetaCache[$dataSubjectId]['specialty'] ?? '';
                    if ($resolvedYear === null && isset($subjectMetaCache[$dataSubjectId]['year'])) $resolvedYear = intval($subjectMetaCache[$dataSubjectId]['year']);
                    if ($resolvedSemester === null && isset($subjectMetaCache[$dataSubjectId]['semester'])) $resolvedSemester = intval($subjectMetaCache[$dataSubjectId]['semester']);
                }
            }

            if ($specialty && $resolvedSpecialty !== $specialty) {
                continue;
            }
            if ($year !== null && $resolvedYear !== $year) {
                continue;
            }
            if ($semester !== null && $resolvedSemester !== $semester) {
                continue;
            }
            $list[] = [
                'id' => $data['id'] ?? basename($f, '.json'),
                'subject_id' => $dataSubjectId,
                'specialty' => $resolvedSpecialty,
                'year' => $resolvedYear,
                'semester' => $resolvedSemester,
                'subject_name' => $data['subject_name'] ?? 'مادة دراسية',
                'chapter_name' => $data['chapter_name'] ?? 'عام',
                'quiz_name' => $data['quiz_name'] ?? 'اختبار',
                'num_questions' => count($data['questions'] ?? []),
                'types_summary' => $data['types_summary'] ?? 'أسئلة متعددة',
                'creation_mode' => $data['creation_mode'] ?? 'ai_generation',
                'difficulty' => $data['difficulty'] ?? 'medium',
                'created_at' => $data['created_at'] ?? ''
            ];
        }
        
        // Sort descending by created_at
        usort($list, function($a, $b) {
            return strcmp($b['created_at'], $a['created_at']);
        });
        
        sendResponse(true, $list);
    } catch (Exception $e) {
        sendResponse(false, "Error loading quizzes: " . $e->getMessage());
    }
}

// --- ACTION 8: DELETE A SAVED QUIZ ---
if ($action === 'delete_quiz' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $quizId = $data['id'] ?? $data['quiz_id'] ?? $_GET['id'] ?? '';

    if (empty($quizId)) sendResponse(false, "Missing quiz ID.");

    $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $quizId);
    $filePath = __DIR__ . '/../quizzes_data/' . $cleanId . '.json';
    if (file_exists($filePath)) {
        @unlink($filePath);
    }

    if (isset($pdo) && $pdo !== null) {
        try {
            $tableLinks = getAiExamSubjectLinksTable($pdo);
            $stmt = $pdo->prepare("DELETE FROM {$tableLinks} WHERE url = ? AND type = 'quiz'");
            $stmt->execute([$quizId]);
        } catch (Throwable $e) {}
    }

    sendResponse(true, ["message" => "Quiz deleted successfully."]);
}

// --- ACTION 8.5: RENAME A SAVED QUIZ ---
if ($action === 'rename_quiz' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    global $JSON_INPUT;
    $data = $JSON_INPUT ?: (json_decode(file_get_contents("php://input"), true) ?: []);
    $quizId = $data['id'] ?? $data['quiz_id'] ?? $_POST['id'] ?? $_GET['id'] ?? '';
    $newName = trim($data['quiz_name'] ?? $data['name'] ?? $data['new_name'] ?? $_POST['quiz_name'] ?? '');

    if (empty($quizId)) sendResponse(false, "Missing quiz ID.");
    if (empty($newName)) sendResponse(false, "Quiz name cannot be empty.");

    $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $quizId);
    $filePath = __DIR__ . '/../quizzes_data/' . $cleanId . '.json';

    if (!file_exists($filePath)) {
        sendResponse(false, "Quiz file not found.");
    }

    $fileContent = @file_get_contents($filePath);
    $quizData = json_decode($fileContent, true);
    if (!is_array($quizData)) {
        sendResponse(false, "Invalid quiz data structure.");
    }

    $quizData['quiz_name'] = $newName;
    $quizData['updated_at'] = date('Y-m-d H:i:s');

    $saved = @file_put_contents($filePath, json_encode($quizData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    if ($saved === false) {
        sendResponse(false, "Failed to write updated quiz file.");
    }

    if (isset($pdo) && $pdo !== null) {
        try {
            $tableLinks = getAiExamSubjectLinksTable($pdo);
            $stmt = $pdo->prepare("UPDATE {$tableLinks} SET title = ? WHERE url = ? AND type = 'quiz'");
            $stmt->execute([$newName, $cleanId]);
        } catch (Throwable $e) {}
    }

    sendResponse(true, [
        "message" => "Quiz renamed successfully.",
        "quiz" => [
            "id" => $cleanId,
            "quiz_name" => $newName
        ]
    ]);
}

// --- ACTION 9: START BACKGROUND QUIZ JOB ---
if ($action === 'start_job' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $limitCheck = ai_exam_check_daily_rate_limit(3);
    if (!$limitCheck['allowed']) {
        sendResponse(false, $limitCheck['message']);
    }

    $data = json_decode(file_get_contents("php://input"), true);
    $mode = $data['mode'] ?? 'ai_generation';
    $isPastExamFilter = ($mode === 'past_exam_filter');

    $subjectId = $data['subjectId'] ?? '';
    $selectedChapters = $data['selectedChapters'] ?? [];
    $uploadedFiles = $data['uploadedFiles'] ?? [];
    $targetChapters = $data['targetChapters'] ?? [];
    $quizName = $data['quizName'] ?? ($isPastExamFilter ? 'تجميعات السنوات السابقة' : 'اختبار تجريبي');
    $difficulty = $data['difficulty'] ?? 'medium';

    if (is_array($uploadedFiles) && count($uploadedFiles) > 10) {
        sendResponse(false, "لا يمكن رفع أكثر من 10 ملفات في المرة الواحدة.");
    }

    $specialty = $data['specialty'] ?? '';
    $year = (isset($data['year']) && $data['year'] !== '' && $data['year'] !== null) ? intval($data['year']) : null;
    $semester = (isset($data['semester']) && $data['semester'] !== '' && $data['semester'] !== null) ? intval($data['semester']) : null;

    if ((empty($specialty) || $year === null || $semester === null) && !empty($subjectId)) {
        if (isset($pdo) && $pdo !== null) {
            try {
                $tableSubs = getAiExamSubjectsTable($pdo);
                $stmt = $pdo->prepare("SELECT specialty, year, semester FROM {$tableSubs} WHERE id = ?");
                $stmt->execute([$subjectId]);
                $subRow = $stmt->fetch(PDO::FETCH_ASSOC);
                if ($subRow) {
                    if (empty($specialty)) $specialty = $subRow['specialty'] ?? '';
                    if ($year === null && isset($subRow['year'])) $year = intval($subRow['year']);
                    if ($semester === null && isset($subRow['semester'])) $semester = intval($subRow['semester']);
                }
            } catch (Throwable $e) {
                error_log('Quiz metadata lookup failed: ' . $e->getMessage());
            }
        }
    }
    
    if (empty($specialty) || $year === null || $semester === null) {
        sendResponse(false, "Cannot determine specialty/year/semester for quiz. Please check subject configuration.");
    }
    
    $data['specialty'] = $specialty;
    $data['year'] = $year;
    $data['semester'] = $semester;

    if (empty($subjectId) || empty($quizName)) {
        sendResponse(false, "Missing required parameters (Subject or Quiz Name).");
    }

    if ($isPastExamFilter && empty($uploadedFiles) && empty($selectedChapters)) {
        sendResponse(false, "يرجى رفع صور أو ملفات أوراق الاختبار السابق.");
    }

    if (!$isPastExamFilter && empty($selectedChapters) && empty($uploadedFiles)) {
        sendResponse(false, "يرجى تحديد شابتر واحد على الأقل أو رفع ملفات من الجهاز.");
    }

    $jobsDir = __DIR__ . '/../quiz_jobs';
    if (!is_dir($jobsDir)) @mkdir($jobsDir, 0777, true);

    $jobId = 'job_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3));
    $jobFile = $jobsDir . '/' . $jobId . '.json';

    $jobStatusData = [
        'id' => $jobId,
        'status' => 'processing',
        'step' => 'extracting',
        'progress_pct' => 10,
        'message' => 'جاري بدء استخراج وتحليل الملفات...',
        'created_at' => date('Y-m-d H:i:s'),
        'quiz_id' => null,
        'quiz_name' => $quizName
    ];
    file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    // Respond immediately to client to prevent gateway timeouts
    ignore_user_abort(true);
    set_time_limit(360);

    $jobResp = json_encode(["success" => true, "data" => ["jobId" => $jobId, "message" => "Job started in background"]]);
    if (function_exists('fastcgi_finish_request')) {
        echo $jobResp;
        fastcgi_finish_request();
    } else {
        if (session_id()) session_write_close();
        header('Connection: close');
        header('Content-Type: application/json; charset=UTF-8');
        header('Content-Length: ' . strlen($jobResp));
        echo $jobResp;
        if (function_exists('ob_end_flush')) @ob_end_flush();
        @ob_flush();
        @flush();
    }

    // --- EXECUTE BACKGROUND PROCESSING ---
    $geminiFileUris = [];
    $tempLocalFilesToClean = [];

    try {
        $combinedText = '';
        $combinedImages = [];
        $totalDriveChaps = count($selectedChapters);
        $totalUploads = count($uploadedFiles);
        $totalItems = $totalDriveChaps + $totalUploads;

        $extractionErrors = [];
        $partialContent = false;

        // Proportional character budget per chapter
        $maxPerItemChars = ($totalItems > 0) ? intval(600000 / $totalItems) : 80000;
        if ($maxPerItemChars < 20000) $maxPerItemChars = 20000;

        // 1. Process Google Drive Chapters
        for ($i = 0; $i < $totalDriveChaps; $i++) {
            $chap = $selectedChapters[$i];
            $chapName = $chap['name'] ?? 'شابتر';
            $driveLink = $chap['driveLink'] ?? ($chap['id'] ?? '');

            $jobStatusData['progress_pct'] = intval((($i + 1) / max(1, $totalItems)) * 40);
            $jobStatusData['message'] = "(1/3) قراءة وتحليل (" . ($i + 1) . " من $totalItems): $chapName";
            file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

            try {
                $extRes = performDriveExtraction($driveLink);
                if ($extRes['success'] && isset($extRes['data'])) {
                    $t = $extRes['data']['text'] ?? '';
                    $imgs = $extRes['data']['images'] ?? [];
                    $isScanned = !empty($extRes['data']['is_scanned_pdf']);
                    $localPdf = $extRes['data']['local_pdf_path'] ?? '';
                    $cacheKey = $extRes['data']['cache_key'] ?? null;
                    $cachedUri = $extRes['data']['gemini_file_uri'] ?? null;
                    $cachedName = $extRes['data']['gemini_file_name'] ?? null;

                    if ($cachedUri) {
                        $jobStatusData['message'] = "(1/3) استخدام الذاكرة السحابية السريعة (0 ثوانٍ): $chapName";
                        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
                        $apiKeys = getGeminiRawApiKeys();
                        $geminiFileUris[] = [
                            'uri' => $cachedUri,
                            'name' => $cachedName ?? $cachedUri,
                            'chap_name' => $chapName,
                            'api_key' => $apiKeys[0],
                            'is_cached' => true
                        ];
                        $partialContent = true;
                    } elseif ($isScanned && !empty($localPdf) && file_exists($localPdf)) {
                        $tempLocalFilesToClean[] = $localPdf;
                        $jobStatusData['message'] = "(1/3) مستند/كتاب شامل: جاري الرفع والمعالجة بـ Gemini File API (" . ($i + 1) . " من $totalItems): $chapName";
                        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

                        $apiKeys = getGeminiRawApiKeys();
                        $upRes = uploadPdfToGeminiFileApi($localPdf, $apiKeys[0], $chapName, $cacheKey);
                        if ($upRes['success'] && !empty($upRes['file_uri'])) {
                            $geminiFileUris[] = [
                                'uri' => $upRes['file_uri'],
                                'name' => $upRes['file_name'] ?? $upRes['file_uri'],
                                'chap_name' => $chapName,
                                'api_key' => $apiKeys[0],
                                'is_cached' => !empty($cacheKey)
                            ];
                            $partialContent = true;
                        } else {
                            $extractionErrors[] = $chapName . ': ' . ($upRes['message'] ?? 'فشل الرفع لـ Gemini File API');
                        }
                    } elseif ($t && $t !== 'IMAGE_SLIDES_EXTRACTED') {
                        $condensed = cleanAndCondenseExtractedText($t, $maxPerItemChars);
                        $combinedText .= "\n\n=== [المحاضرة / الشابتر: $chapName] ===\n\n" . $condensed;
                        $partialContent = true;
                    }

                    if (!empty($imgs)) {
                        $combinedImages = array_merge($combinedImages, $imgs);
                        $partialContent = true;
                    }
                } else {
                    $extractionErrors[] = $chapName . ': ' . ($extRes['message'] ?? 'تعذر استخراج المحتوى');
                }
            } catch (Throwable $chapErr) {
                $extractionErrors[] = $chapName . ': ' . $chapErr->getMessage();
            }
        }

        // 2. Process Direct Device Uploads (PDFs / Images)
        for ($j = 0; $j < $totalUploads; $j++) {
            $upFile = $uploadedFiles[$j];
            $upName = $upFile['name'] ?? ('ملف ' . ($j + 1));

            $jobStatusData['progress_pct'] = intval((($totalDriveChaps + $j + 1) / max(1, $totalItems)) * 45);
            $jobStatusData['message'] = "(1/3) معالجة واستخراج نصوص (" . ($j + 1) . " من $totalUploads): $upName";
            file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

            try {
                $upRes = performDirectUploadedFileExtraction($upFile);
                if ($upRes['success'] && isset($upRes['data'])) {
                    $t = $upRes['data']['text'] ?? '';
                    $imgs = $upRes['data']['images'] ?? [];
                    $isScanned = !empty($upRes['data']['is_scanned_pdf']);
                    $localPdf = $upRes['data']['local_pdf_path'] ?? '';

                    if ($isScanned && !empty($localPdf) && file_exists($localPdf)) {
                        $tempLocalFilesToClean[] = $localPdf;
                        $jobStatusData['message'] = "(1/3) ملف مرفوع: جاري الرفع والمعالجة بـ Gemini File API: $upName";
                        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

                        $apiKeys = getGeminiRawApiKeys();
                        $upRes = uploadPdfToGeminiFileApi($localPdf, $apiKeys[0], $upName);
                        if ($upRes['success'] && !empty($upRes['file_uri'])) {
                            $geminiFileUris[] = [
                                'uri' => $upRes['file_uri'],
                                'name' => $upRes['file_name'] ?? $upRes['file_uri'],
                                'chap_name' => $upName,
                                'api_key' => $apiKeys[0],
                                'is_cached' => false
                            ];
                            $partialContent = true;
                        } else {
                            $extractionErrors[] = $upName . ': ' . ($upRes['message'] ?? 'فشل الرفع لـ Gemini File API');
                        }
                    } elseif ($t && $t !== 'IMAGE_SLIDES_EXTRACTED') {
                        $condensed = cleanAndCondenseExtractedText($t, $maxPerItemChars);
                        $combinedText .= "\n\n=== [ملف مرفوع: $upName] ===\n\n" . $condensed;
                        $partialContent = true;
                    }

                    if (!empty($imgs)) {
                        $combinedImages = array_merge($combinedImages, $imgs);
                        $partialContent = true;
                    }
                } else {
                    $extractionErrors[] = $upName . ': ' . ($upRes['message'] ?? 'تعذر استخراج المحتوى');
                }
            } catch (Throwable $upErr) {
                $extractionErrors[] = $upName . ': ' . $upErr->getMessage();
            }
        }

        if (!$partialContent || (empty(trim($combinedText)) && empty($combinedImages) && empty($geminiFileUris))) {
            $detail = !empty($extractionErrors) ? implode(' | ', $extractionErrors) : 'لم يتم العثور على نصوص أو ملفات قابلة للاستخدام.';
            throw new Exception("تعذر استخراج المحتوى من الملفات المحددة. التفاصيل: " . $detail);
        }

        $combinedText = cleanAndCondenseExtractedText($combinedText, 800000);

        // Step 2: Generate via Gemini Flash
        $jobStatusData['step'] = 'generating';
        $jobStatusData['progress_pct'] = 70;
        if (!empty($geminiFileUris)) {
            $jobStatusData['message'] = "(2/3) الذكاء الاصطناعي (Gemini Flash) يحلل صفحات الكتاب/المستند بالكامل ويصيغ الأسئلة...";
        } elseif ($isPastExamFilter) {
            $jobStatusData['message'] = "(2/3) الذكاء الاصطناعي (Gemini Flash) يصنف الأسئلة ويستخرج الخاصة بالشابترات المحددة فقط...";
        } else {
            $jobStatusData['message'] = "(2/3) الذكاء الاصطناعي (Gemini Flash) يصيغ الأسئلة بحسب الصعوبة ($difficulty)...";
        }
        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        $genPayload = [
            'mode' => $mode,
            'specialty' => $specialty,
            'subjectName' => $data['subjectName'] ?? '',
            'year' => $year,
            'difficulty' => $difficulty,
            'text' => $combinedText,
            'gemini_file_uri' => !empty($geminiFileUris) ? $geminiFileUris[0]['uri'] : null,
            'images' => array_slice($combinedImages, 0, 16),
            'numQuestions' => $data['numQuestions'] ?? ($isPastExamFilter ? 200 : 10),
            'pageRange' => $data['pageRange'] ?? '',
            'focusArea' => $data['focusArea'] ?? '',
            'targetChapters' => $targetChapters,
            'options' => $data['options'] ?? []
        ];

        $jobCallback = function($batchNum, $totalBatches, $curQuestionsCount) use ($jobFile, &$jobStatusData) {
            $jobStatusData['progress_pct'] = 60 + intval(($batchNum / max(1, $totalBatches)) * 28);
            $jobStatusData['message'] = "(2/3) الذكاء الاصطناعي يصيغ الأسئلة (دفعة $batchNum من $totalBatches - أُنجز $curQuestionsCount سؤال)...";
            @file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        };

        $genRes = performGeminiGeneration($genPayload, getGeminiRawApiKeys(), $jobCallback);
        if (!$genRes['success'] && strlen($combinedText) > 80000) {
            // Smart recovery: retry with compact 80,000 char prompt if large text timed out
            $genPayload['text'] = cleanAndCondenseExtractedText($combinedText, 80000);
            $genRes = performGeminiGeneration($genPayload, getGeminiRawApiKeys(), $jobCallback);
        }

        if (!$genRes['success'] || empty($genRes['data']['questions'])) {
            throw new Exception($genRes['message'] ?? "فشل توليد الأسئلة من الذكاء الاصطناعي.");
        }

        $questions = $genRes['data']['questions'];

        // Step 3: Save Quiz
        $jobStatusData['step'] = 'saving';
        $jobStatusData['progress_pct'] = 90;
        $jobStatusData['message'] = "(3/3) جاري حفظ الاختبار في البنك...";
        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        $quizzesDir = __DIR__ . '/../quizzes_data';
        if (!is_dir($quizzesDir)) @mkdir($quizzesDir, 0777, true);

        $quizId = 'quiz_' . uniqid() . '_' . bin2hex(random_bytes(2));
        $filePath = $quizzesDir . '/' . $quizId . '.json';

        $quizData = [
            'id' => $quizId,
            'subject_id' => $subjectId,
            'specialty' => $specialty,
            'year' => $year,
            'semester' => $semester,
            'subject_name' => $data['subjectName'] ?? 'مادة دراسية',
            'chapter_name' => $data['chapterName'] ?? 'المحاضرة العامة',
            'quiz_name' => $quizName,
            'types_summary' => $data['typesSummary'] ?? ($isPastExamFilter ? 'تجميعات سنوات' : 'خيارات متعددة'),
            'creation_mode' => $mode,
            'difficulty' => $difficulty,
            'created_at' => date('Y-m-d H:i:s'),
            'questions' => $questions
        ];

        file_put_contents($filePath, json_encode($quizData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        if (isset($pdo) && $pdo !== null) {
            try {
                $tableLinks = getAiExamSubjectLinksTable($pdo);
                $stmt = $pdo->prepare("INSERT INTO {$tableLinks} (subject_id, url, title, type) VALUES (?, ?, ?, 'quiz')");
                $stmt->execute([$subjectId, $quizId, $quizName]);
            } catch (Throwable $e) {}
        }

        // Update Job Status to Completed
        $jobStatusData['status'] = 'completed';
        $jobStatusData['step'] = 'done';
        $jobStatusData['progress_pct'] = 100;
        $jobStatusData['message'] = "تم تجهيز وحفظ الاختبار بنجاح!";
        $jobStatusData['quiz_id'] = $quizId;
        $jobStatusData['quiz_data'] = $quizData;
        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    } catch (Throwable $ex) {
        $jobStatusData['status'] = 'failed';
        $jobStatusData['step'] = 'error';
        $jobStatusData['message'] = "حدث خطأ: " . $ex->getMessage();
        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    } finally {
        // Clean up temporary Gemini files only if they were NOT cached for 40-hour reuse
        if (!empty($geminiFileUris)) {
            foreach ($geminiFileUris as $gFile) {
                if (empty($gFile['is_cached'])) {
                    deleteGeminiFile($gFile['name'], $gFile['api_key']);
                }
            }
        }
        // Always clean up temporary disk PDFs
        if (!empty($tempLocalFilesToClean)) {
            foreach ($tempLocalFilesToClean as $tmpF) {
                if (file_exists($tmpF)) @unlink($tmpF);
            }
        }
    }
    exit;
}

// --- ACTION 10: CHECK BACKGROUND JOB STATUS ---
if ($action === 'check_job') {
    $jobId = $_GET['job_id'] ?? '';
    if (empty($jobId)) sendResponse(false, "Missing job_id parameter.");

    $cleanJobId = preg_replace('/[^a-zA-Z0-9_-]/', '', $jobId);
    $jobFile = __DIR__ . '/../quiz_jobs/' . $cleanJobId . '.json';

    if (!file_exists($jobFile)) {
        sendResponse(false, "Job not found.");
    }

    $jobData = json_decode(file_get_contents($jobFile), true);
    sendResponse(true, $jobData);
}

// --- ACTION 11: GET CACHE STATS ---
if ($action === 'get_cache_stats') {
    $stats = getSystemCacheStats();
    sendResponse(true, $stats);
}

// --- ACTION 12: SAVE CACHE SETTINGS ---
if ($action === 'save_cache_settings' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    global $JSON_INPUT;
    $data = $JSON_INPUT ?: (json_decode(file_get_contents('php://input'), true) ?: []);
    $meta = getCacheMetaStore();

    if (isset($data['auto_prewarm_on_upload'])) {
        $meta['auto_prewarm_on_upload'] = (bool)$data['auto_prewarm_on_upload'];
    }
    if (!empty($data['periodic_schedule'])) {
        $meta['periodic_schedule'] = $data['periodic_schedule'];
    }

    saveCacheMetaStore($meta);
    sendResponse(true, ['message' => 'تم حفظ إعدادات الذاكرة والكاش بنجاح.', 'settings' => $meta]);
}

// --- ACTION 13: PRE-WARM ALL SUBJECTS CACHE (BACKGROUND JOB) ---
if ($action === 'prewarm_cache' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!$pdo) {
        sendResponse(false, "Database connection unavailable.");
    }

    $jobsDir = __DIR__ . '/gemini_keys_data/prewarm_jobs';
    if (!is_dir($jobsDir)) @mkdir($jobsDir, 0777, true);

    $jobId = 'prewarm_' . date('Ymd_His') . '_' . bin2hex(random_bytes(2));
    $jobFile = $jobsDir . '/' . $jobId . '.json';

    $jobStatusData = [
        'id' => $jobId,
        'status' => 'processing',
        'progress_pct' => 5,
        'message' => 'جاري استرجاع قائمة المواد والمجلدات من قاعدة البيانات...',
        'log' => [],
        'errors' => [],
        'stats' => null,
        'created_at' => date('Y-m-d H:i:s')
    ];
    file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    // Respond immediately to prevent gateway timeout
    ignore_user_abort(true);
    set_time_limit(600);

    $jobResp = json_encode(["success" => true, "data" => ["jobId" => $jobId, "message" => "Prewarm job started in background"]]);
    if (function_exists('fastcgi_finish_request')) {
        echo $jobResp;
        fastcgi_finish_request();
    } else {
        if (session_id()) session_write_close();
        header('Connection: close');
        header('Content-Type: application/json; charset=UTF-8');
        header('Content-Length: ' . strlen($jobResp));
        echo $jobResp;
        if (function_exists('ob_end_flush')) @ob_end_flush();
        @ob_flush();
        @flush();
    }

    // --- BACKGROUND EXECUTION ---
    try {
        $table_subs = 'subjects';
        try {
            $check = $pdo->query("SELECT 1 FROM wpr9_subjects LIMIT 1");
            if ($check !== false) $table_subs = 'wpr9_subjects';
        } catch(Throwable $e) {}

        $stmt = $pdo->query("SELECT id, name, specialty, year, semester, chapters_folder_id FROM {$table_subs} WHERE chapters_folder_id IS NOT NULL AND chapters_folder_id != ''");
        $subjects = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $totalSubjects = count($subjects);
        $totalFilesScanned = 0;
        $newlyCached = 0;
        $alreadyCached = 0;
        $errors = [];
        $log = [];

        $jobStatusData['progress_pct'] = 10;
        $jobStatusData['message'] = "تم العثور على $totalSubjects مادة دراسية. جاري مسح ملفات Google Drive...";
        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        $sIdx = 0;
        foreach ($subjects as $sub) {
            $sIdx++;
            $subName = $sub['name'];
            $folderId = trim($sub['chapters_folder_id']);
            if (empty($folderId)) continue;

            $jobStatusData['progress_pct'] = 10 + intval(($sIdx / max(1, $totalSubjects)) * 85);
            $jobStatusData['message'] = "($sIdx من $totalSubjects) جاري فحص مجلد: $subName";
            file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

            $files = fetchDriveFolderRecursive($folderId);
            if (empty($files)) continue;

            foreach ($files as $f) {
                $fId = $f['id'];
                $fName = $f['name'] ?? 'ملف دراسي';
                $totalFilesScanned++;

                // Check if already in cache
                $existing = getLocalDocumentTextCache($fId);
                if ($existing !== null) {
                    $alreadyCached++;
                    continue;
                }

                // Extract and cache
                try {
                    $ext = performDriveExtraction($fId);
                    if ($ext['success']) {
                        $newlyCached++;
                        $log[] = "تم تخزين: $subName — $fName";
                    } else {
                        $errors[] = "تعذر استخراج: $subName — $fName (" . ($ext['message'] ?? 'خطأ') . ")";
                    }
                } catch (Throwable $ex) {
                    $errors[] = "خطأ: $subName — $fName: " . $ex->getMessage();
                }

                $jobStatusData['log'] = array_slice(array_reverse($log), 0, 40);
                $jobStatusData['errors'] = array_slice($errors, 0, 10);
                @file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
            }
        }

        $statsSummary = [
            'total_subjects' => $totalSubjects,
            'total_files_scanned' => $totalFilesScanned,
            'newly_cached' => $newlyCached,
            'already_cached' => $alreadyCached,
            'errors_count' => count($errors),
            'timestamp' => date('Y-m-d H:i:s')
        ];

        $meta = getCacheMetaStore();
        $meta['last_prewarm_time'] = date('Y-m-d H:i:s');
        $meta['last_prewarm_stats'] = $statsSummary;
        saveCacheMetaStore($meta);

        $jobStatusData['status'] = 'completed';
        $jobStatusData['progress_pct'] = 100;
        $jobStatusData['message'] = "اكتمل التجهيز المسبق: تم فحص $totalFilesScanned ملف، وتخزين $newlyCached ملفات جديدة بنجاح!";
        $jobStatusData['stats'] = $statsSummary;
        $jobStatusData['cache_stats'] = getSystemCacheStats();
        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    } catch (Throwable $ex) {
        $jobStatusData['status'] = 'failed';
        $jobStatusData['message'] = "حدث خطأ أثناء التجهيز المسبق: " . $ex->getMessage();
        file_put_contents($jobFile, json_encode($jobStatusData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    }
    exit;
}

// --- ACTION 13.5: CHECK PRE-WARM JOB STATUS ---
if ($action === 'check_prewarm_job') {
    $jobId = $_GET['job_id'] ?? '';
    if (empty($jobId)) sendResponse(false, "Missing job_id parameter.");

    $cleanJobId = preg_replace('/[^a-zA-Z0-9_-]/', '', $jobId);
    $jobFile = __DIR__ . '/gemini_keys_data/prewarm_jobs/' . $cleanJobId . '.json';

    if (!file_exists($jobFile)) {
        sendResponse(false, "Prewarm job not found.");
    }

    $jobData = json_decode(file_get_contents($jobFile), true);
    sendResponse(true, $jobData);
}

// --- ACTION 13.6: GET SUBJECTS FOR CLIENT-CONTROLLED PRE-WARM ---
if ($action === 'get_prewarm_subjects') {
    if (!$pdo) sendResponse(false, "Database connection unavailable.");

    $table_subs = 'subjects';
    try {
        $check = $pdo->query("SELECT 1 FROM wpr9_subjects LIMIT 1");
        if ($check !== false) $table_subs = 'wpr9_subjects';
    } catch(Throwable $e) {}

    $stmt = $pdo->query("SELECT id, name, specialty, year, semester, chapters_folder_id FROM {$table_subs} WHERE chapters_folder_id IS NOT NULL AND chapters_folder_id != '' ORDER BY specialty, year, semester, id ASC");
    $subjects = $stmt->fetchAll(PDO::FETCH_ASSOC);

    sendResponse(true, ['subjects' => $subjects, 'total' => count($subjects)]);
}

// --- ACTION 13.7: PRE-WARM A SINGLE SUBJECT ---
if ($action === 'prewarm_subject') {
    global $JSON_INPUT;
    $data = $JSON_INPUT ?: (json_decode(file_get_contents('php://input'), true) ?: []);

    $subjectId = $data['subject_id'] ?? $_POST['subject_id'] ?? $_GET['subject_id'] ?? '';
    $folderId = $data['folder_id'] ?? $_POST['folder_id'] ?? $_GET['folder_id'] ?? '';
    $subjectName = $data['subject_name'] ?? $_POST['subject_name'] ?? $_GET['subject_name'] ?? 'مادة دراسية';

    if (preg_match('/folders\/([a-zA-Z0-9_-]+)/', $folderId, $matches)) {
        $folderId = $matches[1];
    } elseif (preg_match('/id=([a-zA-Z0-9_-]+)/', $folderId, $matches)) {
        $folderId = $matches[1];
    }

    if (empty($folderId) && !empty($subjectId) && $pdo) {
        $table_subs = 'subjects';
        try {
            $check = $pdo->query("SELECT 1 FROM wpr9_subjects LIMIT 1");
            if ($check !== false) $table_subs = 'wpr9_subjects';
        } catch(Throwable $e) {}

        try {
            $stmt = $pdo->prepare("SELECT id, name, chapters_folder_id FROM {$table_subs} WHERE id = ?");
            $stmt->execute([$subjectId]);
            $sub = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($sub) {
                if (empty($subjectName) || $subjectName === 'مادة دراسية') $subjectName = $sub['name'];
                $folderId = trim($sub['chapters_folder_id'] ?? '');
            }
        } catch (Throwable $e) {}
    }

    if (empty($folderId)) {
        sendResponse(true, [
            'subject_name' => $subjectName,
            'total_files' => 0,
            'newly_cached' => 0,
            'already_cached' => 0,
            'log' => ["لا يوجد مجلد قوقل درايف للمادة"],
            'errors' => []
        ]);
    }

    $offset = intval($data['offset'] ?? $_POST['offset'] ?? $_GET['offset'] ?? 0);
    $limit = intval($data['limit'] ?? $_POST['limit'] ?? $_GET['limit'] ?? 1);
    if ($limit < 1) $limit = 1;
    if ($limit > 5) $limit = 5;

    $files = fetchDriveFolderRecursive($folderId);
    $totalFiles = count($files);
    $slice = array_slice($files, $offset, $limit);

    $newlyCached = 0;
    $alreadyCached = 0;
    $log = [];
    $errors = [];

    foreach ($slice as $f) {
        $fId = $f['id'];
        $fName = $f['name'] ?? 'ملف';

        $existing = getLocalDocumentTextCache($fId);
        if ($existing !== null) {
            $alreadyCached++;
            continue;
        }

        try {
            $ext = performDriveExtraction($fId, [
                'subject_name' => $subjectName,
                'file_name' => $fName,
                'subject_id' => $subjectId
            ]);
            if ($ext['success']) {
                $newlyCached++;
                $log[] = "تم استخراج وتخزين: $fName";
            } else {
                $errors[] = "تعذر استخراج: $fName (" . ($ext['message'] ?? 'خطأ') . ")";
            }
        } catch (Throwable $ex) {
            $errors[] = "خطأ: $fName: " . $ex->getMessage();
        }
    }

    $processedSoFar = $offset + count($slice);
    $hasMore = ($processedSoFar < $totalFiles);

    sendResponse(true, [
        'subject_name' => $subjectName,
        'total_files' => $totalFiles,
        'processed_slice' => count($slice),
        'offset' => $offset,
        'next_offset' => $processedSoFar,
        'has_more' => $hasMore,
        'newly_cached' => $newlyCached,
        'already_cached' => $alreadyCached,
        'log' => $log,
        'errors' => $errors
    ]);
}

// --- ACTION 13.8: SCAN COMPLETE PORTAL CATALOG & MAP ALL FILES ---
if ($action === 'scan_cache_catalog') {
    if (!$pdo) sendResponse(false, "Database connection unavailable.");

    $table_subs = getAiExamSubjectsTable($pdo);
    $stmt = $pdo->query("SELECT id, name, specialty, year, semester, chapters_folder_id FROM {$table_subs} WHERE chapters_folder_id IS NOT NULL AND chapters_folder_id != '' ORDER BY specialty, year, semester, id ASC");
    $subjects = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $metaStore = getCacheMetaStore();
    if (!isset($metaStore['files_meta']) || !is_array($metaStore['files_meta'])) {
        $metaStore['files_meta'] = [];
    }

    $cacheDir = __DIR__ . '/gemini_keys_data/text_cache';
    $cachedDiskIds = [];
    if (is_dir($cacheDir)) {
        $files = glob($cacheDir . '/*.txt');
        if ($files) {
            foreach ($files as $f) {
                $cachedDiskIds[basename($f, '.txt')] = [
                    'size_bytes' => filesize($f),
                    'mtime' => date('Y-m-d H:i:s', filemtime($f))
                ];
            }
        }
    }

    $totalSubjects = count($subjects);
    $subjectsWithFiles = 0;
    $totalDriveFiles = 0;
    $uncachedFiles = [];

    foreach ($subjects as $s) {
        $folderId = trim($s['chapters_folder_id'] ?? '');
        if (empty($folderId)) continue;

        if (preg_match('/folders\/([a-zA-Z0-9_-]+)/', $folderId, $m)) $folderId = $m[1];
        elseif (preg_match('/id=([a-zA-Z0-9_-]+)/', $folderId, $m)) $folderId = $m[1];

        $driveFiles = fetchDriveFolderRecursive($folderId);
        if (!empty($driveFiles)) {
            $subjectsWithFiles++;
            $totalDriveFiles += count($driveFiles);

            foreach ($driveFiles as $df) {
                $fid = $df['id'];
                $fname = $df['name'] ?? 'ملف مقرر';
                $sname = $s['name'] ?? 'مادة دراسية';

                $metaStore['files_meta'][$fid] = [
                    'file_name' => $fname,
                    'subject_name' => $sname,
                    'subject_id' => $s['id'],
                    'specialty' => $s['specialty'] ?? '',
                    'year' => $s['year'] ?? 0,
                    'semester' => $s['semester'] ?? 1,
                    'cached_at' => $cachedDiskIds[$fid]['mtime'] ?? ($metaStore['files_meta'][$fid]['cached_at'] ?? null)
                ];

                if (!isset($cachedDiskIds[$fid])) {
                    $uncachedFiles[] = [
                        'file_id' => $fid,
                        'file_name' => $fname,
                        'subject_name' => $sname,
                        'subject_id' => $s['id']
                    ];
                }
            }
        }
    }

    $metaStore['uncached_files'] = $uncachedFiles;
    $metaStore['catalog_summary'] = [
        'total_subjects' => $totalSubjects,
        'subjects_with_files' => $subjectsWithFiles,
        'total_drive_files' => $totalDriveFiles,
        'cached_count' => count($cachedDiskIds),
        'uncached_count' => count($uncachedFiles),
        'last_scan_time' => date('Y-m-d H:i:s')
    ];

    saveCacheMetaStore($metaStore);

    sendResponse(true, [
        'summary' => $metaStore['catalog_summary'],
        'stats' => getSystemCacheStats()
    ]);
}

// --- ACTION 13.9: PRE-WARM A SINGLE SPECIFIC FILE ---
if ($action === 'prewarm_single_file') {
    global $JSON_INPUT;
    $data = $JSON_INPUT ?: (json_decode(file_get_contents('php://input'), true) ?: []);

    $fileId = $data['file_id'] ?? $_POST['file_id'] ?? $_GET['file_id'] ?? '';
    $fileName = $data['file_name'] ?? $_POST['file_name'] ?? $_GET['file_name'] ?? 'ملف مقرر';
    $subjectName = $data['subject_name'] ?? $_POST['subject_name'] ?? $_GET['subject_name'] ?? 'مادة دراسية';
    $subjectId = $data['subject_id'] ?? $_POST['subject_id'] ?? $_GET['subject_id'] ?? null;

    if (empty($fileId)) sendResponse(false, "Missing file_id parameter.");

    $meta = [
        'subject_name' => $subjectName,
        'file_name' => $fileName,
        'subject_id' => $subjectId
    ];

    $res = performDriveExtraction($fileId, $meta);
    if ($res['success']) {
        $metaStore = getCacheMetaStore();
        if (isset($metaStore['uncached_files']) && is_array($metaStore['uncached_files'])) {
            $metaStore['uncached_files'] = array_values(array_filter($metaStore['uncached_files'], function($u) use ($fileId) {
                return ($u['file_id'] ?? '') !== $fileId;
            }));
            if (isset($metaStore['catalog_summary'])) {
                $metaStore['catalog_summary']['cached_count'] = ($metaStore['catalog_summary']['cached_count'] ?? 0) + 1;
                $metaStore['catalog_summary']['uncached_count'] = max(0, ($metaStore['catalog_summary']['uncached_count'] ?? 1) - 1);
            }
            saveCacheMetaStore($metaStore);
        }
        sendResponse(true, [
            'file_id' => $fileId,
            'file_name' => $fileName,
            'subject_name' => $subjectName,
            'message' => "تم استخراج وتخزين الملف في الكاش بنجاح.",
            'stats' => getSystemCacheStats()
        ]);
    } else {
        sendResponse(false, "تعذر استخراج الملف: " . ($res['message'] ?? 'خطأ'));
    }
}

// --- ACTION 14: CLEAR CACHE ---
if ($action === 'clear_cache' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    global $JSON_INPUT;
    $data = $JSON_INPUT ?: (json_decode(file_get_contents('php://input'), true) ?: []);
    $fileId = $data['file_id'] ?? $_POST['file_id'] ?? $_GET['file_id'] ?? '';

    $cacheDir = __DIR__ . '/gemini_keys_data/text_cache';
    $deletedCount = 0;

    if (!empty($fileId)) {
        $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $fileId);
        $targetFile = $cacheDir . '/' . $cleanId . '.txt';
        if (file_exists($targetFile)) {
            @unlink($targetFile);
            $deletedCount++;
        }
    } else {
        if (is_dir($cacheDir)) {
            $files = glob($cacheDir . '/*.txt');
            if ($files) {
                foreach ($files as $f) {
                    @unlink($f);
                    $deletedCount++;
                }
            }
        }
    }

    sendResponse(true, [
        'message' => !empty($fileId) ? "تم حذف الملف من الكاش." : "تم تفريغ كامل الكاش ($deletedCount ملف).",
        'deleted_count' => $deletedCount,
        'cache_stats' => getSystemCacheStats()
    ]);
}

sendResponse(false, "Invalid action");
?>

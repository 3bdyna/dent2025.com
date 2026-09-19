<?php
// db_connect.php
// Safe PDO connection dynamically resolving credentials from WordPress wp-config.php or environment.

$host = 'localhost';
$dbname = 'dentqsoa_wp366';
$user = 'dentqsoa_wp366';
$pass = '';
$db_table_prefix = 'wp_';

// Check defined constants first
if (defined('DB_NAME') && defined('DB_USER') && defined('DB_PASSWORD')) {
    $dbname = DB_NAME;
    $user = DB_USER;
    $pass = DB_PASSWORD;
    $host = defined('DB_HOST') ? DB_HOST : 'localhost';
} else {
    // Attempt reading from wp-config.php safely
    $wp_config_paths = [
        dirname(__DIR__) . '/wp-config.php',
        dirname(dirname(__DIR__)) . '/wp-config.php'
    ];
    foreach ($wp_config_paths as $wpc) {
        if (file_exists($wpc)) {
            $content = file_get_contents($wpc);
            if (preg_match("/define\s*\(\s*['\"]DB_NAME['\"]\s*,\s*['\"](.*?)['\"]\s*\)/", $content, $m)) {
                $dbname = $m[1];
            }
            if (preg_match("/define\s*\(\s*['\"]DB_USER['\"]\s*,\s*['\"](.*?)['\"]\s*\)/", $content, $m)) {
                $user = $m[1];
            }
            if (preg_match("/define\s*\(\s*['\"]DB_PASSWORD['\"]\s*,\s*['\"](.*?)['\"]\s*\)/", $content, $m)) {
                $pass = $m[1];
            }
            if (preg_match("/define\s*\(\s*['\"]DB_HOST['\"]\s*,\s*['\"](.*?)['\"]\s*\)/", $content, $m)) {
                $host = $m[1];
            }
            if (preg_match("/\\\$table_prefix\s*=\s*['\"](.*?)['\"]\s*;/", $content, $m)) {
                $db_table_prefix = $m[1];
            }
            if (!empty($pass)) break;
        }
    }
}

// Fallback to environment variables if available
if (getenv('DB_PASSWORD')) {
    $pass = getenv('DB_PASSWORD');
    if (getenv('DB_USER')) $user = getenv('DB_USER');
    if (getenv('DB_NAME')) $dbname = getenv('DB_NAME');
    if (getenv('DB_HOST')) $host = getenv('DB_HOST');
}

// Strict CORS handling for trusted Dent2025 origins
if (!headers_sent()) {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed_origins = [
        'https://dent2025.com',
        'https://www.dent2025.com',
        'http://localhost',
        'http://127.0.0.1'
    ];
    if (in_array($origin, $allowed_origins, true) || preg_match('/^https?:\/\/localhost(:\d+)?$/', $origin)) {
        header("Access-Control-Allow-Origin: $origin");
        header("Vary: Origin");
    } else {
        header("Access-Control-Allow-Origin: https://dent2025.com");
    }
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Admin-Pass");
    header("Content-Type: application/json; charset=UTF-8");
}

// Handle preflight OPTIONS request
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$pdo = null;
try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $user, $pass);
    // Set PDO error mode to exception
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // Fetch objects by default
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
} catch(PDOException $e) {
    // Database unavailable, keep $pdo null for non-DB endpoints
    $pdo = null;
}

// Helper function to resolve dynamic table prefix safely across all environments
if (!function_exists('get_dent2025_table')) {
    function get_dent2025_table($pdo, $baseName) {
        static $resolved = [];
        if (isset($resolved[$baseName])) return $resolved[$baseName];
        if (!$pdo) return $baseName;

        global $db_table_prefix;
        $prefix = !empty($db_table_prefix) ? $db_table_prefix : 'wp_';

        $candidates = [
            $prefix . $baseName,
            'wp_' . $baseName,
            'wpr9_' . $baseName,
            $baseName
        ];

        foreach ($candidates as $cand) {
            try {
                $check = $pdo->query("SELECT 1 FROM `{$cand}` LIMIT 1");
                if ($check !== false) {
                    $resolved[$baseName] = $cand;
                    return $cand;
                }
            } catch (Throwable $e) {}
        }

        $resolved[$baseName] = $prefix . $baseName;
        return $resolved[$baseName];
    }
}

// Helper function to respond with JSON
function sendResponse($success, $data_or_message) {
    if ($success) {
        echo json_encode(["success" => true, "data" => $data_or_message]);
    } else {
        echo json_encode(["success" => false, "message" => $data_or_message]);
    }
    exit();
}
?>

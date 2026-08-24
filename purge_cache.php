<?php
define('LSCACHE_NO_CACHE', true);
header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-cache, must-revalidate, max-age=0');

// Shared purge token. An authenticated admin passkey (from the RBAC store) is
// required; without it, this endpoint refuses to purge the site cache (anti-DoS).
require_once __DIR__ . '/dent2025_rbac.php';
$token = isset($_GET['token']) ? $_GET['token'] : (isset($_POST['token']) ? $_POST['token'] : '');
$auth_ok = false;
if ($token !== '') {
    $info = dent2025_get_passkey_info($token);
    $auth_ok = ($info !== null);
}
if (!$auth_ok) {
    http_response_code(403);
    echo "Unauthorized: a valid admin token is required to purge the cache.\n";
    exit;
}

$dir = dirname(__FILE__);
$wp_load = $dir . '/wp-load.php';
if (!file_exists($wp_load)) {
    $wp_load = dirname($dir) . '/wp-load.php';
}

if (file_exists($wp_load)) {
    require_once $wp_load;
    if (function_exists('do_action')) {
        do_action('litespeed_purge_all');
        echo "LiteSpeed cache purged successfully!\n";
    }
    global $wpdb;
    if ($wpdb) {
        $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_dent2025\_%'");
        echo "Dent2025 transients purged successfully!\n";
    }
} else {
    echo "wp-load.php not found.\n";
}

<?php
// backend/api_data.php
// Forwarding compatibility shim to unified primary API (dent2025_api.php)

if (!isset($_GET['action'])) {
    $_GET['action'] = 'data';
}

require_once dirname(__DIR__) . '/dent2025_api.php';

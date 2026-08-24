<?php
// history_helpers.php
// Central Audit & Snapshot helper module for Dent2025 Academic Portal

if (!function_exists('dent2025_get_history_dir')) {
    function dent2025_get_history_dir() {
        $dir = __DIR__ . '/history_data';
        if (!file_exists($dir)) {
            @mkdir($dir, 0777, true);
        }
        $snapshots_dir = $dir . '/snapshots';
        if (!file_exists($snapshots_dir)) {
            @mkdir($snapshots_dir, 0777, true);
        }
        return $dir;
    }
}

if (!function_exists('dent2025_db')) {
    function dent2025_db() {
        global $wpdb;
        static $active = null;
        if ($active !== null) return $active;

        if (!isset($wpdb)) {
            if (file_exists(__DIR__ . '/wp-load.php')) {
                @require_once __DIR__ . '/wp-load.php';
            } elseif (file_exists(dirname(__DIR__) . '/wp-load.php')) {
                @require_once dirname(__DIR__) . '/wp-load.php';
            }
            global $wpdb;
        }

        if (isset($wpdb) && is_object($wpdb) && method_exists($wpdb, 'get_var')) {
            $prefix = !empty($wpdb->prefix) ? $wpdb->prefix : (isset($GLOBALS['table_prefix']) ? $GLOBALS['table_prefix'] : 'wpr9_');
            $prefixed_subs = "`{$prefix}subjects`";
            $prefixed_links = "`{$prefix}subject_links`";

            $count = $wpdb->get_var("SELECT COUNT(*) FROM {$prefixed_subs}");
            if ($count !== null) {
                $active = ['db' => $wpdb, 'table_subs' => $prefixed_subs, 'table_links' => $prefixed_links];
                return $active;
            }
        }

        if (class_exists('wpdb') && defined('DB_USER') && defined('DB_PASSWORD') && defined('DB_NAME')) {
            try {
                $db_host = defined('DB_HOST') ? DB_HOST : 'localhost';
                $prefix = isset($GLOBALS['table_prefix']) ? $GLOBALS['table_prefix'] : 'wpr9_';
                $dev_db = new wpdb(DB_USER, DB_PASSWORD, DB_NAME, $db_host);
                $dev_db->prefix = $prefix;
                $active = ['db' => $dev_db, 'table_subs' => "`{$prefix}subjects`", 'table_links' => "`{$prefix}subject_links`"];
                return $active;
            } catch (Exception $e) {}
        }

        if (isset($wpdb) && is_object($wpdb)) {
            $prefix = !empty($wpdb->prefix) ? $wpdb->prefix : 'wpr9_';
            $active = ['db' => $wpdb, 'table_subs' => "`{$prefix}subjects`", 'table_links' => "`{$prefix}subject_links`"];
            return $active;
        }

        return null;
    }
}

if (!function_exists('dent2025_capture_system_state')) {
    /**
     * Captures full current snapshot of system data across DB and JSON stores
     * @return array
     */
    function dent2025_capture_system_state() {
        global $wpdb;

        $state = [
            'subjects' => [],
            'subject_links' => [],
            'classes' => [],
            'announcements' => [],
            'events' => [],
            'passwords' => []
        ];

        // 1. Database - Subjects & Subject Links
        try {
            $ctx = dent2025_db();
            if ($ctx && isset($ctx['db']) && is_object($ctx['db']) && method_exists($ctx['db'], 'get_results')) {
                $db = $ctx['db'];
                $table_subs = $ctx['table_subs'];
                $table_links = $ctx['table_links'];

                $subjects = $db->get_results("SELECT * FROM {$table_subs}", ARRAY_A);
                $state['subjects'] = is_array($subjects) ? $subjects : [];

                $links = $db->get_results("SELECT * FROM {$table_links}", ARRAY_A);
                $state['subject_links'] = is_array($links) ? $links : [];
            } else {
                // Fallback to PDO if standalone script
                $db_file = __DIR__ . '/backend/db_connect.php';
                if (file_exists($db_file)) {
                    require_once $db_file;
                    if (isset($pdo) && $pdo instanceof PDO) {
                        $stmt = $pdo->query("SELECT * FROM subjects");
                        $state['subjects'] = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];

                        $stmt2 = $pdo->query("SELECT * FROM subject_links");
                        $state['subject_links'] = $stmt2 ? $stmt2->fetchAll(PDO::FETCH_ASSOC) : [];
                    }
                }
            }
        } catch (Exception $e) {
            // Keep empty on error
        }

        // 2. Class Timetables
        $classes_file = __DIR__ . '/dent2025_classes.json';
        if (file_exists($classes_file)) {
            $json = @file_get_contents($classes_file);
            $state['classes'] = $json ? (json_decode($json, true) ?: []) : [];
        }

        // 3. Announcements
        $ann_dir = __DIR__ . '/announcements_data';
        if (file_exists($ann_dir)) {
            $files = glob("{$ann_dir}/announcements_*.json");
            if ($files) {
                foreach ($files as $file) {
                    $basename = basename($file);
                    $content = @file_get_contents($file);
                    $state['announcements'][$basename] = $content ? (json_decode($content, true) ?: []) : [];
                }
            }
        }

        // 4. Timeline Schedule Events
        $global_events_file = __DIR__ . '/schedule_events.json';
        if (file_exists($global_events_file)) {
            $json = @file_get_contents($global_events_file);
            $state['events']['schedule_events.json'] = $json ? (json_decode($json, true) ?: []) : [];
        }
        $local_event_files = glob(__DIR__ . '/schedule_events_*.json');
        if ($local_event_files) {
            foreach ($local_event_files as $file) {
                $basename = basename($file);
                $json = @file_get_contents($file);
                $state['events'][$basename] = $json ? (json_decode($json, true) ?: []) : [];
            }
        }

        // 5. Admin Passkeys & Permissions (Mask passkeys in snapshot storage for security)
        $passwords_file = __DIR__ . '/dent2025_passwords.json';
        if (file_exists($passwords_file)) {
            $json = @file_get_contents($passwords_file);
            $raw_pass = $json ? (json_decode($json, true) ?: []) : [];
            $state['passwords'] = array_map(function($p) {
                if (isset($p['passkey'])) {
                    $p['passkey'] = '***';
                }
                return $p;
            }, $raw_pass);
        }

        return $state;
    }
}

if (!function_exists('dent2025_record_audit_event')) {
    /**
     * Records an audit event and saves a state snapshot
     * @param string $category 'subjects'|'classes'|'announcements'|'events'|'passkeys'|'rollback'|'manual'
     * @param string $action_type 'add'|'edit'|'delete'|'bulk_update'|'bulk_clear'|'rollback'|'manual_save'
     * @param string $description Arabic summary description
     * @param string $passkey_label Label/identifier of passkey used
     * @param array|null $pre_captured_state Optional pre-captured state
     * @param array|null $metadata Optional structured metadata regarding modified fields/items
     * @return array Created audit entry info
     */
    function dent2025_record_audit_event($category, $action_type, $description, $passkey_label = '', $pre_captured_state = null, $metadata = null) {
        $history_dir = dent2025_get_history_dir();
        $snapshots_dir = $history_dir . '/snapshots';

        $timestamp = time();
        $micro = sprintf("%04d", rand(0, 9999));
        $snapshot_id = "snap_{$timestamp}_{$micro}";
        $audit_id = "audit_{$timestamp}_{$micro}";

        // Capture system state
        $state = $pre_captured_state ?: dent2025_capture_system_state();

        // Save snapshot file
        $snapshot_file = "{$snapshots_dir}/{$snapshot_id}.json";
        $snapshot_data = [
            'snapshot_id' => $snapshot_id,
            'timestamp' => $timestamp,
            'date_formatted' => date('Y-m-d H:i:s', $timestamp),
            'category' => $category,
            'action_type' => $action_type,
            'description' => $description,
            'passkey_label' => $passkey_label ?: 'الأدمن (Passkey)',
            'metadata' => $metadata ?: null,
            'state' => $state
        ];
        @file_put_contents($snapshot_file, json_encode($snapshot_data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        // Append to audit log
        $audit_log_file = "{$history_dir}/audit_log.json";
        $audit_log = [];
        if (file_exists($audit_log_file)) {
            $json = @file_get_contents($audit_log_file);
            if ($json) {
                $audit_log = json_decode($json, true) ?: [];
            }
        }

        $audit_entry = [
            'id' => $audit_id,
            'snapshot_id' => $snapshot_id,
            'timestamp' => $timestamp,
            'date_formatted' => date('Y-m-d H:i:s', $timestamp),
            'category' => $category,
            'action_type' => $action_type,
            'description' => $description,
            'passkey_label' => $passkey_label ?: 'الأدمن (Passkey)'
        ];

        if ($metadata) {
            $audit_entry['metadata'] = $metadata;
        }

        // Insert at beginning (newest first)
        array_unshift($audit_log, $audit_entry);

        // Keep last 500 audit entries to manage size
        if (count($audit_log) > 500) {
            $audit_log = array_slice($audit_log, 0, 500);
        }

        @file_put_contents($audit_log_file, json_encode($audit_log, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        return $audit_entry;
    }
}


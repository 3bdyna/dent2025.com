<?php
// dent2025_rbac.php
// Shared RBAC helper module for Dent2025 Admin Dashboard
if (file_exists(__DIR__ . '/history_helpers.php')) {
    require_once __DIR__ . '/history_helpers.php';
}

if (!function_exists('dent2025_load_passwords')) {
    function dent2025_load_passwords($force_reload = false) {
        static $cache = null;
        if ($cache !== null && !$force_reload) {
            return $cache;
        }
        $json_file = __DIR__ . '/dent2025_passwords.json';
        if (!file_exists($json_file)) {
            $cache = [];
            return $cache;
        }
        $json_content = file_get_contents($json_file);
        // Strip UTF-8 BOM if present
        $json_content = preg_replace('/^\xEF\xBB\xBF/', '', $json_content);
        $data = json_decode($json_content, true);
        $cache = is_array($data) ? $data : [];
        return $cache;
    }
}

if (!function_exists('dent2025_save_passwords')) {
    /**
     * Save updated passwords array to dent2025_passwords.json
     * @param array $passwords_array
     * @return bool Success status
     */
    function dent2025_save_passwords($passwords_array) {
        if (!is_array($passwords_array)) {
            return false;
        }
        $json_file = __DIR__ . '/dent2025_passwords.json';
        $json_content = json_encode($passwords_array, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json_content === false) {
            return false;
        }
        $result = file_put_contents($json_file, $json_content, LOCK_EX);
        if ($result !== false) {
            dent2025_load_passwords(true);
            return true;
        }
        return false;
    }
}

if (!function_exists('dent2025_add_password')) {
    /**
     * Add a new passkey entry to dent2025_passwords.json
     * @param array $entry
     * @return bool Success status
     */
    function dent2025_add_password($entry) {
        if (!is_array($entry)) {
            return false;
        }
        if (empty($entry['id'])) {
            $entry['id'] = 'pass_' . uniqid();
        }
        if (!isset($entry['label'])) {
            $entry['label'] = 'New Passkey';
        }
        if (!isset($entry['passkey'])) {
            return false;
        }
        if (!isset($entry['allowed_contexts']) || !is_array($entry['allowed_contexts'])) {
            $entry['allowed_contexts'] = ['*'];
        }
        if (!isset($entry['permissions']) || !is_array($entry['permissions'])) {
            $entry['permissions'] = [];
        }

        $passwords = dent2025_load_passwords();
        $passwords[] = $entry;
        $res = dent2025_save_passwords($passwords);
        if ($res && function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('passkeys', 'add', 'إضافة كلمة مرور جديدة: ' . ($entry['label'] ?? ''), 'إدارة الصلاحيات');
        }
        return $res;
    }
}

if (!function_exists('dent2025_update_password')) {
    /**
     * Update an existing passkey entry in dent2025_passwords.json
     * @param string $id
     * @param array $updates
     * @return bool Success status
     */
    function dent2025_update_password($id, $updates) {
        if (empty($id) || !is_array($updates)) {
            return false;
        }
        $passwords = dent2025_load_passwords();
        $found = false;
        foreach ($passwords as $index => $entry) {
            if (isset($entry['id']) && $entry['id'] === $id) {
                $updated_entry = array_merge($entry, $updates);
                $updated_entry['id'] = $id;
                $passwords[$index] = $updated_entry;
                $found = true;
                break;
            }
        }
        if (!$found) {
            return false;
        }
        $res = dent2025_save_passwords($passwords);
        if ($res && function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('passkeys', 'edit', 'تعديل كلمة مرور / صلاحيات ID: ' . $id, 'إدارة الصلاحيات');
        }
        return $res;
    }
}

if (!function_exists('dent2025_delete_password')) {
    /**
     * Delete a passkey entry by ID from dent2025_passwords.json
     * @param string $id
     * @return bool Success status
     */
    function dent2025_delete_password($id) {
        if (empty($id)) {
            return false;
        }
        $passwords = dent2025_load_passwords();
        $initial_count = count($passwords);
        $filtered = array_filter($passwords, function($entry) use ($id) {
            return !isset($entry['id']) || $entry['id'] !== $id;
        });
        $filtered = array_values($filtered);
        if (count($filtered) === $initial_count) {
            return false;
        }
        $res = dent2025_save_passwords($filtered);
        if ($res && function_exists('dent2025_record_audit_event')) {
            dent2025_record_audit_event('passkeys', 'delete', 'حذف كلمة مرور ID: ' . $id, 'إدارة الصلاحيات');
        }
        return $res;
    }
}

if (!function_exists('dent2025_get_passkey_info')) {
    /**
     * Look up passkey entry in dent2025_passwords.json
     * @param string $passkey
     * @return array|null Returns entry array (id, label, passkey, allowed_contexts, permissions) or null if not found
     */
    function dent2025_get_passkey_info($passkey) {
        if (empty($passkey) || !is_string($passkey)) {
            return null;
        }
        $passwords = dent2025_load_passwords();
        foreach ($passwords as $entry) {
            if (isset($entry['passkey']) && $entry['passkey'] === $passkey) {
                return $entry;
            }
        }

        return null;
    }
}

if (!function_exists('dent2025_check_rbac_permission')) {
    /**
     * Check if passkey has required permission and context access.
     * Logic:
     * 1. If manage_passwords === true, acts as a master override (returns true).
     * 2. Checks if $required_perm is true in permissions.
     * 3. Checks context matching: wildcard "*" matches any context;
     *    otherwise checks if "{specialty}_{year}_{semester}" matches allowed_contexts.
     *
     * @param string $passkey
     * @param string|null $required_perm
     * @param string|null $specialty
     * @param int|string|null $year
     * @param int|string|null $semester
     * @return bool
     */
    function dent2025_check_rbac_permission($passkey, $required_perm, $specialty = null, $year = null, $semester = null) {
        $entry = dent2025_get_passkey_info($passkey);
        if (!$entry) {
            return false;
        }

        $perms = $entry['permissions'] ?? [];

        // Master override: manage_passwords === true
        if (!empty($perms['manage_passwords'])) {
            return true;
        }

        // Check required permission
        if ($required_perm !== null && empty($perms[$required_perm])) {
            return false;
        }

        // Check context matching
        $allowed = $entry['allowed_contexts'] ?? [];
        if (in_array('*', $allowed, true)) {
            return true;
        }
        if ($specialty === null || $year === null || $semester === null) {
            return false; // Context required for scoped passkeys
        }
        $target_context = "{$specialty}_{$year}_{$semester}";
        if (!in_array($target_context, $allowed, true)) {
            return false;
        }
        return true;
    }
}

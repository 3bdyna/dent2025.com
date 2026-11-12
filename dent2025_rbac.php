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
        $passkey = trim($passkey);
        $passwords = dent2025_load_passwords();
        foreach ($passwords as $entry) {
            if (isset($entry['passkey']) && is_string($entry['passkey']) && hash_equals($entry['passkey'], $passkey)) {
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
        if (function_exists('dent2025_is_ip_locked_out') && dent2025_is_ip_locked_out()) {
            return false;
        }

        $entry = dent2025_get_passkey_info($passkey);
        if (!$entry) {
            static $last_failed_passkey = null;
            if ($last_failed_passkey !== $passkey && !empty($passkey) && function_exists('dent2025_record_auth_failure')) {
                $last_failed_passkey = $passkey;
                dent2025_record_auth_failure();
            }
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
        if ($specialty === 'pre-med' && ($year === 0 || $year === '0' || $year === 1 || $year === '1')) {
            $year = 1;
        }
        $target_context = "{$specialty}_{$year}_{$semester}";
        if (!in_array($target_context, $allowed, true)) {
            return false;
        }
        return true;
    }
}

// =========================================================================
// BRUTE-FORCE DEFENSE & RATE LIMITING SYSTEM FOR AUTH & PIN CODE
// =========================================================================

if (!function_exists('dent2025_get_client_ip')) {
    /**
     * Resolve the authentic client IP address, supporting Cloudflare Tunnel securely
     * without allowing untrusted X-Forwarded-For or CF-Connecting-IP header spoofing.
     * @return string
     */
    function dent2025_get_client_ip() {
        $remote_addr = $_SERVER['REMOTE_ADDR'] ?? '';
        $is_loopback = in_array($remote_addr, ['127.0.0.1', '::1', 'localhost'], true);

        // 1. Cloudflare Connecting IP: only trust when request originated from local Cloudflare tunnel / loopback proxy
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP']) && ($is_loopback || empty($remote_addr))) {
            $ip = trim($_SERVER['HTTP_CF_CONNECTING_IP']);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }

        // 2. Only trust X-Forwarded-For if REMOTE_ADDR is an internal loopback proxy (127.0.0.1, ::1)
        if ($is_loopback && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
            $first = trim($parts[0] ?? '');
            if (filter_var($first, FILTER_VALIDATE_IP)) {
                return $first;
            }
        }

        // 3. Direct REMOTE_ADDR
        if (!empty($remote_addr) && filter_var($remote_addr, FILTER_VALIDATE_IP)) {
            return $remote_addr;
        }

        return '127.0.0.1';
    }
}

if (!function_exists('dent2025_get_rate_limit_file')) {
    /**
     * Get path to the persistent rate-limit JSON store.
     * @return string
     */
    function dent2025_get_rate_limit_file() {
        $dir = __DIR__ . '/dent2025_study_data';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return $dir . '/auth_rate_limits.json';
    }
}

if (!function_exists('dent2025_modify_rate_limit_data')) {
    /**
     * Atomically read, modify, and save rate-limit data under exclusive lock (flock).
     * Uses stream_get_contents() to eliminate PHP stat cache discrepancy.
     *
     * @param callable $callback function(&$data): mixed
     * @return mixed Returns callback result
     */
    function dent2025_modify_rate_limit_data($callback) {
        $file = dent2025_get_rate_limit_file();
        $fp = @fopen($file, 'c+');
        if (!$fp) {
            $data = ['ips' => [], 'last_cleanup' => time()];
            return $callback($data);
        }

        if (!flock($fp, LOCK_EX)) {
            fclose($fp);
            $data = ['ips' => [], 'last_cleanup' => time()];
            return $callback($data);
        }

        rewind($fp);
        $content = stream_get_contents($fp);
        $data = !empty($content) ? json_decode($content, true) : null;
        if (!is_array($data) || !isset($data['ips']) || !is_array($data['ips'])) {
            $data = ['ips' => [], 'last_cleanup' => time()];
        }

        $result = $callback($data);

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json !== false) {
            rewind($fp);
            ftruncate($fp, 0);
            fwrite($fp, $json);
            fflush($fp);
        }

        flock($fp, LOCK_UN);
        fclose($fp);

        return $result;
    }
}

if (!function_exists('dent2025_load_rate_limit_data')) {
    /**
     * Read rate-limiting store with shared lock without stat cache pitfalls.
     * @return array
     */
    function dent2025_load_rate_limit_data() {
        $file = dent2025_get_rate_limit_file();
        if (!file_exists($file)) {
            return ['ips' => [], 'last_cleanup' => time()];
        }
        $fp = @fopen($file, 'r');
        if (!$fp) {
            return ['ips' => [], 'last_cleanup' => time()];
        }
        flock($fp, LOCK_SH);
        rewind($fp);
        $content = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        fclose($fp);

        $data = json_decode($content, true);
        if (!is_array($data) || !isset($data['ips']) || !is_array($data['ips'])) {
            return ['ips' => [], 'last_cleanup' => time()];
        }
        return $data;
    }
}

if (!function_exists('dent2025_check_auth_rate_limit')) {
    /**
     * Check if client IP is currently locked out or allowed to make an auth attempt.
     * @param string|null $ip
     * @return array ['allowed' => bool, 'locked' => bool, 'remaining_attempts' => int, 'retry_after' => int, 'message' => string]
     */
    function dent2025_check_auth_rate_limit($ip = null) {
        $ip = $ip ?: dent2025_get_client_ip();
        $data = dent2025_load_rate_limit_data();
        $now = time();
        $entry = $data['ips'][$ip] ?? null;

        if ($entry && isset($entry['lockout_until']) && $entry['lockout_until'] > $now) {
            $retry_after = $entry['lockout_until'] - $now;
            $mins = max(1, (int) ceil($retry_after / 60));
            $min_text = ($mins === 1) ? 'دقيقة واحدة' : (($mins === 2) ? 'دقيقتين' : "{$mins} دقائق");
            return [
                'allowed' => false,
                'locked' => true,
                'remaining_attempts' => 0,
                'retry_after' => $retry_after,
                'message' => "تم حظر محاولات الدخول مؤقتاً لحماية الحساب من التخمين. يرجى الانتظار {$min_text} قبل المحاولة مجدداً."
            ];
        }

        // Count recent failed attempts in rolling 10-minute window (600s)
        $attempts = $entry['attempts'] ?? [];
        $recent = array_filter($attempts, function($t) use ($now) {
            return ($now - $t) <= 600;
        });

        $max_attempts = 5;
        $remaining = max(0, $max_attempts - count($recent));

        return [
            'allowed' => true,
            'locked' => false,
            'remaining_attempts' => $remaining,
            'retry_after' => 0,
            'message' => ''
        ];
    }
}

if (!function_exists('dent2025_is_ip_locked_out')) {
    /**
     * Quick boolean check if IP is currently locked out.
     * @param string|null $ip
     * @return bool
     */
    function dent2025_is_ip_locked_out($ip = null) {
        $status = dent2025_check_auth_rate_limit($ip);
        return !empty($status['locked']);
    }
}

if (!function_exists('dent2025_record_auth_failure')) {
    /**
     * Record a failed PIN/passkey attempt for the client IP.
     * Implements atomic update, progressive delays (tarpit) and escalation lockouts.
     *
     * @param string|null $ip
     * @return array
     */
    function dent2025_record_auth_failure($ip = null) {
        $ip = $ip ?: dent2025_get_client_ip();
        $now = time();
        $sleep_us = 0;

        $status = dent2025_modify_rate_limit_data(function(&$data) use ($ip, $now, &$sleep_us) {
            // Auto-prune entries older than 24h
            if (($now - ($data['last_cleanup'] ?? 0)) > 3600) {
                foreach ($data['ips'] as $stored_ip => $rec) {
                    $until = $rec['lockout_until'] ?? 0;
                    $latest = !empty($rec['attempts']) ? max($rec['attempts']) : 0;
                    if ($until < ($now - 86400) && $latest < ($now - 86400)) {
                        unset($data['ips'][$stored_ip]);
                    }
                }
                $data['last_cleanup'] = $now;
            }

            $entry = $data['ips'][$ip] ?? [
                'attempts' => [],
                'lockout_until' => 0,
                'lockout_level' => 0
            ];

            // If already locked out, immediately return active lockout response
            if (isset($entry['lockout_until']) && $entry['lockout_until'] > $now) {
                $retry_after = $entry['lockout_until'] - $now;
                $mins = max(1, (int) ceil($retry_after / 60));
                $min_text = ($mins === 1) ? 'دقيقة واحدة' : (($mins === 2) ? 'دقيقتين' : "{$mins} دقائق");
                return [
                    'allowed' => false,
                    'locked' => true,
                    'remaining_attempts' => 0,
                    'retry_after' => $retry_after,
                    'message' => "تم حظر محاولات الدخول مؤقتاً لحماية الحساب من التخمين. يرجى الانتظار {$min_text} قبل المحاولة مجدداً."
                ];
            }

            // Decay lockout escalation level if > 1 hour has elapsed since last lockout
            if (($now - ($entry['lockout_until'] ?? 0)) > 3600) {
                $entry['lockout_level'] = 0;
            }

            // Filter recent attempts within 10-minute window
            $recent = array_filter($entry['attempts'] ?? [], function($t) use ($now) {
                return ($now - $t) <= 600;
            });
            $recent[] = $now;
            $entry['attempts'] = array_values($recent);

            $attempt_count = count($recent);
            $max_attempts = 5;

            // Progressive delays (tarpitting against automated scripts)
            // Flagged here, executed after atomic write completes
            if ($attempt_count === 3) {
                $sleep_us = 300000; // 300ms
            } elseif ($attempt_count === 4) {
                $sleep_us = 800000; // 800ms
            } elseif ($attempt_count >= $max_attempts) {
                $sleep_us = 1200000; // 1.2s
            }

            if ($attempt_count >= $max_attempts) {
                // Trigger escalation lockout
                $prev_level = (int) ($entry['lockout_level'] ?? 0);
                $new_level = min(3, $prev_level + 1);

                // Level 1: 5 minutes (300s)
                // Level 2: 15 minutes (900s)
                // Level 3: 60 minutes (3600s)
                $durations = [1 => 300, 2 => 900, 3 => 3600];
                $duration = $durations[$new_level] ?? 3600;

                $entry['lockout_until'] = $now + $duration;
                $entry['lockout_level'] = $new_level;
                $entry['attempts'] = []; // Reset attempts for when lockout expires

                $data['ips'][$ip] = $entry;

                $mins = max(1, (int) ceil($duration / 60));
                $min_text = ($mins === 1) ? 'دقيقة واحدة' : (($mins === 2) ? 'دقيقتين' : "{$mins} دقائق");

                return [
                    'allowed' => false,
                    'locked' => true,
                    'remaining_attempts' => 0,
                    'retry_after' => $duration,
                    'message' => "تم حظر محاولات الدخول مؤقتاً لتكرار إدخال رمز خاطئ. يرجى الانتظار {$min_text} قبل المحاولة مجدداً."
                ];
            }

            $remaining = $max_attempts - $attempt_count;
            $data['ips'][$ip] = $entry;

            $rem_text = ($remaining === 1) ? 'محاولة واحدة متبقية' : (($remaining === 2) ? 'محاولتان متبقيتان' : "{$remaining} محاولات متبقية");

            return [
                'allowed' => true,
                'locked' => false,
                'remaining_attempts' => $remaining,
                'retry_after' => 0,
                'message' => "رمز PIN غير صحيح. لديك {$rem_text} قبل حظر الدخول مؤقتاً."
            ];
        });

        // Execute progressive delay outside of the file lock
        if ($sleep_us > 0) {
            usleep($sleep_us);
        }

        return $status;
    }
}

if (!function_exists('dent2025_record_auth_success')) {
    /**
     * Record a successful authentication, resetting failed attempts and lockout.
     * @param string|null $ip
     * @return bool
     */
    function dent2025_record_auth_success($ip = null) {
        $ip = $ip ?: dent2025_get_client_ip();
        return dent2025_modify_rate_limit_data(function(&$data) use ($ip) {
            if (isset($data['ips'][$ip])) {
                unset($data['ips'][$ip]);
            }
            return true;
        });
    }
}

if (!function_exists('dent2025_reset_auth_rate_limits')) {
    /**
     * Reset rate limits for all IPs or a specific IP (admin/test utility).
     * @param string|null $target_ip
     * @return bool
     */
    function dent2025_reset_auth_rate_limits($target_ip = null) {
        return dent2025_modify_rate_limit_data(function(&$data) use ($target_ip) {
            if ($target_ip === null) {
                $data = ['ips' => [], 'last_cleanup' => time()];
            } elseif (isset($data['ips'][$target_ip])) {
                unset($data['ips'][$target_ip]);
            }
            return true;
        });
    }
}

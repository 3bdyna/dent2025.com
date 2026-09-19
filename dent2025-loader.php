<?php
/**
 * Plugin Name: Dent2025 Component Loader
 * Plugin URI: https://dent2025.com
 * Description: Dynamic server component loader for Dent2025 Academic Portal. Loads frontend HTML, JS, and CSS components directly from server files with automatic cache-busting.
 * Version: 1.0.0
 * Author: Dent2025
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

function dent2025_load_component_shortcode($atts) {
    $atts = shortcode_atts([
        'file' => '',
        'type' => '' // optional manual override: js, css, html
    ], $atts, 'dent_component');

    $file = trim($atts['file']);
    if (empty($file)) {
        return '<!-- Dent2025 Loader: No file specified -->';
    }

    // Strict sanitization against directory traversal
    $safe_file = basename($file);
    $safe_file = preg_replace('/[^a-zA-Z0-9_.-]/', '', $safe_file);

    if (empty($safe_file)) {
        return '<!-- Dent2025 Loader: Invalid filename -->';
    }

    $components_dir = ABSPATH . 'frontend_components/';
    $file_path = $components_dir . $safe_file;

    if (!file_exists($file_path)) {
        // Fallback check in dev/ directory if needed
        $fallback_path = ABSPATH . 'dev/frontend_components/' . $safe_file;
        if (file_exists($fallback_path)) {
            $file_path = $fallback_path;
        } else {
            return "<!-- Dent2025 Loader: Component file not found ({$safe_file}) -->";
        }
    }

    $ext = strtolower(pathinfo($safe_file, PATHINFO_EXTENSION));
    $mtime = filemtime($file_path);
    $override_type = strtolower($atts['type']);

    // Handle standalone JavaScript file
    if ($override_type === 'js' || $ext === 'js') {
        return sprintf(
            '<script src="/frontend_components/%s?v=%d"></script>',
            esc_attr($safe_file),
            $mtime
        );
    }

    // Handle standalone CSS file
    if ($override_type === 'css' || $ext === 'css') {
        return sprintf(
            '<link rel="stylesheet" href="/frontend_components/%s?v=%d">',
            esc_attr($safe_file),
            $mtime
        );
    }

    // For HTML, TXT, or composite template components
    $content = file_get_contents($file_path);
    if ($content === false) {
        return "<!-- Dent2025 Loader: Failed to read file ({$safe_file}) -->";
    }

    if ($safe_file === 'study_timer_banner_widget.html') {
        $GLOBALS['dent2025_timer_rendered'] = true;
    }

    // Strip legacy PHP snippet wrapper tags if any exist in the source file
    $content = preg_replace('/<\?php\s*add_action.*?\?>/s', '', $content);
    $content = preg_replace('/<\?php\s*\};\s*\?>/s', '', $content);

    // Automatically append ?v={filemtime} to any embedded <script src="..."> or <link href="..."> tags inside HTML blocks
    $content = preg_replace_callback(
        '/(src|href)=["\']([^"\']+\.(js|css))["\']/i',
        function ($matches) use ($mtime) {
            $attr = $matches[1];
            $url = $matches[2];
            $tag_mtime = $mtime;
            
            // If the embedded file exists locally, use its actual disk mtime
            $asset_path = '';
            if (strpos($url, '/frontend_components/') !== false) {
                $rel = preg_replace('#^.*?/frontend_components/#', '', $url);
                $rel = preg_replace('/[^a-zA-Z0-9_.\/-]/', '', $rel);
                $asset_path = ABSPATH . 'frontend_components/' . $rel;
            } elseif (strpos($url, 'http') === false && !preg_match('#^//#', $url)) {
                $rel = ltrim(preg_replace('/[^a-zA-Z0-9_.\/-]/', '', $url), '/');
                $asset_path = ABSPATH . $rel;
            }
            if (!empty($asset_path) && file_exists($asset_path)) {
                $tag_mtime = filemtime($asset_path) ?: $mtime;
            }

            if (strpos($url, '?') === false) {
                $url .= '?v=' . $tag_mtime;
            }
            return sprintf('%s="%s"', $attr, $url);
        },
        $content
    );

    // Defeat WordPress wpautop by collapsing whitespace/newlines inside <style> blocks
    $content = preg_replace_callback('/<style\b[^>]*>(.*?)<\/style>/is', function($matches) {
        $css = preg_replace('/\s+/', ' ', $matches[1]);
        return '<style>' . trim($css) . '</style>';
    }, $content);

    return $content;
}

add_shortcode('dent_component', 'dent2025_load_component_shortcode');

// Filter the_content to remove any <p> or <br> wrappers inserted around <style> and <script> tags
add_filter('the_content', function($content) {
    $content = preg_replace('/<p>\s*(<style\b[^>]*>.*?<\/style>)\s*<\/p>/is', '$1', $content);
    $content = preg_replace('/<p>\s*(<script\b[^>]*>.*?<\/script>)\s*<\/p>/is', '$1', $content);
    $content = preg_replace('/<br\s*\/?>\s*(<style\b[^>]*>.*?<\/style>)/is', '$1', $content);
    return $content;
}, 999);

// Automatically load Study Timer & Tracker sitewide in wp_footer so the floating badge follows students across all pages
add_action('wp_footer', function() {
    // Avoid loading timer on welcome selection page
    if (is_page('wolcome') || is_page('welcome')) return;

    // Avoid duplicate rendering if already embedded via [dent_component file="study_timer_banner_widget.html"]
    if (!empty($GLOBALS['dent2025_timer_rendered'])) return;

    $timer_file = ABSPATH . 'frontend_components/study_timer_banner_widget.html';
    if (file_exists($timer_file)) {
        $content = file_get_contents($timer_file);
        if ($content !== false) {
            $content = preg_replace('/<\?php.*?\?>/s', '', $content);
            $content = preg_replace_callback('/<style\b[^>]*>(.*?)<\/style>/is', function($m) {
                return '<style>' . preg_replace('/\s+/', ' ', $m[1]) . '</style>';
            }, $content);
            echo $content;
            $GLOBALS['dent2025_timer_rendered'] = true;
        }
    }
});

// Force LiteSpeed Cache purge when requested via ?purge=1 with admin auth
add_action('init', function() {
    if (isset($_GET['purge']) || isset($_GET['nocache'])) {
        $token = $_GET['token'] ?? ($_POST['token'] ?? '');
        $is_admin = function_exists('current_user_can') && current_user_can('manage_options');
        $is_token_valid = false;
        $rbac_file = ABSPATH . 'dent2025_rbac.php';
        if (!empty($token) && file_exists($rbac_file)) {
            require_once $rbac_file;
            if (function_exists('dent2025_get_passkey_info')) {
                $is_token_valid = (dent2025_get_passkey_info($token) !== null);
            }
        }
        if (($is_admin || $is_token_valid) && function_exists('do_action')) {
            do_action('litespeed_purge_all');
        }
    }
});

// ---------------------------------------------------------------
// PERFORMANCE OPTIMIZATIONS (self-hosted fonts, deferred rendering)
// ---------------------------------------------------------------

function dent2025_is_frontend_head() {
    return !is_admin() && !(defined('DOING_CRON') && DOING_CRON);
}

if (dent2025_is_frontend_head()) {
    // Strip external Google Fonts from <head> and serve self-hosted copies instead.
    // This removes the fonts.googleapis.com stylesheet + fonts.gstatic.com woff2
    // round-trips from the LCP critical path.
    add_action('wp_head', function() { ob_start(); }, 1);

    add_action('wp_head', function() {
        $head = (string) ob_get_clean();

        // Remove every Google Fonts <link> (stylesheet, preconnect, dns-prefetch)
        $head = preg_replace('~<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*/?>~i', '', $head);

        // Inject self-hosted fonts INLINE (removes the last render-blocking request)
        // + preload the two fonts that render the LCP card.
        // NOTE: the inlined CSS is served from the page URL, so its relative font
        // paths must be rewritten to absolute /frontend_components/fonts/ paths.
        // Otherwise relative url('outfit-latin.woff2') resolves against the page
        // root/subpage and the fonts 404 (falling back to system fonts).
        $fonts_css = ABSPATH . 'frontend_components/fonts/fonts.css';
        if (file_exists($fonts_css)) {
            $fonts_content = (string) @file_get_contents($fonts_css);
            if (trim($fonts_content) !== '') {
                $fonts_content = preg_replace_callback('~url\(\s*([\'"]?)\s*([^)>\'"]+)\s*\1\s*\)~i', function ($fm) {
                    $path = trim($fm[2]);
                    // Skip absolute / protocol / data URLs
                    if (preg_match('~^(https?:)?//|^data:|^#~i', $path)) return $fm[0];
                    return 'url(' . $fm[1] . '/frontend_components/fonts/' . $path . $fm[1] . ')';
                }, $fonts_content);
                $head .= '<style id="dent-local-fonts-css">' . trim($fonts_content) . '</style>';
            } else {
                $version = (string) @filemtime($fonts_css);
                $head .= '<link rel="stylesheet" id="dent-local-fonts-css" href="/frontend_components/fonts/fonts.css?v=' . esc_attr($version) . '">';
            }
        }
        $head .= '<link rel="preload" as="font" type="font/woff2" href="/frontend_components/fonts/notokufiarabic-arabic.woff2" crossorigin>';
        $head .= '<link rel="preload" as="font" type="font/woff2" href="/frontend_components/fonts/outfit-latin.woff2" crossorigin>';

        // Strip legacy or duplicate Open Graph and Twitter Card tags from <head>
        $head = preg_replace('~<!--\s*(?:Open Graph Meta Tags|Twitter Card Tags).*?-->\s*~is', '', $head);
        $head = preg_replace('~<meta\b[^>]*(?:property|name)=["\'](?:og:[^"\']+|twitter:[^"\']+)["\'][^>]*>\s*~i', '', $head);

        // Inject standardized Open Graph & Twitter Card tags with cache busting
        $og_file = ABSPATH . 'logos/og_share_preview.jpg';
        $og_ver = file_exists($og_file) ? filemtime($og_file) : 1;
        $og_url = 'https://dent2025.com/logos/og_share_preview.jpg?v=' . $og_ver;
        $site_url = function_exists('home_url') ? home_url('/') : 'https://dent2025.com/';

        $invisible_desc = "\xE2\xA0\x80";
        $head .= "\n" .
            '<!-- Open Graph Meta Tags for WhatsApp / Social Media -->' . "\n" .
            '<meta property="og:title" content="Dent 2025 | Study Hub">' . "\n" .
            '<meta property="og:description" content="' . $invisible_desc . '">' . "\n" .
            '<meta property="og:type" content="website">' . "\n" .
            '<meta property="og:url" content="' . esc_url($site_url) . '">' . "\n" .
            '<meta property="og:image" content="' . esc_url($og_url) . '">' . "\n" .
            '<meta property="og:image:secure_url" content="' . esc_url($og_url) . '">' . "\n" .
            '<meta property="og:image:type" content="image/jpeg">' . "\n" .
            '<meta property="og:image:width" content="1200">' . "\n" .
            '<meta property="og:image:height" content="630">' . "\n" .
            '<!-- Twitter Card Tags -->' . "\n" .
            '<meta name="twitter:card" content="summary_large_image">' . "\n" .
            '<meta name="twitter:title" content="Dent 2025 | Study Hub">' . "\n" .
            '<meta name="twitter:description" content="' . $invisible_desc . '">' . "\n" .
            '<meta name="twitter:image" content="' . esc_url($og_url) . '">' . "\n";

        echo $head;
    }, 99);

    // Defer the Astra frontend JS and delay Google Site Kit gtag.js until after first render.
    // Site Kit's inline snippet defines the gtag() queue shim, so queued events replay
    // safely once the delayed library eventually loads.
    add_filter('script_loader_tag', function($tag, $handle, $src) {
        if ($handle === 'astra-theme-js' && $src && strpos($src, 'frontend.min.js') !== false) {
            if (strpos($tag, 'defer') === false) {
                $tag = str_replace('<script ', '<script defer ', $tag);
            }
        }
        if ($handle === 'google_gtagjs') {
            if (preg_match("~src=[\"']([^\"']+)~i", $tag, $m)) {
                $gaSrc = $m[1];
                $loader = "window.addEventListener('load',function(){setTimeout(function(){var s=document.createElement('script');s.async=true;s.src='" . esc_js($gaSrc) . "';document.head.appendChild(s);},1000);});";
                return "<script type='text/javascript' id='google_gtagjs-js'>" . $loader . "</script>";
            }
        }
        return $tag;
    }, 20, 3);
}

// --- Daily Cache Cron Sync at 12:00 PM AST (09:00 UTC) ---
add_filter('cron_schedules', function ($schedules) {
    $schedules['dent2025_daily_noon'] = [
        'interval' => 86400,
        'display'  => 'Once Daily at 12 PM AST'
    ];
    return $schedules;
});

add_action('dent2025_cache_cron_sync', function () {
    $passwords_file = ABSPATH . 'dent2025_passwords.json';
    if (!file_exists($passwords_file)) return;
    $passwords = json_decode(file_get_contents($passwords_file), true);
    if (!is_array($passwords)) return;

    // Find master passkey
    $masterPass = '';
    foreach ($passwords as $entry) {
        if (!empty($entry['permissions']['manage_passwords'])) {
            $masterPass = $entry['passkey'] ?? '';
            break;
        }
    }
    if (empty($masterPass)) return;

    $url = site_url('/backend/api_ai_exam.php');
    wp_remote_post($url, [
        'timeout' => 120,
        'body'    => json_encode([
            'action'   => 'cron_sync',
            'password' => $masterPass
        ]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
});

// Schedule the cron on plugin activation / on every load if not scheduled
add_action('init', function () {
    if (!wp_next_scheduled('dent2025_cache_cron_sync')) {
        // Next 12:00 PM AST = 09:00 UTC
        $now_utc = time();
        $today_noon_utc = strtotime(gmdate('Y-m-d') . ' 09:00:00 UTC');
        $next_run = ($today_noon_utc > $now_utc) ? $today_noon_utc : $today_noon_utc + 86400;
        wp_schedule_event($next_run, 'dent2025_daily_noon', 'dent2025_cache_cron_sync');
    }
});

// Clean up on plugin deactivation
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('dent2025_cache_cron_sync');
});

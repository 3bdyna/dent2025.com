<?php
require_once dirname(__FILE__) . '/wp-load.php';

// Secure it (one-off admin tool: requires WordPress manage_options capability)
if (!current_user_can('manage_options')) {
    die("You must be logged in as an admin to run this script.");
}

global $wpdb;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_admin_referer('dent2025_auto_relink_action', 'dent2025_relink_nonce');
    $json_data = stripslashes($_POST['json_data'] ?? '');
    $dry_run = isset($_POST['dry_run']);
    
    $folders = json_decode($json_data, true);
    
    if (!$folders) {
        $error = "Invalid JSON data.";
    } else {
        $table = $wpdb->prefix . 'subjects';
        $subjects = $wpdb->get_results("SELECT id, name, chapters_folder_id FROM {$table}", ARRAY_A);
        $log = [];
        $updates = 0;
        
        foreach ($subjects as $sub) {
            $name = trim($sub['name']);
            if (isset($folders[$name])) {
                $chap_id = $folders[$name]['chapters_folder_id'] ?? '';
                $mat_id = $folders[$name]['materials_folder_id'] ?? '';
                
                if ($dry_run) {
                    $log[] = "[DRY RUN] Matched '{$name}' -> Chapters ID: {$chap_id} | Materials ID: {$mat_id}";
                } else {
                    $wpdb->update($table, [
                        'chapters_folder_id' => $chap_id,
                        'materials_folder_id' => $mat_id
                    ], ['id' => $sub['id']]);
                    
                    $log[] = "[UPDATED] '{$name}' -> successfully linked to Google Drive!";
                    $updates++;
                }
            } else {
                $log[] = "[NOT FOUND] '{$name}' was not found in the Google Drive JSON.";
            }
        }
        
        if (!$dry_run && $updates > 0) {
            // Clear cache!
            $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_dent2025\_data\_%'");
            $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_timeout\_dent2025\_data\_%'");
        }
    }
}
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>أداة الربط التلقائي (Auto Relink)</title>
    <style>
        body { font-family: Tahoma, sans-serif; background: #f4f4f9; padding: 20px; }
        .container { max-width: 800px; margin: auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        textarea { width: 100%; height: 200px; font-family: monospace; padding: 10px; margin-bottom: 20px; direction: ltr; }
        .btn { background: #4f8cff; color: white; border: none; padding: 10px 20px; font-size: 16px; border-radius: 5px; cursor: pointer; }
        .btn-warning { background: #f59e0b; }
        .log { background: #1e293b; color: #4ade80; padding: 15px; border-radius: 5px; font-family: monospace; white-space: pre-wrap; direction: ltr; text-align: left; margin-top: 20px; }
        .log .error { color: #f87171; }
        .log .not-found { color: #94a3b8; }
    </style>
</head>
<body>
    <div class="container">
        <h2>أداة الربط التلقائي بمجلدات جوجل درايف</h2>
        <p>قم بلصق محتوى ملف <code>Dent2025_Exported_IDs.json</code> الذي استخرجته من جوجل درايف هنا:</p>
        
        <?php if (isset($error)): ?>
            <p style="color:red;"><?php echo $error; ?></p>
        <?php endif; ?>

        <form method="POST">
            <?php wp_nonce_field('dent2025_auto_relink_action', 'dent2025_relink_nonce'); ?>
            <textarea name="json_data" placeholder='{"Subject Name": {"chapters_folder_id": "...", "materials_folder_id": "..."}}'><?php echo isset($_POST['json_data']) ? htmlspecialchars(stripslashes($_POST['json_data'])) : ''; ?></textarea>
            
            <div style="display: flex; gap: 10px;">
                <button type="submit" name="dry_run" class="btn btn-warning">فحص فقط (Dry Run) - لن يتم التعديل</button>
                <button type="submit" name="execute" class="btn">تنفيذ الربط الفعلي (Execute)</button>
            </div>
        </form>

        <?php if (isset($log)): ?>
            <div class="log">
                <h3>سجل العمليات:</h3>
                <?php foreach ($log as $line): ?>
                    <?php 
                        $class = '';
                        if (strpos($line, '[NOT FOUND]') !== false) $class = 'not-found';
                        if (strpos($line, '[DRY RUN]') !== false) $class = 'error';
                    ?>
                    <div class="<?php echo $class; ?>"><?php echo htmlspecialchars($line); ?></div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </div>
</body>
</html>

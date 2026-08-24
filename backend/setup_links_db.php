<?php
// backend/setup_links_db.php
require_once 'db_connect.php';
require_once __DIR__ . '/../dent2025_rbac.php';

$pass = $_GET['password'] ?? ($_POST['password'] ?? '');
if (!dent2025_check_rbac_permission($pass, 'manage_passwords')) {
    http_response_code(403);
    die("Unauthorized: Admin passkey required.");
}

try {
    $sql = "CREATE TABLE IF NOT EXISTS subject_links (
        id INT AUTO_INCREMENT PRIMARY KEY,
        subject_id INT NOT NULL,
        url VARCHAR(1000) NOT NULL,
        title VARCHAR(255) NOT NULL,
        type VARCHAR(50) DEFAULT 'link',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";

    $pdo->exec($sql);
    echo "<div style='font-family: monospace; background: #111; color: #0f0; padding: 20px; border-radius: 10px;'>";
    echo "<h2>Success!</h2>";
    echo "<p>The 'subject_links' table has been created successfully.</p>";
    echo "</div>";
} catch (PDOException $e) {
    echo "<div style='font-family: monospace; background: #111; color: #f00; padding: 20px; border-radius: 10px;'>";
    echo "<h2>Error Creating Table</h2>";
    echo "<p>" . htmlspecialchars($e->getMessage()) . "</p>";
    echo "</div>";
}
?>

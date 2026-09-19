<?php
// backend/api_data.php
// Fetches subjects for a specific specialty, year, and semester

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: https://dent2025.com");

require_once 'db_connect.php';

$specialty = $_GET['specialty'] ?? '';
$year = $_GET['year'] ?? 0;
$semester = $_GET['semester'] ?? 0;

if (empty($specialty) || empty($semester)) {
    echo json_encode(["success" => false, "message" => "Missing required parameters"]);
    exit;
}

if (!$pdo) {
    echo json_encode(["success" => false, "data" => ["subjects" => []], "message" => "Database connection unavailable"]);
    exit;
}

try {
    $table_subs = get_dent2025_table($pdo, 'subjects');
    $table_links = get_dent2025_table($pdo, 'subject_links');

    $stmt = $pdo->prepare("SELECT * FROM {$table_subs} WHERE specialty = ? AND year = ? AND semester = ? ORDER BY created_at ASC");
    $stmt->execute([$specialty, $year, $semester]);
    $subjects = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Fetch links for all these subjects
    if (count($subjects) > 0) {
        $subjectIds = array_column($subjects, 'id');
        $placeholders = implode(',', array_fill(0, count($subjectIds), '?'));
        
        $stmtLinks = $pdo->prepare("SELECT * FROM {$table_links} WHERE subject_id IN ($placeholders) ORDER BY created_at DESC");
        $stmtLinks->execute($subjectIds);
        $allLinks = $stmtLinks->fetchAll(PDO::FETCH_ASSOC);
        
        $linksBySubject = [];
        foreach ($allLinks as $link) {
            $linksBySubject[$link['subject_id']][] = $link;
        }
        
        foreach ($subjects as &$sub) {
            $sub['links'] = $linksBySubject[$sub['id']] ?? [];
        }
        unset($sub);
    }

    echo json_encode([
        "success" => true,
        "data" => [
            "subjects" => $subjects
        ]
    ]);
} catch (Throwable $e) {
    error_log('api_data query error: ' . $e->getMessage());
    echo json_encode(["success" => false, "message" => "Database error occurred"]);
}
?>

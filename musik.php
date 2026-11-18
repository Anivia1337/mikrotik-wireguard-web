<?php
// /vpn/musik.php - Liste der Dateien in musik/ fuer den Mini-Player.
// Einfach MP3s in den Ordner legen; Dateiname "Kuenstler - Titel.mp3" wird
// so angezeigt, Pixabay-Namen ("artist-titel-123456.mp3") gehen auch.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');
$dateien = glob(__DIR__ . '/musik/*.{mp3,ogg,opus,m4a,wav}', GLOB_BRACE) ?: [];
$namen = array_map('basename', $dateien);
natcasesort($namen);
echo json_encode(array_values($namen), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

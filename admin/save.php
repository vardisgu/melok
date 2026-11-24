<?php
// Сохранение изменений из редактора сайта «Мелок».
//
// Меняет только index.html и PDF-файлы в папке files/ рядом с сайтом.
// Прежняя версия страницы при каждом сохранении уходит в admin/backups/ (хранятся последние 30).
// Вход — по паролю из config.php (образец — config.sample.php).
// Если пароль задан, он нужен всегда. Пока пароля нет, сохранять можно только на компьютере разработчика
// (встроенный сервер PHP, php -S); на настоящем хостинге без пароля сохранение выключено.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function out($code, $data) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function fail($code, $msg) { out($code, array('ok' => false, 'error' => $msg)); }

$site = dirname(__DIR__);                                   // папка сайта: admin/ лежит внутри неё
$ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
$dev = PHP_SAPI === 'cli-server' && in_array($ip, array('127.0.0.1', '::1'), true);     // предпросмотр на компьютере разработчика
$config = is_file(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : array();
$hash = (is_array($config) && isset($config['password_hash'])) ? (string) $config['password_hash'] : '';
$mode = $hash !== '' ? 'password' : (($dev && !getenv('MELOK_REQUIRE_PASSWORD')) ? 'local' : 'locked');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    out(200, array('ok' => true, 'mode' => $mode, 'dev' => $dev, 'writable' => is_writable($site . '/index.html') && is_writable($site)));
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Метод не поддерживается');

// запросы принимаются только от самого редактора на этом же сайте
if (!isset($_SERVER['HTTP_X_MELOK']) || $_SERVER['HTTP_X_MELOK'] !== '1') fail(400, 'Запрос пришёл не из редактора');
if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && $_SERVER['HTTP_SEC_FETCH_SITE'] !== 'same-origin') fail(403, 'Запрос пришёл с другого сайта');

if ($mode === 'locked') fail(403, 'Сохранение выключено: на сервере не задан пароль (файл admin/config.php)');

$backups = __DIR__ . '/backups';
if (!is_dir($backups)) { @mkdir($backups, 0755); @file_put_contents($backups . '/.htaccess', "Require all denied\n"); }

if ($mode === 'password') {
    // не больше 8 неверных попыток за 15 минут с одного адреса
    $log = $backups . '/.attempts'; $now = time();
    $tries = is_file($log) ? json_decode((string) @file_get_contents($log), true) : array();
    if (!is_array($tries)) $tries = array();
    $mine = array();
    foreach ((isset($tries[$ip]) && is_array($tries[$ip]) ? $tries[$ip] : array()) as $t) if ($t > $now - 900) $mine[] = $t;
    if (count($mine) >= 8) fail(429, 'Слишком много попыток. Подождите 15 минут.');
    $given = isset($_SERVER['HTTP_X_MELOK_PASSWORD']) ? rawurldecode((string) $_SERVER['HTTP_X_MELOK_PASSWORD']) : '';
    if (!password_verify($given, $hash)) {
        $mine[] = $now; $tries[$ip] = $mine;
        @file_put_contents($log, json_encode($tries), LOCK_EX);
        usleep(400000);
        fail(401, 'Неверный пароль');
    }
}

// если запрос больше, чем разрешает сервер, PHP молча отбрасывает его содержимое
if (empty($_POST) && empty($_FILES) && isset($_SERVER['CONTENT_LENGTH']) && (int) $_SERVER['CONTENT_LENGTH'] > 0) {
    fail(413, 'Файл больше, чем разрешает сервер (' . ini_get('post_max_size') . ')');
}

$action = isset($_POST['action']) ? (string) $_POST['action'] : 'save';
if ($action === 'login') out(200, array('ok' => true));

$path = isset($_POST['path']) ? (string) $_POST['path'] : '';
if ($path === 'index.html') $max = 3 * 1024 * 1024;
elseif (preg_match('~^files/[a-z0-9][a-z0-9._-]{0,80}\.pdf$~', $path)) $max = 40 * 1024 * 1024;
else fail(400, 'Этот файл менять нельзя');

$file = isset($_FILES['file']) ? $_FILES['file'] : null;
if (!$file || !isset($file['error'])) fail(400, 'Файл не получен');
if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE) fail(413, 'Файл больше, чем разрешает сервер (' . ini_get('upload_max_filesize') . ')');
if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) fail(400, 'Файл не получен');
if ($file['size'] > $max) fail(413, 'Файл слишком большой');
$data = file_get_contents($file['tmp_name']);
if ($data === false || $data === '') fail(400, 'Файл пустой');

if ($path === 'index.html') {
    // это должна быть именно страница сайта, а не что-то другое
    if (stripos(ltrim($data), '<!doctype html') !== 0 || strpos($data, 'id="top"') === false || strpos($data, '</html>') === false) {
        fail(400, 'Это не похоже на страницу сайта');
    }
    if (is_file($site . '/index.html')) @copy($site . '/index.html', $backups . '/index-' . date('Ymd-His') . sprintf('-%03d', (int) floor(fmod(microtime(true), 1) * 1000)) . '.html');
    $old = glob($backups . '/index-*.html');
    if (is_array($old)) { sort($old); foreach (array_slice($old, 0, max(0, count($old) - 30)) as $f) @unlink($f); }
} else {
    if (strncmp($data, '%PDF-', 5) !== 0) fail(400, 'Нужен файл в формате PDF');
    if (!is_dir($site . '/files') && !@mkdir($site . '/files', 0755)) fail(500, 'Не удалось создать папку files');
}

// запись через временный файл: страница никогда не окажется записанной наполовину
$tmp = $site . '/' . $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
if (@file_put_contents($tmp, $data, LOCK_EX) === false || !@rename($tmp, $site . '/' . $path)) {
    @unlink($tmp);
    fail(500, 'Не удалось записать файл: проверьте права на папку сайта');
}
out(200, array('ok' => true, 'path' => $path, 'bytes' => strlen($data)));

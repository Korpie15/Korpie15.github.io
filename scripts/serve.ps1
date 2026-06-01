$port = 8000
$prefix = "http://localhost:$port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
    Write-Output "Serving $PWD at $prefix"
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $resp = $context.Response
        $localPath = $req.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($localPath)) { $localPath = 'index.html' }
        $fullPath = Join-Path $PWD $localPath
        if (Test-Path $fullPath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            $resp.ContentLength64 = $bytes.Length
            $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
            switch ($ext) {
                ".html" { $resp.ContentType = "text/html" }
                ".htm"  { $resp.ContentType = "text/html" }
                ".css"  { $resp.ContentType = "text/css" }
                ".js"   { $resp.ContentType = "application/javascript" }
                ".json" { $resp.ContentType = "application/json" }
                ".png"  { $resp.ContentType = "image/png" }
                ".jpg"  { $resp.ContentType = "image/jpeg" }
                ".jpeg" { $resp.ContentType = "image/jpeg" }
                ".gif"  { $resp.ContentType = "image/gif" }
                default { $resp.ContentType = "application/octet-stream" }
            }
            $resp.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $resp.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $resp.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        $resp.OutputStream.Close()
    }
} finally {
    if ($listener -and $listener.IsListening) { $listener.Stop(); $listener.Close() }
}

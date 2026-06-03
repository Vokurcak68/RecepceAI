# Záloha PostgreSQL databáze receptionai (custom formát pro pg_restore) + rotace.
# Spouští se naplánovanou úlohou (deploy\backup-install-task.ps1) každý den.
#   Ruční spuštění:  powershell -ExecutionPolicy Bypass -File deploy\backup-db.ps1
$ErrorActionPreference = "Stop"

$pgDump   = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
$envFile  = "C:\ReceptionAI\.env"
$backupDir = "C:\ReceptionAI\backups"
$keep = 30   # ponechat posledních N záloh

if (-not (Test-Path $pgDump)) { throw "pg_dump nenalezen: $pgDump" }
New-Item -ItemType Directory -Force $backupDir | Out-Null

# DATABASE_URL z .env (odřízni ?schema=… — pg_dump ho nezná)
$line = (Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1).Line
$url = ($line -replace '^\s*DATABASE_URL\s*=', '' -replace '^"', '' -replace '"$', '') -replace '\?.*$', ''
if (-not $url) { throw "DATABASE_URL nenalezen v .env" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $backupDir "receptionai-$stamp.dump"

& $pgDump --dbname=$url --format=custom --compress=6 --file=$out
if ($LASTEXITCODE -ne 0) { throw "pg_dump selhal (kód $LASTEXITCODE)" }

$size = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host "$(Get-Date -Format o)  záloha OK: $out ($size MB)"

# Rotace — smaž nejstarší nad limit
Get-ChildItem $backupDir -Filter "receptionai-*.dump" |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip $keep | Remove-Item -Force

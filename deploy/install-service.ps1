# Nainstaluje (nebo přeinstaluje) backend Node API jako Windows službu přes NSSM.
# Spouštěj v PowerShellu JAKO SPRÁVCE.
#
#   .\deploy\install-service.ps1 -Nssm "C:\tools\nssm\nssm.exe"
#
# Po změně .env: .\deploy\install-service.ps1 ... -RestartOnly
param(
  [string]$Nssm = "C:\tools\nssm\nssm.exe",
  [string]$ServiceName = "ReceptionAI-API",
  [string]$Root = (Resolve-Path "$PSScriptRoot\.."),
  [switch]$RestartOnly
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path $Nssm)) { throw "NSSM nenalezen na '$Nssm'. Stáhni z https://nssm.cc a předej -Nssm <cesta>." }

if ($RestartOnly) {
  & $Nssm restart $ServiceName
  Write-Host "Služba $ServiceName restartována." -ForegroundColor Green
  return
}

$node = (Get-Command node -ErrorAction Stop).Source
$tsx  = Join-Path $Root "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsx)) { throw "tsx nenalezen ($tsx). Spusť nejdřív 'npm install' v $Root." }
if (-not (Test-Path (Join-Path $Root ".env"))) { Write-Warning "POZOR: $Root\.env neexistuje — API se bez něj nerozjede." }

New-Item -ItemType Directory -Force (Join-Path $Root "logs") | Out-Null

# Když služba existuje, odeber a vytvoř znovu (čistý stav)
$exists = (& $Nssm status $ServiceName) 2>$null
if ($LASTEXITCODE -eq 0) { & $Nssm stop $ServiceName 2>$null; & $Nssm remove $ServiceName confirm }

& $Nssm install $ServiceName $node "`"$tsx`" src\server.ts"
& $Nssm set $ServiceName AppDirectory $Root
& $Nssm set $ServiceName AppStdout (Join-Path $Root "logs\api.out.log")
& $Nssm set $ServiceName AppStderr (Join-Path $Root "logs\api.err.log")
& $Nssm set $ServiceName AppRotateFiles 1
& $Nssm set $ServiceName AppRotateBytes 10485760
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm start $ServiceName

Start-Sleep -Seconds 3
try {
  $h = Invoke-RestMethod "http://localhost:4000/health" -TimeoutSec 10
  Write-Host "OK — /health: $($h | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
  Write-Warning "API zatím neodpovídá na /health. Zkontroluj logs\api.err.log."
}

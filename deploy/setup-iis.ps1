# Založí 3 IIS weby (kiosk/admin/guest) na subdoménách a zkopíruje web.config
# (reverse proxy /api + SPA fallback) do každé dist složky.
# Spouštěj v PowerShellu JAKO SPRÁVCE. Předpoklady: IIS, URL Rewrite, ARR (+Enable proxy),
# a frontendy už zbuildované (deploy\build-frontends.ps1).
#
#   .\deploy\setup-iis.ps1 -KioskHost kiosk.tvojedomena.cz -AdminHost admin.tvojedomena.cz -GuestHost host.tvojedomena.cz
#
# HTTPS (443) NEŘEŠÍ — po tomhle spusť win-acme (wacs.exe) a vyber tyto weby pro cert.
param(
  [Parameter(Mandatory=$true)][string]$KioskHost,
  [Parameter(Mandatory=$true)][string]$AdminHost,
  [Parameter(Mandatory=$true)][string]$GuestHost,
  [string]$Root = (Resolve-Path "$PSScriptRoot\..")
)
$ErrorActionPreference = "Stop"
Import-Module WebAdministration

$tpl = Join-Path $PSScriptRoot "web.config"
if (-not (Test-Path $tpl)) { throw "Chybí šablona $tpl" }

# Ověř, že je ARR proxy zapnutá (jinak rewrite na localhost:4000 nefunguje)
try {
  $proxy = (Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -ErrorAction Stop).Value
  if (-not $proxy) { Write-Warning "ARR proxy je VYPNUTÁ. Zapni: IIS Manager -> server -> Application Request Routing Cache -> Server Proxy Settings -> Enable proxy." }
} catch { Write-Warning "Nelze ověřit ARR proxy (je ARR nainstalované?). Zkontroluj ručně 'Enable proxy'." }

$sites = @(
  @{ Name = "ReceptionAI-Kiosk"; Host = $KioskHost; Path = Join-Path $Root "kiosk\dist" },
  @{ Name = "ReceptionAI-Admin"; Host = $AdminHost; Path = Join-Path $Root "admin\dist" },
  @{ Name = "ReceptionAI-Guest"; Host = $GuestHost; Path = Join-Path $Root "guest\dist" }
)

foreach ($s in $sites) {
  if (-not (Test-Path $s.Path)) { throw "Dist neexistuje: $($s.Path). Spusť nejdřív deploy\build-frontends.ps1." }
  Copy-Item $tpl (Join-Path $s.Path "web.config") -Force
  if (Get-Website -Name $s.Name -ErrorAction SilentlyContinue) {
    Set-ItemProperty "IIS:\Sites\$($s.Name)" -Name physicalPath -Value $s.Path
    Write-Host "Web $($s.Name) už existuje — aktualizována cesta + web.config." -ForegroundColor Yellow
  } else {
    New-WebSite -Name $s.Name -PhysicalPath $s.Path -HostHeader $s.Host -Port 80 | Out-Null
    Write-Host "Vytvořen web $($s.Name) -> http://$($s.Host) ($($s.Path))" -ForegroundColor Green
  }
}

Write-Host "`nHotovo. Dál: 1) DNS A-záznamy pro tyto hostnames na veřejnou IP serveru," -ForegroundColor Cyan
Write-Host "         2) firewall 80/443, 3) win-acme (wacs.exe) pro HTTPS certifikáty." -ForegroundColor Cyan

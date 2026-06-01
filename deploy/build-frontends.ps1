# Zbuilduje všechny tři frontendy do jejich dist\ složek.
# VITE_GUEST_URL se zapéká do admin buildu (odkaz na portál hosta).
#
#   .\deploy\build-frontends.ps1 -GuestUrl "https://host.tvojedomena.cz"
param(
  [Parameter(Mandatory=$true)][string]$GuestUrl,
  [string]$Root = (Resolve-Path "$PSScriptRoot\.."),
  [ValidateSet("all","admin","kiosk","guest")][string]$Only = "all"
)
$ErrorActionPreference = "Stop"
Push-Location $Root
try {
  if ($Only -in @("all","kiosk")) { Write-Host "== build kiosk ==" -ForegroundColor Cyan; npm run build --prefix kiosk }
  if ($Only -in @("all","guest")) { Write-Host "== build guest ==" -ForegroundColor Cyan; npm run build --prefix guest }
  if ($Only -in @("all","admin")) {
    Write-Host "== build admin (VITE_GUEST_URL=$GuestUrl) ==" -ForegroundColor Cyan
    $env:VITE_GUEST_URL = $GuestUrl
    npm run build --prefix admin
  }
  Write-Host "Hotovo. Dist: admin\dist, kiosk\dist, guest\dist" -ForegroundColor Green
} finally { Pop-Location }

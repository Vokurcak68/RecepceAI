# Zaregistruje naplánovanou úlohu „ReceptionAI-Backup" — denní záloha DB ve 3:00.
# Spustit JEDNOU jako správce:  powershell -ExecutionPolicy Bypass -File deploy\backup-install-task.ps1
$ErrorActionPreference = "Stop"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\ReceptionAI\deploy\backup-db.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00am
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "ReceptionAI-Backup" -Action $action -Trigger $trigger -Principal $principal -Description "Denni zaloha PostgreSQL DB receptionai (deploy\backup-db.ps1)" -Force | Out-Null
Write-Host "Uloha ReceptionAI-Backup zaregistrovana (denne 3:00, SYSTEM)."

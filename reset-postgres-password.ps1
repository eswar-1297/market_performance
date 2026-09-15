# Sets a new password for the PostgreSQL "postgres" account on this machine,
# for when nobody remembers the one chosen at install time.
#
# Run in an ADMIN PowerShell, from this folder:
#     powershell -ExecutionPolicy Bypass -File .\reset-postgres-password.ps1
#
# What it does, and puts back:
#   1. stops the PostgreSQL service
#   2. backs up pg_hba.conf, then lets local connections in without a password
#   3. starts the service, sets the new password, stops it again
#   4. restores pg_hba.conf from the backup and starts the service
#
# Nothing in the databases is touched.

$ErrorActionPreference = 'Stop'

$pgRoot  = 'C:\Program Files\PostgreSQL\17'
$service = 'postgresql-x64-17'
$hbaPath = Join-Path $pgRoot 'data\pg_hba.conf'
$psql    = Join-Path $pgRoot 'bin\psql.exe'

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host "This needs an admin PowerShell (right-click PowerShell, Run as administrator)." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $hbaPath)) {
    Write-Host "Could not find $hbaPath - edit pgRoot at the top of this script." -ForegroundColor Red
    exit 1
}

$secure = Read-Host "New password for the 'postgres' account" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
if ([string]::IsNullOrWhiteSpace($plain)) {
    Write-Host "No password given - nothing changed." -ForegroundColor Red
    exit 1
}

$backup = "$hbaPath.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $hbaPath $backup
Write-Host "backed up pg_hba.conf to $backup"

try {
    Stop-Service $service
    Write-Host "stopped $service"

    # Let local connections in unauthenticated, just for the next few seconds.
    $hba = Get-Content $hbaPath
    $open = $hba | ForEach-Object {
        if ($_ -match '^\s*(local|host)\s') { $_ -replace '(scram-sha-256|md5|password)\s*$', 'trust' } else { $_ }
    }
    Set-Content -Path $hbaPath -Value $open -Encoding ascii

    Start-Service $service
    Start-Sleep -Seconds 2
    Write-Host "started $service with local trust"

    $escaped = $plain.Replace("'", "''")
    & $psql -U postgres -h localhost -d postgres -c "ALTER USER postgres WITH PASSWORD '$escaped';" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not set the password" }
    Write-Host "password set"
}
finally {
    # Always put the original rules back, whatever happened above.
    Stop-Service $service -ErrorAction SilentlyContinue
    Copy-Item $backup $hbaPath -Force
    Start-Service $service
    Start-Sleep -Seconds 2
    Write-Host "restored pg_hba.conf and restarted $service"
}

Write-Host ""
Write-Host "Now run, in a normal PowerShell:" -ForegroundColor Green
Write-Host "    powershell -ExecutionPolicy Bypass -File .\setup-db.ps1" -ForegroundColor Green
Write-Host "and give it the password you just set." -ForegroundColor Green

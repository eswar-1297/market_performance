# Points the tracker at a database and writes server\.env.
#
# Against the PostgreSQL installed on this machine (creates the database too):
#     powershell -ExecutionPolicy Bypass -File .\setup-db.ps1
#
# Against a database somewhere else — Render, Neon, Supabase — paste its
# connection string at the prompt:
#     powershell -ExecutionPolicy Bypass -File .\setup-db.ps1 -Remote
#
# Either way the password is only ever written into server\.env, which git
# ignores, and a fresh JWT secret is generated alongside it.

param(
    [switch]$Remote
)

$ErrorActionPreference = 'Stop'

function Write-EnvFile($connectionString) {
    $chars = (48..57) + (65..90) + (97..122)
    $secret = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    $lines = @()
    $lines += "DATABASE_URL=$connectionString"
    $lines += "JWT_SECRET=$secret"
    $envPath = Join-Path $PSScriptRoot 'server\.env'
    # Plain UTF-8, no byte order mark: Node reads .env byte for byte, and a BOM
    # would end up glued to the first key name.
    [IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding $false))
    Write-Host "wrote $envPath"
    Write-Host ""
    Write-Host "Done. Tell Claude it is set up - it will create the tables, seed the" -ForegroundColor Green
    Write-Host "teams and columns, and import your old sheet." -ForegroundColor Green
}

if ($Remote) {
    Write-Host "Paste the database connection string (it looks like"
    Write-Host "postgres://user:password@host/dbname). It stays hidden as you paste."
    $secureUrl = Read-Host "Connection string" -AsSecureString
    $bstrUrl = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    $url = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstrUrl).Trim()
    if (-not $url.StartsWith('postgres')) {
        Write-Host "That does not look like a postgres:// connection string." -ForegroundColor Red
        exit 1
    }
    Write-EnvFile $url
    exit 0
}

$pgBin  = 'C:\Program Files\PostgreSQL\17\bin'
$dbUser = 'postgres'
$dbName = 'marketing'
$dbHost = 'localhost'
$dbPort = '5432'

$psql = Join-Path $pgBin 'psql.exe'
$createdb = Join-Path $pgBin 'createdb.exe'

if (-not (Test-Path $psql)) {
    Write-Host "Could not find psql at $pgBin - edit the pgBin line at the top of this script." -ForegroundColor Red
    exit 1
}

$secure = Read-Host "PostgreSQL password for user '$dbUser'" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
$env:PGPASSWORD = $plain

# --- 1. the database -------------------------------------------------------

$check = "SELECT 1 FROM pg_database WHERE datname = '$dbName'"
$exists = & $psql -U $dbUser -h $dbHost -p $dbPort -d postgres -t -A -c $check 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not connect to PostgreSQL:" -ForegroundColor Red
    Write-Host $exists -ForegroundColor Red
    $env:PGPASSWORD = ''
    exit 1
}

if ("$exists".Trim() -eq '1') {
    Write-Host "database '$dbName' is already there"
} else {
    & $createdb -U $dbUser -h $dbHost -p $dbPort $dbName
    if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = ''; exit 1 }
    Write-Host "created database '$dbName'"
}

# --- 2. server\.env --------------------------------------------------------

# The password goes into a URL, so anything exotic in it has to be escaped.
$escaped = [uri]::EscapeDataString($plain)
$env:PGPASSWORD = ''
Write-EnvFile "postgres://${dbUser}:${escaped}@${dbHost}:${dbPort}/${dbName}"

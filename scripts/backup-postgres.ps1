param(
  [string]$OutputDirectory = ".\\backups"
)
$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "Set DATABASE_URL to the PostgreSQL connection URI first." }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $OutputDirectory "suhooltech-$stamp.dump"
& pg_dump "$env:DATABASE_URL" --format=custom --no-owner --no-acl --file "$file"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }
Write-Host "Backup created: $file"
Write-Warning "Keep VAULT_ENCRYPTION_KEY backed up separately and securely. A database dump alone cannot recover encrypted vault values."

param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [Parameter(Mandatory = $true)]
  [string]$TargetDatabaseUrl,
  [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"

if (-not $ConfirmRestore) {
  throw "Restore is destructive. Review the target database, then rerun with -ConfirmRestore."
}
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
  throw "Backup file not found: $BackupFile"
}
$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
if ((Get-Item -LiteralPath $resolvedBackup).Length -lt 1024) {
  throw "Backup file is unexpectedly small; refusing to restore."
}
if ([string]::IsNullOrWhiteSpace($TargetDatabaseUrl)) {
  throw "TargetDatabaseUrl is required."
}

Write-Host "Target database: $TargetDatabaseUrl"
Write-Host "Backup archive: $resolvedBackup"
$confirmation = Read-Host "Type RESTORE to apply this backup to the target database"
if ($confirmation -cne "RESTORE") {
  throw "Restore cancelled."
}

& pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname "$TargetDatabaseUrl" "$resolvedBackup"
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore failed. Review the PostgreSQL error output; no later steps were run."
}

Write-Host "Restore command completed successfully."
Write-Warning "Verify application login, key business records, and VAULT_ENCRYPTION_KEY separately before returning the restored database to service."

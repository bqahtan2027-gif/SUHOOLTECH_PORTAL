$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "Set DATABASE_URL to the PostgreSQL connection URI first." }
$root = Split-Path -Parent $PSScriptRoot
$migrations = @(
  "001_core.sql",
  "002_projects_dashboard.sql",
  "003_quotes.sql",
  "004_hr.sql",
  "005_documents.sql",
  "006_admin_services.sql",
  "007_calendar.sql",
  "008_vault.sql",
  "009_inventory.sql",
  "010_finance.sql",
  "011_zatca.sql",
  "012_enterprise_modules.sql",
  "013_goods_receipts.sql",
  "014_supplier_invoices.sql",
  "015_sales_workflow.sql",
  "016_customer_receipts.sql",
  "017_sales_credit_notes.sql",
  "018_sales_cost_accounting.sql",
  "019_customer_credit_refunds.sql",
  "020_supplier_payments.sql",
  "021_zatca_connection_settings.sql"
)
foreach ($migration in $migrations) {
  $file = Join-Path $root "database/init/$migration"
  if (-not (Test-Path $file)) { throw "Missing migration: $file" }
  Write-Host "Applying $migration ..."
  & psql "$env:DATABASE_URL" --set ON_ERROR_STOP=1 --file "$file"
  if ($LASTEXITCODE -ne 0) { throw "Migration failed: $migration. Stop here; do not skip it." }
}
Write-Host "All 21 migrations applied successfully."

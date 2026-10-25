param([string]$MailpitPath = 'C:\Tools\Mailpit\mailpit.exe')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $MailpitPath -PathType Leaf)) {
    throw 'Mailpit was not found. Download the Windows binary from the official Mailpit releases and supply -MailpitPath.'
}
# Inspect names only; never print relay/forwarding credentials or their values.
$relayVariables = Get-ChildItem Env: | Where-Object { $_.Name -match '^MP_(SMTP_(RELAY|FORWARD)|FORWARD_TO)' }
if ($relayVariables) { throw 'Remove Mailpit relay/forwarding environment settings from this terminal before starting local capture.' }
$artifactPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\apps\web\artifacts'))
New-Item -ItemType Directory -Path $artifactPath -Force | Out-Null
$databasePath = Join-Path $artifactPath 'mailpit.db'
# Mailpit is foreground-only here; Ctrl+C stops it. Neither PostgreSQL DB is touched.
& $MailpitPath --smtp '127.0.0.1:1025' --listen '127.0.0.1:8025' `
    --database $databasePath --max 0 --disable-version-check --smtp-disable-rdns `
    --allowed-hosts 'localhost,127.0.0.1' `
    --smtp-allowed-recipients '^watchtower\+[0-9a-f-]{36}@example\.test$'
if ($LASTEXITCODE -ne 0) { throw 'Mailpit stopped with an error; check your installed version and local ports.' }

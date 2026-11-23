$ErrorActionPreference = 'Stop'

$composeArgs = @(
  'compose',
  '--env-file', '.env.prod.local',
  '-f', 'docker-compose.yml',
  '-f', 'docker-compose.prod.yml',
  '-f', 'docker-compose.prod-local.yml',
  'exec', '-T', 'caddy',
  'cat', '/data/caddy/pki/authorities/local/root.crt'
)

$root = Join-Path $env:TEMP 'caddy-local-root.crt'
docker @composeArgs | Set-Content -Encoding ascii $root

& certutil.exe -addstore Root $root
if ($LASTEXITCODE -ne 0) {
  throw "Cannot install Caddy local root certificate."
}

Write-Output 'Caddy local root certificate trusted in Windows.'

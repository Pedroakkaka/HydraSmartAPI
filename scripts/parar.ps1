# HydraSmart — desliga a API, o painel e o banco de dados (os dados gravados são mantidos).

. (Join-Path $PSScriptRoot 'comum.ps1')

Escrever-Passo 'Desligando a API e o painel'
$nomes = @{ 3333 = 'API'; 4173 = 'Painel' }
foreach ($porta in 3333, 4173) {
  $pids = @(Processos-NodeNaPorta $porta)
  if (-not $pids.Count) {
    Escrever-Ok "$($nomes[$porta]) já estava desligado"
    continue
  }
  foreach ($id in $pids) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    Escrever-Ok "$($nomes[$porta]) desligado (processo $id)"
  }
}
# Fecha as janelas do PowerShell abertas pelo iniciar.ps1
Get-Process powershell -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -like 'HydraSmart*' } |
  Stop-Process -Force -ErrorAction SilentlyContinue

Escrever-Passo 'Desligando o banco de dados'
if (Docker-Respondendo) {
  Push-Location $PastaApi
  try {
    $ErrorActionPreference = 'Continue'
    & docker compose stop db
  } finally {
    Pop-Location
  }
  Escrever-Ok 'Banco desligado (dados preservados)'
} else {
  Escrever-Aviso 'Docker não está rodando — nada a desligar.'
}

Write-Host ''
Write-Host 'HydraSmart desligado.' -ForegroundColor Green
Start-Sleep -Seconds 4

# HydraSmart — liga o sistema completo (banco, API e painel) e abre o navegador.

. (Join-Path $PSScriptRoot 'comum.ps1')

Write-Host '=============================================================' -ForegroundColor Cyan
Write-Host '   HydraSmart — Iniciando o sistema' -ForegroundColor Cyan
Write-Host '=============================================================' -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $PastaApi 'node_modules')) -or -not (Test-Path (Join-Path $PastaFront 'node_modules'))) {
  Parar-ComErro 'O sistema ainda não foi instalado neste computador. Rode primeiro INSTALAR-HYDRASMART.bat.'
}

$chaveOperador = Garantir-ChaveOperador

Garantir-Docker
Subir-Banco

Escrever-Passo 'Ligando a API (janela "HydraSmart API")'
if (Aguardar-Url $UrlApi 1) {
  Escrever-Aviso 'A API já estava rodando — mantida.'
} else {
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $PastaApi -ArgumentList @(
    '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command',
    "`$Host.UI.RawUI.WindowTitle = 'HydraSmart API (nao feche esta janela)'; npm.cmd start"
  )
  if (-not (Aguardar-Url $UrlApi 60)) {
    Parar-ComErro 'A API não respondeu em 60 segundos. Veja a mensagem de erro na janela "HydraSmart API".'
  }
}
Escrever-Ok 'API no ar em http://localhost:3333 (documentação em /docs)'

Escrever-Passo 'Ligando o painel (janela "HydraSmart Painel")'
if (Aguardar-Url $UrlPainelTeste 1) {
  Escrever-Aviso 'O painel já estava rodando — mantido.'
} else {
  if (-not (Test-Path (Join-Path $PastaFront 'dist\index.html'))) {
    Executar-Npm $PastaFront @('run', 'build')
  }
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $PastaFront -ArgumentList @(
    '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command',
    "`$Host.UI.RawUI.WindowTitle = 'HydraSmart Painel (nao feche esta janela)'; npm.cmd run preview"
  )
  if (-not (Aguardar-Url $UrlPainelTeste 40)) {
    Parar-ComErro 'O painel não respondeu. Veja a mensagem de erro na janela "HydraSmart Painel".'
  }
}
Escrever-Ok "Painel no ar em $UrlPainel"

# Endereço para abrir o painel em outro aparelho da mesma rede (TV, tablet, celular)
# (adaptador com saída para a internet; ignora adaptadores virtuais do Docker/WSL)
$ipRede = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1 | ForEach-Object { $_.IPv4Address.IPAddress } | Select-Object -First 1

Start-Process $UrlPainel

Write-Host ''
Write-Host '=============================================================' -ForegroundColor Green
Write-Host '   HydraSmart rodando!' -ForegroundColor Green
Write-Host "   Neste computador:   $UrlPainel" -ForegroundColor Green
if ($ipRede) {
  Write-Host "   Em outro aparelho:  http://${ipRede}:4173  (mesma rede Wi-Fi)" -ForegroundColor Green
}
if ($chaveOperador) { Write-Host "   Chave do operador:  $chaveOperador  (pedida pelo painel nas ações de operador)" -ForegroundColor Green }
Write-Host '   Para desligar: PARAR-HYDRASMART.bat' -ForegroundColor Green
Write-Host '=============================================================' -ForegroundColor Green
Write-Host ''
Write-Host 'Esta janela pode ser fechada. NÃO feche as janelas "HydraSmart API" e "HydraSmart Painel".'
Start-Sleep -Seconds 8

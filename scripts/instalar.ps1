# HydraSmart — instalação completa em um computador novo.
# Rode UMA vez (com internet). Depois use iniciar.ps1 (ou INICIAR-HYDRASMART.bat) para ligar o sistema.

. (Join-Path $PSScriptRoot 'comum.ps1')

Write-Host '=============================================================' -ForegroundColor Cyan
Write-Host '   HydraSmart — Instalação' -ForegroundColor Cyan
Write-Host '=============================================================' -ForegroundColor Cyan

Verificar-Programas

Escrever-Passo 'Conferindo os repositórios'
if (-not (Test-Path (Join-Path $PastaFront 'package.json'))) {
  Write-Host "    Baixando o painel (HydraSmartFront) em $PastaFront ..."
  $ErrorActionPreference = 'Continue'
  & git clone $RepoFront $PastaFront
  if ($LASTEXITCODE -ne 0) { Parar-ComErro 'Não foi possível baixar o HydraSmartFront. Verifique a internet e o acesso ao GitHub.' }
}
Escrever-Ok "API:    $PastaApi"
Escrever-Ok "Painel: $PastaFront"

Escrever-Passo 'Criando o arquivo de configuração (.env)'
$envApi = Join-Path $PastaApi '.env'
if (Test-Path $envApi) {
  Escrever-Ok '.env já existe (mantido)'
} else {
  Copy-Item (Join-Path $PastaApi '.env.example') $envApi
  Escrever-Ok '.env criado a partir do .env.example'
}

Escrever-Passo 'Instalando dependências da API (pode levar alguns minutos)'
Executar-Npm $PastaApi @('ci', '--no-audit', '--no-fund')
Escrever-Ok 'Dependências da API instaladas'

Escrever-Passo 'Instalando dependências do painel'
Executar-Npm $PastaFront @('ci', '--no-audit', '--no-fund')
Escrever-Ok 'Dependências do painel instaladas'

Garantir-Docker
Subir-Banco

Escrever-Passo 'Criando as tabelas do banco de dados'
Executar-Npm $PastaApi @('run', 'db:migrate')
Escrever-Ok 'Tabelas criadas'

Escrever-Passo 'Gerando a versão otimizada do painel'
Executar-Npm $PastaFront @('run', 'build')
Escrever-Ok 'Painel pronto'

Escrever-Passo 'Conferindo o sistema (testes automáticos da API)'
Executar-Npm $PastaApi @('test')
Escrever-Ok 'Testes aprovados'

Write-Host ''
Write-Host '=============================================================' -ForegroundColor Green
Write-Host '   Instalação concluída!' -ForegroundColor Green
Write-Host '   Para ligar o sistema: dois cliques em INICIAR-HYDRASMART.bat' -ForegroundColor Green
Write-Host '=============================================================' -ForegroundColor Green
Write-Host ''
Read-Host 'Pressione ENTER para fechar'

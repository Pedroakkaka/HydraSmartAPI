# Funções compartilhadas pelos scripts de instalação e inicialização do HydraSmart.
# Compatível com o Windows PowerShell 5.1 (já vem no Windows 10/11).

$ErrorActionPreference = 'Stop'

$Script:PastaApi = Split-Path $PSScriptRoot -Parent
$Script:PastaRaiz = Split-Path $PastaApi -Parent
$Script:PastaFront = Join-Path $PastaRaiz 'HydraSmartFront'
$Script:RepoFront = 'https://github.com/Pedroakkaka/HydraSmartFront.git'
# 127.0.0.1 em vez de localhost: no PowerShell 5.1 "localhost" tenta IPv6 primeiro e estoura o tempo.
$Script:UrlApi = 'http://127.0.0.1:3333/api/v1/health'
$Script:UrlPainelTeste = 'http://127.0.0.1:4173'
$Script:UrlPainel = 'http://localhost:4173'
$Script:ContainerBanco = 'hydrasmart-api-db-1'

function Escrever-Passo([string]$texto) {
  Write-Host ''
  Write-Host "==> $texto" -ForegroundColor Cyan
}

function Escrever-Ok([string]$texto) {
  Write-Host "    [OK] $texto" -ForegroundColor Green
}

function Escrever-Aviso([string]$texto) {
  Write-Host "    [!] $texto" -ForegroundColor Yellow
}

function Parar-ComErro([string]$texto) {
  Write-Host ''
  Write-Host "    [ERRO] $texto" -ForegroundColor Red
  Write-Host ''
  Read-Host 'Pressione ENTER para fechar'
  exit 1
}

function Comando-Existe([string]$nome) {
  return [bool](Get-Command $nome -ErrorAction SilentlyContinue)
}

function Verificar-Programas {
  Escrever-Passo 'Verificando programas necessários'

  if (-not (Comando-Existe 'node')) {
    Parar-ComErro 'Node.js não encontrado. Instale a versão LTS em https://nodejs.org e rode este script de novo.'
  }
  $versaoNode = (& node -v).TrimStart('v')
  if ([int]($versaoNode.Split('.')[0]) -lt 20) {
    Parar-ComErro "Node.js $versaoNode é antigo demais. Instale a versão LTS (20 ou mais nova) em https://nodejs.org"
  }
  Escrever-Ok "Node.js $versaoNode"

  if (-not (Comando-Existe 'git')) {
    Parar-ComErro 'Git não encontrado. Instale em https://git-scm.com/download/win e rode este script de novo.'
  }
  Escrever-Ok 'Git instalado'

  if (-not (Comando-Existe 'docker')) {
    Parar-ComErro 'Docker não encontrado. Instale o Docker Desktop em https://www.docker.com/products/docker-desktop e rode este script de novo.'
  }
  Escrever-Ok 'Docker instalado'
}

function Docker-Respondendo {
  $ErrorActionPreference = 'Continue'
  & docker info *> $null
  return ($LASTEXITCODE -eq 0)
}

function Garantir-Docker {
  Escrever-Passo 'Verificando o Docker Desktop'
  if (Docker-Respondendo) {
    Escrever-Ok 'Docker Desktop já está rodando'
    return
  }

  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $exe)) {
    Parar-ComErro 'Docker Desktop não está aberto. Abra o Docker Desktop pelo menu Iniciar e rode este script de novo.'
  }

  Write-Host '    Abrindo o Docker Desktop (pode levar até 2 minutos na primeira vez)...'
  Start-Process $exe
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 3
    if (Docker-Respondendo) {
      Escrever-Ok 'Docker Desktop pronto'
      return
    }
  }
  Parar-ComErro 'O Docker Desktop não respondeu. Abra-o manualmente, espere aparecer "Engine running" e rode de novo.'
}

function Subir-Banco {
  Escrever-Passo 'Iniciando o banco de dados (PostgreSQL no Docker)'
  Push-Location $PastaApi
  try {
    $ErrorActionPreference = 'Continue'
    & docker compose up -d db
    if ($LASTEXITCODE -ne 0) {
      Parar-ComErro 'Não foi possível iniciar o banco. Se a mensagem fala de porta ocupada, troque DB_PORT e a porta em DATABASE_URL no arquivo .env (ex.: 5434).'
    }
  } finally {
    Pop-Location
  }

  for ($i = 0; $i -lt 40; $i++) {
    $ErrorActionPreference = 'Continue'
    $saude = & docker inspect --format '{{.State.Health.Status}}' $ContainerBanco 2>$null
    if ($saude -eq 'healthy') {
      Escrever-Ok 'Banco de dados pronto'
      return
    }
    Start-Sleep -Seconds 2
  }
  Parar-ComErro 'O banco de dados não ficou pronto a tempo. Veja os detalhes com: docker compose logs db'
}

function Aguardar-Url([string]$url, [int]$segundos) {
  for ($i = 0; $i -lt $segundos; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -lt 500) { return $true }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

# PIDs de processos node.exe escutando na porta (a API usa 3333 e o painel 4173).
# Não usa o filtro -State porque ele vem vazio em algumas instalações do Windows.
function Processos-NodeNaPorta([int]$porta) {
  $pids = Get-NetTCPConnection -LocalPort $porta -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -gt 0 } |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($id in $pids) {
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') { $id }
  }
}

# Garante uma OPERATOR_API_KEY no .env da API (gera uma aleatória se estiver vazia ou ausente)
# e devolve o valor. O painel pede essa chave para ações de operador.
function Garantir-ChaveOperador {
  $arquivo = Join-Path $PastaApi '.env'
  if (-not (Test-Path $arquivo)) { return $null }
  $linhas = @(Get-Content -Path $arquivo -Encoding UTF8)
  $atual = $linhas | Where-Object { $_ -match '^\s*OPERATOR_API_KEY\s*=' } | Select-Object -First 1
  if ($atual) {
    $valor = ($atual -split '=', 2)[1].Trim()
    if ($valor) { return $valor }
  }

  $bytes = New-Object byte[] 9
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $nova = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').Replace('=', '')

  if ($atual) {
    $linhas = $linhas | ForEach-Object { if ($_ -match '^\s*OPERATOR_API_KEY\s*=') { "OPERATOR_API_KEY=$nova" } else { $_ } }
  } else {
    $linhas += ''
    $linhas += '# Chave do operador do painel (gerada automaticamente pelo instalador)'
    $linhas += "OPERATOR_API_KEY=$nova"
  }
  # .env em UTF-8 sem BOM (o Node lê sem problemas)
  [System.IO.File]::WriteAllLines($arquivo, [string[]]$linhas, (New-Object System.Text.UTF8Encoding($false)))
  return $nova
}

function Executar-Npm([string]$pasta, [string[]]$argumentos) {
  Push-Location $pasta
  try {
    $ErrorActionPreference = 'Continue'
    & npm.cmd @argumentos
    if ($LASTEXITCODE -ne 0) { Parar-ComErro "Falha ao rodar 'npm $($argumentos -join ' ')' em $pasta" }
  } finally {
    Pop-Location
  }
}

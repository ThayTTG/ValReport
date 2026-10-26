# ValReport · limpa as partidas antigas (docs/data) do histórico do GitHub
# Roda pelo Atalhos\limpar_historico_github.bat. Faz um backup completo antes e só segue depois que você digitar LIMPAR.
$ErrorActionPreference = "Continue"
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz

function Parar($texto) {
    Write-Host ""
    Write-Host $texto -ForegroundColor Red
    Read-Host "Aperte Enter para fechar"
    exit 1
}
function Conferir($etapa) {
    if ($LASTEXITCODE -ne 0) { Parar "Algo deu errado em: $etapa. Nada foi enviado ao GitHub depois disso. O backup continua guardado." }
}

Write-Host "=================================================================="
Write-Host " ValReport · limpar as partidas antigas do histórico do GitHub"
Write-Host "=================================================================="

git --version *> $null
if ($LASTEXITCODE -ne 0) { Parar "Não encontrei o Git neste PC." }
if (-not (Test-Path (Join-Path $raiz ".git"))) { Parar "Esta pasta não é o repositório do ValReport (falta a pasta .git)." }

$origem = (git remote get-url origin) 2>$null
if (-not $origem -or $origem -notmatch "ValReport") { Parar "O repositório remoto não parece ser o ValReport: $origem" }

$mudancas = git status --porcelain --untracked-files=no
if ($mudancas) { Parar "Há mudanças no código que ainda não foram publicadas. Rode o Atalhos\publicar_site.bat primeiro e depois este arquivo de novo." }

$antes = @(git log --all --oneline -- docs/data).Count
if ($antes -eq 0) {
    Write-Host ""
    Write-Host "O histórico já está limpo: nenhum commit guarda a pasta docs/data." -ForegroundColor Green
    Read-Host "Aperte Enter para fechar"
    exit 0
}

Write-Host ""
Write-Host "Encontrei $antes commit(s) com a pasta docs/data (as partidas antigas)."
Write-Host "O que vai acontecer:"
Write-Host "  1. Um backup completo do repositório é salvo ao lado da pasta do projeto."
Write-Host "  2. A pasta docs/data é apagada de todos os commits (o código fica igual)."
Write-Host "  3. O histórico novo substitui o antigo no GitHub."
Write-Host "Os arquivos do seu PC (dados, notas, config) não são tocados."
Write-Host ""
$ok = Read-Host "Para confirmar, digite LIMPAR"
if ($ok -cne "LIMPAR") { Parar "Cancelado. Nada foi mudado." }

$quando = Get-Date -Format "yyyy-MM-dd_HHmm"
$backup = Join-Path (Split-Path $raiz -Parent) "ValReport-backup-$quando.bundle"
Write-Host ""
Write-Host "1/4 Fazendo o backup em $backup ..."
git bundle create "$backup" --all
Conferir "backup"

Write-Host "2/4 Apagando docs/data do histórico (pode levar alguns minutos)..."
$env:FILTER_BRANCH_SQUELCH_WARNING = "1"
git filter-branch --force --index-filter "git rm -r --cached --ignore-unmatch --quiet docs/data" --prune-empty --tag-name-filter cat -- --all
Conferir "limpeza do histórico"
git for-each-ref --format="%(refname)" refs/original/ | ForEach-Object { git update-ref -d $_ }
git reflog expire --expire=now --all
git gc --prune=now --aggressive --quiet

$depois = @(git log --all --oneline -- docs/data).Count
if ($depois -ne 0) { Parar "Ainda sobraram $depois commit(s) com docs/data. Não enviei nada ao GitHub. Me mande um print desta tela." }

Write-Host "3/4 Enviando o histórico limpo para o GitHub..."
git push origin --force --all
Conferir "envio dos commits"
Write-Host "4/4 Enviando as tags..."
git push origin --force --tags
Conferir "envio das tags"

Write-Host ""
Write-Host "Pronto! As partidas antigas saíram do histórico do GitHub." -ForegroundColor Green
Write-Host "Backup guardado em: $backup"
Write-Host "(Se tudo estiver certo daqui a alguns dias, você pode apagar o backup.)"
Read-Host "Aperte Enter para fechar"

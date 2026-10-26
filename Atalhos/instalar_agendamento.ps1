# Cria (ou atualiza) as duas tarefas do ValReport no Agendador de Tarefas do Windows:
#   1. "NokyLabs - Report VALORANT": todo dia às 21h (report completo + Discord + site)
#   2. "NokyLabs - Atualizar site VALORANT": a cada 20 minutos, procura partidas novas e atualiza o site
#      (roda escondida, sem abrir janela; só publica quando acha partida nova)
# Rode com: botão direito > "Executar com o PowerShell"
# Se o PC estiver desligado às 21h, o dia é pulado e o próximo report avisa "N dias sem leitura".

$atalhos = Split-Path -Parent $MyInvocation.MyCommand.Path
$pasta  = Split-Path -Parent $atalhos   # pasta principal do projeto
$bat    = Join-Path $atalhos "rodar_report.bat"
$nome   = "NokyLabs - Report VALORANT"
$nomeR  = "NokyLabs - Atualizar site VALORANT"
$minutos = 20

if (-not (Test-Path $bat)) {
    Write-Host "Não encontrei o rodar_report.bat na pasta Atalhos." -ForegroundColor Red
    Read-Host "Enter para sair"; exit 1
}
if (-not [Environment]::GetEnvironmentVariable("HENRIKDEV_API_KEY", "User")) {
    Write-Host "Aviso: a variável HENRIKDEV_API_KEY não foi encontrada para o seu usuário." -ForegroundColor Yellow
}

# ---------- 1. Report diário das 21h ----------
$acao      = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $pasta
$gatilho   = New-ScheduledTaskTrigger -Daily -At "21:00"
$config    = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $config `
    -Description "Coleta as partidas do dia na HenrikDev API e gera o report .md" -Force | Out-Null
Write-Host "Pronto! A tarefa '$nome' vai rodar todo dia às 21:00." -ForegroundColor Green

# ---------- 2. Atualização do site a cada 20 minutos (sem janela) ----------
# pyw/pythonw rodam o Python sem abrir console; se não existirem, cai no py normal (abre uma janelinha rápida)
$semJanela = (Get-Command pyw.exe -ErrorAction SilentlyContinue).Source
$argsR = "-3 `"ferramentas\coletor_valorant.py`" --rapido"
if (-not $semJanela) {
    $semJanela = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
    $argsR = "`"ferramentas\coletor_valorant.py`" --rapido"
}
if ($semJanela) {
    $acaoR = New-ScheduledTaskAction -Execute $semJanela -Argument $argsR -WorkingDirectory $pasta
} else {
    Write-Host "Aviso: não achei o pyw.exe nem o pythonw.exe; a atualização vai abrir uma janela rápida a cada $minutos min." -ForegroundColor Yellow
    $acaoR = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c py -3 ferramentas\coletor_valorant.py --rapido" -WorkingDirectory $pasta
}
$inicio = (Get-Date).AddMinutes(2)
try {
    $gatilhoR = New-ScheduledTaskTrigger -Once -At $inicio -RepetitionInterval (New-TimeSpan -Minutes $minutos)
} catch {
    $gatilhoR = New-ScheduledTaskTrigger -Once -At $inicio -RepetitionInterval (New-TimeSpan -Minutes $minutos) `
                    -RepetitionDuration (New-TimeSpan -Days 3650)
}
$configR = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $nomeR -Action $acaoR -Trigger $gatilhoR -Settings $configR `
    -Description "Procura partidas novas a cada $minutos min e atualiza o site do ValReport (só publica quando há novidade)" -Force | Out-Null
Write-Host "Pronto! A tarefa '$nomeR' vai procurar partidas novas a cada $minutos minutos (enquanto o PC estiver ligado)." -ForegroundColor Green
Write-Host "Para pausar sem apagar a tarefa: no config.json, use `"coleta_rapida`": false" -ForegroundColor DarkGray

Write-Host ""
Write-Host "Os reports ficam em: $pasta\dados\reports"
Read-Host "Enter para fechar"

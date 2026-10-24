# Cria (ou atualiza) a tarefa diária das 21h no Agendador de Tarefas do Windows.
# Rode com: botão direito > "Executar com o PowerShell"
# Se o PC estiver desligado às 21h, o dia é pulado e o próximo report avisa "N dias sem leitura".

$pasta  = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat    = Join-Path $pasta "rodar_report.bat"
$nome   = "NokyLabs - Report VALORANT"

if (-not (Test-Path $bat)) {
    Write-Host "Não encontrei o rodar_report.bat nesta pasta." -ForegroundColor Red
    Read-Host "Enter para sair"; exit 1
}
if (-not [Environment]::GetEnvironmentVariable("HENRIKDEV_API_KEY", "User")) {
    Write-Host "Aviso: a variável HENRIKDEV_API_KEY não foi encontrada para o seu usuário." -ForegroundColor Yellow
}

$acao      = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$bat`"" -WorkingDirectory $pasta
$gatilho   = New-ScheduledTaskTrigger -Daily -At "21:00"
$config    = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $config `
    -Description "Coleta as partidas do dia na HenrikDev API e gera o report .md" -Force | Out-Null

Write-Host ""
Write-Host "Pronto! A tarefa '$nome' vai rodar todo dia às 21:00." -ForegroundColor Green
Write-Host "Os reports ficam em: $pasta\dados\reports"
Read-Host "Enter para fechar"

@echo off
REM Procura partidas novas agora e atualiza o site (o mesmo que a tarefa de 20 em 20 minutos faz).
REM Não gera report nem manda nada ao Discord: o que achar entra no report das 21h.
cd /d "%~dp0.."
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 ferramentas\coletor_valorant.py --rapido
) else (
    python ferramentas\coletor_valorant.py --rapido
)
pause

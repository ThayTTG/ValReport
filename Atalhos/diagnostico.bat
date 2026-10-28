@echo off
REM Confere se o PC esta pronto para o ValReport: Python, chaves, tarefas do Agendador, API, Supabase e GitHub.
REM As chaves nunca aparecem (so "configurada" ou "nao configurada"). O resultado fica em dados\diagnostico.txt
REM e aparece no site (Painel > Diagnostico).
cd /d "%~dp0.."
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 ferramentas\diagnostico.py
) else (
    python ferramentas\diagnostico.py
)
pause

@echo off
REM Passa a coleta e o report para a nuvem (GitHub Actions), para nao depender mais deste PC ligado.
REM Envia a configuracao e a pasta dados para o espaco privado do Supabase e oferece desligar as tarefas do Agendador.
REM Se a nuvem ja estiver coletando, nao sobrescreve nada (use --forcar so se tiver certeza).
cd /d "%~dp0.."
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
%PY% ferramentas\nuvem.py enviar %*
pause

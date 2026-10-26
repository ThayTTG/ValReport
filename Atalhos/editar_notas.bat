@echo off
REM Abre o editor das Notas da IGL no navegador (so no seu PC).
cd /d "%~dp0.."
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 ferramentas\notas_igl.py
) else (
    python ferramentas\notas_igl.py
)
pause

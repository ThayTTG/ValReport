@echo off
REM Exporta os dados do site (docs\data) e publica no GitHub (git add + commit + push).
REM Precisa que esta pasta seja um clone do repositorio ValReport (veja PUBLICAR.md).
cd /d "%~dp0"
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 exportar_site.py --publicar
) else (
    python exportar_site.py --publicar
)
pause

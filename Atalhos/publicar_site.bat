@echo off
REM Exporta os dados do site, envia ao Supabase (so a equipe ve) e publica o codigo no GitHub.
REM Os dados das partidas NAO vao para o GitHub. config.json, dados\ e notas\ nunca vao (.gitignore).
REM Precisa que esta pasta seja um clone do repositorio ValReport (veja PUBLICAR.md).
cd /d "%~dp0.."
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 ferramentas\exportar_site.py --publicar --tudo
) else (
    python ferramentas\exportar_site.py --publicar --tudo
)
pause

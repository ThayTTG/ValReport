@echo off
REM Roda o coletor + gerador do report de VALORANT (NokyLabs)
REM Pode ser executado com dois cliques para testar, ou pelo Agendador de Tarefas.
cd /d "%~dp0.."
set PYTHONUTF8=1
REM Cards em imagem precisam do Pillow (instala só se faltar)
py -3 -c "import PIL" >nul 2>nul || py -3 -m pip install --quiet pillow >nul 2>nul
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 ferramentas\coletor_valorant.py
) else (
    python ferramentas\coletor_valorant.py
)

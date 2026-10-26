@echo off
REM Apaga as partidas antigas (docs/data) do historico do GitHub, com backup antes.
REM Pede para digitar LIMPAR antes de mudar qualquer coisa.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "ferramentas\limpar_historico.ps1"

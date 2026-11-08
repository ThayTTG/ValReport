@echo off
REM Traz para este PC a pasta dados que a nuvem vem coletando (por exemplo, para voltar a coletar daqui).
REM A pasta dados atual ganha uma copia de seguranca antes.
cd /d "%~dp0.."
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
%PY% ferramentas\nuvem.py trazer
pause

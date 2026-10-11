@echo off
setlocal
title Manga Panel Finder
cd /d "%~dp0"

set "PYEXE="
where py >nul 2>nul && set "PYEXE=py -3"
if not defined PYEXE where python >nul 2>nul && set "PYEXE=python"
if not defined PYEXE (
  echo Python was not found.
  echo Install Python 3.10 or newer from https://www.python.org/downloads/
  echo ^(tick "Add python.exe to PATH" during setup^), then run this again.
  pause
  exit /b 1
)

rem Recreate the private Python environment if it is missing or was moved/broken.
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys" >nul 2>nul || rmdir /s /q ".venv"
)
if not exist ".venv\Scripts\python.exe" (
  echo Setting up Manga Panel Finder for the first time...
  %PYEXE% -m venv .venv
  if errorlevel 1 (
    echo Could not create the Python environment.
    pause
    exit /b 1
  )
)

".venv\Scripts\python.exe" launcher.py %*
if errorlevel 1 pause

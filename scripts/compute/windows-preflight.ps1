# Read-only inventory to run through Windows OpenSSH before installing anything.
$ErrorActionPreference = "Stop"
$PSVersionTable.PSVersion.ToString()
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, TotalVisibleMemorySize, FreePhysicalMemory
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv,noheader }
if (Get-Command wsl -ErrorAction SilentlyContinue) { wsl --status; wsl --list --verbose }
Get-Service sshd | Select-Object Status, StartType

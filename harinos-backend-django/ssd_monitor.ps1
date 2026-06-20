# PowerShell Background SSD Monitor and Startup Automation Script
# Runs on the host laptop to start/stop MySQL and Django servers based on SSD connection.

Add-Type -AssemblyName System.Windows.Forms
$markerFileName = "harinos_ssd_marker.txt"
$markerRelativePath = "WEB_SERVER\harinos_ssd_marker.txt"

$djangoRunning = $false
$mysqlRunning = $false
$currentDriveLetter = ""

Write-Host "Starting Harino's Pizza SSD Monitor..." -ForegroundColor Green
Write-Host "Scanning drives for signature: $markerRelativePath" -ForegroundColor Cyan

while ($true) {
    # 1. Scan filesystem for the SSD marker file
    $ssdDrive = $null
    $drives = Get-PSDrive -PSProvider FileSystem
    foreach ($d in $drives) {
        $pathToCheck = Join-Path $d.Root $markerRelativePath
        if (Test-Path $pathToCheck) {
            $ssdDrive = $d
            break
        }
    }

    if ($ssdDrive -ne $null) {
        $driveLetter = $ssdDrive.Name + ":"
        $ssdRoot = Join-Path $ssdDrive.Root "WEB_SERVER"
        
        # Check if the SSD drive letter has changed or services are not started
        if (-not $djangoRunning -or -not $mysqlRunning -or $currentDriveLetter -ne $driveLetter) {
            Write-Host "SSD detected at drive letter: $driveLetter. Starting services..." -ForegroundColor Green
            $currentDriveLetter = $driveLetter

            # A. Stop conflicting local MySQL80 service on host laptop
            $localMysql = Get-Service -Name "MySQL80" -ErrorAction SilentlyContinue
            if ($localMysql -and $localMysql.Status -eq "Running") {
                Write-Host "Stopping conflicting laptop MySQL80 service..." -ForegroundColor Yellow
                Stop-Service -Name "MySQL80" -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
            }

            # B. Update my.ini dynamically to match the current drive letter
            $myIniPath = Join-Path $ssdRoot "harinos-mysql\my.ini"
            if (Test-Path $myIniPath) {
                Write-Host "Dynamically updating my.ini config paths..." -ForegroundColor Yellow
                $iniContent = Get-Content $myIniPath
                # Replace basedir, datadir, socket drive letter prefixes
                $updatedIni = $iniContent -replace "([a-zA-Z]:)/WEB_SERVER/harinos-mysql", "$driveLetter/WEB_SERVER/harinos-mysql"
                $updatedIni | Set-Content $myIniPath
            }

            # C. Launch MySQL Server
            $mysqldPath = Join-Path $ssdRoot "harinos-mysql\bin\mysqld.exe"
            if (Test-Path $mysqldPath) {
                $mysqlProcess = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
                if ($null -eq $mysqlProcess) {
                    Write-Host "Starting MySQL server..." -ForegroundColor Green
                    Start-Process -FilePath $mysqldPath -ArgumentList "--defaults-file=$myIniPath --standalone" -WindowStyle Hidden
                    Start-Sleep -Seconds 2
                }
                $mysqlRunning = $true
            } else {
                Write-Host "Warning: Portable MySQL executable not found on SSD at $mysqldPath" -ForegroundColor Red
            }

            # D. Run Django migrations, replay transaction recovery log, and start server
            $djangoManage = Join-Path $ssdRoot "manage.py"
            if (Test-Path $djangoManage) {
                # Run migrations
                Write-Host "Running database migrations..." -ForegroundColor Yellow
                Start-Process -FilePath "python" -ArgumentList "$djangoManage migrate" -WorkingDirectory $ssdRoot -WindowStyle Hidden -Wait
                
                # Replay recovery logs
                Write-Host "Replaying any pending transactions from recovery log..." -ForegroundColor Yellow
                Start-Process -FilePath "python" -ArgumentList "$djangoManage replay_recovery_log" -WorkingDirectory $ssdRoot -WindowStyle Hidden -Wait

                # Start Django server on port 8000
                Write-Host "Starting Django server on 127.0.0.1:8000..." -ForegroundColor Green
                Start-Process -FilePath "python" -ArgumentList "$djangoManage runserver 127.0.0.1:8000" -WorkingDirectory $ssdRoot -WindowStyle Hidden
                $djangoRunning = $true
            } else {
                Write-Host "Warning: Django manage.py not found on SSD at $djangoManage" -ForegroundColor Red
            }
            
            [System.Windows.Forms.MessageBox]::Show("Harino's Pizza Database Connected!`nSSD active at drive $driveLetter.`n`nDjango backend and MySQL are running automatically.", "Storage Manager", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
        }
    } else {
        # SSD is missing or disconnected
        if ($djangoRunning -or $mysqlRunning) {
            Write-Host "SSD disconnected! Terminating services immediately." -ForegroundColor Red
            
            # Kill Django (python processes running manage.py)
            $pList = Get-Process -Name "python" -ErrorAction SilentlyContinue
            foreach ($p in $pList) {
                try {
                    if ($p.CommandLine -like "*manage.py runserver*") {
                        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                    }
                } catch {}
            }

            # Kill MySQL server
            $mList = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
            foreach ($m in $mList) {
                Stop-Process -Id $m.Id -Force -ErrorAction SilentlyContinue
            }

            # Restart conflicting laptop MySQL80 service to restore original state
            $localMysql = Get-Service -Name "MySQL80" -ErrorAction SilentlyContinue
            if ($localMysql -and $localMysql.Status -ne "Running") {
                Write-Host "Restarting laptop MySQL80 service..." -ForegroundColor Green
                Start-Service -Name "MySQL80" -ErrorAction SilentlyContinue
            }

            $djangoRunning = $false
            $mysqlRunning = $false
            $currentDriveLetter = ""

            [System.Windows.Forms.MessageBox]::Show("Harino's Pizza External SSD disconnected!`n`nDatabase services stopped immediately.`nNo database files remain accessible on the laptop.", "Storage Alert", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
        }
    }

    Start-Sleep -Seconds 3
}

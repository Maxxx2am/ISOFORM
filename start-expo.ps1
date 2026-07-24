$logFile = "$env:TEMP\expo-start.log"
$process = Start-Process -FilePath "node" -ArgumentList ".\node_modules\expo\bin\cli start" -NoNewWindow -RedirectStandardOutput $logFile -RedirectStandardError "${logFile}.err" -PassThru
Write-Host "PID: $($process.Id)"
Start-Sleep -Seconds 25
$log = Get-Content $logFile -Raw
Write-Host "=== OUTPUT ==="
Write-Host $log
Write-Host "=== ERROR ==="
$err = Get-Content "${logFile}.err" -Raw
Write-Host $err
Write-Host "=== DONE ==="

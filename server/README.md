# ZKTeco Bridge

This server turns your attendance tab into a real shared biometric flow:

1. ZKTeco device pushes punch logs to the bridge
2. The bridge stores raw logs in Supabase
3. The bridge rebuilds `attendance_records` inside `help360_shared_state`
4. Your `index.html` app reads the shared attendance data on every device

## What You Need

- A Supabase project
- A `service role` key from Supabase
- A machine that can keep this bridge running
- A public URL or a LAN URL that your ZKTeco device can reach

## Required Supabase Tables

Run the SQL shown in the app's `Settings -> Supabase SQL Template`.

That template now creates:

- `activity_reports`
- `help360_shared_state`
- `zkteco_devices`
- `zkteco_attendance_logs`
- `zkteco_sync_runs`

## Environment Variables

Create one of these files:

- `employee-daily-activity-tracker/.env`
- `employee-daily-activity-tracker/server/.env`

Example:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
BRIDGE_PORT=8787
ZK_BRIDGE_ADMIN_KEY=change-this-key
BRIDGE_CORS_ORIGIN=*
ZK_SYNC_LOOKBACK_DAYS=45
ZK_DEFAULT_TIMEZONE=UTC
```

## Run The Bridge

From the project folder:

```powershell
npm run bridge
```

Health check:

```powershell
Invoke-WebRequest http://localhost:8787/health
```

## Frontend Settings

In the app's `Attendance` panel fill:

- `Bridge URL`
- `Bridge Admin Key`
- `Device Timezone`

Example bridge URL:

```text
http://localhost:8787
```

The app uses that bridge URL for:

- `POST /api/zkteco/sync`
- `GET /api/zkteco/status`

## Device Setup

The bridge listens on:

```text
/iclock/cdata
```

and

```text
/iclock/getrequest
```

For ZKTeco attendance devices using PUSH / ADMS:

1. Open the device `COMM -> ADMS`
2. Use the attendance push mode supported by your device
3. If your model has `Enable Domain Name`, turn it on when using a host name
4. Enter the bridge host and port

Example:

```text
attendance.example.com:8787
```

Many PUSH/ADMS models automatically call `/iclock/cdata` after the host is saved. If your model asks for a full path, use:

```text
http://attendance.example.com:8787/iclock/cdata
```

## Manual Test Import

You can test without a real device:

```powershell
$body = @{
  deviceSerial = "TEST-DEVICE"
  data = "EMP-001`t2026-05-20 09:00:00`t1`t0`t0`nEMP-001`t2026-05-20 18:05:00`t1`t0`t0"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://localhost:8787/api/zkteco/import" `
  -Method Post `
  -Headers @{ "x-bridge-key" = "change-this-key" } `
  -ContentType "application/json" `
  -Body $body
```

Then open the HR app and click `Run ZKTeco Sync` or `Refresh Cloud`.

## Notes

- The bridge uses the Supabase `service role` key, so keep it only on the server
- The browser app should keep using the `publishable` key
- If you host the frontend on GitHub Pages, the bridge must run separately on a server, Windows PC, or cloud instance

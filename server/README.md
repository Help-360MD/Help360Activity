# HELP360 Apps Script Backend

This folder now contains the Google Apps Script web app that backs the Help 360 MD Activity Tracker.

## What It Stores

- `SharedState` for app scopes such as settings, employees, jobs, attendance config, and passwords
- `Reports` for submitted employee activity reports
- `StaffDirectory` for login credentials and password source-of-truth data
- `AuthSessions` for signed-in session tokens
- `PinResetRequests` for optional PIN reset requests and audit tracking

## Main Endpoints

- `action=snapshot`
- `action=scope`
- `action=reports`
- `action=upsert_scope`
- `action=upsert_report`
- `action=upsert_staff_directory`
- `action=login`
- `action=validate-session`
- `action=logout`
- `action=request-pin-reset`
- `action=complete-pin-reset`

## Deploy

1. Open Google Sheets and create or pick the workbook you want to use.
2. In the Apps Script editor, add `server/help360-apps-script.gs`.
3. Deploy as a Web App and allow access for the users who need the app.
4. Put the deployed URL into `APPS_SCRIPT_URL` in the frontend once.

## Notes

- The frontend sends `sheetId` for read and write requests, so the web app can work with a standalone deployment.
- If you want to bind the Apps Script directly to one spreadsheet, you can also set the `HELP360_SPREADSHEET_ID` script property.
- Password changes are mirrored into `StaffDirectory` and the shared `passwords` scope, so Sheets stays the source of truth.

# HELP360 Auth Backend Setup

## Tabs
Create these Google Sheets tabs exactly:

- `StaffUsers`
- `AuthSessions`
- `PinResetRequests`
- `AuthAudit`

## Headers

### `StaffUsers`
`userId, fullName, role, status, defaultDepartment, allowedDepartments, pinSalt, pinHash, forcePinReset, lastLoginAt, lastPinResetAt, notes`

### `AuthSessions`
`sessionId, userId, fullName, role, department, tokenHash, issuedAt, lastSeenAt, expiresAt, status`

### `PinResetRequests`
`requestId, userId, fullName, requestedAt, status, requestedFrom, approvedBy, approvedAt, temporaryPin, notes`

### `AuthAudit`
`eventId, actionType, actorUserId, actorName, department, sessionId, targetId, details, createdAt`

## How the flow works

1. Frontend logs in with `userId + PIN + department`.
2. Apps Script checks the hashed PIN in `StaffUsers`.
3. If valid, Apps Script creates a row in `AuthSessions` and returns a session token.
4. Frontend stores the session token in `localStorage`.
5. Frontend validates the session periodically.
6. When you change passwords on the app, the app pushes the full staff directory back to `StaffUsers` through `upsert_staff_directory`.

## Important

Paste the code from `server/HELP360_FULL_BACKEND.gs` into the same Apps Script project and deploy that one file as your web app.
It already includes:

- Google Sheets live sync
- shared state snapshots
- report upserts
- document metadata
- auth / sessions / reset workflow

Do not paste the auth-only file separately if you use the full backend file, because that would create duplicate `doGet` / `doPost` handlers.

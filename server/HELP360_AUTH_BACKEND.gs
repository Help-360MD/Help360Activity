/**
 * HELP360 Auth Backend for Google Apps Script
 *
 * Sheet tabs:
 * - StaffUsers
 * - AuthSessions
 * - PinResetRequests
 * - AuthAudit
 *
 * This file is intended to live in the SAME Google Apps Script project as your
 * existing Google Sheets live-sync handlers.
 *
 * Keep your existing data-sync actions (for reports/shared state), and merge
 * these auth actions into the same doGet/doPost router.
 */

const AUTH_CONFIG = Object.freeze({
  staffSheet: 'StaffUsers',
  sessionSheet: 'AuthSessions',
  resetSheet: 'PinResetRequests',
  auditSheet: 'AuthAudit',
  sessionHours: 8,
  sessionIdleMinutes: 15
});

const AUTH_HEADERS = Object.freeze({
  staff: [
    'userId',
    'fullName',
    'role',
    'status',
    'defaultDepartment',
    'allowedDepartments',
    'pinSalt',
    'pinHash',
    'forcePinReset',
    'lastLoginAt',
    'lastPinResetAt',
    'notes'
  ],
  sessions: [
    'sessionId',
    'userId',
    'fullName',
    'role',
    'department',
    'tokenHash',
    'issuedAt',
    'lastSeenAt',
    'expiresAt',
    'status'
  ],
  resets: [
    'requestId',
    'userId',
    'fullName',
    'requestedAt',
    'status',
    'requestedFrom',
    'approvedBy',
    'approvedAt',
    'temporaryPin',
    'notes'
  ],
  audit: [
    'eventId',
    'actionType',
    'actorUserId',
    'actorName',
    'department',
    'sessionId',
    'targetId',
    'details',
    'createdAt'
  ]
});

function doGet(e) {
  const action = normalizeAction_(e && e.parameter && e.parameter.action);

  try {
    switch (action) {
      case 'staff-list':
        return jsonResponse_({
          ok: true,
          staff: getActiveStaffList_()
        });
      case 'validate-session':
        return jsonResponse_(handleValidateSession_(e && e.parameter && e.parameter.sessionToken));
      default:
        return jsonResponse_({
          ok: false,
          error: 'Unsupported GET action.'
        });
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message });
  }
}

function doPost(e) {
  const payload = parseJsonBody_(e);
  const action = normalizeAction_(payload.action);

  try {
    switch (action) {
      case 'login':
        return jsonResponse_(handleLogin_(payload));
      case 'complete-pin-reset':
        return jsonResponse_(handleCompletePinReset_(payload));
      case 'logout':
        return jsonResponse_(handleLogout_(payload));
      case 'request-pin-reset':
        return jsonResponse_(handlePinResetRequest_(payload));
      case 'upsert_staff_directory':
        return jsonResponse_(handleUpsertStaffDirectory_(payload));
      default:
        return jsonResponse_({
          ok: false,
          error: 'Unsupported POST action.'
        });
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message });
  }
}

function setupAuthSheets() {
  ensureSheetWithHeaders_(AUTH_CONFIG.staffSheet, AUTH_HEADERS.staff);
  ensureSheetWithHeaders_(AUTH_CONFIG.sessionSheet, AUTH_HEADERS.sessions);
  ensureSheetWithHeaders_(AUTH_CONFIG.resetSheet, AUTH_HEADERS.resets);
  ensureSheetWithHeaders_(AUTH_CONFIG.auditSheet, AUTH_HEADERS.audit);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('HELP360 Auth')
    .addItem('Setup Auth Sheets', 'setupAuthSheets')
    .addItem('Generate Temp PIN For Selected Staff', 'adminGenerateTempPinForSelectedStaffRow')
    .addItem('Approve Selected Reset Request', 'adminApproveSelectedResetRequest')
    .addToUi();
}

function adminGenerateTempPinForSelectedStaffRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== AUTH_CONFIG.staffSheet) {
    throw new Error('Open the StaffUsers sheet and select a staff row first.');
  }

  const rowIndex = sheet.getActiveRange().getRow();
  if (rowIndex < 2) {
    throw new Error('Select a staff row, not the header.');
  }

  const userId = sheet.getRange(rowIndex, 1).getValue();
  const result = adminGenerateTemporaryPin_(String(userId));
  SpreadsheetApp.getUi().alert(
    'Temporary PIN Created',
    `${result.fullName}\nUser ID: ${result.userId}\nTemporary PIN: ${result.temporaryPin}\n\nGive this to the staff member and have them change it on first login.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function adminApproveSelectedResetRequest() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== AUTH_CONFIG.resetSheet) {
    throw new Error('Open the PinResetRequests sheet and select a request row first.');
  }

  const rowIndex = sheet.getActiveRange().getRow();
  if (rowIndex < 2) {
    throw new Error('Select a reset request row, not the header.');
  }

  const requestId = String(sheet.getRange(rowIndex, 1).getValue());
  const result = adminApproveResetRequest_(requestId);
  SpreadsheetApp.getUi().alert(
    'Reset Request Approved',
    `${result.fullName}\nUser ID: ${result.userId}\nTemporary PIN: ${result.temporaryPin}\n\nStatus was updated to Approved and the staff member must set a new PIN on next login.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function handleLogin_(payload) {
  const userId = requiredString_(payload.userId, 'userId is required.');
  const pin = requiredString_(payload.pin, 'pin is required.');
  const requestedDepartment = requiredString_(payload.department, 'department is required.');
  const staffRecord = getStaffRecordByUserId_(userId);

  ensureStaffCanLogin_(staffRecord);
  validatePinFormat_(pin);

  if (!staffRecord.pinHash || !staffRecord.pinSalt) {
    throw new Error('No PIN is enrolled for this staff member. Ask an admin to issue a temporary PIN.');
  }

  if (!verifyPin_(pin, staffRecord.pinSalt, staffRecord.pinHash)) {
    writeAuditEvent_('login_failed', {
      actorUserId: staffRecord.userId,
      actorName: staffRecord.fullName,
      department: requestedDepartment,
      details: 'Invalid PIN'
    });
    throw new Error('PIN did not match.');
  }

  const department = chooseDepartment_(staffRecord, requestedDepartment);

  if (isTruthy_(staffRecord.forcePinReset)) {
    return {
      ok: false,
      requiresPinReset: true,
      message: 'Temporary PIN accepted. Set a new personal PIN to continue.',
      staff: {
        userId: staffRecord.userId,
        fullName: staffRecord.fullName,
        role: staffRecord.role,
        department: department
      }
    };
  }

  const session = createSession_(staffRecord, department);
  touchLastLogin_(staffRecord.userId);
  writeAuditEvent_('login_success', {
    actorUserId: staffRecord.userId,
    actorName: staffRecord.fullName,
    department: department,
    sessionId: session.sessionId
  });

  return {
    ok: true,
    session: session
  };
}

function handleCompletePinReset_(payload) {
  const userId = requiredString_(payload.userId, 'userId is required.');
  const currentPin = requiredString_(payload.currentPin, 'currentPin is required.');
  const newPin = requiredString_(payload.newPin, 'newPin is required.');
  const confirmPin = requiredString_(payload.confirmPin, 'confirmPin is required.');
  const requestedDepartment = requiredString_(payload.department, 'department is required.');

  if (newPin !== confirmPin) {
    throw new Error('New PIN and confirmation PIN do not match.');
  }

  validatePinFormat_(currentPin);
  validatePinFormat_(newPin);

  const staffRecord = getStaffRecordByUserId_(userId);
  ensureStaffCanLogin_(staffRecord);

  if (!verifyPin_(currentPin, staffRecord.pinSalt, staffRecord.pinHash)) {
    throw new Error('Temporary PIN did not match.');
  }

  const newSalt = generateSalt_();
  const newHash = hashPin_(newPin, newSalt);
  updateStaffRecord_(staffRecord.rowNumber, {
    pinSalt: newSalt,
    pinHash: newHash,
    forcePinReset: false,
    lastPinResetAt: new Date().toISOString()
  });

  const department = chooseDepartment_(staffRecord, requestedDepartment);
  const refreshedStaffRecord = getStaffRecordByUserId_(userId);
  const session = createSession_(refreshedStaffRecord, department);
  touchLastLogin_(userId);
  writeAuditEvent_('pin_reset_completed', {
    actorUserId: refreshedStaffRecord.userId,
    actorName: refreshedStaffRecord.fullName,
    department: department,
    sessionId: session.sessionId
  });

  return {
    ok: true,
    session: session
  };
}

function handleLogout_(payload) {
  const sessionToken = requiredString_(payload.sessionToken, 'sessionToken is required.');
  const session = getSessionByToken_(sessionToken);
  if (!session) {
    return { ok: true };
  }

  updateSessionRow_(session.rowNumber, {
    status: 'REVOKED',
    lastSeenAt: new Date().toISOString()
  });

  writeAuditEvent_('logout', {
    actorUserId: session.userId,
    actorName: session.fullName,
    department: session.department,
    sessionId: session.sessionId
  });

  return { ok: true };
}

function handleValidateSession_(sessionToken) {
  const token = requiredString_(sessionToken, 'sessionToken is required.');
  const session = getSessionByToken_(token);

  if (!session) {
    return { ok: false, error: 'Session not found.' };
  }

  if (session.status !== 'ACTIVE') {
    return { ok: false, error: 'Session is not active.' };
  }

  const now = new Date();
  const idleCutoff = new Date(now.getTime() - (AUTH_CONFIG.sessionIdleMinutes * 60 * 1000));
  const expiresAt = new Date(session.expiresAt);
  const lastSeenAt = new Date(session.lastSeenAt);

  if (expiresAt < now || lastSeenAt < idleCutoff) {
    updateSessionRow_(session.rowNumber, {
      status: 'EXPIRED'
    });
    writeAuditEvent_('session_expired', {
      actorUserId: session.userId,
      actorName: session.fullName,
      department: session.department,
      sessionId: session.sessionId
    });
    return { ok: false, error: 'Session expired.' };
  }

  updateSessionRow_(session.rowNumber, {
    lastSeenAt: now.toISOString()
  });

  const staffRecord = getStaffRecordByUserId_(session.userId);

  return {
    ok: true,
    session: {
      sessionId: session.sessionId,
      userId: session.userId,
      fullName: session.fullName,
      department: session.department,
      role: staffRecord.role,
      status: staffRecord.status
    }
  };
}

function handlePinResetRequest_(payload) {
  const userId = requiredString_(payload.userId, 'userId is required.');
  const requestedFrom = payload.requestedFrom || '';
  const notes = payload.notes || '';
  const staffRecord = getStaffRecordByUserId_(userId);

  const resetSheet = ensureSheetWithHeaders_(AUTH_CONFIG.resetSheet, AUTH_HEADERS.resets);
  const requestId = Utilities.getUuid();
  const values = [
    requestId,
    staffRecord.userId,
    staffRecord.fullName,
    new Date().toISOString(),
    'PENDING',
    requestedFrom,
    '',
    '',
    '',
    notes
  ];

  resetSheet.appendRow(values);
  writeAuditEvent_('pin_reset_requested', {
    actorUserId: staffRecord.userId,
    actorName: staffRecord.fullName,
    targetId: requestId,
    details: requestedFrom
  });

  return {
    ok: true,
    message: 'Reset request logged. A supervisor or admin can now issue a temporary PIN.'
  };
}

function handleUpsertStaffDirectory_(payload) {
  const staff = Array.isArray(payload.staff) ? payload.staff : [];
  if (!staff.length) {
    throw new Error('staff array is required.');
  }

  const result = staff.map(function (entry) {
    return upsertStaffRecord_(entry);
  });

  writeAuditEvent_('staff_directory_synced', {
    actorUserId: 'system',
    actorName: 'HELP360',
    department: '',
    details: `Synced ${result.length} staff records.`
  });

  return {
    ok: true,
    synced: result.length,
    updatedAt: new Date().toISOString()
  };
}

function adminApproveResetRequest_(requestId) {
  const resetRecord = getResetRequestById_(requestId);
  if (!resetRecord || resetRecord.status !== 'PENDING') {
    throw new Error('Pending reset request not found.');
  }

  const result = adminGenerateTemporaryPin_(resetRecord.userId);
  updateResetRequestRow_(resetRecord.rowNumber, {
    status: 'APPROVED',
    approvedBy: Session.getEffectiveUser().getEmail(),
    approvedAt: new Date().toISOString(),
    temporaryPin: result.temporaryPin
  });

  writeAuditEvent_('pin_reset_approved', {
    actorUserId: result.userId,
    actorName: result.fullName,
    targetId: requestId,
    details: 'Temporary PIN issued'
  });

  return result;
}

function adminGenerateTemporaryPin_(userId) {
  const staffRecord = getStaffRecordByUserId_(userId);
  ensureStaffCanLogin_(staffRecord);

  const temporaryPin = generateTemporaryPin_();
  const salt = generateSalt_();
  const hash = hashPin_(temporaryPin, salt);

  updateStaffRecord_(staffRecord.rowNumber, {
    pinSalt: salt,
    pinHash: hash,
    forcePinReset: true,
    lastPinResetAt: new Date().toISOString()
  });

  return {
    userId: staffRecord.userId,
    fullName: staffRecord.fullName,
    temporaryPin: temporaryPin
  };
}

function getActiveStaffList_() {
  return getAllRows_(AUTH_CONFIG.staffSheet).filter(function(row) {
    return String(row.status || '').toUpperCase() === 'ACTIVE';
  }).map(function(row) {
    return {
      userId: row.userId,
      fullName: row.fullName,
      role: row.role,
      defaultDepartment: row.defaultDepartment,
      allowedDepartments: splitDepartments_(row.allowedDepartments)
    };
  });
}

function getStaffRecordByUserId_(userId) {
  const rows = getAllRows_(AUTH_CONFIG.staffSheet);
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index].userId) === String(userId)) {
      return rows[index];
    }
  }

  throw new Error('Staff user was not found.');
}

function getSessionByToken_(sessionToken) {
  const tokenHash = hashSessionToken_(sessionToken);
  const rows = getAllRows_(AUTH_CONFIG.sessionSheet);
  for (var index = 0; index < rows.length; index += 1) {
    if (rows[index].tokenHash === tokenHash) {
      return rows[index];
    }
  }
  return null;
}

function getResetRequestById_(requestId) {
  const rows = getAllRows_(AUTH_CONFIG.resetSheet);
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index].requestId) === String(requestId)) {
      return rows[index];
    }
  }
  return null;
}

function ensureStaffCanLogin_(staffRecord) {
  if (String(staffRecord.status || '').toUpperCase() !== 'ACTIVE') {
    throw new Error('This staff account is not active.');
  }
}

function chooseDepartment_(staffRecord, requestedDepartment) {
  const allowedDepartments = splitDepartments_(staffRecord.allowedDepartments);

  if (allowedDepartments.length === 0) {
    if (!requestedDepartment) {
      throw new Error('No department is configured for this staff member.');
    }
    return requestedDepartment;
  }

  if (allowedDepartments.indexOf(requestedDepartment) === -1) {
    throw new Error('Requested department is not allowed for this staff member.');
  }

  return requestedDepartment;
}

function splitDepartments_(value) {
  return String(value || '')
    .split('|')
    .map(function(item) { return item.trim(); })
    .filter(Boolean);
}

function createSession_(staffRecord, department) {
  const sessionSheet = ensureSheetWithHeaders_(AUTH_CONFIG.sessionSheet, AUTH_HEADERS.sessions);
  const sessionId = Utilities.getUuid();
  const plainToken = `${sessionId}.${Utilities.getUuid()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (AUTH_CONFIG.sessionHours * 60 * 60 * 1000));

  sessionSheet.appendRow([
    sessionId,
    staffRecord.userId,
    staffRecord.fullName,
    staffRecord.role,
    department,
    hashSessionToken_(plainToken),
    now.toISOString(),
    now.toISOString(),
    expiresAt.toISOString(),
    'ACTIVE'
  ]);

  return {
    sessionId: sessionId,
    sessionToken: plainToken,
    userId: staffRecord.userId,
    fullName: staffRecord.fullName,
    department: department,
    role: staffRecord.role,
    expiresAt: expiresAt.toISOString()
  };
}

function touchLastLogin_(userId) {
  const staffRecord = getStaffRecordByUserId_(userId);
  updateStaffRecord_(staffRecord.rowNumber, {
    lastLoginAt: new Date().toISOString()
  });
}

function updateStaffRecord_(rowNumber, updates) {
  updateSheetRow_(AUTH_CONFIG.staffSheet, AUTH_HEADERS.staff, rowNumber, updates);
}

function updateSessionRow_(rowNumber, updates) {
  updateSheetRow_(AUTH_CONFIG.sessionSheet, AUTH_HEADERS.sessions, rowNumber, updates);
}

function updateResetRequestRow_(rowNumber, updates) {
  updateSheetRow_(AUTH_CONFIG.resetSheet, AUTH_HEADERS.resets, rowNumber, updates);
}

function updateSheetRow_(sheetName, headers, rowNumber, updates) {
  const sheet = ensureSheetWithHeaders_(sheetName, headers);
  const headerIndexes = buildHeaderIndex_(headers);

  Object.keys(updates).forEach(function(key) {
    if (headerIndexes[key] === undefined) {
      return;
    }
    sheet.getRange(rowNumber, headerIndexes[key] + 1).setValue(updates[key]);
  });
}

function upsertStaffRecord_(entry) {
  const userId = requiredString_(entry && entry.userId, 'userId is required for staff sync.');
  const fullName = requiredString_(entry && entry.fullName, 'fullName is required for staff sync.');
  const role = String((entry && entry.role) || 'employee').trim().toLowerCase();
  const status = String((entry && entry.status) || 'ACTIVE').trim().toUpperCase();
  const defaultDepartment = String((entry && entry.defaultDepartment) || 'Operations').trim();
  const allowedDepartments = Array.isArray(entry && entry.allowedDepartments)
    ? (entry.allowedDepartments || []).map(function(item) { return String(item || '').trim(); }).filter(Boolean).join('|')
    : String((entry && entry.allowedDepartments) || defaultDepartment).trim();
  const notes = String((entry && entry.notes) || '').trim();
  const forcePinReset = isTruthy_(entry && entry.forcePinReset);
  const pin = String((entry && entry.pin) || '').trim();
  const now = new Date().toISOString();
  const salt = pin ? generateSalt_() : String((entry && entry.pinSalt) || '').trim();
  const hash = pin ? hashPin_(pin, salt) : String((entry && entry.pinHash) || '').trim();

  const existing = getStaffRecordByUserIdOrNull_(userId);
  const values = {
    userId: userId,
    fullName: fullName,
    role: role,
    status: status,
    defaultDepartment: defaultDepartment,
    allowedDepartments: allowedDepartments,
    pinSalt: salt,
    pinHash: hash,
    forcePinReset: forcePinReset ? 'TRUE' : 'FALSE',
    lastLoginAt: String((entry && entry.lastLoginAt) || (existing && existing.lastLoginAt) || ''),
    lastPinResetAt: pin ? now : String((entry && entry.lastPinResetAt) || (existing && existing.lastPinResetAt) || ''),
    notes: notes || String((entry && entry.notes) || (existing && existing.notes) || '')
  };

  return upsertByKey_(ensureSheetWithHeaders_(AUTH_CONFIG.staffSheet, AUTH_HEADERS.staff), AUTH_HEADERS.staff, 'userId', userId, [
    values.userId,
    values.fullName,
    values.role,
    values.status,
    values.defaultDepartment,
    values.allowedDepartments,
    values.pinSalt,
    values.pinHash,
    values.forcePinReset,
    values.lastLoginAt,
    values.lastPinResetAt,
    values.notes
  ]);
}

function getStaffRecordByUserIdOrNull_(userId) {
  const rows = getAllRows_(AUTH_CONFIG.staffSheet);
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index].userId) === String(userId)) {
      return rows[index];
    }
  }
  return null;
}

function upsertByKey_(sheet, headers, keyHeader, keyValue, rowValues) {
  const keyIndex = headers.indexOf(keyHeader);
  if (keyIndex === -1) {
    throw new Error('Missing key header: ' + keyHeader);
  }

  const normalizedKey = String(keyValue || '').trim();
  if (!normalizedKey) {
    throw new Error('Missing key value for ' + keyHeader);
  }

  const existingRow = findRowByKey_(sheet, keyIndex + 1, normalizedKey);
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    SpreadsheetApp.flush();
    return {
      row: existingRow,
      key: normalizedKey,
      mode: 'updated'
    };
  }

  sheet.appendRow(rowValues);
  SpreadsheetApp.flush();
  return {
    row: sheet.getLastRow(),
    key: normalizedKey,
    mode: 'inserted'
  };
}

function findRowByKey_(sheet, keyColumnIndex, keyValue) {
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const values = sheet.getRange(2, keyColumnIndex, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i][0]).trim() === String(keyValue).trim()) {
      return i + 2;
    }
  }
  return 0;
}

function ensureSheetWithHeaders_(sheetName, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  const existingHeaders = sheet.getLastRow() >= 1
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
    : [];

  const needsHeaders = headers.some(function(header, index) {
    return String(existingHeaders[index] || '') !== String(header);
  });

  if (needsHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getAllRows_(sheetName) {
  const headers = AUTH_HEADERS[sheetNameToHeaderKey_(sheetName)];
  const sheet = ensureSheetWithHeaders_(sheetName, headers);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return [];
  }

  const headerRow = values[0];
  const rows = [];
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const rowObject = {};
    for (var columnIndex = 0; columnIndex < headerRow.length; columnIndex += 1) {
      rowObject[String(headerRow[columnIndex])] = values[rowIndex][columnIndex];
    }
    rowObject.rowNumber = rowIndex + 1;
    rows.push(rowObject);
  }

  return rows;
}

function sheetNameToHeaderKey_(sheetName) {
  if (sheetName === AUTH_CONFIG.staffSheet) {
    return 'staff';
  }
  if (sheetName === AUTH_CONFIG.sessionSheet) {
    return 'sessions';
  }
  if (sheetName === AUTH_CONFIG.resetSheet) {
    return 'resets';
  }
  if (sheetName === AUTH_CONFIG.auditSheet) {
    return 'audit';
  }
  throw new Error('Unknown sheet name.');
}

function buildHeaderIndex_(headers) {
  const index = {};
  headers.forEach(function(header, position) {
    index[header] = position;
  });
  return index;
}

function writeAuditEvent_(actionType, details) {
  const auditSheet = ensureSheetWithHeaders_(AUTH_CONFIG.auditSheet, AUTH_HEADERS.audit);
  const eventId = Utilities.getUuid();
  auditSheet.appendRow([
    eventId,
    actionType,
    details.actorUserId || '',
    details.actorName || '',
    details.department || '',
    details.sessionId || '',
    details.targetId || '',
    details.details || '',
    new Date().toISOString()
  ]);
}

function validatePinFormat_(pin) {
  if (!/^\d{4,6}$/.test(String(pin))) {
    throw new Error('PIN must be 4 to 6 digits.');
  }
}

function verifyPin_(pin, salt, expectedHash) {
  return hashPin_(pin, salt) === expectedHash;
}

function hashPin_(pin, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    `${salt}:${pin}`,
    Utilities.Charset.UTF_8
  );

  return digest.map(function(byte) {
    const normalizedByte = (byte + 256) % 256;
    return normalizedByte.toString(16).padStart(2, '0');
  }).join('');
}

function hashSessionToken_(token) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    token,
    Utilities.Charset.UTF_8
  );

  return digest.map(function(byte) {
    const normalizedByte = (byte + 256) % 256;
    return normalizedByte.toString(16).padStart(2, '0');
  }).join('');
}

function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function generateTemporaryPin_() {
  return String(Math.floor(100000 + (Math.random() * 900000)));
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  return JSON.parse(e.postData.contents);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeAction_(value) {
  return String(value || '').trim().toLowerCase();
}

function requiredString_(value, errorMessage) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(errorMessage);
  }
  return normalized;
}

function isTruthy_(value) {
  return String(value).toUpperCase() === 'TRUE' || value === true;
}

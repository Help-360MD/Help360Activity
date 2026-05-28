/**
 * HELP360 full Google Apps Script backend
 *
 * Paste this entire file into ONE Apps Script project and deploy it as a web app.
 * It handles:
 * - Google Sheets live sync
 * - shared state snapshots
 * - reports
 * - documents metadata
 * - audit log
 * - auth / sessions / password reset workflow
 *
 * Required sheets:
 * - activity_reports
 * - help360_shared_state
 * - documents
 * - audit_log
 * - StaffUsers
 * - AuthSessions
 * - PinResetRequests
 * - AuthAudit
 */

const HELP360 = Object.freeze({
  SHEETS: Object.freeze({
    REPORTS: 'activity_reports',
    SHARED: 'help360_shared_state',
    DOCUMENTS: 'documents',
    AUDIT: 'audit_log',
    STAFF: 'StaffUsers',
    SESSIONS: 'AuthSessions',
    RESETS: 'PinResetRequests',
    AUTH_AUDIT: 'AuthAudit'
  }),
  DRIVE_FOLDER_NAME: 'HELP360_Documents',
  SESSION_HOURS: 8,
  SESSION_IDLE_MINUTES: 15
});

const REPORT_HEADERS = [
  'report_id',
  'employee',
  'employee_email',
  'employee_title',
  'department',
  'report_date',
  'report_time',
  'total_tasks',
  'total_count',
  'status',
  'notes',
  'email_method',
  'cc_email',
  'sheet_synced',
  'attachment_count',
  'attachment_names',
  'task_details_json',
  'assigned_responsibilities_json',
  'submitted_at',
  'updated_at',
  'payload_json'
];

const SHARED_HEADERS = [
  'scope',
  'record_count',
  'updated_at',
  'payload_json'
];

const DOCUMENT_HEADERS = [
  'document_id',
  'employee_id',
  'employee_name',
  'title',
  'category',
  'issued_on',
  'expires_on',
  'requires_signature',
  'employee_signature',
  'employee_signed_at',
  'hr_signature',
  'hr_signed_at',
  'status',
  'priority',
  'file_name',
  'file_url',
  'drive_file_id',
  'mime_type',
  'file_size',
  'storage_type',
  'created_at',
  'updated_at',
  'payload_json'
];

const AUDIT_HEADERS = [
  'event_id',
  'scope',
  'employee_name',
  'actor',
  'actor_role',
  'title',
  'details',
  'created_at',
  'payload_json'
];

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
  authAudit: [
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
  const action = normalizeAction_((e && e.parameter && e.parameter.action) || '');
  const spreadsheet = getSpreadsheet_();

  try {
    setupWorkbook_(spreadsheet);

    switch (action) {
      case '':
      case 'ping':
        return jsonResponse_({
          ok: true,
          service: 'help360-full-backend',
          time: new Date().toISOString()
        });

      case 'snapshot':
        return jsonResponse_({
          ok: true,
          snapshot: getWorkbookSnapshot_(spreadsheet)
        });

      case 'scope':
        return jsonResponse_({
          ok: true,
          row: readSharedScope_(spreadsheet, String((e && e.parameter && e.parameter.scope) || '').trim())
        });

      case 'reports':
        return jsonResponse_({
          ok: true,
          rows: readReportRows_(spreadsheet)
        });

      case 'shared':
        return jsonResponse_({
          ok: true,
          rows: readSharedRows_(spreadsheet)
        });

      case 'documents':
        return jsonResponse_({
          ok: true,
          rows: readDocumentRows_(spreadsheet)
        });

      case 'audit':
        return jsonResponse_({
          ok: true,
          rows: readAuditRows_(spreadsheet)
        });

      case 'staff-list':
        return jsonResponse_({
          ok: true,
          staff: getActiveStaffList_(spreadsheet)
        });

      case 'validate-session':
        return jsonResponse_(handleValidateSession_(spreadsheet, (e && e.parameter && e.parameter.sessionToken) || ''));

      default:
        return jsonResponse_({
          ok: false,
          error: 'Unsupported GET action.'
        });
    }
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function doPost(e) {
  const input = parseJsonBody_(e);
  const action = normalizeAction_(input.action);
  const spreadsheet = openTargetSpreadsheet_(input.sheetId || input.spreadsheetId);

  try {
    setupWorkbook_(spreadsheet);

    return withLock_(function () {
      switch (action) {
        case 'upsert_report':
          return jsonResponse_({
            ok: true,
            action: 'upsert_report',
            result: upsertReport_(spreadsheet, input)
          });

        case 'upsert_scope':
          return jsonResponse_({
            ok: true,
            action: 'upsert_scope',
            result: upsertSharedScope_(spreadsheet, input)
          });

        case 'upsert_document':
          return jsonResponse_({
            ok: true,
            action: 'upsert_document',
            result: upsertDocument_(spreadsheet, input)
          });

        case 'upload_document':
          return jsonResponse_({
            ok: true,
            action: 'upload_document',
            result: uploadDocument_(spreadsheet, input)
          });

        case 'log_event':
          return jsonResponse_({
            ok: true,
            action: 'log_event',
            result: appendAuditLog_(spreadsheet, input)
          });

        case 'login':
          return jsonResponse_(handleLogin_(spreadsheet, input));

        case 'complete-pin-reset':
          return jsonResponse_(handleCompletePinReset_(spreadsheet, input));

        case 'logout':
          return jsonResponse_(handleLogout_(spreadsheet, input));

        case 'request-pin-reset':
          return jsonResponse_(handlePinResetRequest_(spreadsheet, input));

        case 'upsert_staff_directory':
          return jsonResponse_(handleUpsertStaffDirectory_(spreadsheet, input));

        default:
          return jsonResponse_({
            ok: false,
            error: 'Unsupported POST action.'
          });
      }
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function setupHelp360Workbook() {
  const spreadsheet = getSpreadsheet_();
  setupWorkbook_(spreadsheet);
  return {
    ok: true,
    message: 'HELP360 workbook prepared.'
  };
}

function setupWorkbook_(spreadsheet) {
  ensureHeaders_(ensureSheet_(spreadsheet, HELP360.SHEETS.REPORTS), REPORT_HEADERS);
  ensureHeaders_(ensureSheet_(spreadsheet, HELP360.SHEETS.SHARED), SHARED_HEADERS);
  ensureHeaders_(ensureSheet_(spreadsheet, HELP360.SHEETS.DOCUMENTS), DOCUMENT_HEADERS);
  ensureHeaders_(ensureSheet_(spreadsheet, HELP360.SHEETS.AUDIT), AUDIT_HEADERS);
  ensureHeaders_(ensureSheet_(spreadsheet, HELP360.SHEETS.STAFF), AUTH_HEADERS.staff);
  ensureHeaders_(ensureSheet_(spreadsheet, HELP360.SHEETS.SESSIONS), AUTH_HEADERS.sessions);
  ensureHeaders_(ensureSheet_(spreadsheet, HELP360.SHEETS.RESETS), AUTH_HEADERS.resets);
  ensureHeaders_(ensureSheet_(spreadsheet, HELP360.SHEETS.AUTH_AUDIT), AUTH_HEADERS.authAudit);
}

function getWorkbookSnapshot_(spreadsheet) {
  return {
    shared: readSharedRows_(spreadsheet),
    reports: readReportRows_(spreadsheet),
    documents: readDocumentRows_(spreadsheet),
    audit: readAuditRows_(spreadsheet)
  };
}

function upsertReport_(spreadsheet, input) {
  const sheet = ensureSheet_(spreadsheet, HELP360.SHEETS.REPORTS);
  ensureHeaders_(sheet, REPORT_HEADERS);

  const reportId = safeString_(input.reportId || input.report_id || input.id || `report_${Date.now()}`);
  const now = new Date().toISOString();
  const attachmentNames = arrayToText_(input.attachmentNames || input.attachment_names || []);

  const record = {
    report_id: reportId,
    employee: safeString_(input.employee || ''),
    employee_email: safeString_(input.employeeEmail || input.employee_email || ''),
    employee_title: safeString_(input.employeeTitle || input.employee_title || ''),
    department: safeString_(input.department || 'Operations'),
    report_date: safeString_(input.date || input.report_date || ''),
    report_time: safeString_(input.time || input.report_time || ''),
    total_tasks: toNumber_(input.totalTasks || input.total_tasks || 0),
    total_count: toNumber_(input.totalCount || input.total_count || 0),
    status: safeString_(input.status || 'sent'),
    notes: safeString_(input.notes || ''),
    email_method: safeString_(input.emailMethod || input.email_method || ''),
    cc_email: safeString_(input.ccEmail || input.cc_email || ''),
    sheet_synced: textBoolean_(input.sheetSynced || input.sheet_synced),
    attachment_count: toNumber_(input.attachmentCount || input.attachment_count || 0),
    attachment_names: attachmentNames,
    task_details_json: jsonText_(normalizeJsonInput_(input.taskDetails || input.task_details || {})),
    assigned_responsibilities_json: jsonText_(normalizeJsonInput_(input.assignedResponsibilities || input.assigned_responsibilities || [])),
    submitted_at: safeString_(input.submittedAt || input.submitted_at || now),
    updated_at: now,
    payload_json: jsonText_(sanitizePayload_(input))
  };

  return upsertByKey_(sheet, REPORT_HEADERS, 'report_id', reportId, record);
}

function upsertSharedScope_(spreadsheet, input) {
  const sheet = ensureSheet_(spreadsheet, HELP360.SHEETS.SHARED);
  ensureHeaders_(sheet, SHARED_HEADERS);

  const scope = safeString_(input.scope || '');
  if (!scope) {
    throw new Error('Missing scope.');
  }

  const now = new Date().toISOString();
  const payload = normalizeJsonInput_(input.payload !== undefined ? input.payload : {});
  const record = {
    scope: scope,
    record_count: toNumber_(input.recordCount || input.record_count || countPayload_(payload)),
    updated_at: safeString_(input.updatedAt || input.updated_at || now),
    payload_json: jsonText_(sanitizePayload_(payload))
  };

  return upsertByKey_(sheet, SHARED_HEADERS, 'scope', scope, record);
}

function upsertDocument_(spreadsheet, input) {
  const sheet = ensureSheet_(spreadsheet, HELP360.SHEETS.DOCUMENTS);
  ensureHeaders_(sheet, DOCUMENT_HEADERS);

  const documentId = safeString_(input.documentId || input.document_id || input.id || `doc_${Date.now()}`);
  const now = new Date().toISOString();
  const record = {
    document_id: documentId,
    employee_id: safeString_(input.employeeId || input.employee_id || ''),
    employee_name: safeString_(input.employeeName || input.employee_name || ''),
    title: safeString_(input.title || 'Document'),
    category: safeString_(input.category || 'Other'),
    issued_on: safeString_(input.issuedOn || input.issued_on || ''),
    expires_on: safeString_(input.expiresOn || input.expires_on || ''),
    requires_signature: textBoolean_(input.requiresSignature || input.requires_signature),
    employee_signature: safeString_(input.employeeSignature || input.employee_signature || ''),
    employee_signed_at: safeString_(input.employeeSignedAt || input.employee_signed_at || ''),
    hr_signature: safeString_(input.hrSignature || input.hr_signature || ''),
    hr_signed_at: safeString_(input.hrSignedAt || input.hr_signed_at || ''),
    status: safeString_(input.status || 'Active'),
    priority: safeString_(input.priority || 'Medium'),
    file_name: safeString_(input.fileName || input.file_name || ''),
    file_url: safeString_(input.fileUrl || input.file_url || ''),
    drive_file_id: safeString_(input.driveFileId || input.drive_file_id || ''),
    mime_type: safeString_(input.mimeType || input.mime_type || 'application/octet-stream'),
    file_size: toNumber_(input.fileSize || input.file_size || 0),
    storage_type: safeString_(input.storageType || input.storage_type || ((input.fileUrl || input.driveFileId) ? 'google_drive' : 'metadata_only')),
    created_at: safeString_(input.createdAt || input.created_at || now),
    updated_at: now,
    payload_json: jsonText_(sanitizePayload_(input))
  };

  return upsertByKey_(sheet, DOCUMENT_HEADERS, 'document_id', documentId, record);
}

function uploadDocument_(spreadsheet, input) {
  let base64 = safeString_(input.base64 || input.dataUrl || input.fileData || '');
  if (!base64) {
    throw new Error('Missing document file data.');
  }

  if (base64.indexOf('base64,') !== -1) {
    base64 = base64.split('base64,').pop();
  }

  const bytes = Utilities.base64Decode(base64.replace(/\s/g, ''));
  const mimeType = safeString_(input.mimeType || input.mime_type || 'application/octet-stream') || 'application/octet-stream';
  const fileName = safeString_(input.fileName || input.file_name || input.name || 'document') || 'document';
  const folder = getDriveFolder_(input);
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));

  const shareMode = safeString_(input.shareMode || input.share_mode || 'private').toLowerCase();
  if (shareMode === 'link' || shareMode === 'anyone' || shareMode === 'public') {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }

  const meta = Object.assign({}, input, {
    documentId: safeString_(input.documentId || input.document_id || input.id || file.getId()),
    fileName: fileName,
    fileUrl: file.getUrl(),
    driveFileId: file.getId(),
    mimeType: mimeType,
    fileSize: bytes.length,
    storageType: 'google_drive',
    base64: null,
    dataUrl: null,
    fileData: null
  });

  return upsertDocument_(spreadsheet, meta);
}

function appendAuditLog_(spreadsheet, input) {
  const sheet = ensureSheet_(spreadsheet, HELP360.SHEETS.AUDIT);
  ensureHeaders_(sheet, AUDIT_HEADERS);

  const record = {
    event_id: safeString_(input.eventId || input.event_id || `evt_${Date.now()}`),
    scope: safeString_(input.scope || 'general'),
    employee_name: safeString_(input.employeeName || input.employee_name || ''),
    actor: safeString_(input.actor || ''),
    actor_role: safeString_(input.actorRole || input.actor_role || ''),
    title: safeString_(input.title || 'Event'),
    details: safeString_(input.details || ''),
    created_at: safeString_(input.createdAt || input.created_at || new Date().toISOString()),
    payload_json: jsonText_(sanitizePayload_(input))
  };

  sheet.appendRow(AUDIT_HEADERS.map((header) => toSheetValue_(record[header])));
  SpreadsheetApp.flush();
  return {
    row: sheet.getLastRow(),
    event_id: record.event_id
  };
}

function readReportRows_(spreadsheet) {
  return readRows_(ensureSheet_(spreadsheet, HELP360.SHEETS.REPORTS)).map(function (row) {
    return Object.assign({}, row, {
      sheet_synced: textToBoolean_(row.sheet_synced),
      total_tasks: toNumber_(row.total_tasks, 0),
      total_count: toNumber_(row.total_count, 0),
      attachment_count: toNumber_(row.attachment_count, 0),
      taskDetails: safeParseJson_(row.task_details_json, {}),
      assignedResponsibilities: safeParseJson_(row.assigned_responsibilities_json, []),
      payload: safeParseJson_(row.payload_json, {})
    });
  });
}

function readSharedRows_(spreadsheet) {
  return readRows_(ensureSheet_(spreadsheet, HELP360.SHEETS.SHARED)).map(function (row) {
    return Object.assign({}, row, {
      record_count: toNumber_(row.record_count, 0),
      payload: safeParseJson_(row.payload_json, {})
    });
  });
}

function readSharedScope_(spreadsheet, scope) {
  const rows = readSharedRows_(spreadsheet);
  for (let index = 0; index < rows.length; index += 1) {
    if (safeString_(rows[index].scope) === safeString_(scope)) {
      return rows[index];
    }
  }
  return null;
}

function readDocumentRows_(spreadsheet) {
  return readRows_(ensureSheet_(spreadsheet, HELP360.SHEETS.DOCUMENTS)).map(function (row) {
    return Object.assign({}, row, {
      requires_signature: textToBoolean_(row.requires_signature),
      file_size: toNumber_(row.file_size, 0),
      payload: safeParseJson_(row.payload_json, {})
    });
  });
}

function readAuditRows_(spreadsheet) {
  return readRows_(ensureSheet_(spreadsheet, HELP360.SHEETS.AUDIT)).map(function (row) {
    return Object.assign({}, row, {
      payload: safeParseJson_(row.payload_json, {})
    });
  });
}

function handleLogin_(spreadsheet, input) {
  const userId = requiredString_(input.userId, 'userId is required.');
  const secret = requiredString_(input.pin, 'pin is required.');
  const requestedDepartment = safeString_(input.department || '');
  const staffRecord = getStaffRecordByUserId_(spreadsheet, userId);

  ensureStaffCanLogin_(staffRecord);
  validateSecretFormat_(secret);

  if (!safeString_(staffRecord.pinHash) || !safeString_(staffRecord.pinSalt)) {
    throw new Error('No password is enrolled for this account. Ask an admin to issue one.');
  }

  if (!verifySecret_(secret, staffRecord.pinSalt, staffRecord.pinHash)) {
    writeAuthAuditEvent_(spreadsheet, 'login_failed', {
      actorUserId: staffRecord.userId,
      actorName: staffRecord.fullName,
      department: requestedDepartment,
      details: 'Invalid password'
    });
    throw new Error('Password did not match.');
  }

  const department = chooseDepartment_(staffRecord, requestedDepartment);

  if (isTruthy_(staffRecord.forcePinReset)) {
    return {
      ok: false,
      requiresPinReset: true,
      message: 'Temporary password accepted. Set a new personal password to continue.',
      staff: {
        userId: staffRecord.userId,
        fullName: staffRecord.fullName,
        role: staffRecord.role,
        department: department
      }
    };
  }

  const session = createSession_(spreadsheet, staffRecord, department);
  touchLastLogin_(spreadsheet, staffRecord.userId);
  writeAuthAuditEvent_(spreadsheet, 'login_success', {
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

function handleCompletePinReset_(spreadsheet, input) {
  const userId = requiredString_(input.userId, 'userId is required.');
  const currentPin = requiredString_(input.currentPin, 'currentPin is required.');
  const newPin = requiredString_(input.newPin, 'newPin is required.');
  const confirmPin = requiredString_(input.confirmPin, 'confirmPin is required.');
  const requestedDepartment = safeString_(input.department || '');

  if (newPin !== confirmPin) {
    throw new Error('New password and confirmation password do not match.');
  }

  validateSecretFormat_(currentPin);
  validateSecretFormat_(newPin);

  const staffRecord = getStaffRecordByUserId_(spreadsheet, userId);
  ensureStaffCanLogin_(staffRecord);

  if (!verifySecret_(currentPin, staffRecord.pinSalt, staffRecord.pinHash)) {
    throw new Error('Temporary password did not match.');
  }

  const newSalt = generateSalt_();
  const newHash = hashSecret_(newPin, newSalt);
  updateStaffRecord_(spreadsheet, staffRecord.rowNumber, {
    pinSalt: newSalt,
    pinHash: newHash,
    forcePinReset: 'FALSE',
    lastPinResetAt: new Date().toISOString()
  });

  const department = chooseDepartment_(staffRecord, requestedDepartment);
  const refreshedStaffRecord = getStaffRecordByUserId_(spreadsheet, userId);
  const session = createSession_(spreadsheet, refreshedStaffRecord, department);
  touchLastLogin_(spreadsheet, userId);
  writeAuthAuditEvent_(spreadsheet, 'pin_reset_completed', {
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

function handleLogout_(spreadsheet, input) {
  const sessionToken = requiredString_(input.sessionToken, 'sessionToken is required.');
  const session = getSessionByToken_(spreadsheet, sessionToken);
  if (!session) {
    return { ok: true };
  }

  updateSessionRow_(spreadsheet, session.rowNumber, {
    status: 'REVOKED',
    lastSeenAt: new Date().toISOString()
  });

  writeAuthAuditEvent_(spreadsheet, 'logout', {
    actorUserId: session.userId,
    actorName: session.fullName,
    department: session.department,
    sessionId: session.sessionId
  });

  return { ok: true };
}

function handleValidateSession_(spreadsheet, sessionToken) {
  const token = requiredString_(sessionToken, 'sessionToken is required.');
  const session = getSessionByToken_(spreadsheet, token);

  if (!session) {
    return { ok: false, error: 'Session not found.' };
  }

  if (String(session.status || '').toUpperCase() !== 'ACTIVE') {
    return { ok: false, error: 'Session is not active.' };
  }

  const now = new Date();
  const idleCutoff = new Date(now.getTime() - (HELP360.SESSION_IDLE_MINUTES * 60 * 1000));
  const expiresAt = new Date(session.expiresAt);
  const lastSeenAt = new Date(session.lastSeenAt);

  if (expiresAt < now || lastSeenAt < idleCutoff) {
    updateSessionRow_(spreadsheet, session.rowNumber, {
      status: 'EXPIRED'
    });
    writeAuthAuditEvent_(spreadsheet, 'session_expired', {
      actorUserId: session.userId,
      actorName: session.fullName,
      department: session.department,
      sessionId: session.sessionId
    });
    return { ok: false, error: 'Session expired.' };
  }

  updateSessionRow_(spreadsheet, session.rowNumber, {
    lastSeenAt: now.toISOString()
  });

  const staffRecord = getStaffRecordByUserId_(spreadsheet, session.userId);
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

function handlePinResetRequest_(spreadsheet, input) {
  const userId = requiredString_(input.userId, 'userId is required.');
  const requestedFrom = safeString_(input.requestedFrom || '');
  const notes = safeString_(input.notes || '');
  const staffRecord = getStaffRecordByUserId_(spreadsheet, userId);
  const resetSheet = ensureSheet_(spreadsheet, HELP360.SHEETS.RESETS);
  ensureHeaders_(resetSheet, AUTH_HEADERS.resets);

  const requestId = Utilities.getUuid();
  resetSheet.appendRow([
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
  ]);

  writeAuthAuditEvent_(spreadsheet, 'pin_reset_requested', {
    actorUserId: staffRecord.userId,
    actorName: staffRecord.fullName,
    targetId: requestId,
    details: requestedFrom
  });

  return {
    ok: true,
    message: 'Reset request logged.'
  };
}

function handleUpsertStaffDirectory_(spreadsheet, input) {
  const staff = Array.isArray(input.staff) ? input.staff : [];
  if (!staff.length) {
    throw new Error('staff array is required.');
  }

  let synced = 0;
  staff.forEach(function (entry) {
    upsertStaffRecord_(spreadsheet, entry);
    synced += 1;
  });

  writeAuthAuditEvent_(spreadsheet, 'staff_directory_synced', {
    actorUserId: 'system',
    actorName: 'HELP360',
    details: `Synced ${synced} staff records.`
  });

  return {
    ok: true,
    synced: synced,
    updatedAt: new Date().toISOString()
  };
}

function upsertStaffRecord_(spreadsheet, entry) {
  const staffSheet = ensureSheet_(spreadsheet, HELP360.SHEETS.STAFF);
  ensureHeaders_(staffSheet, AUTH_HEADERS.staff);

  const userId = requiredString_(entry && entry.userId, 'userId is required for staff sync.');
  const fullName = requiredString_(entry && entry.fullName, 'fullName is required for staff sync.');
  const role = safeString_((entry && entry.role) || 'employee').toLowerCase() || 'employee';
  const status = safeString_((entry && entry.status) || 'ACTIVE').toUpperCase() || 'ACTIVE';
  const defaultDepartment = safeString_((entry && entry.defaultDepartment) || 'Operations') || 'Operations';
  const allowedDepartments = Array.isArray(entry && entry.allowedDepartments)
    ? (entry.allowedDepartments || []).map((item) => safeString_(item)).filter(Boolean).join('|')
    : safeString_((entry && entry.allowedDepartments) || defaultDepartment);
  const notes = safeString_((entry && entry.notes) || '');
  const forcePinReset = isTruthy_(entry && entry.forcePinReset);
  const pin = safeString_((entry && entry.pin) || '');
  const now = new Date().toISOString();

  const existing = getStaffRecordByUserIdOrNull_(spreadsheet, userId);
  const salt = pin ? generateSalt_() : safeString_((entry && entry.pinSalt) || (existing && existing.pinSalt) || '');
  const hash = pin ? hashSecret_(pin, salt) : safeString_((entry && entry.pinHash) || (existing && existing.pinHash) || '');

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
    lastLoginAt: safeString_((entry && entry.lastLoginAt) || (existing && existing.lastLoginAt) || ''),
    lastPinResetAt: pin ? now : safeString_((entry && entry.lastPinResetAt) || (existing && existing.lastPinResetAt) || ''),
    notes: notes || safeString_((entry && entry.notes) || (existing && existing.notes) || '')
  };

  return upsertByKey_(staffSheet, AUTH_HEADERS.staff, 'userId', userId, values);
}

function getActiveStaffList_(spreadsheet) {
  return readRows_(ensureSheet_(spreadsheet, HELP360.SHEETS.STAFF)).filter(function (row) {
    return String(row.status || '').toUpperCase() === 'ACTIVE';
  }).map(function (row) {
    return {
      userId: row.userId,
      fullName: row.fullName,
      role: row.role,
      defaultDepartment: row.defaultDepartment,
      allowedDepartments: splitDepartments_(row.allowedDepartments)
    };
  });
}

function getStaffRecordByUserId_(spreadsheet, userId) {
  const row = getStaffRecordByUserIdOrNull_(spreadsheet, userId);
  if (!row) {
    throw new Error('Staff user was not found.');
  }
  return row;
}

function getStaffRecordByUserIdOrNull_(spreadsheet, userId) {
  const rows = readRows_(ensureSheet_(spreadsheet, HELP360.SHEETS.STAFF));
  for (let index = 0; index < rows.length; index += 1) {
    if (safeString_(rows[index].userId) === safeString_(userId)) {
      return rows[index];
    }
  }
  return null;
}

function createSession_(spreadsheet, staffRecord, department) {
  const sessionSheet = ensureSheet_(spreadsheet, HELP360.SHEETS.SESSIONS);
  ensureHeaders_(sessionSheet, AUTH_HEADERS.sessions);

  const sessionId = Utilities.getUuid();
  const plainToken = `${sessionId}.${Utilities.getUuid()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (HELP360.SESSION_HOURS * 60 * 60 * 1000));

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

function getSessionByToken_(spreadsheet, sessionToken) {
  const tokenHash = hashSessionToken_(sessionToken);
  const rows = readRows_(ensureSheet_(spreadsheet, HELP360.SHEETS.SESSIONS));
  for (let index = 0; index < rows.length; index += 1) {
    if (safeString_(rows[index].tokenHash) === tokenHash) {
      return rows[index];
    }
  }
  return null;
}

function updateStaffRecord_(spreadsheet, rowNumber, updates) {
  updateSheetRow_(spreadsheet, HELP360.SHEETS.STAFF, AUTH_HEADERS.staff, rowNumber, updates);
}

function updateSessionRow_(spreadsheet, rowNumber, updates) {
  updateSheetRow_(spreadsheet, HELP360.SHEETS.SESSIONS, AUTH_HEADERS.sessions, rowNumber, updates);
}

function updateSheetRow_(spreadsheet, sheetName, headers, rowNumber, updates) {
  const sheet = ensureSheet_(spreadsheet, sheetName);
  const headerIndex = buildHeaderIndex_(headers);

  Object.keys(updates || {}).forEach(function (key) {
    if (headerIndex[key] === undefined) return;
    sheet.getRange(rowNumber, headerIndex[key] + 1).setValue(updates[key]);
  });
}

function touchLastLogin_(spreadsheet, userId) {
  const staffRecord = getStaffRecordByUserId_(spreadsheet, userId);
  updateStaffRecord_(spreadsheet, staffRecord.rowNumber, {
    lastLoginAt: new Date().toISOString()
  });
}

function writeAuthAuditEvent_(spreadsheet, actionType, details) {
  const auditSheet = ensureSheet_(spreadsheet, HELP360.SHEETS.AUTH_AUDIT);
  ensureHeaders_(auditSheet, AUTH_HEADERS.authAudit);

  auditSheet.appendRow([
    Utilities.getUuid(),
    safeString_(actionType),
    safeString_(details && details.actorUserId),
    safeString_(details && details.actorName),
    safeString_(details && details.department),
    safeString_(details && details.sessionId),
    safeString_(details && details.targetId),
    safeString_(details && details.details),
    new Date().toISOString()
  ]);
}

function chooseDepartment_(staffRecord, requestedDepartment) {
  const allowedDepartments = splitDepartments_(staffRecord.allowedDepartments);

  if (!allowedDepartments.length) {
    if (!requestedDepartment) {
      throw new Error('No department is configured for this staff member.');
    }
    return requestedDepartment;
  }

  if (!requestedDepartment || allowedDepartments.indexOf(requestedDepartment) === -1) {
    throw new Error('Requested department is not allowed for this staff member.');
  }

  return requestedDepartment;
}

function splitDepartments_(value) {
  return String(value || '')
    .split('|')
    .map(function (item) {
      return safeString_(item);
    })
    .filter(Boolean);
}

function ensureStaffCanLogin_(staffRecord) {
  if (String(staffRecord.status || '').toUpperCase() !== 'ACTIVE') {
    throw new Error('This staff account is not active.');
  }
}

function verifySecret_(secret, salt, expectedHash) {
  return hashSecret_(secret, salt) === safeString_(expectedHash);
}

function hashSecret_(secret, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    `${salt}:${secret}`,
    Utilities.Charset.UTF_8
  );

  return digest.map(function (byte) {
    const normalizedByte = (byte + 256) % 256;
    return normalizedByte.toString(16).padStart(2, '0');
  }).join('');
}

function hashSessionToken_(token) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(token || ''),
    Utilities.Charset.UTF_8
  );

  return digest.map(function (byte) {
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

function validateSecretFormat_(secret) {
  const value = safeString_(secret);
  if (value.length < 4 || value.length > 128) {
    throw new Error('Password must be between 4 and 128 characters.');
  }
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return {};
  }
}

function normalizeJsonInput_(value) {
  if (value === null || value === undefined || value === '') {
    return value;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    return value;
  }
}

function sanitizePayload_(value) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return sanitizePayload_(item);
    });
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const next = {};
  Object.keys(value).forEach(function (key) {
    if (key === 'base64' || key === 'dataUrl' || key === 'fileData' || key === 'photoDataUrl') {
      return;
    }
    next[key] = sanitizePayload_(value[key]);
  });
  return next;
}

function jsonText_(value) {
  if (value === null || value === undefined) {
    return '{}';
  }

  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch (error) {
      return JSON.stringify(value);
    }
  }

  return JSON.stringify(value);
}

function safeParseJson_(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
}

function countPayload_(payload) {
  if (Array.isArray(payload)) {
    return payload.length;
  }
  if (payload && typeof payload === 'object') {
    return Object.keys(payload).length;
  }
  return 0;
}

function arrayToText_(value) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return safeString_(item);
    }).filter(Boolean).join('; ');
  }
  return safeString_(value);
}

function textBoolean_(value) {
  return isTruthy_(value) ? 'TRUE' : 'FALSE';
}

function textToBoolean_(value) {
  return isTruthy_(value);
}

function isTruthy_(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const text = safeString_(value).toLowerCase();
  return ['true', '1', 'yes', 'y', 'on'].indexOf(text) !== -1;
}

function safeString_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toNumber_(value, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) {
    return fallback !== undefined ? fallback : 0;
  }
  return n;
}

function normalizeAction_(value) {
  return safeString_(value).toLowerCase();
}

function requiredString_(value, errorMessage) {
  const normalized = safeString_(value);
  if (!normalized) {
    throw new Error(errorMessage);
  }
  return normalized;
}

function buildHeaderIndex_(headers) {
  const index = {};
  headers.forEach(function (header, position) {
    index[header] = position;
  });
  return index;
}

function ensureSheet_(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  if (!sheet || !headers || !headers.length) return;
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  const needsHeaders = headers.some(function (header, index) {
    return safeString_(existingHeaders[index]) !== safeString_(header);
  });

  if (needsHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function upsertByKey_(sheet, headers, keyHeader, keyValue, recordObject) {
  const keyIndex = headers.indexOf(keyHeader);
  if (keyIndex === -1) {
    throw new Error('Missing key header: ' + keyHeader);
  }

  const normalizedKey = safeString_(keyValue);
  if (!normalizedKey) {
    throw new Error('Missing key value for ' + keyHeader);
  }

  const rowValues = headers.map(function (header) {
    return toSheetValue_(recordObject[header]);
  });

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
  for (let index = 0; index < values.length; index += 1) {
    if (safeString_(values[index][0]) === safeString_(keyValue)) {
      return index + 2;
    }
  }
  return 0;
}

function readRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
    return [];
  }

  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  if (!values || values.length < 2) {
    return [];
  }

  const headers = values.shift();
  const rows = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    if (!rowHasData_(row)) continue;

    const item = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = safeString_(headers[columnIndex]);
      if (!header) continue;
      item[header] = row[columnIndex];
    }
    item.rowNumber = rowIndex + 2;
    rows.push(item);
  }

  return rows;
}

function rowHasData_(row) {
  if (!row || !row.length) return false;
  for (let index = 0; index < row.length; index += 1) {
    const cell = row[index];
    if (cell !== '' && cell !== null && cell !== undefined) {
      return true;
    }
  }
  return false;
}

function toSheetValue_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function openTargetSpreadsheet_(sheetId) {
  const normalized = safeString_(sheetId);
  if (normalized) {
    return SpreadsheetApp.openById(normalized);
  }

  const props = PropertiesService.getScriptProperties();
  const propId = safeString_(props.getProperty('SPREADSHEET_ID'));
  if (propId) {
    return SpreadsheetApp.openById(propId);
  }

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }

  throw new Error('No spreadsheet found. Bind the script to a workbook or set SPREADSHEET_ID in Script Properties.');
}

function getSpreadsheet_() {
  return openTargetSpreadsheet_('');
}

function getDriveFolder_(input) {
  const props = PropertiesService.getScriptProperties();
  const folderId = safeString_((input && (input.folderId || input.driveFolderId)) || props.getProperty('DRIVE_FOLDER_ID'));
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (error) {
      // fall back to folder name
    }
  }

  const folderName = safeString_((input && (input.folderName || input.driveFolderName)) || props.getProperty('DRIVE_FOLDER_NAME') || HELP360.DRIVE_FOLDER_NAME);
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

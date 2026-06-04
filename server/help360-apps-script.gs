const HELP360_SHEETS = {
  shared: 'SharedState',
  reports: 'Reports',
  staff: 'StaffDirectory',
  sessions: 'AuthSessions',
  resets: 'PinResetRequests'
};

const HELP360_HEADERS = {
  shared: ['scope', 'record_count', 'updated_at', 'payload_json'],
  reports: [
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
    'sheet_synced',
    'attachment_count',
    'attachment_names_json',
    'task_details_json',
    'assigned_responsibilities_json',
    'submitted_at',
    'updated_at',
    'payload_json'
  ],
  staff: [
    'staff_id',
    'user_id',
    'full_name',
    'role',
    'status',
    'default_department',
    'allowed_departments',
    'pin',
    'password',
    'force_pin_reset',
    'last_login_at',
    'last_pin_reset_at',
    'notes',
    'created_at',
    'updated_at'
  ],
  sessions: [
    'session_token',
    'user_id',
    'full_name',
    'role',
    'department',
    'status',
    'created_at',
    'expires_at',
    'last_validated_at',
    'revoked_at',
    'client_ip',
    'user_agent',
    'extra_json'
  ],
  resets: [
    'request_id',
    'user_id',
    'requested_from',
    'notes',
    'status',
    'reset_token',
    'created_at',
    'updated_at',
    'resolved_at',
    'payload_json'
  ]
};

const HELP360_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HELP360_SCOPE_ORDER = [
  'settings',
  'manager_account',
  'manager_approver',
  'passwords',
  'custom_responsibilities',
  'employees',
  'leave_requests',
  'announcements',
  'audit_log',
  'disciplinary_actions',
  'job_posts',
  'candidates',
  'document_center',
  'self_service_requests',
  'timeline_events',
  'notifications',
  'attendance_config',
  'attendance_records',
  'payroll_runs',
  'loans',
  'final_settlements'
];

function doGet(e) {
  try {
    const action = normalizeAction_(getParam_(e, 'action'));
    const spreadsheet = resolveSpreadsheet_(getParam_(e, 'sheetId'));
    if (action === 'snapshot') {
      return jsonResponse_(buildSnapshot_(spreadsheet));
    }
    if (action === 'scope') {
      return jsonResponse_(readScope_(spreadsheet, getParam_(e, 'scope')));
    }
    if (action === 'reports') {
      return jsonResponse_(readReports_(spreadsheet));
    }
    if (action === 'validate-session') {
      return jsonResponse_(validateSession_(spreadsheet, getParam_(e, 'sessionToken')));
    }
    return jsonResponse_({
      ok: true,
      service: 'help360-apps-script',
      action: action || 'status',
      time: nowIso_()
    });
  } catch (error) {
    return jsonResponse_(errorPayload_(error));
  }
}

function doPost(e) {
  try {
    const input = parseRequestBody_(e);
    const action = normalizeAction_(input.action);
    const spreadsheet = resolveSpreadsheet_(input.sheetId || getParam_(e, 'sheetId'));
    return withScriptLock_(function () {
      if (action === 'upsert_scope') {
        return jsonResponse_(upsertScope_(spreadsheet, input));
      }
      if (action === 'upsert_report') {
        return jsonResponse_(upsertReport_(spreadsheet, input));
      }
      if (action === 'upsert_staff_directory') {
        return jsonResponse_(upsertStaffDirectory_(spreadsheet, input));
      }
      if (action === 'login') {
        return jsonResponse_(login_(spreadsheet, input));
      }
      if (action === 'logout') {
        return jsonResponse_(logout_(spreadsheet, input));
      }
      if (action === 'request-pin-reset') {
        return jsonResponse_(requestPinReset_(spreadsheet, input));
      }
      if (action === 'complete-pin-reset') {
        return jsonResponse_(completePinReset_(spreadsheet, input));
      }
      return jsonResponse_({
        ok: false,
        error: `Unsupported action: ${action || 'unknown'}.`
      });
    });
  } catch (error) {
    return jsonResponse_(errorPayload_(error));
  }
}

function buildSnapshot_(spreadsheet) {
  const sharedRows = readSharedRows_(spreadsheet);
  const reportRows = readReportsRows_(spreadsheet);
  return {
    ok: true,
    snapshot: {
      generatedAt: nowIso_(),
      shared: mergeDerivedPasswordsRow_(spreadsheet, sharedRows),
      reports: reportRows
    }
  };
}

function readScope_(spreadsheet, scope) {
  const normalizedScope = trimText_(scope);
  if (!normalizedScope) {
    return { ok: false, error: 'Missing scope.' };
  }
  const row = normalizedScope === 'passwords'
    ? buildPasswordScopeRow_(spreadsheet)
    : readSharedScopeRow_(spreadsheet, normalizedScope);
  if (!row) {
    return { ok: false, error: `Scope not found: ${normalizedScope}.` };
  }
  return { ok: true, row };
}

function readReports_(spreadsheet) {
  return {
    ok: true,
    rows: readReportsRows_(spreadsheet)
  };
}

function upsertScope_(spreadsheet, input) {
  const scope = trimText_(input.scope);
  if (!scope) {
    return { ok: false, error: 'Missing scope.' };
  }
  if (scope === 'passwords') {
    const passwordMap = normalizePasswordMap_(input.payload);
    const staffResult = updateStaffPasswordsFromMap_(spreadsheet, passwordMap);
    const row = writeSharedScopeRow_(
      spreadsheet,
      'passwords',
      passwordMap,
      Object.keys(passwordMap).length,
      input.updatedAt || nowIso_()
    );
    return {
      ok: true,
      action: 'upsert_scope',
      scope: 'passwords',
      row: row,
      staffUpdated: staffResult.updated
    };
  }

  const payload = input.payload === undefined ? null : input.payload;
  const row = writeSharedScopeRow_(
    spreadsheet,
    scope,
    payload,
    input.recordCount,
    input.updatedAt || nowIso_()
  );
  return {
    ok: true,
    action: 'upsert_scope',
    scope: scope,
    row: row
  };
}

function upsertReport_(spreadsheet, input) {
  const row = normalizeReportInput_(input);
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.reports, HELP360_HEADERS.reports);
  upsertRowByKey_(sheet, row.report_id, HELP360_HEADERS.reports, row);
  return {
    ok: true,
    action: 'upsert_report',
    reportId: row.report_id,
    row: mapReportRowForClient_(row)
  };
}

function upsertStaffDirectory_(spreadsheet, input) {
  const staffList = Array.isArray(input.staff) ? input.staff : [];
  const existingRows = readStaffRows_(spreadsheet);
  const existingByKey = {};
  existingRows.forEach((row) => {
    const key = staffRecordKey_(row);
    if (key) existingByKey[key] = row;
  });

  const nextRows = staffList
    .map((item) => normalizeStaffInput_(item))
    .filter((item) => item.staff_id || item.user_id || item.full_name)
    .map((item) => mergeStaffRecord_(existingByKey[staffRecordKey_(item)] || null, item, nowIso_()));

  writeTableRows_(spreadsheet, HELP360_SHEETS.staff, HELP360_HEADERS.staff, nextRows);
  writeSharedScopeRow_(
    spreadsheet,
    'passwords',
    buildPasswordMapFromStaffRows_(nextRows),
    nextRows.filter((row) => row.role === 'employee').length,
    input.updatedAt || nowIso_()
  );
  return {
    ok: true,
    action: 'upsert_staff_directory',
    count: nextRows.length
  };
}

function login_(spreadsheet, input) {
  const userId = trimText_(input.userId);
  const pin = trimText_(input.pin);
  if (!userId || !pin) {
    return { ok: false, error: 'User ID and password are required.' };
  }
  const staffRows = readStaffRows_(spreadsheet);
  const staff = findStaffByLogin_(staffRows, userId);
  if (!staff) {
    return { ok: false, error: 'Invalid credentials.' };
  }
  if (normalizeStatus_(staff.status) !== 'ACTIVE') {
    return { ok: false, error: 'Account is inactive.' };
  }
  if (trimText_(staff.pin) !== pin) {
    return { ok: false, error: 'Incorrect password.' };
  }
  const requiresPinReset = isTruthy_(staff.force_pin_reset) || !trimText_(staff.pin);
  if (!requiresPinReset) {
    const updated = updateStaffRow_(spreadsheet, staff, {
      last_login_at: nowIso_(),
      updated_at: nowIso_()
    });
    if (updated) {
      staff.last_login_at = updated.last_login_at;
      staff.updated_at = updated.updated_at;
    }
  }
  return {
    ok: true,
    requiresPinReset: requiresPinReset,
    session: requiresPinReset ? null : createSessionRecord_(spreadsheet, staff, trimText_(input.department), false)
  };
}

function logout_(spreadsheet, input) {
  const token = trimText_(input.sessionToken);
  if (!token) {
    return { ok: true };
  }
  const result = updateSessionRow_(spreadsheet, token, {
    status: 'REVOKED',
    revoked_at: nowIso_(),
    last_validated_at: nowIso_(),
    updated_at: nowIso_()
  });
  return {
    ok: true,
    revoked: Boolean(result)
  };
}

function requestPinReset_(spreadsheet, input) {
  const userId = trimText_(input.userId);
  if (!userId) {
    return { ok: false, error: 'User ID is required.' };
  }
  const staffRows = readStaffRows_(spreadsheet);
  const staff = findStaffByLogin_(staffRows, userId);
  if (!staff) {
    return { ok: false, error: 'Account not found.' };
  }
  const resetToken = Utilities.getUuid();
  const now = nowIso_();
  updateStaffRow_(spreadsheet, staff, {
    force_pin_reset: true,
    updated_at: now
  });
  const requestRow = {
    request_id: Utilities.getUuid(),
    user_id: staff.user_id,
    requested_from: trimText_(input.requestedFrom),
    notes: trimText_(input.notes),
    status: 'OPEN',
    reset_token: resetToken,
    created_at: now,
    updated_at: now,
    resolved_at: '',
    payload_json: JSON.stringify({
      userId: staff.user_id,
      requestedFrom: trimText_(input.requestedFrom),
      notes: trimText_(input.notes)
    })
  };
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.resets, HELP360_HEADERS.resets);
  upsertRowByKey_(sheet, requestRow.request_id, HELP360_HEADERS.resets, requestRow);
  return {
    ok: true,
    request: requestRow
  };
}

function completePinReset_(spreadsheet, input) {
  const userId = trimText_(input.userId);
  const currentPin = trimText_(input.currentPin);
  const newPin = trimText_(input.newPin);
  const confirmPin = trimText_(input.confirmPin);
  if (!userId || !currentPin || !newPin || !confirmPin) {
    return { ok: false, error: 'All PIN fields are required.' };
  }
  if (newPin !== confirmPin) {
    return { ok: false, error: 'New PIN entries do not match.' };
  }
  const staffRows = readStaffRows_(spreadsheet);
  const staff = findStaffByLogin_(staffRows, userId);
  if (!staff) {
    return { ok: false, error: 'Account not found.' };
  }
  if (trimText_(staff.pin) !== currentPin) {
    return { ok: false, error: 'Current PIN is incorrect.' };
  }
  const now = nowIso_();
  const updated = updateStaffRow_(spreadsheet, staff, {
    pin: newPin,
    password: newPin,
    force_pin_reset: false,
    last_pin_reset_at: now,
    updated_at: now
  });
  markResetRequestsResolved_(spreadsheet, staff.user_id, now);
  const session = createSessionRecord_(spreadsheet, updated || staff, trimText_(input.department), true);
  return {
    ok: true,
    session: session
  };
}

function validateSession_(spreadsheet, sessionToken) {
  const token = trimText_(sessionToken);
  if (!token) {
    return { ok: false, error: 'Session token missing.' };
  }
  const session = readSessionByToken_(spreadsheet, token);
  if (!session) {
    return { ok: false, error: 'Session not found.' };
  }
  if (trimText_(session.status) === 'REVOKED') {
    return { ok: false, error: 'Session expired.' };
  }
  const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
  if (!expiresAt || isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    updateSessionRow_(spreadsheet, token, {
      status: 'EXPIRED',
      revoked_at: nowIso_(),
      last_validated_at: nowIso_(),
      updated_at: nowIso_()
    });
    return { ok: false, error: 'Session expired.' };
  }
  const now = nowIso_();
  const updated = updateSessionRow_(spreadsheet, token, {
    last_validated_at: now,
    updated_at: now
  });
  return {
    ok: true,
    session: Object.assign({}, session, updated ? { last_validated_at: updated.last_validated_at, updated_at: updated.updated_at } : {}, {
      sessionToken: session.session_token
    })
  };
}

function createSessionRecord_(spreadsheet, staff, department, forceReset) {
  const now = nowIso_();
  const session = {
    session_token: Utilities.getUuid(),
    user_id: trimText_(staff.user_id),
    full_name: trimText_(staff.full_name),
    role: normalizeRole_(staff.role),
    department: trimText_(department) || trimText_(staff.default_department) || 'Operations',
    status: 'ACTIVE',
    created_at: now,
    expires_at: new Date(Date.now() + HELP360_SESSION_TTL_MS).toISOString(),
    last_validated_at: now,
    revoked_at: '',
    client_ip: '',
    user_agent: '',
    extra_json: JSON.stringify({
      staffId: trimText_(staff.staff_id),
      requiresPinReset: Boolean(forceReset)
    })
  };
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.sessions, HELP360_HEADERS.sessions);
  upsertRowByKey_(sheet, session.session_token, HELP360_HEADERS.sessions, session);
  return Object.assign({
    sessionToken: session.session_token,
    userId: session.user_id,
    fullName: session.full_name,
    role: session.role,
    department: session.department,
    status: session.status,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    lastValidatedAt: session.last_validated_at
  });
}

function updateSessionRow_(spreadsheet, sessionToken, updates) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.sessions, HELP360_HEADERS.sessions);
  const rows = readSheetObjects_(sheet);
  const index = rows.findIndex((row) => trimText_(row.session_token) === trimText_(sessionToken));
  if (index < 0) {
    return null;
  }
  const current = rows[index];
  const next = Object.assign({}, current, updates || {});
  next.extra_json = trimText_(next.extra_json) || trimText_(current.extra_json);
  rows[index] = next;
  writeTableRows_(spreadsheet, HELP360_SHEETS.sessions, HELP360_HEADERS.sessions, rows);
  return next;
}

function mapSessionRowForClient_(row) {
  const mapped = {
    session_token: trimText_(row.session_token),
    user_id: trimText_(row.user_id),
    full_name: trimText_(row.full_name),
    role: normalizeRole_(row.role),
    department: trimText_(row.department),
    status: trimText_(row.status || 'ACTIVE') || 'ACTIVE',
    created_at: trimText_(row.created_at),
    expires_at: trimText_(row.expires_at),
    last_validated_at: trimText_(row.last_validated_at),
    revoked_at: trimText_(row.revoked_at),
    client_ip: trimText_(row.client_ip),
    user_agent: trimText_(row.user_agent),
    extra_json: trimText_(row.extra_json)
  };
  mapped.sessionToken = mapped.session_token;
  mapped.userId = mapped.user_id;
  mapped.fullName = mapped.full_name;
  mapped.createdAt = mapped.created_at;
  mapped.expiresAt = mapped.expires_at;
  mapped.lastValidatedAt = mapped.last_validated_at;
  mapped.revokedAt = mapped.revoked_at;
  return mapped;
}

function readSessionByToken_(spreadsheet, sessionToken) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.sessions, HELP360_HEADERS.sessions);
  const rows = readSheetObjects_(sheet);
  const found = rows.find((row) => trimText_(row.session_token) === trimText_(sessionToken));
  if (!found) return null;
  return mapSessionRowForClient_(found);
}

function updateStaffRow_(spreadsheet, existingRow, updates) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.staff, HELP360_HEADERS.staff);
  const rows = readStaffRows_(spreadsheet);
  const key = staffRecordKey_(existingRow);
  const index = rows.findIndex((row) => staffRecordKey_(row) === key);
  if (index < 0) {
    return null;
  }
  const merged = mergeStaffRecord_(rows[index], Object.assign({}, existingRow, updates || {}), nowIso_());
  rows[index] = merged;
  writeTableRows_(spreadsheet, HELP360_SHEETS.staff, HELP360_HEADERS.staff, rows);
  writeSharedScopeRow_(
    spreadsheet,
    'passwords',
    buildPasswordMapFromStaffRows_(rows),
    rows.filter((row) => row.role === 'employee').length,
    nowIso_()
  );
  return merged;
}

function markResetRequestsResolved_(spreadsheet, userId, resolvedAt) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.resets, HELP360_HEADERS.resets);
  const rows = readSheetObjects_(sheet);
  let changed = false;
  rows.forEach((row) => {
    if (trimText_(row.user_id) !== trimText_(userId)) return;
    if (trimText_(row.status).toUpperCase() !== 'OPEN') return;
    row.status = 'COMPLETED';
    row.resolved_at = resolvedAt;
    row.updated_at = resolvedAt;
    changed = true;
  });
  if (changed) {
    writeTableRows_(spreadsheet, HELP360_SHEETS.resets, HELP360_HEADERS.resets, rows);
  }
}

function readSharedRows_(spreadsheet) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.shared, HELP360_HEADERS.shared);
  const rows = readSheetObjects_(sheet);
  return rows
    .map((row) => mapSharedRowForClient_(row))
    .filter((row) => row.scope);
}

function readSharedScopeRow_(spreadsheet, scope) {
  if (trimText_(scope) === 'passwords') {
    return buildPasswordScopeRow_(spreadsheet);
  }
  const rows = readSharedRows_(spreadsheet);
  return rows.find((row) => trimText_(row.scope) === trimText_(scope)) || null;
}

function buildPasswordScopeRow_(spreadsheet) {
  const staffRows = readStaffRows_(spreadsheet);
  const payload = buildPasswordMapFromStaffRows_(staffRows);
  const now = nowIso_();
  return {
    scope: 'passwords',
    record_count: Object.keys(payload).length,
    updated_at: latestTimestamp_(staffRows.map((row) => row.updated_at).concat([now])),
    payload: payload,
    payload_json: JSON.stringify(payload)
  };
}

function mergeDerivedPasswordsRow_(spreadsheet, sharedRows) {
  const rows = sharedRows.slice();
  const passwordsRow = buildPasswordScopeRow_(spreadsheet);
  const index = rows.findIndex((row) => trimText_(row.scope) === 'passwords');
  if (index >= 0) {
    rows[index] = passwordsRow;
  } else {
    rows.push(passwordsRow);
  }
  return sortSharedRows_(rows);
}

function writeSharedScopeRow_(spreadsheet, scope, payload, recordCount, updatedAt) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.shared, HELP360_HEADERS.shared);
  const row = {
    scope: trimText_(scope),
    record_count: computeRecordCount_(payload, recordCount),
    updated_at: trimText_(updatedAt) || nowIso_(),
    payload_json: serializeJson_(payload),
    payload: cloneValue_(payload)
  };
  upsertRowByKey_(sheet, row.scope, HELP360_HEADERS.shared, row);
  return mapSharedRowForClient_(row);
}

function readReportsRows_(spreadsheet) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.reports, HELP360_HEADERS.reports);
  const rows = readSheetObjects_(sheet);
  return rows
    .map((row) => mapReportRowForClient_(row))
    .filter((row) => row.report_id)
    .sort((left, right) => {
      const leftTime = new Date(left.submitted_at || left.updated_at || 0).getTime();
      const rightTime = new Date(right.submitted_at || right.updated_at || 0).getTime();
      return rightTime - leftTime;
    });
}

function readStaffRows_(spreadsheet) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.staff, HELP360_HEADERS.staff);
  return readSheetObjects_(sheet).map((row) => mapStaffRowForClient_(row));
}

function updateStaffPasswordsFromMap_(spreadsheet, passwordMap) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.staff, HELP360_HEADERS.staff);
  const rows = readSheetObjects_(sheet).map((row) => mapStaffRowForClient_(row));
  let updated = 0;
  const nextRows = rows.map((row) => {
    if (normalizeRole_(row.role) !== 'employee') {
      return row;
    }
    const key = trimText_(row.full_name) || trimText_(row.user_id);
    if (!Object.prototype.hasOwnProperty.call(passwordMap, key)) {
      return row;
    }
    const next = Object.assign({}, row, {
      pin: trimText_(passwordMap[key]),
      password: trimText_(passwordMap[key]),
      updated_at: nowIso_()
    });
    updated += 1;
    return next;
  });
  writeTableRows_(spreadsheet, HELP360_SHEETS.staff, HELP360_HEADERS.staff, nextRows);
  return { updated: updated, rows: nextRows };
}

function findStaffByLogin_(staffRows, userId) {
  const normalized = trimText_(userId).toLowerCase();
  return (staffRows || []).find((row) => {
    const userMatch = trimText_(row.user_id).toLowerCase() === normalized;
    const nameMatch = trimText_(row.full_name).toLowerCase() === normalized;
    return userMatch || nameMatch;
  }) || null;
}

function buildPasswordMapFromStaffRows_(staffRows) {
  const map = {};
  (staffRows || []).forEach((row) => {
    if (normalizeRole_(row.role) !== 'employee') return;
    const key = trimText_(row.full_name);
    if (!key) return;
    map[key] = trimText_(row.pin || row.password || '');
  });
  return map;
}

function normalizeReportInput_(input) {
  const attachmentNames = normalizeArray_(input.attachmentNames || input.attachment_names);
  const taskDetails = parseJsonMaybe_(input.taskDetails || input.task_details, {});
  const responsibilities = normalizeArray_(input.assignedResponsibilities || input.assigned_responsibilities);
  const payload = {
    reportId: trimText_(input.reportId || input.report_id || input.id),
    employee: trimText_(input.employee),
    employeeEmail: trimText_(input.employeeEmail || input.employee_email),
    employeeTitle: trimText_(input.employeeTitle || input.employee_title),
    department: trimText_(input.department || 'Operations') || 'Operations',
    date: trimText_(input.date || input.report_date || input.dateDisplay),
    time: trimText_(input.time || input.report_time),
    totalTasks: toNumber_(input.totalTasks || input.total_tasks, 0),
    totalCount: toNumber_(input.totalCount || input.total_count, 0),
    status: trimText_(input.status || 'sent') || 'sent',
    notes: trimText_(input.notes),
    emailMethod: trimText_(input.emailMethod || input.email_method),
    sheetSynced: isTruthy_(input.sheetSynced || input.sheet_synced),
    attachmentCount: toNumber_(input.attachmentCount || input.attachment_count, attachmentNames.length),
    attachmentNames: attachmentNames,
    taskDetails: taskDetails,
    assignedResponsibilities: responsibilities,
    submittedAt: trimText_(input.submittedAt || input.submitted_at || nowIso_()),
    updatedAt: nowIso_()
  };
  return {
    report_id: payload.reportId || String(Date.now()),
    employee: payload.employee,
    employee_email: payload.employeeEmail,
    employee_title: payload.employeeTitle,
    department: payload.department,
    report_date: payload.date,
    report_time: payload.time,
    total_tasks: payload.totalTasks,
    total_count: payload.totalCount,
    status: payload.status,
    notes: payload.notes,
    email_method: payload.emailMethod,
    sheet_synced: Boolean(payload.sheetSynced),
    attachment_count: payload.attachmentCount,
    attachment_names_json: serializeJson_(attachmentNames),
    task_details_json: serializeJson_(taskDetails),
    assigned_responsibilities_json: serializeJson_(responsibilities),
    submitted_at: payload.submittedAt,
    updated_at: payload.updatedAt,
    payload_json: serializeJson_(payload)
  };
}

function mapReportRowForClient_(row) {
  const attachmentNames = parseJsonMaybe_(row.attachment_names_json, []);
  const taskDetails = parseJsonMaybe_(row.task_details_json, {});
  const responsibilities = parseJsonMaybe_(row.assigned_responsibilities_json, []);
  const payload = parseJsonMaybe_(row.payload_json, null);
  const mapped = {
    report_id: trimText_(row.report_id),
    employee: trimText_(row.employee),
    employee_email: trimText_(row.employee_email),
    employee_title: trimText_(row.employee_title),
    department: trimText_(row.department),
    report_date: trimText_(row.report_date),
    report_time: trimText_(row.report_time),
    total_tasks: toNumber_(row.total_tasks, 0),
    total_count: toNumber_(row.total_count, 0),
    status: trimText_(row.status || 'sent') || 'sent',
    notes: trimText_(row.notes),
    email_method: trimText_(row.email_method),
    sheet_synced: isTruthy_(row.sheet_synced),
    attachment_count: toNumber_(row.attachment_count, Array.isArray(attachmentNames) ? attachmentNames.length : 0),
    attachment_names: Array.isArray(attachmentNames) ? attachmentNames : [],
    task_details: taskDetails && typeof taskDetails === 'object' ? taskDetails : {},
    assigned_responsibilities: Array.isArray(responsibilities) ? responsibilities : [],
    submitted_at: trimText_(row.submitted_at || row.updated_at),
    updated_at: trimText_(row.updated_at),
    payload_json: trimText_(row.payload_json),
    payload: payload && typeof payload === 'object' ? payload : null
  };
  mapped.reportId = mapped.report_id;
  mapped.employeeEmail = mapped.employee_email;
  mapped.employeeTitle = mapped.employee_title;
  mapped.reportDate = mapped.report_date;
  mapped.reportTime = mapped.report_time;
  mapped.totalTasks = mapped.total_tasks;
  mapped.totalCount = mapped.total_count;
  mapped.emailMethod = mapped.email_method;
  mapped.sheetSynced = mapped.sheet_synced;
  mapped.attachmentNames = mapped.attachment_names;
  mapped.taskDetails = mapped.task_details;
  mapped.assignedResponsibilities = mapped.assigned_responsibilities;
  return mapped;
}

function normalizeStaffInput_(input) {
  const incoming = input && typeof input === 'object' ? input : {};
  const staffId = trimText_(incoming.staffId || incoming.staff_id || incoming.employeeId || incoming.employee_id || incoming.id || incoming.userId || incoming.user_id || incoming.fullName || incoming.full_name);
  return {
    staff_id: staffId,
    user_id: trimText_(incoming.userId || incoming.user_id),
    full_name: trimText_(incoming.fullName || incoming.full_name),
    role: normalizeRole_(incoming.role || 'employee'),
    status: normalizeStatus_(incoming.status || 'ACTIVE'),
    default_department: trimText_(incoming.defaultDepartment || incoming.default_department),
    allowed_departments: trimText_(incoming.allowedDepartments || incoming.allowed_departments),
    pin: trimText_(incoming.pin || incoming.password),
    password: trimText_(incoming.password || incoming.pin),
    force_pin_reset: isTruthy_(incoming.forcePinReset || incoming.force_pin_reset),
    last_login_at: trimText_(incoming.lastLoginAt || incoming.last_login_at),
    last_pin_reset_at: trimText_(incoming.lastPinResetAt || incoming.last_pin_reset_at),
    notes: trimText_(incoming.notes),
    created_at: trimText_(incoming.createdAt || incoming.created_at),
    updated_at: trimText_(incoming.updatedAt || incoming.updated_at)
  };
}

function mergeStaffRecord_(existingRow, incomingRow, now) {
  const existing = existingRow && typeof existingRow === 'object' ? existingRow : {};
  const incoming = incomingRow && typeof incomingRow === 'object' ? incomingRow : {};
  const existingPin = trimText_(existing.pin || existing.password);
  const incomingPin = trimText_(incoming.pin || incoming.password);
  const merged = {
    staff_id: trimText_(incoming.staff_id || existing.staff_id),
    user_id: trimText_(incoming.user_id || existing.user_id),
    full_name: trimText_(incoming.full_name || existing.full_name),
    role: normalizeRole_(incoming.role || existing.role),
    status: normalizeStatus_(incoming.status || existing.status || 'ACTIVE'),
    default_department: trimText_(incoming.default_department || existing.default_department),
    allowed_departments: trimText_(incoming.allowed_departments || existing.allowed_departments),
    pin: incomingPin || existingPin,
    password: incomingPin || existingPin,
    force_pin_reset: incoming.force_pin_reset === true ? true : isTruthy_(existing.force_pin_reset),
    last_login_at: trimText_(incoming.last_login_at) || trimText_(existing.last_login_at),
    last_pin_reset_at: trimText_(incoming.last_pin_reset_at) || trimText_(existing.last_pin_reset_at),
    notes: trimText_(incoming.notes || existing.notes),
    created_at: trimText_(existing.created_at || incoming.created_at || now),
    updated_at: trimText_(incoming.updated_at || now)
  };
  if (!merged.staff_id) {
    merged.staff_id = merged.user_id || merged.full_name || Utilities.getUuid();
  }
  if (!merged.user_id) {
    merged.user_id = merged.full_name || merged.staff_id;
  }
  if (!merged.full_name) {
    merged.full_name = merged.user_id || merged.staff_id;
  }
  return merged;
}

function mapStaffRowForClient_(row) {
  return {
    staff_id: trimText_(row.staff_id),
    user_id: trimText_(row.user_id),
    full_name: trimText_(row.full_name),
    role: normalizeRole_(row.role),
    status: normalizeStatus_(row.status),
    default_department: trimText_(row.default_department),
    allowed_departments: trimText_(row.allowed_departments),
    pin: trimText_(row.pin || row.password),
    password: trimText_(row.password || row.pin),
    force_pin_reset: isTruthy_(row.force_pin_reset),
    last_login_at: trimText_(row.last_login_at),
    last_pin_reset_at: trimText_(row.last_pin_reset_at),
    notes: trimText_(row.notes),
    created_at: trimText_(row.created_at),
    updated_at: trimText_(row.updated_at)
  };
}

function staffRecordKey_(row) {
  const staffId = trimText_(row && (row.staff_id || row.staffId || row.employeeId || row.id));
  if (staffId) return `staff:${staffId.toLowerCase()}`;
  const userId = trimText_(row && (row.user_id || row.userId));
  if (userId) return `user:${userId.toLowerCase()}`;
  const fullName = trimText_(row && (row.full_name || row.fullName));
  if (fullName) return `name:${fullName.toLowerCase()}`;
  return '';
}

function normalizePasswordMap_(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const map = {};
  Object.keys(value).forEach((key) => {
    const nextKey = trimText_(key);
    if (!nextKey) return;
    map[nextKey] = trimText_(value[key]);
  });
  return map;
}

function mapSharedRowForClient_(row) {
  const payload = parseJsonMaybe_(row.payload_json, null);
  const mapped = {
    scope: trimText_(row.scope),
    record_count: toNumber_(row.record_count, 0),
    updated_at: trimText_(row.updated_at),
    payload_json: trimText_(row.payload_json),
    payload: payload && typeof payload === 'object' ? payload : payload
  };
  mapped.recordCount = mapped.record_count;
  mapped.updatedAt = mapped.updated_at;
  mapped.payloadJson = mapped.payload_json;
  return mapped;
}

function sortSharedRows_(rows) {
  const order = new Map(HELP360_SCOPE_ORDER.map((scope, index) => [scope, index]));
  return (rows || []).slice().sort((left, right) => {
    const leftIndex = order.has(trimText_(left.scope)) ? order.get(trimText_(left.scope)) : 999;
    const rightIndex = order.has(trimText_(right.scope)) ? order.get(trimText_(right.scope)) : 999;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return trimText_(left.scope).localeCompare(trimText_(right.scope));
  });
}

function readSheetObjects_(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  const headers = (data[0] || []).map((header) => trimText_(header));
  return data
    .slice(1)
    .filter((row) => row.some((cell) => trimText_(cell) !== ''))
    .map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        if (!header) return;
        obj[header] = row[index];
      });
      return obj;
    });
}

function writeTableRows_(spreadsheet, sheetName, headers, rows) {
  const sheet = ensureSheet_(spreadsheet, sheetName, headers);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }
  if (!rows || !rows.length) {
    return sheet;
  }
  const values = rows.map((row) => headers.map((header) => coerceSheetValue_(row[header])));
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  return sheet;
}

function upsertRowByKey_(sheet, keyValue, headers, rowObject) {
  const key = trimText_(keyValue);
  const existing = readSheetObjects_(sheet);
  const index = existing.findIndex((row) => trimText_(row[headers[0]]) === key);
  const prepared = headers.reduce((obj, header) => {
    obj[header] = rowObject[header];
    return obj;
  }, {});
  if (index >= 0) {
    existing[index] = Object.assign({}, existing[index], prepared);
    writeTableRows_(getSpreadsheetFromSheet_(sheet), sheet.getName(), headers, existing);
    return mapRowForHeaderSheet_(prepared, headers);
  }
  existing.push(prepared);
  writeTableRows_(getSpreadsheetFromSheet_(sheet), sheet.getName(), headers, existing);
  return mapRowForHeaderSheet_(prepared, headers);
}

function mapRowForHeaderSheet_(row, headers) {
  const mapped = {};
  headers.forEach((header) => {
    mapped[header] = row[header];
  });
  return mapped;
}

function getSpreadsheetFromSheet_(sheet) {
  return sheet.getParent();
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  if (headers && headers.length && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function resolveSpreadsheet_(sheetId) {
  const explicitId = trimText_(sheetId);
  if (explicitId) {
    return SpreadsheetApp.openById(explicitId);
  }
  const scriptSheetId = trimText_(PropertiesService.getScriptProperties().getProperty('HELP360_SPREADSHEET_ID'));
  if (scriptSheetId) {
    return SpreadsheetApp.openById(scriptSheetId);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  throw new Error('Missing sheetId. Pass sheetId or set HELP360_SPREADSHEET_ID.');
}

function parseRequestBody_(e) {
  const body = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
  if (!body) {
    return Object.assign({}, e && e.parameter ? e.parameter : {});
  }
  const parsed = safeJsonParse_(body, {});
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Request body must be JSON.');
  }
  return parsed;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorPayload_(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : String(error || 'Unknown error')
  };
}

function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function getParam_(e, name) {
  return e && e.parameter && Object.prototype.hasOwnProperty.call(e.parameter, name) ? e.parameter[name] : '';
}

function normalizeAction_(value) {
  return trimText_(value).toLowerCase();
}

function normalizeRole_(value) {
  const role = trimText_(value).toLowerCase();
  if (role === 'hr' || role === 'manager' || role === 'employee') {
    return role;
  }
  return 'employee';
}

function normalizeStatus_(value) {
  const status = trimText_(value).toUpperCase();
  if (status === 'ACTIVE' || status === 'INACTIVE' || status === 'REVOKED' || status === 'EXPIRED') {
    return status;
  }
  return status || 'ACTIVE';
}

function latestTimestamp_(values) {
  const list = Array.isArray(values) ? values : [];
  let latest = '';
  let latestTime = 0;
  list.forEach((value) => {
    const text = trimText_(value);
    if (!text) return;
    const time = new Date(text).getTime();
    if (!isNaN(time) && time >= latestTime) {
      latestTime = time;
      latest = text;
    }
  });
  return latest || nowIso_();
}

function computeRecordCount_(payload, fallback) {
  if (typeof fallback === 'number' && !isNaN(fallback)) {
    return fallback;
  }
  if (Array.isArray(payload)) {
    return payload.length;
  }
  if (payload && typeof payload === 'object') {
    return Object.keys(payload).length;
  }
  return 0;
}

function serializeJson_(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function parseJsonMaybe_(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  return safeJsonParse_(String(value), fallback);
}

function safeJsonParse_(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

function normalizeArray_(value) {
  if (Array.isArray(value)) {
    return value.map((item) => trimText_(item)).filter(Boolean);
  }
  if (!value && value !== 0) {
    return [];
  }
  if (typeof value === 'string') {
    const text = trimText_(value);
    if (!text) return [];
    if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
      const parsed = safeJsonParse_(text, []);
      return Array.isArray(parsed)
        ? parsed.map((item) => trimText_(item)).filter(Boolean)
        : [];
    }
    return text.split(',').map((item) => trimText_(item)).filter(Boolean);
  }
  return [];
}

function coerceSheetValue_(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return serializeJson_(value);
  return value;
}

function trimText_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function toNumber_(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : Number(fallback || 0);
}

function isTruthy_(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = trimText_(value).toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  return Boolean(value);
}

function nowIso_() {
  return new Date().toISOString();
}

function cloneValue_(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

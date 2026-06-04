const HELP360_SHEETS = {
  shared: 'SharedState',
  reports: 'Reports',
  payroll: 'Payroll',
  staff: 'StaffUsers',
  jobs: 'Jobs',
  cvApplications: 'CVApplications',
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
  payroll: [
    'payroll_id',
    'employee_id',
    'employee_name',
    'department',
    'month',
    'year',
    'basic_salary',
    'allowances',
    'deductions',
    'net_salary',
    'generated_by',
    'generated_at',
    'status',
    'employee_viewed_at',
    'payload_json'
  ],
  jobs: [
    'job_id',
    'title',
    'department',
    'location',
    'employment_type',
    'openings',
    'description',
    'closes_on',
    'status',
    'created_at',
    'updated_at',
    'payload_json'
  ],
  staff: [
    'staff_id',
    'user_id',
    'full_name',
    'role',
    'team_lead_id',
    'status',
    'default_department',
    'allowed_departments',
    'pin',
    'password',
    'force_pin_reset',
    'last_login_at',
    'last_activity_at',
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
    'last_activity_at',
    'revoked_at',
    'client_ip',
    'user_agent',
    'extra_json'
  ],
  cvApplications: [
    'application_id',
    'full_name',
    'email',
    'phone',
    'position',
    'job_id',
    'cv_file_name',
    'cv_file_url',
    'drive_file_id',
    'applied_at',
    'status',
    'payload_json'
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

const HELP360_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const HELP360_SESSION_IDLE_MS = 60 * 60 * 1000;
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
    if (!action || action === 'status' || action === 'health') {
      const configuredSheetId = trimText_(getParam_(e, 'sheetId')) ||
        trimText_(PropertiesService.getScriptProperties().getProperty('HELP360_SPREADSHEET_ID'));
      return jsonResponse_({
        ok: true,
        service: 'help360-apps-script',
        action: action || 'status',
        time: nowIso_(),
        spreadsheetConfigured: Boolean(configuredSheetId),
        sheetIdProvided: Boolean(trimText_(getParam_(e, 'sheetId'))),
        scriptPropertyConfigured: Boolean(trimText_(PropertiesService.getScriptProperties().getProperty('HELP360_SPREADSHEET_ID')))
      });
    }
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
    if (action === 'jobs') {
      return jsonResponse_(readJobs_(spreadsheet));
    }
    if (action === 'payroll') {
      return jsonResponse_(readPayroll_(spreadsheet));
    }
    if (action === 'my_payroll') {
      return jsonResponse_(readMyPayroll_(spreadsheet, getParam_(e, 'userId')));
    }
    if (action === 'cv_applications') {
      return jsonResponse_(readCvApplications_(spreadsheet));
    }
    if (action === 'team_members') {
      return jsonResponse_(readTeamMembers_(spreadsheet, getParam_(e, 'teamLeadId'), getParam_(e, 'userId')));
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
      if (action === 'upsert_payroll') {
        return jsonResponse_(upsertPayroll_(spreadsheet, input));
      }
      if (action === 'upsert_staff_directory') {
        return jsonResponse_(upsertStaffDirectory_(spreadsheet, input));
      }
      if (action === 'upload_cv') {
        return jsonResponse_(uploadCvApplication_(spreadsheet, input));
      }
      if (action === 'rename_employee') {
        return jsonResponse_(renameEmployeeEverywhere_(spreadsheet, input));
      }
      if (action === 'login') {
        return jsonResponse_(login_(spreadsheet, input));
      }
      if (action === 'logout') {
        return jsonResponse_(logout_(spreadsheet, input));
      }
      if (action === 'revoke-session') {
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
      reports: reportRows,
      payroll: readPayrollRows_(spreadsheet),
      jobs: readJobRows_(spreadsheet),
      cvApplications: readCvApplicationRows_(spreadsheet)
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

function readJobs_(spreadsheet) {
  return {
    ok: true,
    rows: readJobRows_(spreadsheet)
  };
}

function readPayroll_(spreadsheet) {
  return {
    ok: true,
    rows: readPayrollRows_(spreadsheet)
  };
}

function readMyPayroll_(spreadsheet, userId) {
  const normalized = trimText_(userId).toLowerCase();
  if (!normalized) {
    return { ok: false, error: 'Missing userId.' };
  }
  const rows = readPayrollRows_(spreadsheet).filter((row) => {
    const matchesEmployeeId = trimText_(row.employee_id).toLowerCase() === normalized;
    const matchesEmployeeName = trimText_(row.employee_name).toLowerCase() === normalized;
    return matchesEmployeeId || matchesEmployeeName;
  });
  return {
    ok: true,
    rows: rows
  };
}

function readCvApplications_(spreadsheet) {
  return {
    ok: true,
    rows: readCvApplicationRows_(spreadsheet)
  };
}

function readTeamMembers_(spreadsheet, teamLeadId, userId) {
  const staffRows = readStaffRows_(spreadsheet);
  const leadKey = trimText_(teamLeadId) || trimText_(userId);
  if (!leadKey) {
    return { ok: false, error: 'Missing teamLeadId.' };
  }
  const normalizedLeadKey = leadKey.toLowerCase();
  const leadRows = staffRows.filter((row) => {
    const assignedLeadId = trimText_(row.team_lead_id).toLowerCase();
    return assignedLeadId && assignedLeadId === normalizedLeadKey;
  });
  return {
    ok: true,
    rows: leadRows
  };
}

function normalizeJobInput_(input) {
  const incoming = input && typeof input === 'object' ? input : {};
  const now = nowIso_();
  const jobId = trimText_(incoming.jobId || incoming.job_id || incoming.id);
  const payload = {
    jobId: jobId || Utilities.getUuid(),
    title: trimText_(incoming.title || 'Open Role') || 'Open Role',
    department: trimText_(incoming.department || 'Operations') || 'Operations',
    location: trimText_(incoming.location || 'Remote') || 'Remote',
    employmentType: trimText_(incoming.employmentType || incoming.employment_type || 'Full Time') || 'Full Time',
    openings: Math.max(toNumber_(incoming.openings, 1), 1),
    description: trimText_(incoming.description),
    closesOn: trimText_(incoming.closesOn || incoming.closes_on),
    status: trimText_(incoming.status || 'Open') || 'Open',
    createdAt: trimText_(incoming.createdAt || incoming.created_at || now),
    updatedAt: trimText_(incoming.updatedAt || incoming.updated_at || now)
  };
  return {
    job_id: payload.jobId,
    title: payload.title,
    department: payload.department,
    location: payload.location,
    employment_type: payload.employmentType,
    openings: payload.openings,
    description: payload.description,
    closes_on: payload.closesOn,
    status: payload.status,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
    payload_json: serializeJson_(payload)
  };
}

function mapJobRowForClient_(row) {
  const payload = parseJsonMaybe_(row.payload_json, null);
  const mapped = {
    job_id: trimText_(row.job_id),
    title: trimText_(row.title),
    department: trimText_(row.department),
    location: trimText_(row.location),
    employment_type: trimText_(row.employment_type),
    openings: Math.max(toNumber_(row.openings, 1), 1),
    description: trimText_(row.description),
    closes_on: trimText_(row.closes_on),
    status: trimText_(row.status || 'Open') || 'Open',
    created_at: trimText_(row.created_at),
    updated_at: trimText_(row.updated_at),
    payload_json: trimText_(row.payload_json),
    payload: payload && typeof payload === 'object' ? payload : null
  };
  mapped.id = mapped.job_id;
  mapped.jobId = mapped.job_id;
  mapped.employmentType = mapped.employment_type;
  mapped.closesOn = mapped.closes_on;
  mapped.createdAt = mapped.created_at;
  mapped.updatedAt = mapped.updated_at;
  return mapped;
}

function writeJobRowsFromPayload_(spreadsheet, payload, updatedAt) {
  const inputRows = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const rows = inputRows
    .map((item) => normalizeJobInput_(item))
    .filter((row) => row.job_id || row.title);
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.jobs, HELP360_HEADERS.jobs);
  writeTableRows_(spreadsheet, HELP360_SHEETS.jobs, HELP360_HEADERS.jobs, rows);
  return rows.map((row) => mapJobRowForClient_(row));
}

function readJobRows_(spreadsheet) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.jobs, HELP360_HEADERS.jobs);
  const directRows = readSheetObjects_(sheet)
    .map((row) => mapJobRowForClient_(row))
    .filter((row) => row.job_id || row.title);
  if (directRows.length) {
    return directRows.sort((left, right) => {
      const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightTime - leftTime;
    });
  }
  const sharedRow = readSharedScopeRow_(spreadsheet, 'job_posts');
  const payload = sharedRow && sharedRow.payload ? sharedRow.payload : parseJsonMaybe_(sharedRow && sharedRow.payload_json, []);
  const fallbackRows = Array.isArray(payload)
    ? payload.map((item) => mapJobRowForClient_(normalizeJobInput_(item)))
    : [];
  return fallbackRows.sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });
}

function resolvePayrollDepartment_(spreadsheet, payrollRow) {
  const explicit = trimText_(payrollRow.department);
  if (explicit) {
    return explicit;
  }
  const staffRows = readStaffRows_(spreadsheet);
  const employeeKey = trimText_(payrollRow.employee_id || payrollRow.employeeId || payrollRow.employee_name || payrollRow.employeeName).toLowerCase();
  if (!employeeKey) {
    return 'Operations';
  }
  const staffMatch = staffRows.find((row) => {
    const staffId = trimText_(row.staff_id).toLowerCase();
    const userId = trimText_(row.user_id).toLowerCase();
    const fullName = trimText_(row.full_name).toLowerCase();
    return employeeKey === staffId || employeeKey === userId || employeeKey === fullName;
  });
  return trimText_(staffMatch && staffMatch.default_department) || 'Operations';
}

function normalizePayrollInput_(spreadsheet, input) {
  const incoming = input && typeof input === 'object' ? input : {};
  const now = nowIso_();
  const employeeId = trimText_(incoming.employeeId || incoming.employee_id || incoming.userId || incoming.user_id || incoming.id);
  const employeeName = trimText_(incoming.employeeName || incoming.employee_name || incoming.fullName || incoming.full_name || '');
  const month = trimText_(incoming.month || '');
  const year = trimText_(incoming.year || (month && month.indexOf('-') > -1 ? month.split('-')[0] : ''));
  const generatedAt = trimText_(incoming.generatedAt || incoming.generated_at || now);
  const basicSalary = Math.max(toNumber_(incoming.basicSalary || incoming.basic_salary, 0), 0);
  const allowances = Math.max(toNumber_(incoming.allowances, 0), 0);
  const deductions = Math.max(toNumber_(incoming.deductions, 0), 0);
  const netSalary = Math.max(toNumber_(incoming.netSalary || incoming.net_salary || incoming.netPay || incoming.net_pay, 0), 0);
  const generatedBy = trimText_(incoming.generatedBy || incoming.generated_by || incoming.generatedByName || '');
  const employeeViewedAt = trimText_(incoming.employeeViewedAt || incoming.employee_viewed_at);
  const payload = {
    payrollId: trimText_(incoming.payrollId || incoming.payroll_id || incoming.id) || Utilities.getUuid(),
    employeeId: employeeId,
    employeeName: employeeName,
    department: trimText_(incoming.department || resolvePayrollDepartment_(spreadsheet, incoming) || 'Operations') || 'Operations',
    month: month,
    year: year || (month && month.indexOf('-') > -1 ? month.split('-')[0] : ''),
    basicSalary: basicSalary,
    allowances: allowances,
    deductions: deductions,
    netSalary: netSalary,
    generatedBy: generatedBy || 'HR',
    generatedAt: generatedAt,
    status: trimText_(incoming.status || 'Generated') || 'Generated',
    employeeViewedAt: employeeViewedAt,
    payload: cloneValue_(incoming)
  };
  if (!payload.department) {
    payload.department = 'Operations';
  }
  return {
    payroll_id: payload.payrollId,
    employee_id: payload.employeeId,
    employee_name: payload.employeeName,
    department: payload.department,
    month: payload.month,
    year: payload.year,
    basic_salary: payload.basicSalary,
    allowances: payload.allowances,
    deductions: payload.deductions,
    net_salary: payload.netSalary,
    generated_by: payload.generatedBy,
    generated_at: payload.generatedAt,
    status: payload.status,
    employee_viewed_at: payload.employeeViewedAt,
    payload_json: serializeJson_(payload)
  };
}

function mapPayrollRowForClient_(row) {
  const payload = parseJsonMaybe_(row.payload_json, null);
  const mapped = {
    payroll_id: trimText_(row.payroll_id),
    employee_id: trimText_(row.employee_id),
    employee_name: trimText_(row.employee_name),
    department: trimText_(row.department),
    month: trimText_(row.month),
    year: trimText_(row.year),
    basic_salary: Math.max(toNumber_(row.basic_salary, 0), 0),
    allowances: Math.max(toNumber_(row.allowances, 0), 0),
    deductions: Math.max(toNumber_(row.deductions, 0), 0),
    net_salary: Math.max(toNumber_(row.net_salary, 0), 0),
    generated_by: trimText_(row.generated_by),
    generated_at: trimText_(row.generated_at),
    status: trimText_(row.status || 'Generated') || 'Generated',
    employee_viewed_at: trimText_(row.employee_viewed_at),
    payload_json: trimText_(row.payload_json),
    payload: payload && typeof payload === 'object' ? payload : null
  };
  mapped.payrollId = mapped.payroll_id;
  mapped.employeeId = mapped.employee_id;
  mapped.employeeName = mapped.employee_name;
  mapped.basicSalary = mapped.basic_salary;
  mapped.netSalary = mapped.net_salary;
  mapped.generatedBy = mapped.generated_by;
  mapped.generatedAt = mapped.generated_at;
  mapped.employeeViewedAt = mapped.employee_viewed_at;
  return mapped;
}

function writePayrollRowsFromPayload_(spreadsheet, payload) {
  const inputRows = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const rows = inputRows
    .map((item) => normalizePayrollInput_(spreadsheet, item))
    .filter((row) => row.payroll_id || row.employee_id || row.employee_name);
  writeTableRows_(spreadsheet, HELP360_SHEETS.payroll, HELP360_HEADERS.payroll, rows);
  return rows.map((row) => mapPayrollRowForClient_(row));
}

function readPayrollRows_(spreadsheet) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.payroll, HELP360_HEADERS.payroll);
  const directRows = readSheetObjects_(sheet)
    .map((row) => mapPayrollRowForClient_(row))
    .filter((row) => row.payroll_id || row.employee_name || row.employee_id);
  if (directRows.length) {
    return directRows.sort((left, right) => {
      const leftTime = new Date(left.generated_at || 0).getTime();
      const rightTime = new Date(right.generated_at || 0).getTime();
      return rightTime - leftTime;
    });
  }
  const sharedRow = readSharedScopeRow_(spreadsheet, 'payroll_runs');
  const payload = sharedRow && sharedRow.payload ? sharedRow.payload : parseJsonMaybe_(sharedRow && sharedRow.payload_json, []);
  const fallbackRows = Array.isArray(payload)
    ? payload.map((item) => mapPayrollRowForClient_(normalizePayrollInput_(spreadsheet, item)))
    : [];
  return fallbackRows.sort((left, right) => {
    const leftTime = new Date(left.generated_at || 0).getTime();
    const rightTime = new Date(right.generated_at || 0).getTime();
    return rightTime - leftTime;
  });
}

function normalizeCvApplicationInput_(input) {
  const incoming = input && typeof input === 'object' ? input : {};
  const now = nowIso_();
  const applicationId = trimText_(incoming.applicationId || incoming.application_id || incoming.id) || Utilities.getUuid();
  const fullName = trimText_(incoming.fullName || incoming.full_name || '');
  const email = trimText_(incoming.email || '');
  const phone = trimText_(incoming.phone || '');
  const position = trimText_(incoming.position || incoming.jobTitle || incoming.job_title || '');
  const jobId = trimText_(incoming.jobId || incoming.job_id || '');
  const cvFileName = trimText_(incoming.cvFileName || incoming.cv_file_name || incoming.fileName || incoming.file_name || '') || `${fullName || 'Candidate'} CV`;
  const status = trimText_(incoming.status || 'Received') || 'Received';
  const appliedAt = trimText_(incoming.appliedAt || incoming.applied_at || now);
  const payload = {
    applicationId: applicationId,
    fullName: fullName,
    email: email,
    phone: phone,
    position: position,
    jobId: jobId,
    cvFileName: cvFileName,
    cvFileUrl: trimText_(incoming.cvFileUrl || incoming.cv_file_url),
    driveFileId: trimText_(incoming.driveFileId || incoming.drive_file_id),
    appliedAt: appliedAt,
    status: status,
    source: trimText_(incoming.source || 'Careers Page') || 'Careers Page',
    coverLetter: trimText_(incoming.coverLetter || incoming.cover_letter),
    expectedSalary: Math.max(toNumber_(incoming.expectedSalary || incoming.expected_salary, 0), 0)
  };
  return {
    application_id: payload.applicationId,
    full_name: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    position: payload.position,
    job_id: payload.jobId,
    cv_file_name: payload.cvFileName,
    cv_file_url: payload.cvFileUrl,
    drive_file_id: payload.driveFileId,
    applied_at: payload.appliedAt,
    status: payload.status,
    payload_json: serializeJson_(payload)
  };
}

function mapCvApplicationRowForClient_(row) {
  const payload = parseJsonMaybe_(row.payload_json, null);
  const mapped = {
    application_id: trimText_(row.application_id),
    full_name: trimText_(row.full_name),
    email: trimText_(row.email),
    phone: trimText_(row.phone),
    position: trimText_(row.position),
    job_id: trimText_(row.job_id),
    cv_file_name: trimText_(row.cv_file_name),
    cv_file_url: trimText_(row.cv_file_url),
    drive_file_id: trimText_(row.drive_file_id),
    applied_at: trimText_(row.applied_at),
    status: trimText_(row.status || 'Received') || 'Received',
    payload_json: trimText_(row.payload_json),
    payload: payload && typeof payload === 'object' ? payload : null
  };
  mapped.applicationId = mapped.application_id;
  mapped.fullName = mapped.full_name;
  mapped.cvFileName = mapped.cv_file_name;
  mapped.cvFileUrl = mapped.cv_file_url;
  mapped.driveFileId = mapped.drive_file_id;
  mapped.appliedAt = mapped.applied_at;
  return mapped;
}

function readCvApplicationRows_(spreadsheet) {
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.cvApplications, HELP360_HEADERS.cvApplications);
  const rows = readSheetObjects_(sheet)
    .map((row) => mapCvApplicationRowForClient_(row))
    .filter((row) => row.application_id || row.full_name || row.email);
  return rows.sort((left, right) => {
    const leftTime = new Date(left.applied_at || 0).getTime();
    const rightTime = new Date(right.applied_at || 0).getTime();
    return rightTime - leftTime;
  });
}

function createDriveFileFromDataUrl_(folder, fileName, dataUrl, mimeType) {
  const text = trimText_(dataUrl);
  if (!text) {
    return null;
  }
  const match = text.match(/^data:([^;]+);base64,(.+)$/i);
  const resolvedMimeType = trimText_(mimeType) || (match ? match[1] : 'application/octet-stream');
  const base64 = match ? match[2] : text;
  const bytes = Utilities.base64Decode(base64);
  const safeName = trimText_(fileName) || `CV-${Date.now()}`;
  const blob = Utilities.newBlob(bytes, resolvedMimeType, safeName);
  if (folder && typeof folder.createFile === 'function') {
    return folder.createFile(blob);
  }
  return DriveApp.createFile(blob);
}

function resolveCvUploadFolder_() {
  const folderId = trimText_(PropertiesService.getScriptProperties().getProperty('HELP360_CV_FOLDER_ID')) ||
    trimText_(PropertiesService.getScriptProperties().getProperty('HELP360_DRIVE_FOLDER_ID'));
  if (folderId) {
    return DriveApp.getFolderById(folderId);
  }
  return DriveApp.getRootFolder();
}

function uploadCvApplication_(spreadsheet, input) {
  const row = normalizeCvApplicationInput_(input);
  const payload = parseJsonMaybe_(row.payload_json, {});
  const fileDataUrl = trimText_(input.cvDataUrl || input.cv_data_url || input.resumeDataUrl || input.resume_data_url || payload.cvDataUrl || payload.resumeDataUrl);
  const fileName = trimText_(input.cvFileName || input.cv_file_name || payload.cvFileName) || row.cv_file_name || `${row.full_name || 'Candidate'} CV`;
  let uploadedFile = null;
  let uploadWarning = '';
  if (fileDataUrl) {
    try {
      uploadedFile = createDriveFileFromDataUrl_(resolveCvUploadFolder_(), fileName, fileDataUrl, trimText_(input.mimeType || input.mime_type || payload.mimeType));
      row.cv_file_name = uploadedFile.getName();
      row.cv_file_url = uploadedFile.getUrl();
      row.drive_file_id = uploadedFile.getId();
      const nextPayload = Object.assign({}, payload, {
        cvFileName: row.cv_file_name,
        cvFileUrl: row.cv_file_url,
        driveFileId: row.drive_file_id
      });
      row.payload_json = serializeJson_(nextPayload);
    } catch (error) {
      uploadWarning = error && error.message ? error.message : 'Unable to upload CV to Google Drive.';
      const nextPayload = Object.assign({}, payload, {
        uploadWarning: uploadWarning
      });
      row.payload_json = serializeJson_(nextPayload);
    }
  }
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.cvApplications, HELP360_HEADERS.cvApplications);
  upsertRowByKey_(sheet, row.application_id, HELP360_HEADERS.cvApplications, row);
  return {
    ok: true,
    action: 'upload_cv',
    application: mapCvApplicationRowForClient_(row),
    driveFileId: uploadedFile ? uploadedFile.getId() : '',
    driveFileUrl: uploadedFile ? uploadedFile.getUrl() : '',
    warning: uploadWarning
  };
}

function replaceTextDeep_(value, oldText, newText) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    const text = trimText_(oldText);
    return text ? value.split(text).join(newText) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceTextDeep_(item, oldText, newText));
  }
  if (typeof value === 'object') {
    const next = {};
    Object.keys(value).forEach((key) => {
      next[key] = replaceTextDeep_(value[key], oldText, newText);
    });
    return next;
  }
  return value;
}

function renameEmployeeEverywhere_(spreadsheet, input) {
  const oldName = trimText_(input.oldName || input.from || input.previousName || input.employeeName || input.currentName);
  const newName = trimText_(input.newName || input.to || input.updatedName || input.fullName || input.employeeName);
  if (!oldName || !newName) {
    return { ok: false, error: 'Missing oldName or newName.' };
  }
  if (oldName === newName) {
    return { ok: true, changed: false };
  }
  const oldKey = oldName.toLowerCase();
  const now = nowIso_();
  let staffChanged = 0;
  let reportChanged = 0;
  let payrollChanged = 0;
  let sessionChanged = 0;
  let cvChanged = 0;

  const staffSheet = ensureSheet_(spreadsheet, HELP360_SHEETS.staff, HELP360_HEADERS.staff);
  const staffRows = readSheetObjects_(staffSheet).map((row) => {
    const next = Object.assign({}, row);
    const fullName = trimText_(next.full_name).toLowerCase();
    const userId = trimText_(next.user_id).toLowerCase();
    if (fullName === oldKey || userId === oldKey) {
      next.full_name = newName;
      if (userId === oldKey) {
        next.user_id = newName;
      }
      next.updated_at = now;
      if (next.payload_json) {
        const payload = parseJsonMaybe_(next.payload_json, null);
        next.payload_json = serializeJson_(replaceTextDeep_(payload, oldName, newName));
      }
      staffChanged += 1;
    }
    return next;
  });
  if (staffChanged) {
    writeTableRows_(spreadsheet, HELP360_SHEETS.staff, HELP360_HEADERS.staff, staffRows);
  }

  const reportSheet = ensureSheet_(spreadsheet, HELP360_SHEETS.reports, HELP360_HEADERS.reports);
  const reportRows = readSheetObjects_(reportSheet).map((row) => {
    const next = Object.assign({}, row);
    if (trimText_(next.employee).toLowerCase() === oldKey) {
      next.employee = newName;
      const generatedOldEmail = String(oldName || '').toLowerCase().replace(/\s+/g, '.');
      if (trimText_(next.employee_email).toLowerCase().includes(generatedOldEmail)) {
        next.employee_email = trimText_(next.employee_email).split(oldName).join(newName);
      }
      if (next.payload_json) {
        const payload = parseJsonMaybe_(next.payload_json, null);
        next.payload_json = serializeJson_(replaceTextDeep_(payload, oldName, newName));
      }
      reportChanged += 1;
    }
    return next;
  });
  if (reportChanged) {
    writeTableRows_(spreadsheet, HELP360_SHEETS.reports, HELP360_HEADERS.reports, reportRows);
  }

  const payrollSheet = ensureSheet_(spreadsheet, HELP360_SHEETS.payroll, HELP360_HEADERS.payroll);
  const payrollRows = readSheetObjects_(payrollSheet).map((row) => {
    const next = Object.assign({}, row);
    if (trimText_(next.employee_name).toLowerCase() === oldKey || trimText_(next.employee_id).toLowerCase() === oldKey) {
      next.employee_name = newName;
      if (trimText_(next.employee_id).toLowerCase() === oldKey) {
        next.employee_id = newName;
      }
      next.updated_at = now;
      if (next.payload_json) {
        const payload = parseJsonMaybe_(next.payload_json, null);
        next.payload_json = serializeJson_(replaceTextDeep_(payload, oldName, newName));
      }
      payrollChanged += 1;
    }
    return next;
  });
  if (payrollChanged) {
    writeTableRows_(spreadsheet, HELP360_SHEETS.payroll, HELP360_HEADERS.payroll, payrollRows);
  }

  const sessionSheet = ensureSheet_(spreadsheet, HELP360_SHEETS.sessions, HELP360_HEADERS.sessions);
  const sessionRows = readSheetObjects_(sessionSheet).map((row) => {
    const next = Object.assign({}, row);
    if (trimText_(next.full_name).toLowerCase() === oldKey || trimText_(next.user_id).toLowerCase() === oldKey) {
      next.full_name = newName;
      if (trimText_(next.user_id).toLowerCase() === oldKey) {
        next.user_id = newName;
      }
      next.updated_at = now;
      sessionChanged += 1;
    }
    return next;
  });
  if (sessionChanged) {
    writeTableRows_(spreadsheet, HELP360_SHEETS.sessions, HELP360_HEADERS.sessions, sessionRows);
  }

  const cvSheet = ensureSheet_(spreadsheet, HELP360_SHEETS.cvApplications, HELP360_HEADERS.cvApplications);
  const cvRows = readSheetObjects_(cvSheet).map((row) => {
    const next = Object.assign({}, row);
    if (trimText_(next.full_name).toLowerCase() === oldKey) {
      next.full_name = newName;
      next.applied_at = trimText_(next.applied_at) || now;
      if (next.payload_json) {
        const payload = parseJsonMaybe_(next.payload_json, null);
        next.payload_json = serializeJson_(replaceTextDeep_(payload, oldName, newName));
      }
      cvChanged += 1;
    }
    return next;
  });
  if (cvChanged) {
    writeTableRows_(spreadsheet, HELP360_SHEETS.cvApplications, HELP360_HEADERS.cvApplications, cvRows);
  }

  const mirroredCounts = {
    staff: staffChanged,
    reports: reportChanged,
    payroll: payrollChanged,
    sessions: sessionChanged,
    cvApplications: cvChanged
  };
  return {
    ok: true,
    changed: Boolean(staffChanged || reportChanged || payrollChanged || sessionChanged || cvChanged),
    oldName: oldName,
    newName: newName,
    counts: mirroredCounts
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
  const updatedAt = input.updatedAt || nowIso_();
  const row = writeSharedScopeRow_(
    spreadsheet,
    scope,
    payload,
    input.recordCount,
    updatedAt
  );
  if (scope === 'job_posts') {
    const jobs = writeJobRowsFromPayload_(spreadsheet, payload, updatedAt);
    return {
      ok: true,
      action: 'upsert_scope',
      scope: scope,
      row: row,
      directRows: jobs.length
    };
  }
  if (scope === 'payroll_runs') {
    const payrollRows = writePayrollRowsFromPayload_(spreadsheet, payload);
    return {
      ok: true,
      action: 'upsert_scope',
      scope: scope,
      row: row,
      directRows: payrollRows.length
    };
  }
  return {
    ok: true,
    action: 'upsert_scope',
    scope: scope,
    row: row
  };
}

function upsertPayroll_(spreadsheet, input) {
  const payload = input.payload !== undefined
    ? input.payload
    : input.payroll !== undefined
      ? input.payroll
      : input.run !== undefined
        ? input.run
        : input;
  const sheet = ensureSheet_(spreadsheet, HELP360_SHEETS.payroll, HELP360_HEADERS.payroll);
  const existingRows = readSheetObjects_(sheet);
  const existingByKey = {};
  existingRows.forEach((row) => {
    const key = trimText_(row.payroll_id);
    if (key) existingByKey[key] = row;
  });
  const inputRows = Array.isArray(payload) ? payload : [payload];
  const nextRows = inputRows
    .map((item) => normalizePayrollInput_(spreadsheet, item))
    .filter((row) => row.payroll_id || row.employee_id || row.employee_name)
    .map((row) => {
      const key = trimText_(row.payroll_id);
      const current = key && existingByKey[key] ? existingByKey[key] : null;
      return current ? Object.assign({}, current, row) : row;
    });
  const mergedRows = existingRows.slice();
  nextRows.forEach((row) => {
    const key = trimText_(row.payroll_id);
    const index = mergedRows.findIndex((item) => trimText_(item.payroll_id) === key);
    if (index >= 0) {
      mergedRows[index] = Object.assign({}, mergedRows[index], row);
    } else {
      mergedRows.push(row);
    }
  });
  writeTableRows_(spreadsheet, HELP360_SHEETS.payroll, HELP360_HEADERS.payroll, mergedRows);
  const payrollRows = mergedRows.map((row) => mapPayrollRowForClient_(row));
  writeSharedScopeRow_(
    spreadsheet,
    'payroll_runs',
    payrollRows.map((row) => row.payload || row),
    payrollRows.length,
    input.updatedAt || nowIso_()
  );
  return {
    ok: true,
    action: 'upsert_payroll',
    count: payrollRows.length,
    rows: payrollRows
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
  const activityAt = session.last_activity_at || session.last_validated_at || session.created_at;
  const activityTime = activityAt ? new Date(activityAt).getTime() : NaN;
  if (!activityTime || isNaN(activityTime) || activityTime + HELP360_SESSION_IDLE_MS < Date.now()) {
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
    last_activity_at: now,
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
    last_activity_at: now,
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
    lastValidatedAt: session.last_validated_at,
    lastActivityAt: session.last_activity_at
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
    last_activity_at: trimText_(row.last_activity_at),
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
  mapped.lastActivityAt = mapped.last_activity_at;
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
    team_lead_id: trimText_(incoming.teamLeadId || incoming.team_lead_id || incoming.teamLead || incoming.team_lead),
    status: normalizeStatus_(incoming.status || 'ACTIVE'),
    default_department: trimText_(incoming.defaultDepartment || incoming.default_department),
    allowed_departments: trimText_(incoming.allowedDepartments || incoming.allowed_departments),
    pin: trimText_(incoming.pin || incoming.password),
    password: trimText_(incoming.password || incoming.pin),
    force_pin_reset: isTruthy_(incoming.forcePinReset || incoming.force_pin_reset),
    last_login_at: trimText_(incoming.lastLoginAt || incoming.last_login_at),
    last_activity_at: trimText_(incoming.lastActivityAt || incoming.last_activity_at),
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
    team_lead_id: trimText_(incoming.team_lead_id || existing.team_lead_id),
    status: normalizeStatus_(incoming.status || existing.status || 'ACTIVE'),
    default_department: trimText_(incoming.default_department || existing.default_department),
    allowed_departments: trimText_(incoming.allowed_departments || existing.allowed_departments),
    pin: incomingPin || existingPin,
    password: incomingPin || existingPin,
    force_pin_reset: incoming.force_pin_reset === true ? true : isTruthy_(existing.force_pin_reset),
    last_login_at: trimText_(incoming.last_login_at) || trimText_(existing.last_login_at),
    last_activity_at: trimText_(incoming.last_activity_at) || trimText_(existing.last_activity_at),
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
    team_lead_id: trimText_(row.team_lead_id),
    status: normalizeStatus_(row.status),
    default_department: trimText_(row.default_department),
    allowed_departments: trimText_(row.allowed_departments),
    pin: trimText_(row.pin || row.password),
    password: trimText_(row.password || row.pin),
    force_pin_reset: isTruthy_(row.force_pin_reset),
    last_login_at: trimText_(row.last_login_at),
    last_activity_at: trimText_(row.last_activity_at),
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

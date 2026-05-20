import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadEnvFiles([
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '.env.local'),
  join(__dirname, '.env'),
  join(__dirname, '.env.local')
]);

const CONFIG = {
  host: process.env.BRIDGE_HOST || '0.0.0.0',
  port: asNumber(process.env.BRIDGE_PORT, 8787),
  corsOrigin: process.env.BRIDGE_CORS_ORIGIN || '*',
  adminKey: String(process.env.ZK_BRIDGE_ADMIN_KEY || '').trim(),
  supabaseUrl: normalizeBaseUrl(process.env.SUPABASE_URL || ''),
  serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  sharedTable: String(process.env.SUPABASE_SHARED_TABLE || 'help360_shared_state').trim(),
  logTable: String(process.env.SUPABASE_ZK_LOG_TABLE || 'zkteco_attendance_logs').trim(),
  deviceTable: String(process.env.SUPABASE_ZK_DEVICE_TABLE || 'zkteco_devices').trim(),
  syncTable: String(process.env.SUPABASE_ZK_SYNC_TABLE || 'zkteco_sync_runs').trim(),
  employeesScope: String(process.env.ZK_EMPLOYEES_SCOPE || 'employees').trim(),
  attendanceConfigScope: String(process.env.ZK_ATTENDANCE_CONFIG_SCOPE || 'attendance_config').trim(),
  attendanceRecordsScope: String(process.env.ZK_ATTENDANCE_RECORDS_SCOPE || 'attendance_records').trim(),
  syncLookbackDays: asNumber(process.env.ZK_SYNC_LOOKBACK_DAYS, 45),
  defaultTimezone: String(process.env.ZK_DEFAULT_TIMEZONE || 'UTC').trim() || 'UTC'
};

const SELF_TEST = process.argv.includes('--self-test');
const HELP_ONLY = process.argv.includes('--help') || process.argv.includes('-h');

if (HELP_ONLY) {
  printHelp();
  process.exit(0);
}

if (SELF_TEST) {
  runSelfTest();
  process.exit(0);
}

assertRuntimeConfig();

const server = createServer(async (request, response) => {
  applyCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        service: 'zkteco-bridge',
        time: new Date().toISOString()
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/zkteco/status') {
      enforceAdminKey(request, url);
      const status = await buildBridgeStatus();
      sendJson(response, 200, status);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/zkteco/sync') {
      enforceAdminKey(request, url);
      const syncResult = await rebuildAttendanceSnapshot({
        reason: 'manual-api',
        requestedBy: request.headers['x-requested-by'] || 'browser'
      });
      await recordSyncRun({
        deviceSn: '',
        syncSource: 'manual-api',
        syncStatus: 'ok',
        importedLogs: 0,
        rebuiltRecords: syncResult.recordsBuilt,
        message: syncResult.message,
        requestMeta: {
          path: url.pathname,
          requestedBy: request.headers['x-requested-by'] || 'browser'
        }
      });
      sendJson(response, 200, {
        ok: true,
        syncedAt: syncResult.syncedAt,
        rebuiltRecords: syncResult.recordsBuilt,
        message: syncResult.message
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/zkteco/import') {
      enforceAdminKey(request, url);
      const rawBody = await readRequestBody(request);
      const importResult = await importManualPayload(rawBody, request, url);
      sendJson(response, 200, importResult);
      return;
    }

    if (url.pathname === '/iclock/cdata' || url.pathname === '/iclock/getrequest') {
      const rawBody = request.method === 'POST' ? await readRequestBody(request) : '';
      const deviceResult = await handleDeviceTraffic({
        request,
        url,
        rawBody,
        path: url.pathname
      });
      sendPlain(response, 200, deviceResult.replyText || 'OK');
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: `Unknown route: ${request.method} ${url.pathname}`
    });
  } catch (error) {
    const status = error && error.statusCode ? error.statusCode : 500;
    sendJson(response, status, {
      ok: false,
      error: error && error.message ? error.message : 'Unexpected bridge error.'
    });
  }
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(
    `[zkteco-bridge] listening on http://${CONFIG.host}:${CONFIG.port} ` +
    `using shared scope "${CONFIG.attendanceRecordsScope}"`
  );
});

function printHelp() {
  console.log(`ZKTeco -> Supabase bridge

Required environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional:
  BRIDGE_HOST=0.0.0.0
  BRIDGE_PORT=8787
  ZK_BRIDGE_ADMIN_KEY=your-admin-key
  BRIDGE_CORS_ORIGIN=*
  SUPABASE_SHARED_TABLE=help360_shared_state
  SUPABASE_ZK_LOG_TABLE=zkteco_attendance_logs
  SUPABASE_ZK_DEVICE_TABLE=zkteco_devices
  SUPABASE_ZK_SYNC_TABLE=zkteco_sync_runs
  ZK_SYNC_LOOKBACK_DAYS=45
  ZK_DEFAULT_TIMEZONE=UTC

Endpoints:
  GET  /health
  GET  /api/zkteco/status          (admin key optional if configured)
  POST /api/zkteco/sync            (admin key optional if configured)
  POST /api/zkteco/import          (admin key optional if configured)
  GET/POST /iclock/cdata           (device push endpoint)
  GET/POST /iclock/getrequest      (device polling endpoint)
`);
}

function loadEnvFiles(paths) {
  paths.forEach((path) => {
    if (!existsSync(path)) return;
    const contents = readFileSync(path, 'utf8');
    contents.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex <= 0) return;
      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
  });
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function assertRuntimeConfig() {
  if (!CONFIG.supabaseUrl) {
    throw new Error('Missing SUPABASE_URL for the ZKTeco bridge.');
  }
  if (!CONFIG.serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for the ZKTeco bridge.');
  }
}

function applyCors(response) {
  response.setHeader('Access-Control-Allow-Origin', CONFIG.corsOrigin);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Key, X-Requested-By');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendPlain(response, statusCode, message) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(String(message || 'OK'));
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 3 * 1024 * 1024) {
      const error = new Error('Request payload is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function enforceAdminKey(request, url) {
  if (!CONFIG.adminKey) return;
  const provided = String(request.headers['x-bridge-key'] || url.searchParams.get('key') || '').trim();
  if (!provided) {
    const error = new Error('Bridge admin key is required.');
    error.statusCode = 401;
    throw error;
  }
  const expectedBuffer = Buffer.from(CONFIG.adminKey);
  const providedBuffer = Buffer.from(provided);
  const matches = expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);
  if (!matches) {
    const error = new Error('Bridge admin key is invalid.');
    error.statusCode = 403;
    throw error;
  }
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function parseFormBody(rawBody) {
  if (!rawBody || !rawBody.includes('=')) return {};
  const params = new URLSearchParams(rawBody);
  const next = {};
  for (const [key, value] of params.entries()) {
    next[key] = value;
  }
  return next;
}

function extractDeviceMeta(request, url, rawBody, jsonBody, formBody) {
  const serial =
    String(url.searchParams.get('SN') || formBody.SN || jsonBody?.SN || jsonBody?.sn || '').trim() ||
    'UNKNOWN_DEVICE';
  const table =
    String(url.searchParams.get('table') || formBody.table || jsonBody?.table || '').trim();
  return {
    serial,
    table,
    stamp: String(url.searchParams.get('Stamp') || formBody.Stamp || jsonBody?.Stamp || '').trim(),
    opStamp: String(url.searchParams.get('OpStamp') || formBody.OpStamp || jsonBody?.OpStamp || '').trim(),
    pushVersion: String(url.searchParams.get('pushver') || formBody.pushver || jsonBody?.pushver || '').trim(),
    options: String(url.searchParams.get('options') || formBody.options || jsonBody?.options || '').trim(),
    remoteIp: forwardedIp(request),
    userAgent: String(request.headers['user-agent'] || '').trim(),
    bodyPreview: String(rawBody || '').slice(0, 1000)
  };
}

function forwardedIp(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  return forwarded[0] || request.socket.remoteAddress || '';
}

function sha1(value) {
  return createHash('sha1').update(String(value || '')).digest('hex');
}

function sanitizeTimestampText(value) {
  const normalized = String(value || '').trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }
  return normalized;
}

function parseKeyValueAttendanceLine(line) {
  const pairs = {};
  String(line || '')
    .split(/\t|,/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const equalsIndex = part.indexOf('=');
      if (equalsIndex <= 0) return;
      const key = part.slice(0, equalsIndex).trim().toLowerCase();
      const value = part.slice(equalsIndex + 1).trim();
      pairs[key] = value;
    });
  const employeeCode = pairs.pin || pairs.userid || pairs.employee || pairs.badgenumber || '';
  const timestamp = sanitizeTimestampText(pairs.datetime || pairs.time || pairs.atttime || '');
  if (!employeeCode || !timestamp) return null;
  return {
    employeeCode,
    timestampText: timestamp,
    verifyType: String(pairs.verify || pairs.verifytype || pairs.verified || '').trim(),
    ioMode: String(pairs.status || pairs.iomode || pairs['inoutmode'] || '').trim(),
    workCode: String(pairs.workcode || '').trim()
  };
}

function parseAttendanceLine(line) {
  const normalizedLine = String(line || '').replace(/\0/g, '').trim();
  if (!normalizedLine) return null;
  if (/^(Stamp|OpStamp|INFO|OPERLOG|CMD|DeviceName|DevInfo)\b/i.test(normalizedLine)) return null;

  const keyValueEntry = parseKeyValueAttendanceLine(normalizedLine);
  if (keyValueEntry) {
    return Object.assign({ rawLine: normalizedLine }, keyValueEntry);
  }

  const parts = normalizedLine.includes('\t')
    ? normalizedLine.split('\t')
    : normalizedLine.includes(',')
      ? normalizedLine.split(',')
      : normalizedLine.split(/\s+/);

  const tokens = parts.map((part) => String(part || '').trim()).filter(Boolean);
  if (!tokens.length) return null;

  let timestampIndex = tokens.findIndex((token) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(token));
  let timestampText = '';

  if (timestampIndex >= 0) {
    timestampText = sanitizeTimestampText(tokens[timestampIndex]);
  } else {
    const dateIndex = tokens.findIndex((token, index) => (
      /^\d{4}-\d{2}-\d{2}$/.test(token) &&
      /^\d{2}:\d{2}(:\d{2})?$/.test(tokens[index + 1] || '')
    ));
    if (dateIndex >= 0) {
      timestampIndex = dateIndex;
      timestampText = sanitizeTimestampText(`${tokens[dateIndex]} ${tokens[dateIndex + 1]}`);
    }
  }

  if (timestampIndex <= 0 || !timestampText) return null;

  const employeeCode = String(tokens[0] || '').trim();
  if (!employeeCode) return null;

  const nextOffset = /\s/.test(tokens[timestampIndex]) ? 1 : 2;
  return {
    rawLine: normalizedLine,
    employeeCode,
    timestampText,
    verifyType: String(tokens[timestampIndex + nextOffset] || '').trim(),
    ioMode: String(tokens[timestampIndex + nextOffset + 1] || '').trim(),
    workCode: String(tokens.slice(timestampIndex + nextOffset + 2).join(' ') || '').trim()
  };
}

function extractAttendanceEvents(rawBody, meta) {
  const jsonBody = safeJsonParse(rawBody);
  const formBody = parseFormBody(rawBody);
  const sources = [];

  if (jsonBody && Array.isArray(jsonBody.records)) {
    jsonBody.records.forEach((record) => {
      const employeeCode = String(record.employeeCode || record.pin || '').trim();
      const timestampText = sanitizeTimestampText(record.timestamp || record.dateTime || record.logTime || '');
      if (!employeeCode || !timestampText) return;
      sources.push({
        employeeCode,
        timestampText,
        verifyType: String(record.verifyType || '').trim(),
        ioMode: String(record.ioMode || '').trim(),
        workCode: String(record.workCode || '').trim(),
        rawLine: JSON.stringify(record)
      });
    });
  }

  if (typeof jsonBody?.data === 'string' && jsonBody.data.trim()) {
    sources.push(...jsonBody.data.replace(/\r/g, '').split('\n').map(parseAttendanceLine).filter(Boolean));
  }

  if (typeof jsonBody?.attlog === 'string' && jsonBody.attlog.trim()) {
    sources.push(...jsonBody.attlog.replace(/\r/g, '').split('\n').map(parseAttendanceLine).filter(Boolean));
  }

  if (typeof formBody.ATTLOG === 'string' && formBody.ATTLOG.trim()) {
    sources.push(...formBody.ATTLOG.replace(/\r/g, '').split('\n').map(parseAttendanceLine).filter(Boolean));
  }

  if (typeof formBody.records === 'string' && formBody.records.trim()) {
    sources.push(...formBody.records.replace(/\r/g, '').split('\n').map(parseAttendanceLine).filter(Boolean));
  }

  if (!sources.length && rawBody && !jsonBody) {
    sources.push(...rawBody.replace(/\r/g, '').split('\n').map(parseAttendanceLine).filter(Boolean));
  }

  return sources
    .map((entry) => {
      const timestampText = sanitizeTimestampText(entry.timestampText);
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestampText)) return null;
      const eventHash = sha1([
        meta.serial,
        entry.employeeCode,
        timestampText,
        entry.verifyType,
        entry.ioMode,
        entry.rawLine || ''
      ].join('|'));
      return {
        eventHash,
        deviceSn: meta.serial,
        employeeCode: String(entry.employeeCode || '').trim(),
        verifyType: String(entry.verifyType || '').trim(),
        ioMode: String(entry.ioMode || '').trim(),
        workCode: String(entry.workCode || '').trim(),
        logDate: timestampText.slice(0, 10),
        logTimeText: timestampText,
        rawLine: String(entry.rawLine || '').trim() || [
          entry.employeeCode,
          timestampText,
          entry.verifyType,
          entry.ioMode,
          entry.workCode
        ].join('\t'),
        rawPayload: {
          serial: meta.serial,
          table: meta.table,
          pushVersion: meta.pushVersion
        },
        source: 'push'
      };
    })
    .filter(Boolean);
}

async function handleDeviceTraffic(context) {
  const jsonBody = safeJsonParse(context.rawBody);
  const formBody = parseFormBody(context.rawBody);
  const meta = extractDeviceMeta(context.request, context.url, context.rawBody, jsonBody, formBody);

  await upsertDeviceHeartbeat(meta, context.path);

  let importedLogs = 0;
  let rebuiltRecords = 0;
  let message = 'Device heartbeat received.';

  const events = extractAttendanceEvents(context.rawBody, meta);
  if (events.length) {
    importedLogs = await storeAttendanceEvents(events);
    const rebuild = await rebuildAttendanceSnapshot({
      reason: 'device-push',
      deviceSn: meta.serial
    });
    rebuiltRecords = rebuild.recordsBuilt;
    message = `Imported ${importedLogs} punch logs and rebuilt ${rebuiltRecords} attendance rows.`;
  } else if (String(meta.table || '').toUpperCase() === 'ATTLOG') {
    message = 'ATTLOG request received but no parsable punch data was found.';
  }

  await recordSyncRun({
    deviceSn: meta.serial,
    syncSource: context.path === '/iclock/getrequest' ? 'device-poll' : 'device-push',
    syncStatus: 'ok',
    importedLogs,
    rebuiltRecords,
    message,
    requestMeta: {
      path: context.path,
      table: meta.table,
      stamp: meta.stamp,
      opStamp: meta.opStamp,
      pushVersion: meta.pushVersion,
      options: meta.options,
      remoteIp: meta.remoteIp
    }
  });

  return {
    ok: true,
    replyText: 'OK',
    importedLogs,
    rebuiltRecords,
    message
  };
}

async function importManualPayload(rawBody, request, url) {
  const jsonBody = safeJsonParse(rawBody);
  const meta = {
    serial: String(jsonBody?.deviceSerial || jsonBody?.serial || url.searchParams.get('serial') || 'MANUAL_IMPORT').trim(),
    table: 'ATTLOG',
    pushVersion: 'manual',
    options: '',
    stamp: '',
    opStamp: '',
    remoteIp: forwardedIp(request),
    userAgent: String(request.headers['user-agent'] || '').trim(),
    bodyPreview: String(rawBody || '').slice(0, 1000)
  };
  const events = extractAttendanceEvents(rawBody, meta);
  const importedLogs = await storeAttendanceEvents(events);
  const rebuild = await rebuildAttendanceSnapshot({
    reason: 'manual-import',
    deviceSn: meta.serial
  });

  await recordSyncRun({
    deviceSn: meta.serial,
    syncSource: 'manual-import',
    syncStatus: 'ok',
    importedLogs,
    rebuiltRecords: rebuild.recordsBuilt,
    message: rebuild.message,
    requestMeta: {
      path: '/api/zkteco/import',
      remoteIp: meta.remoteIp
    }
  });

  return {
    ok: true,
    importedLogs,
    rebuiltRecords: rebuild.recordsBuilt,
    syncedAt: rebuild.syncedAt,
    message: rebuild.message
  };
}

async function upsertDeviceHeartbeat(meta, path) {
  const payload = [{
    device_sn: meta.serial,
    device_name: meta.serial,
    last_ip: meta.remoteIp,
    push_mode: meta.table || 'heartbeat',
    last_seen_at: new Date().toISOString(),
    last_path: path,
    last_table: meta.table || '',
    last_payload: {
      stamp: meta.stamp,
      opStamp: meta.opStamp,
      pushVersion: meta.pushVersion,
      options: meta.options,
      userAgent: meta.userAgent,
      bodyPreview: meta.bodyPreview
    },
    updated_at: new Date().toISOString()
  }];
  await supabaseInsertOrMerge(CONFIG.deviceTable, payload, 'device_sn');
}

async function storeAttendanceEvents(events) {
  if (!events.length) return 0;
  const payload = events.map((event) => ({
    event_hash: event.eventHash,
    device_sn: event.deviceSn,
    employee_code: event.employeeCode,
    verify_type: event.verifyType,
    io_mode: event.ioMode,
    work_code: event.workCode,
    log_date: event.logDate,
    log_time_text: event.logTimeText,
    raw_line: event.rawLine,
    raw_payload: event.rawPayload,
    source: event.source || 'push'
  }));
  const insertedRows = await supabaseInsertOrIgnore(CONFIG.logTable, payload, 'event_hash');
  return insertedRows.length;
}

async function recordSyncRun(run) {
  const payload = [{
    device_sn: String(run.deviceSn || '').trim() || null,
    sync_source: String(run.syncSource || 'bridge').trim(),
    sync_status: String(run.syncStatus || 'ok').trim(),
    imported_logs: Math.max(asNumber(run.importedLogs, 0), 0),
    rebuilt_records: Math.max(asNumber(run.rebuiltRecords, 0), 0),
    message: String(run.message || '').trim(),
    request_meta: run.requestMeta && typeof run.requestMeta === 'object' ? run.requestMeta : {}
  }];
  await supabaseInsert(CONFIG.syncTable, payload, { ignoreErrors: true, preferMinimal: true });
}

async function buildBridgeStatus() {
  const devices = await supabaseSelect(CONFIG.deviceTable, {
    select: 'device_sn,device_name,last_ip,push_mode,last_seen_at,last_path,last_table,updated_at',
    order: ['last_seen_at.desc'],
    limit: '20'
  });
  const runs = await supabaseSelect(CONFIG.syncTable, {
    select: 'id,device_sn,sync_source,sync_status,imported_logs,rebuilt_records,message,created_at',
    order: ['created_at.desc'],
    limit: '10'
  });
  return {
    ok: true,
    time: new Date().toISOString(),
    pushEndpoint: '/iclock/cdata',
    devices,
    recentRuns: runs
  };
}

async function rebuildAttendanceSnapshot(context) {
  const shared = await fetchSharedScopes([
    CONFIG.employeesScope,
    CONFIG.attendanceConfigScope,
    CONFIG.attendanceRecordsScope
  ]);
  const attendanceConfig = shared[CONFIG.attendanceConfigScope] && typeof shared[CONFIG.attendanceConfigScope] === 'object'
    ? shared[CONFIG.attendanceConfigScope]
    : {};
  const employees = Array.isArray(shared[CONFIG.employeesScope]) ? shared[CONFIG.employeesScope] : [];
  const existingRecords = Array.isArray(shared[CONFIG.attendanceRecordsScope]) ? shared[CONFIG.attendanceRecordsScope] : [];
  const startDate = isoDateDaysAgo(CONFIG.syncLookbackDays);
  const logs = await supabaseSelect(CONFIG.logTable, {
    select: 'device_sn,employee_code,verify_type,io_mode,work_code,log_date,log_time_text,source,recorded_at',
    filters: {
      log_date: `gte.${startDate}`
    },
    order: ['log_date.asc', 'log_time_text.asc'],
    limit: '5000'
  });

  const derivedRecords = buildAttendanceRecordsFromLogs(logs, employees, existingRecords);
  const mergedRecords = mergeAttendanceRecords(existingRecords, derivedRecords);
  const now = new Date().toISOString();
  const deviceCount = new Set(logs.map((log) => String(log.device_sn || '').trim()).filter(Boolean)).size;
  const nextConfig = Object.assign({}, attendanceConfig, {
    deviceMode: attendanceConfig.deviceMode || 'API Bridge',
    timezone: attendanceConfig.timezone || CONFIG.defaultTimezone,
    lastSyncAt: now,
    bridgeStatus: deviceCount ? `Connected (${deviceCount} device${deviceCount === 1 ? '' : 's'})` : 'Listening',
    lastSyncSummary: `${derivedRecords.length} biometric attendance row${derivedRecords.length === 1 ? '' : 's'} rebuilt from ${logs.length} punch log${logs.length === 1 ? '' : 's'}.`
  });

  await upsertSharedScope(CONFIG.attendanceRecordsScope, mergedRecords);
  await upsertSharedScope(CONFIG.attendanceConfigScope, nextConfig);

  return {
    ok: true,
    syncedAt: now,
    recordsBuilt: derivedRecords.length,
    message: `${derivedRecords.length} attendance row${derivedRecords.length === 1 ? '' : 's'} refreshed from ${logs.length} biometric punch log${logs.length === 1 ? '' : 's'}.`,
    context
  };
}

function buildAttendanceRecordsFromLogs(logs, employees, existingRecords) {
  const employeeByCode = new Map();
  const employeeByName = new Map();
  employees.forEach((employee) => {
    const code = String(employee && employee.employeeCode || '').trim().toLowerCase();
    const name = String(employee && employee.name || '').trim().toLowerCase();
    if (code) employeeByCode.set(code, employee);
    if (name) employeeByName.set(name, employee);
  });

  const groups = new Map();
  logs.forEach((log) => {
    const employeeCode = String(log.employee_code || '').trim();
    const lookupKey = employeeCode.toLowerCase();
    const employee = employeeByCode.get(lookupKey) || employeeByName.get(lookupKey) || null;
    const identity = employee ? employee.id : employeeCode || 'UNKNOWN_EMPLOYEE';
    const key = `${identity}::${log.log_date}`;
    if (!groups.has(key)) {
      groups.set(key, {
        employee,
        employeeCode,
        date: String(log.log_date || '').trim(),
        deviceSerials: new Set(),
        punches: []
      });
    }
    const group = groups.get(key);
    group.deviceSerials.add(String(log.device_sn || '').trim());
    group.punches.push({
      timeText: String(log.log_time_text || '').trim(),
      recordedAt: String(log.recorded_at || '').trim()
    });
  });

  return [...groups.values()].map((group) => {
    group.punches.sort((left, right) => left.timeText.localeCompare(right.timeText));
    const firstPunch = group.punches[0];
    const lastPunch = group.punches[group.punches.length - 1];
    const employee = group.employee || findExistingRecordOwner(existingRecords, group.employeeCode);
    const employeeName = employee ? employee.name : `Unknown Employee (${group.employeeCode || 'No Code'})`;
    const employeeId = employee ? employee.id : '';
    const employeeCode = employee ? employee.employeeCode : group.employeeCode;
    const shiftName = employee && employee.shiftName ? employee.shiftName : 'Morning Shift';
    const clockIn = firstPunch && firstPunch.timeText.length >= 16 ? firstPunch.timeText.slice(11, 16) : '';
    const clockOut = lastPunch && lastPunch.timeText.length >= 16 ? lastPunch.timeText.slice(11, 16) : '';
    return {
      id: `bridge_${sha1(`${employeeCode || employeeName}|${group.date}`)}`,
      employeeId,
      employeeName,
      employeeCode,
      date: group.date,
      shiftName,
      clockIn,
      clockOut,
      source: 'ZKTeco Bridge',
      status: 'Present',
      remarks: `${group.punches.length} biometric punch${group.punches.length === 1 ? '' : 'es'} imported from ${group.deviceSerials.size} device${group.deviceSerials.size === 1 ? '' : 's'}.`,
      createdAt: lastPunch && lastPunch.recordedAt ? lastPunch.recordedAt : new Date().toISOString()
    };
  });
}

function findExistingRecordOwner(existingRecords, employeeCode) {
  const lookup = String(employeeCode || '').trim().toLowerCase();
  if (!lookup) return null;
  const existing = existingRecords.find((record) => String(record && record.employeeCode || '').trim().toLowerCase() === lookup);
  if (!existing) return null;
  return {
    id: String(existing.employeeId || '').trim(),
    name: String(existing.employeeName || '').trim(),
    employeeCode: String(existing.employeeCode || '').trim(),
    shiftName: String(existing.shiftName || 'Morning Shift').trim()
  };
}

function mergeAttendanceRecords(existingRecords, derivedRecords) {
  const map = new Map();
  existingRecords
    .filter((record) => !/^ZKTeco Bridge|ZKTeco Sync$/i.test(String(record && record.source || '').trim()))
    .forEach((record) => {
      map.set(attendanceRecordKey(record), record);
    });
  derivedRecords.forEach((record) => {
    map.set(attendanceRecordKey(record), record);
  });
  return [...map.values()].sort((left, right) => {
    const leftStamp = `${left.date || ''} ${left.clockIn || ''}`;
    const rightStamp = `${right.date || ''} ${right.clockIn || ''}`;
    return rightStamp.localeCompare(leftStamp);
  });
}

function attendanceRecordKey(record) {
  return [
    String(record && (record.employeeId || record.employeeCode || record.employeeName) || '').trim().toLowerCase(),
    String(record && record.date || '').trim()
  ].join('::');
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(asNumber(days, 45), 1));
  return date.toISOString().slice(0, 10);
}

async function fetchSharedScopes(scopes) {
  const rows = await supabaseSelect(CONFIG.sharedTable, {
    select: 'scope,payload,updated_at',
    filters: {
      scope: `in.(${scopes.join(',')})`
    },
    limit: String(scopes.length)
  });
  return rows.reduce((result, row) => {
    result[String(row.scope || '').trim()] = row.payload;
    return result;
  }, {});
}

async function upsertSharedScope(scope, payload) {
  return supabaseInsertOrMerge(CONFIG.sharedTable, [{
    scope,
    payload,
    updated_at: new Date().toISOString()
  }], 'scope');
}

async function supabaseSelect(table, options) {
  const params = new URLSearchParams();
  params.set('select', options.select || '*');
  if (options.filters && typeof options.filters === 'object') {
    Object.entries(options.filters).forEach(([key, value]) => {
      params.set(key, String(value));
    });
  }
  if (Array.isArray(options.order)) {
    options.order.forEach((value) => params.append('order', String(value)));
  }
  if (options.limit) {
    params.set('limit', String(options.limit));
  }
  return supabaseRequest(`${table}?${params.toString()}`, {
    method: 'GET'
  });
}

async function supabaseInsertOrMerge(table, rows, onConflict, options) {
  const config = Object.assign({
    ignoreErrors: false,
    preferMinimal: false
  }, options || {});
  try {
    return await supabaseRequest(
      `${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: 'POST',
        headers: {
          Prefer: `${config.preferMinimal ? 'return=minimal' : 'return=representation'},resolution=merge-duplicates`
        },
        body: rows
      }
    );
  } catch (error) {
    if (config.ignoreErrors) return [];
    throw error;
  }
}

async function supabaseInsertOrIgnore(table, rows, onConflict) {
  return supabaseRequest(
    `${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=ignore-duplicates'
      },
      body: rows
    }
  );
}

async function supabaseInsert(table, rows, options) {
  const config = Object.assign({
    ignoreErrors: false,
    preferMinimal: false
  }, options || {});
  try {
    return await supabaseRequest(
      table,
      {
        method: 'POST',
        headers: {
          Prefer: config.preferMinimal ? 'return=minimal' : 'return=representation'
        },
        body: rows
      }
    );
  } catch (error) {
    if (config.ignoreErrors) return [];
    throw error;
  }
}

async function supabaseRequest(path, options) {
  const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: Object.assign({
      apikey: CONFIG.serviceRoleKey,
      Authorization: `Bearer ${CONFIG.serviceRoleKey}`,
      'Content-Type': 'application/json'
    }, options.headers || {}),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${bodyText || response.statusText}`);
  }

  if (response.status === 204) return [];
  const bodyText = await response.text();
  if (!bodyText) return [];
  return safeJsonParse(bodyText) ?? [];
}

function runSelfTest() {
  const sample = [
    'E001\t2026-05-20 09:03:00\t1\t0\t0',
    'E001\t2026-05-20 18:11:00\t1\t0\t0',
    'E002\t2026-05-20 08:58:00\t1\t0\t0'
  ].join('\n');
  const events = extractAttendanceEvents(sample, {
    serial: 'SELFTEST',
    table: 'ATTLOG',
    pushVersion: 'test'
  });
  if (events.length !== 3) {
    throw new Error(`Self-test failed: expected 3 events, received ${events.length}.`);
  }
  const records = buildAttendanceRecordsFromLogs([
    {
      device_sn: 'SELFTEST',
      employee_code: 'E001',
      verify_type: '1',
      io_mode: '0',
      work_code: '0',
      log_date: '2026-05-20',
      log_time_text: '2026-05-20 09:03:00',
      source: 'push',
      recorded_at: '2026-05-20T09:03:01Z'
    },
    {
      device_sn: 'SELFTEST',
      employee_code: 'E001',
      verify_type: '1',
      io_mode: '0',
      work_code: '0',
      log_date: '2026-05-20',
      log_time_text: '2026-05-20 18:11:00',
      source: 'push',
      recorded_at: '2026-05-20T18:11:01Z'
    }
  ], [{
    id: 'emp1',
    name: 'Alice',
    employeeCode: 'E001',
    shiftName: 'Morning Shift'
  }], []);
  if (records.length !== 1 || records[0].clockIn !== '09:03' || records[0].clockOut !== '18:11') {
    throw new Error('Self-test failed: derived attendance record did not match expected times.');
  }
  console.log('[zkteco-bridge] self-test passed');
}

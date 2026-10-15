/**
 * ADJUTORIX / MIDIA-AI owner-approved native desktop link.
 * The key never leaves Electron's main process, and no mutation/command endpoint
 * is exposed to the renderer. All source reads remain MIDIA grant-bound.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import * as crypto from 'node:crypto';

const VERSION = 'midia.desktop.channel.v1';
const LIMIT = 262144;
const ID = /^s_[a-f0-9]{48}$/;
const VIEW = /^view_[a-f0-9]{48}$/;
const HEX = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{48}$/;
const MAX_PATH = 2048;

type JsonRecord = Record<string, unknown>;
export class NativeLinkRefused extends Error {
  constructor(readonly reason: string) { super(reason); this.name = 'NativeLinkRefused'; }
}
function deny(reason: string): never { throw new NativeLinkRefused(reason); }
function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function ownedDirectory(p: string, uid: number): void {
  const entry = fs.lstatSync(p);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.uid !== uid && entry.uid !== 0) ||
      (entry.mode & 0o022) !== 0) deny('DESKTOP_PATH_NOT_PRIVATE');
}
function ownedFile(p: string, uid: number): Buffer {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(p, flags);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.uid !== uid || before.nlink !== 1 || (before.mode & 0o077) !== 0 ||
        before.size < 10 || before.size > 32768) deny('DESKTOP_BINDING_FILE_NOT_PRIVATE');
    const raw = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) deny('DESKTOP_BINDING_CHANGED');
    return raw;
  } finally { fs.closeSync(fd); }
}
function keyedMac(key: Buffer, kind: 'request'|'response', nonce: string, at: number, body: string): string {
  return crypto.createHmac('sha256', key)
    .update([VERSION, kind, nonce, String(at), body].join('\n'), 'ascii')
    .digest('hex');
}
function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return deny('DESKTOP_JSON_INVALID'); }
}
function boundString(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value) > max ||
      /[\0-\x1f]/.test(value)) deny(code);
  return value;
}

export class MidiaNativeClient {
  readonly state: string;
  readonly desktop: string;
  readonly home: string;
  constructor(state = path.join(os.homedir(), '.midia-ai', 'gateway-live'), home = os.homedir()) {
    this.home = home;
    if (state !== path.join(home, '.midia-ai', 'gateway-live')) deny('DESKTOP_STATE_PATH_INVALID');
    this.state = state;
    this.desktop = path.join(state, 'desktop');
  }
  private binding(): {key: Buffer; socketPath: string} {
    if (process.platform !== 'darwin') deny('MACOS_NATIVE_CHANNEL_REQUIRED');
    const uid = process.getuid?.();
    if (typeof uid !== 'number') deny('UNIX_OWNER_REQUIRED');
    for (const part of [this.home, path.join(this.home, '.midia-ai'), this.state, this.desktop]) {
      ownedDirectory(part, uid);
    }
    const config = safeJson(ownedFile(path.join(this.desktop, 'channel.json'), uid).toString('utf8'));
    if (!isRecord(config) || config.schema !== VERSION || typeof config.key_hex !== 'string' ||
        !HEX.test(config.key_hex) || typeof config.socket_path !== 'string' ||
        config.socket_path !== path.join(this.desktop, 'channel.sock') ||
        !Array.isArray(config.socket_identity) || config.socket_identity.length !== 2 ||
        typeof config.principal !== 'string' || typeof config.scope_binding !== 'string') {
      deny('DESKTOP_BINDING_INVALID');
    }
    const entry = fs.lstatSync(config.socket_path);
    if (!entry.isSocket() || entry.uid !== uid || (entry.mode & 0o077) !== 0 ||
        entry.dev !== config.socket_identity[0] || entry.ino !== config.socket_identity[1]) {
      deny('DESKTOP_SOCKET_IDENTITY_INVALID');
    }
    return {key: Buffer.from(config.key_hex, 'hex'), socketPath: config.socket_path};
  }
  private async request(method: string, params: JsonRecord): Promise<JsonRecord> {
    const {key, socketPath} = this.binding();
    const nonce = crypto.randomBytes(24).toString('hex');
    const issuedAt = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({method, params}), 'utf8').toString('base64');
    const request = JSON.stringify({version: VERSION, nonce, issued_at: issuedAt, body,
        mac: keyedMac(key, 'request', nonce, issuedAt, body)}) + '\n';
    if (Buffer.byteLength(request) > LIMIT) deny('DESKTOP_MESSAGE_LIMIT');
    const raw = await new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const chunks: Buffer[] = [];
      let bytes = 0;
      const socket = net.createConnection({path: socketPath});
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new NativeLinkRefused(reason));
      };
      socket.setTimeout(4500, () => fail('DESKTOP_SOCKET_TIMEOUT'));
      socket.on('connect', () => socket.write(request));
      socket.on('error', () => fail('DESKTOP_SOCKET_UNAVAILABLE'));
      socket.on('end', () => { if (!settled) fail('DESKTOP_RESPONSE_TRUNCATED'); });
      socket.on('data', chunk => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > LIMIT) return fail('DESKTOP_RESPONSE_TOO_LARGE');
        chunks.push(chunk);
        const received = Buffer.concat(chunks);
        const lf = received.indexOf(10);
        if (lf < 0) return;
        if (lf !== received.length - 1) return fail('DESKTOP_RESPONSE_PIPELINING');
        settled = true;
        socket.end();
        resolve(received.subarray(0, -1));
      });
    });
    const response = safeJson(raw.toString('utf8'));
    if (!isRecord(response) || Object.keys(response).sort().join(',') !== 'body,issued_at,mac,nonce,version' ||
        response.version !== VERSION || response.nonce !== nonce || !NONCE.test(response.nonce as string) ||
        response.issued_at !== issuedAt || typeof response.body !== 'string' ||
        typeof response.mac !== 'string' || !HEX.test(response.mac) ||
        Math.abs(Date.now() / 1000 - issuedAt) > 30) deny('DESKTOP_RESPONSE_ENVELOPE_INVALID');
    const actual = keyedMac(key, 'response', nonce, issuedAt, response.body);
    if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(response.mac, 'hex'))) {
      deny('DESKTOP_RESPONSE_AUTHENTICATION_DENIED');
    }
    const decoded = Buffer.from(response.body, 'base64');
    if (decoded.toString('base64') !== response.body) deny('DESKTOP_RESPONSE_BODY_INVALID');
    const payload = safeJson(decoded.toString('utf8'));
    if (!isRecord(payload) || typeof payload.ok !== 'boolean') deny('DESKTOP_RESPONSE_BODY_INVALID');
    if (!payload.ok) deny(typeof payload.error === 'string' && /^[A-Z0-9_]{2,100}$/.test(payload.error)
      ? payload.error : 'DESKTOP_REMOTE_OPERATION_REFUSED');
    if (!isRecord(payload.result)) deny('DESKTOP_RESPONSE_RESULT_INVALID');
    return payload.result;
  }
  async status(): Promise<JsonRecord> {
    const result = await this.request('health', {});
    if (result.service !== 'MIDIA-AI' || result.transport !== 'owner-authenticated-local-channel') {
      deny('DESKTOP_HEALTH_IDENTITY_INVALID');
    }
    // The gateway's source_grants is a shaped object with a projects array.
    // Owner-declared organizations are NOT project grants and must not appear here.
    const inventory = result.source_grants;
    if (!isRecord(inventory) || !Array.isArray(inventory.projects))
      deny('DESKTOP_GRANTS_SHAPE_INVALID');
    const grants = inventory.projects.slice(0, 32).map((item: unknown) => {
      if (!isRecord(item) || typeof item.project_id !== 'string' ||
          typeof item.state !== 'string') deny('DESKTOP_GRANT_ENTRY_INVALID');
      return {project: item.project_id, state: item.state};
    });
    return {connected: true, service: 'MIDIA-AI', transport: result.transport,
      grants, native_chat_identity_attested: false, execution_authorized: false};
  }
  async presentations(): Promise<JsonRecord> {
    const result = await this.request('presentations', {});
    const source = result.presentations;
    if (!Array.isArray(source)) deny('DESKTOP_PRESENTATIONS_INVALID');
    return {presentations: source.slice(0,32).filter(isRecord).map(event => {
      const b = event.binding;
      return {event_id: String(event.event_id ?? ''), state: String(event.state ?? ''),
        session_id: isRecord(b) ? String(b.session_id ?? '') : '',
        project: isRecord(b) ? String(b.project ?? '') : ''};
    }).filter(item => ID.test(item.session_id))};
  }
  async bind(sessionId: unknown): Promise<JsonRecord> {
    if (typeof sessionId !== 'string' || !ID.test(sessionId)) deny('DESKTOP_SESSION_INVALID');
    const items = await this.presentations();
    if (!(items.presentations as Array<{session_id:string}>).some(e => e.session_id === sessionId)) {
      deny('DESKTOP_SESSION_NOT_PRESENTED');
    }
    const result = await this.request('bind_view', {session_id: sessionId});
    if (typeof result.view_id !== 'string' || !VIEW.test(result.view_id)) deny('DESKTOP_VIEW_INVALID');
    return {view_id: result.view_id, session_id: sessionId, project: result.project,
      native_chat_identity_attested: false};
  }
  async listing(viewId: unknown): Promise<JsonRecord> {
    if (typeof viewId !== 'string' || !VIEW.test(viewId)) deny('DESKTOP_VIEW_INVALID');
    const result = await this.request('listing', {view_id: viewId, path: '.', offset: 0, limit: 100});
    return {view_id: viewId, result};
  }
  async read(viewId: unknown, filePath: unknown): Promise<JsonRecord> {
    if (typeof viewId !== 'string' || !VIEW.test(viewId)) deny('DESKTOP_VIEW_INVALID');
    const name = boundString(filePath, MAX_PATH, 'DESKTOP_FILE_PATH_INVALID');
    const result = await this.request('read', {view_id: viewId, path: name, start_line: 1, line_count: 150});
    return {view_id: viewId, path: name, text: result.text, source_sha256: result.source_sha256,
      head: result.head, unsaved_buffer_included: false};
  }
  async workItems(): Promise<JsonRecord> {
    const result = await this.request('work_items', {});
    if (!Array.isArray(result.work_items)) deny('DESKTOP_WORK_ITEMS_INVALID');
    return {items: result.work_items.slice(0,100).filter(isRecord).map(item => ({
      work_id: String(item.work_id ?? ''), kind: String(item.kind ?? ''),
      command: String(item.command ?? '').slice(0,8000),
      state: String(item.state ?? ''),
      project: isRecord(item.binding) ? String(item.binding.project ?? '') : '',
      execution_authorized: false,
    }))};
  }
}

/** Only fixed IPC; a renderer cannot address a socket, choose an arbitrary file or obtain a key. */
export function registerMidiaNativeIpc(ipc: {handle: (name:string, callback:(event:unknown,input?:unknown)=>Promise<unknown>)=>void}): void {
  const link = new MidiaNativeClient();
  async function wrap(operation: () => Promise<JsonRecord>): Promise<JsonRecord> {
    try { return {ok:true, ...(await operation())}; }
    catch (error) { return {ok:false, reason:error instanceof NativeLinkRefused ? error.reason : 'DESKTOP_CHANNEL_UNAVAILABLE'}; }
  }
  ipc.handle('adjutorix:midia:status', async () => wrap(() => link.status()));
  ipc.handle('adjutorix:midia:presentations', async () => wrap(() => link.presentations()));
  ipc.handle('adjutorix:midia:bind', async (_event, input) => wrap(() => link.bind(isRecord(input) ? input.session_id : null)));
  ipc.handle('adjutorix:midia:listing', async (_event, input) => wrap(() => link.listing(isRecord(input) ? input.view_id : null)));
  ipc.handle('adjutorix:midia:read', async (_event, input) => wrap(() => link.read(isRecord(input) ? input.view_id : null,
    isRecord(input) ? input.path : null)));
  ipc.handle('adjutorix:midia:workItems', async () => wrap(() => link.workItems()));
}

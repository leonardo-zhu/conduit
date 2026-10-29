/**
 * SQLite 存储，用 Node 内置的 node:sqlite（不引入原生依赖，ARM 镜像不用编译）。
 *
 * 库文件在 CONDUIT_DATA_DIR（默认 web/.data/）下的 conduit.db。
 * 表结构用 user_version 做迁移：MIGRATIONS 只追加，不改已有的条目。
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS = [
  `CREATE TABLE passkeys (
    id            TEXT PRIMARY KEY,        -- 凭据 ID（base64url）
    public_key    BLOB NOT NULL,           -- COSE 公钥
    counter       INTEGER NOT NULL DEFAULT 0,
    transports    TEXT NOT NULL DEFAULT '[]',
    name          TEXT NOT NULL,
    device_type   TEXT NOT NULL,           -- singleDevice / multiDevice
    backed_up     INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,        -- unix 秒
    last_used_at  INTEGER
  )`,
  // 应用、上游、别名、令牌、用量记录。额度单位都是 token（输入 + 输出），0 表示不限
  `CREATE TABLE apps (
    id            INTEGER PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,    -- 应用标识，如 vita；也是别名和令牌名的前缀
    name          TEXT NOT NULL,
    status        INTEGER NOT NULL DEFAULT 1,  -- 1 启用，2 禁用
    quota         INTEGER NOT NULL DEFAULT 0,
    quota_period  TEXT NOT NULL DEFAULT 'none',  -- none 不重置 / month 每月 1 日重置
    used          INTEGER NOT NULL DEFAULT 0,    -- 当前周期已用
    period_start  INTEGER NOT NULL DEFAULT 0,    -- 当前周期开始（unix 秒），按月重置时用
    request_count INTEGER NOT NULL DEFAULT 0,
    remark        TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE upstreams (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    type          INTEGER NOT NULL,        -- 沿用 NewAPI 的渠道类型编号：1 OpenAI 兼容，8 自定义，45 火山方舟，35 MiniMax
    base_url      TEXT NOT NULL DEFAULT '',
    key_enc       TEXT NOT NULL,           -- 用 CONDUIT_MASTER_KEY 加密，见 crypto.ts
    key_last4     TEXT NOT NULL,
    models        TEXT NOT NULL DEFAULT '[]',  -- 上游提供的模型名（JSON 数组），别名从中选
    test_model    TEXT NOT NULL DEFAULT '',
    status        INTEGER NOT NULL DEFAULT 1,  -- 1 启用，2 禁用
    remark        TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    test_time     INTEGER NOT NULL DEFAULT 0,
    response_time INTEGER NOT NULL DEFAULT 0   -- 最近一次测试的耗时（毫秒）
  );
  CREATE TABLE aliases (
    id             INTEGER PRIMARY KEY,
    app_id         INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,          -- 如 vita-chat，应用之间互不影响
    upstream_id    INTEGER NOT NULL REFERENCES upstreams(id) ON DELETE RESTRICT,
    upstream_model TEXT NOT NULL,
    UNIQUE (app_id, name)
  );
  CREATE TABLE tokens (
    id            INTEGER PRIMARY KEY,
    app_id        INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    key_hash      TEXT NOT NULL UNIQUE,    -- sha256(去掉 sk- 的密钥)，明文只在创建时返回一次
    key_prefix    TEXT NOT NULL,           -- 前 4 位和后 4 位，列表里显示用
    key_last4     TEXT NOT NULL,
    status        INTEGER NOT NULL DEFAULT 1,  -- 1 启用，2 禁用（过期、额度用尽按字段现算）
    expires_at    INTEGER NOT NULL DEFAULT -1, -- -1 不过期
    quota         INTEGER NOT NULL DEFAULT 0,
    used          INTEGER NOT NULL DEFAULT 0,
    models        TEXT NOT NULL DEFAULT '[]',  -- 可用的别名（JSON 数组），必须属于同一应用
    allow_ips     TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX tokens_app ON tokens(app_id);
  -- 用量记录只记元数据，不记请求和响应内容。不加外键：删掉应用或令牌后记录保留
  CREATE TABLE usage_logs (
    id             INTEGER PRIMARY KEY,
    request_id     TEXT NOT NULL,
    app_id         INTEGER,
    app_slug       TEXT NOT NULL,
    token_id       INTEGER,
    token_name     TEXT NOT NULL,
    alias          TEXT NOT NULL,
    upstream_id    INTEGER,
    upstream_name  TEXT NOT NULL DEFAULT '',
    upstream_model TEXT NOT NULL DEFAULT '',
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    is_stream      INTEGER NOT NULL DEFAULT 0,
    status_code    INTEGER NOT NULL DEFAULT 200,
    error          TEXT NOT NULL DEFAULT '',   -- 空表示成功
    first_token_ms INTEGER NOT NULL DEFAULT 0,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    estimated      INTEGER NOT NULL DEFAULT 0, -- 拿不到上游 usage、按收到的输出估算
    ip             TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL
  );
  CREATE INDEX usage_logs_created ON usage_logs(created_at);
  CREATE INDEX usage_logs_app ON usage_logs(app_id, created_at);
  CREATE INDEX usage_logs_token ON usage_logs(token_id, created_at);`,
]

function open(): DatabaseSync {
  const dir = path.resolve(process.env.CONDUIT_DATA_DIR || '.data')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(path.join(dir, 'conduit.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i])
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return db
}

// 开发时热更新会重新执行模块，挂在 globalThis 上避免重复打开
const globalRef = globalThis as typeof globalThis & { __conduitDb?: DatabaseSync }

export function db(): DatabaseSync {
  globalRef.__conduitDb ??= open()
  return globalRef.__conduitDb
}

// ---------------------------------------------------------------------------
// passkeys
// ---------------------------------------------------------------------------

export interface PasskeyRow {
  id: string
  public_key: Uint8Array
  counter: number
  transports: string
  name: string
  device_type: string
  backed_up: number
  created_at: number
  last_used_at: number | null
}

export function listPasskeys(): PasskeyRow[] {
  return db().prepare('SELECT * FROM passkeys ORDER BY created_at').all() as unknown as PasskeyRow[]
}

export function countPasskeys(): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM passkeys').get() as { n: number }
  return row.n
}

export function getPasskey(id: string): PasskeyRow | undefined {
  return db().prepare('SELECT * FROM passkeys WHERE id = ?').get(id) as PasskeyRow | undefined
}

export function insertPasskey(row: Omit<PasskeyRow, 'last_used_at'>) {
  db()
    .prepare(
      `INSERT INTO passkeys (id, public_key, counter, transports, name, device_type, backed_up, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.public_key,
      row.counter,
      row.transports,
      row.name,
      row.device_type,
      row.backed_up,
      row.created_at
    )
}

export function touchPasskey(id: string, counter: number, backedUp: boolean, now: number) {
  db()
    .prepare('UPDATE passkeys SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ?')
    .run(counter, backedUp ? 1 : 0, now, id)
}

export function deletePasskey(id: string): boolean {
  return db().prepare('DELETE FROM passkeys WHERE id = ?').run(id).changes > 0
}

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

export function transaction<T>(run: () => T): T {
  const conn = db()
  conn.exec('BEGIN IMMEDIATE')
  try {
    const result = run()
    conn.exec('COMMIT')
    return result
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('FOREIGN KEY constraint failed')
}

export const nowSeconds = () => Math.floor(Date.now() / 1000)

export function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

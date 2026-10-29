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

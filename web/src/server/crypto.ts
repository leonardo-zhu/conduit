/**
 * 上游密钥的加密：AES-256-GCM，主密钥来自环境变量 CONDUIT_MASTER_KEY
 * （32 字节的 base64，用 openssl rand -base64 32 生成）。
 *
 * 密文格式 v1:iv:tag:ciphertext（都是 base64url）。换主密钥后旧密文解不开，
 * 需要在后台重新填一遍各上游的密钥。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export class MasterKeyError extends Error {}

function masterKey(): Buffer {
  const value = process.env.CONDUIT_MASTER_KEY
  if (!value) throw new MasterKeyError('未配置 CONDUIT_MASTER_KEY')
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new MasterKeyError('CONDUIT_MASTER_KEY 必须是 32 字节的 base64')
  return key
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join(':')
}

export function decryptSecret(encoded: string): string {
  const [version, iv, tag, data] = encoded.split(':')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('密文格式不对')
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

/** 令牌密钥只存哈希。密钥是 48 位随机字符，熵足够，不需要慢哈希 */
export function hashTokenKey(key: string): string {
  return createHash('sha256').update(key.replace(/^sk-/, '')).digest('hex')
}

const KEY_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** 和 NewAPI 一样：48 位字母数字，前端显示时加 sk- 前缀 */
export function generateTokenKey(): string {
  const bytes = randomBytes(48)
  let key = ''
  // 62 不整除 256，用拒绝采样避免偏差
  for (let i = 0; key.length < 48; i++) {
    const b = i < bytes.length ? bytes[i] : randomBytes(1)[0]
    if (b < 248) key += KEY_CHARS[b % 62]
  }
  return key
}

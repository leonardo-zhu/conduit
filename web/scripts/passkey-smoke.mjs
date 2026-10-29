#!/usr/bin/env node
/**
 * Passkey 接口冒烟测试：在 Node 里模拟一个软件认证器（P-256 密钥 + none 证明），
 * 走一遍注册、登录、列表、删除，以及几种应当失败的情况。
 *
 * 浏览器里的 WebAuthn 会弹系统的 Touch ID，没法自动化，接口层用这个脚本验证。
 * 会在库里注册一个名为 smoke-test 的 Passkey，结束时删掉。
 *
 *   pnpm dev   # 另开一个终端
 *   node scripts/passkey-smoke.mjs [http://localhost:3020] [密码]
 */
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'

const BASE = process.argv[2] || 'http://localhost:3020'
const USERNAME = process.env.ADMIN_USERNAME || 'admin'
const PASSWORD = process.argv[3] || 'conduit-dev-local'
const ORIGIN = new URL(BASE).origin

// ---------------------------------------------------------------------------
// 最小 CBOR 编码：只支持整数、字节串、文本和 map，够拼 attestationObject 和 COSE 公钥
// ---------------------------------------------------------------------------

function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 256) return Buffer.from([(major << 5) | 24, n])
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff])
  throw new Error('too long')
}

function cbor(value) {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === 'string') {
    const bytes = Buffer.from(value)
    return Buffer.concat([head(3, bytes.length), bytes])
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value])
  if (value instanceof Map) {
    const parts = [head(5, value.size)]
    for (const [k, v] of value) parts.push(cbor(k), cbor(v))
    return Buffer.concat(parts)
  }
  throw new Error(`unsupported ${typeof value}`)
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const sha256 = (data) => createHash('sha256').update(data).digest()

// ---------------------------------------------------------------------------
// 软件认证器
// ---------------------------------------------------------------------------

// flags：UP(0x01) | UV(0x04) | BE(0x08) | BS(0x10)，注册时再加 AT(0x40)
const FLAGS = 0x01 | 0x04 | 0x08 | 0x10

class Authenticator {
  constructor() {
    this.keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    this.credentialId = randomBytes(16)
    this.counter = 0
  }

  authData(rpId, flags, attested) {
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.counter)
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), counter, attested ?? Buffer.alloc(0)])
  }

  create(options) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' })
    const coseKey = cbor(
      new Map([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ])
    )
    const idLen = Buffer.alloc(2)
    idLen.writeUInt16BE(this.credentialId.length)
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, coseKey])
    const authData = this.authData(options.rp.id, FLAGS | 0x40, attested)
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: ORIGIN, crossOrigin: false })
    )
    this.userHandle = options.user.id
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        attestationObject: b64url(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))),
        clientDataJSON: b64url(clientDataJSON),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
    }
  }

  get(options) {
    this.counter += 1
    const authData = this.authData(options.rpId, FLAGS)
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: ORIGIN, crossOrigin: false })
    )
    const signer = createSign('SHA256')
    signer.update(Buffer.concat([authData, sha256(clientDataJSON)]))
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        authenticatorData: b64url(authData),
        clientDataJSON: b64url(clientDataJSON),
        signature: b64url(signer.sign(this.keys.privateKey)),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  const session = res.headers.getSetCookie().find((c) => c.startsWith('conduit_session='))
  return { status: res.status, json, cookie: session?.split(';')[0] }
}

let failed = 0
function check(label, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  ${JSON.stringify(detail)}`}`)
  if (!ok) failed += 1
}

// ---------------------------------------------------------------------------

const login = await call('POST', '/api/user/login', { body: { username: USERNAME, password: PASSWORD } })
check('密码登录', login.json.success && login.cookie, login.json)
const cookie = login.cookie

const before = (await call('GET', '/api/user/passkey', { cookie })).json.data.length

const badPw = await call('POST', '/api/user/passkey/register/begin', { cookie, body: { password: 'wrong' } })
check('注册：密码错误被拒', !badPw.json.success, badPw.json)

const noSession = await call('POST', '/api/user/passkey/register/begin', { body: { password: PASSWORD } })
check('注册：未登录 401', noSession.status === 401, noSession)

const regBegin = await call('POST', '/api/user/passkey/register/begin', { cookie, body: { password: PASSWORD } })
const regOptions = regBegin.json.data?.options?.publicKey
check('注册：begin 返回选项', regBegin.json.success && regOptions?.challenge, regBegin.json)
check('注册：要求可发现凭据', regOptions?.authenticatorSelection?.residentKey === 'required', regOptions)

const authr = new Authenticator()
const attestation = authr.create(regOptions)
const regFinish = await call('POST', '/api/user/passkey/register/finish', {
  cookie,
  body: { flow_token: regBegin.json.data.flow_token, credential: attestation, name: 'smoke-test' },
})
check('注册：finish 成功', regFinish.json.success && regFinish.json.data?.name === 'smoke-test', regFinish.json)
check('注册：识别为可同步凭据', regFinish.json.data?.device_type === 'multiDevice' && regFinish.json.data?.backed_up, regFinish.json.data)

const regReplay = await call('POST', '/api/user/passkey/register/finish', {
  cookie,
  body: { flow_token: regBegin.json.data.flow_token, credential: attestation },
})
check('注册：flow token 不能重用', !regReplay.json.success, regReplay.json)

const list = await call('GET', '/api/user/passkey', { cookie })
check('列表多了一个且不含公钥', list.json.data?.length === before + 1 && !('public_key' in list.json.data.at(-1)), list.json)

const status = await call('GET', '/api/status')
check('status：passkey_login 为 true', status.json.data?.passkey_login === true, status.json.data?.passkey_login)

const wrongRp = await call('POST', '/api/user/passkey/login/begin', { body: { rp_id: 'example.com' } })
check('登录：RP ID 不符返回 PASSKEY_RP_ID_UNAVAILABLE', wrongRp.json.code === 'PASSKEY_RP_ID_UNAVAILABLE', wrongRp.json)

const crossKind = await call('POST', '/api/user/passkey/login/finish', {
  body: { flow_token: regBegin.json.data.flow_token, credential: authr.get({ rpId: regOptions.rp.id, challenge: regOptions.challenge }) },
})
check('登录：注册用的 flow token 不能拿来登录', !crossKind.json.success, crossKind.json)

const loginBegin = await call('POST', '/api/user/passkey/login/begin', { body: {} })
const loginOptions = loginBegin.json.data?.options?.publicKey
check('登录：begin 不带 allowCredentials', loginBegin.json.success && !loginOptions?.allowCredentials?.length, loginBegin.json)

const tampered = authr.get(loginOptions)
tampered.response.signature = b64url(Buffer.from(tampered.response.signature, 'base64url').map((b, i) => (i === 10 ? b ^ 1 : b)))
const badSig = await call('POST', '/api/user/passkey/login/finish', {
  body: { flow_token: loginBegin.json.data.flow_token, credential: tampered },
})
check('登录：签名被篡改时失败', !badSig.json.success && !badSig.cookie, badSig.json)

const loginBegin2 = await call('POST', '/api/user/passkey/login/begin', { body: {} })
const assertion = authr.get(loginBegin2.json.data.options.publicKey)
const loginFinish = await call('POST', '/api/user/passkey/login/finish', {
  body: { flow_token: loginBegin2.json.data.flow_token, credential: assertion },
})
check(
  '登录：finish 成功并下发会话',
  loginFinish.json.success && loginFinish.cookie && loginFinish.json.data?.session?.login_method === 'passkey',
  loginFinish.json
)

const self = await call('GET', '/api/user/self', { cookie: loginFinish.cookie })
check('登录：新会话可访问 /api/user/self', self.json.success, self.json)

const loginReplay = await call('POST', '/api/user/passkey/login/finish', {
  body: { flow_token: loginBegin2.json.data.flow_token, credential: assertion },
})
check('登录：同一份应答不能重放', !loginReplay.json.success, loginReplay.json)

const used = (await call('GET', '/api/user/passkey', { cookie })).json.data.find((p) => p.name === 'smoke-test')
check('登录后记录最近使用时间', typeof used?.last_used_at === 'number', used)

const del = await call('DELETE', `/api/user/passkey/${encodeURIComponent(used.id)}`, { cookie })
check('删除成功', del.json.success, del.json)
const delAgain = await call('DELETE', `/api/user/passkey/${encodeURIComponent(used.id)}`, { cookie })
check('删除不存在的返回 404', delAgain.status === 404, delAgain)

const loginBegin3 = await call('POST', '/api/user/passkey/login/begin', { body: {} })
const afterDelete = await call('POST', '/api/user/passkey/login/finish', {
  body: { flow_token: loginBegin3.json.data.flow_token, credential: authr.get(loginBegin3.json.data.options.publicKey) },
})
check('删除后不能再用它登录', !afterDelete.json.success && afterDelete.json.code === 'PASSKEY_NOT_FOUND', afterDelete.json)

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)

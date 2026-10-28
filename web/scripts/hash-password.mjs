// 生成 ADMIN_PASSWORD_HASH：node scripts/hash-password.mjs
// 密码从标准输入读取，不出现在命令行历史里。格式与 src/server/auth.ts 的 verifyPassword 一致。
import { randomBytes, scryptSync } from 'node:crypto'
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
rl._writeToOutput = (s) => {
  if (s.includes('Password')) process.stderr.write(s)
}
rl.question('Password: ', (password) => {
  rl.close()
  process.stderr.write('\n')
  if (password.length < 12) {
    console.error('密码至少 12 位')
    process.exit(1)
  }
  const [N, r, p] = [16384, 8, 1]
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N, r, p })
  console.log(['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join(':'))
})

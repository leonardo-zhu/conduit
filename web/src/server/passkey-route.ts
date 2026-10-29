import { AuthConfigError } from './auth'
import { PasskeyError } from './passkey'
import { respond } from './respond'

/** Passkey 接口共用的错误处理：PasskeyError 原样返回给前端，其余按服务端错误处理 */
export async function passkeyRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof PasskeyError) {
      return respond({ success: false, message: error.message, code: error.code }, { status: 400 })
    }
    if (error instanceof AuthConfigError) {
      console.error(`[auth] ${error.message}`)
      return respond({ success: false, message: '服务端未配置管理员账号' }, { status: 500 })
    }
    throw error
  }
}

/**
 * 假数据接口的路由表。
 *
 * 自己的后端写好之前，页面请求的 /api/* 由这里按 NewAPI 的返回格式应答，
 * 用来跑通页面、决定每页留哪些字段。接口逐个换成真实实现后删掉对应条目。
 */
import { createRouter } from '@/server/router'

export type { ApiRequest as MockRequest } from '@/server/router'
export { fail, ok, paginate } from '@/server/router'

const router = createRouter()

export const mock = router.register
export const match = router.match

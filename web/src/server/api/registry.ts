import { createRouter } from '../router'

// 真实接口的路由表；各领域的文件 import 时注册，入口见 ./index.ts
const router = createRouter()

export const route = router.register
export const match = router.match

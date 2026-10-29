import { mock, ok } from '../router'

mock('GET', '/api/notice', () => ok(''))

// NewAPI 的分组（计费倍率用），Conduit 不用，只给一个默认分组
mock('GET', '/api/group', () => ok(['default']))
mock('GET', '/api/user/self/groups', () => ok({ default: { desc: '默认分组', ratio: 1 } }))

// 管理员细粒度权限目录，Conduit 只有一个超级管理员，返回空
mock('GET', '/api/authz/catalog', () => ok({ resources: [], roles: [] }))

// 应用没有第三方登录
mock('GET', '/api/user/:id/oauth/bindings', () => ok([]))

// 渠道运维设置：Conduit 不重试、不自动禁用
mock('GET', '/api/channel/ops', () =>
  ok({ retry_times: 0, request_policy: { automatic_disable: false, source: 'global' } })
)

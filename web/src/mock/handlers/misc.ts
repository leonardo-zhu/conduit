import { mock, ok } from '../router'

mock('GET', '/api/notice', () => ok(''))

// NewAPI 的分组（计费倍率用），Conduit 不用，只给一个默认分组
mock('GET', '/api/group', () => ok(['default']))

// 管理员细粒度权限目录，Conduit 只有一个超级管理员，返回空
mock('GET', '/api/authz/catalog', () => ok({ resources: [], roles: [] }))

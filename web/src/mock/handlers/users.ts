import { users, type MockUser } from '../data'
import { fail, mock, ok, paginate } from '../router'

// 应用列表：管理员账号不算应用
const apps = () => users.filter((u) => u.role < 10)

mock('GET', '/api/user', ({ query }) => paginate(apps(), query))

mock('GET', '/api/user/search', ({ query }) => {
  const keyword = (query.get('keyword') ?? '').toLowerCase()
  return paginate(
    apps().filter(
      (u) =>
        !keyword ||
        u.username.toLowerCase().includes(keyword) ||
        u.display_name.toLowerCase().includes(keyword)
    ),
    query
  )
})

mock('GET', '/api/user/self/groups', () =>
  ok({ default: { desc: '默认分组', ratio: 1 } })
)

mock('GET', '/api/user/:id/oauth/bindings', () => ok([]))

mock('GET', '/api/user/:id', ({ params }) => {
  const u = users.find((x) => x.id === Number(params.id))
  return u ? ok(u) : fail('用户不存在')
})

mock('POST', '/api/user', ({ body }) => {
  const input = (body ?? {}) as Partial<MockUser>
  const id = Math.max(0, ...users.map((u) => u.id)) + 1
  const t = Math.floor(Date.now() / 1000)
  users.push({
    id,
    username: input.username ?? `app-${id}`,
    display_name: input.display_name ?? input.username ?? `app-${id}`,
    role: 1,
    status: 1,
    group: 'default',
    quota: input.quota ?? 0,
    used_quota: 0,
    request_count: 0,
    remark: input.remark,
    created_at: t,
    last_login_at: 0,
  })
  return ok()
})

mock('PUT', '/api/user', ({ body }) => {
  const input = (body ?? {}) as Partial<MockUser> & { password?: string }
  const u = users.find((x) => x.id === Number(input.id))
  if (!u) return fail('用户不存在')
  const { id: _id, password: _pw, ...rest } = input
  Object.assign(u, rest)
  return ok(u)
})

mock('DELETE', '/api/user/:id', ({ params }) => {
  const i = users.findIndex((x) => x.id === Number(params.id))
  if (i <= 0) return fail('不能删除这个用户')
  users.splice(i, 1)
  return ok()
})

// 启用 / 禁用 / 提升 / 降级
mock('POST', '/api/user/manage', ({ body }) => {
  const { id, action } = (body ?? {}) as { id?: number; action?: string }
  const u = users.find((x) => x.id === Number(id))
  if (!u) return fail('用户不存在')
  if (action === 'disable') u.status = 2
  if (action === 'enable') u.status = 1
  if (action === 'promote') u.role = 10
  if (action === 'demote') u.role = 1
  return ok({ role: u.role, status: u.status })
})

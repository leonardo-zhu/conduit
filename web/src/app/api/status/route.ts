import { countPasskeys } from '@/server/db'
import { respond } from '@/server/respond'

const startTime = Math.floor(Date.now() / 1000)

// 对应 NewAPI 的 GET /api/status，不需要登录。只填页面会读到的字段；第三方登录、充值、注册一律关闭
export function GET() {
  return respond({
    success: true,
    data: {
      version: 'conduit',
      start_time: startTime,
      system_name: 'Conduit',
      logo: '',
      footer_html: '',
      server_address: process.env.PASSKEY_ORIGIN || 'https://conduit.r4s.leonardo-zhu.me',
      docs_link: '',
      // 只计 token，不计价
      quota_per_unit: 500000,
      display_in_currency: false,
      quota_display_type: 'TOKENS',
      usd_exchange_rate: 7,
      enable_batch_update: true,
      enable_drawing: false,
      enable_task: false,
      enable_data_export: true,
      data_export_default_time: 'hour',
      default_collapse_sidebar: false,
      self_use_mode_enabled: true,
      register_enabled: false,
      password_login_enabled: true,
      password_register_enabled: false,
      password_login_encryption_enabled: false,
      email_verification: false,
      github_oauth: false,
      discord_oauth: false,
      linuxdo_oauth: false,
      telegram_oauth: false,
      wechat_login: false,
      oidc_enabled: false,
      // 至少注册了一个 Passkey 时，登录页才显示 Passkey 按钮
      passkey_login: countPasskeys() > 0,
      turnstile_check: false,
      demo_site_enabled: false,
      api_info_enabled: false,
      uptime_kuma_enabled: false,
      announcements_enabled: false,
      faq_enabled: false,
      checkin_enabled: false,
      user_agreement_enabled: false,
      privacy_policy_enabled: false,
      log_export_enabled: true,
      log_max_range_days: 30,
      quota_remind_enabled: false,
      setup: true,
      chats: [],
    },
  })
}

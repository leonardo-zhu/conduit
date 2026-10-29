/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
/**
 * Conduit: 上游（NewAPI 渠道）的新建 / 编辑抽屉。
 *
 * NewAPI 原抽屉有 5000 多行，覆盖四十多种渠道类型的专属配置（Azure、Vertex、AWS、
 * 多 Key、参数覆盖、请求头透传等）。Conduit 只接 OpenAI 兼容、自定义、火山方舟和
 * MiniMax，这里沿用原抽屉的布局组件，只保留用得到的字段。
 *
 * 别名属于应用，在应用里配置；这里只填上游提供哪些模型，供别名选择和测试用。
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Download, KeyRound, Loader2, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createChannel, fetchUpstreamModels, updateChannel } from '../../api'
import { CHANNEL_STATUS } from '../../constants'
import { channelsQueryKeys } from '../../lib'
import type { Channel } from '../../types'

// Conduit: 上游不区分服务商，也不按服务商给默认值。
// OpenAI 兼容地址必填，Chat Completions 一定提供；Responses API 用开关决定是否提供（默认关），
// 打开后再选原生支持（默认）还是网关转换；Anthropic 兼容地址选填，填了就提供 /v1/messages
// （直接转发，不和 OpenAI 格式互转）
type ResponsesMode = NonNullable<Channel['responses_mode']>
type ResponsesKind = Exclude<ResponsesMode, 'none'>
const RESPONSES_KINDS: ResponsesKind[] = ['native', 'convert']

function getSchema(t: (key: string) => string, isUpdate: boolean) {
  return z.object({
    name: z.string().trim().min(1, t('Please enter a name')),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._-]*$/, t('Use lowercase letters, digits and . _ -')),
    responses_enabled: z.boolean(),
    responses_kind: z.enum(['native', 'convert']),
    anthropic_base_url: z
      .string()
      .trim()
      .refine((v) => !v || /^https?:\/\//.test(v), t('Start the address with http:// or https://')),
    base_url: z.string().trim().min(1, t('Please enter the base URL')),
    // 编辑时留空表示不改密钥
    key: isUpdate
      ? z.string()
      : z.string().trim().min(1, t('Please enter the API key')),
    models: z.array(z.string()),
    test_model: z.string(),
    enabled: z.boolean(),
    remark: z.string(),
  })
}

type FormValues = z.infer<ReturnType<typeof getSchema>>

const EMPTY_VALUES: FormValues = {
  name: '',
  slug: '',
  // 新建默认只有 Chat Completions；打开 Responses 时默认原生支持
  responses_enabled: false,
  responses_kind: 'native',
  anthropic_base_url: '',
  base_url: '',
  key: '',
  models: [],
  test_model: '',
  enabled: true,
  remark: '',
}

function toFormValues(channel: Channel): FormValues {
  return {
    name: channel.name,
    slug: channel.slug ?? '',
    responses_enabled: (channel.responses_mode ?? 'none') !== 'none',
    responses_kind: channel.responses_mode === 'convert' ? 'convert' : 'native',
    anthropic_base_url: channel.anthropic_base_url ?? '',
    base_url: channel.base_url ?? '',
    key: '',
    models: channel.models.split(',').filter(Boolean),
    test_model: channel.test_model ?? '',
    enabled: channel.status === CHANNEL_STATUS.ENABLED,
    remark: channel.remark ?? '',
  }
}

function toPayload(values: FormValues): Partial<Channel> {
  return {
    name: values.name,
    slug: values.slug,
    responses_mode: values.responses_enabled ? values.responses_kind : 'none',
    anthropic_base_url: values.anthropic_base_url.replace(/\/+$/, ''),
    base_url: values.base_url.replace(/\/+$/, '') || null,
    models: values.models.join(','),
    test_model: values.test_model || null,
    // 需求不含渠道自动禁用
    auto_ban: 0,
    status: values.enabled
      ? CHANNEL_STATUS.ENABLED
      : CHANNEL_STATUS.MANUAL_DISABLED,
    remark: values.remark,
    ...(values.key.trim() ? { key: values.key.trim() } : {}),
  }
}

type ChannelMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow: Channel | null
}

export function ChannelMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: ChannelMutateDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isUpdate = !!currentRow
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t, isUpdate)),
    defaultValues: EMPTY_VALUES,
  })

  useEffect(() => {
    if (!open) return
    form.reset(currentRow ? toFormValues(currentRow) : EMPTY_VALUES)
  }, [open, currentRow, form])

  const models = form.watch('models')
  const responsesMode: ResponsesMode = form.watch('responses_enabled') ? form.watch('responses_kind') : 'none'
  const hasAnthropic = !!form.watch('anthropic_base_url').trim()
  const RESPONSES_HINT: Record<ResponsesMode, string> = {
    none: t('Calls to /v1/responses are rejected with a hint to use /v1/chat/completions'),
    convert: t(
      'The gateway converts to and from Chat Completions. Only function tools are kept; reasoning parameters and built-in tools such as search are dropped.'
    ),
    native: t('The upstream has /responses at the OpenAI-compatible address; requests are forwarded as-is'),
  }
  const RESPONSES_LABEL: Record<ResponsesKind, string> = {
    native: t('Native'),
    convert: t('Convert in the gateway'),
  }
  const [isFetchingModels, setIsFetchingModels] = useState(false)

  // 从上游的 GET /models 拉取，并入已填的模型（只有保存过的上游才有密钥可用）
  const handleFetchModels = async () => {
    if (!currentRow) return
    setIsFetchingModels(true)
    try {
      const result = await fetchUpstreamModels(currentRow.id)
      if (!result.success || !result.data) {
        handleServerError(result, t('Failed to fetch models'))
        return
      }
      const merged = [...new Set([...form.getValues('models'), ...result.data])]
      form.setValue('models', merged, { shouldDirty: true })
      toast.success(t('Fetched {{count}} models', { count: result.data.length }))
    } catch (error) {
      handleServerError(error, t('Failed to fetch models'))
    } finally {
      setIsFetchingModels(false)
    }
  }

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      const payload = toPayload(values)
      const result = currentRow
        ? await updateChannel(currentRow.id, payload)
        : await createChannel({ mode: 'single', channel: payload })
      if (!result.success) {
        handleServerError(result, t('Failed to save channel'))
        return
      }
      toast.success(
        currentRow
          ? t('Channel updated successfully')
          : t('Channel created successfully')
      )
      await queryClient.invalidateQueries({ queryKey: channelsQueryKeys.all })
      onOpenChange(false)
    } catch (error) {
      handleServerError(error, t('Failed to save channel'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={sideDrawerContentClassName('max-w-none sm:!max-w-[620px]')}
      >
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Update Channel') : t('Create Channel')}
          </SheetTitle>
          <SheetDescription>
            {t('Configure an upstream provider: address, key and the models it offers')}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='channel-form'
            onSubmit={form.handleSubmit(onSubmit)}
            inert={isSubmitting ? true : undefined}
            className={sideDrawerFormClassName('gap-5')}
          >
            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Basic Information')}
                icon={<KeyRound className='size-4' />}
                iconTone='info'
              />
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('e.g. Main upstream')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='slug'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Provider ID')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder='minimax' autoComplete='off' />
                    </FormControl>
                    <FormDescription>
                      {t('Apps can skip aliases and call ID/model directly, e.g. minimax/MiniMax-M2. Apps using the old ID break if you change it.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className='space-y-4'>
                <Label>{t('Endpoints')}</Label>
                <FormField
                  control={form.control}
                  name='base_url'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='text-sm'>{t('OpenAI-compatible base URL')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder='https://api.example.com/v1' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className='space-y-3 border-l-2 pl-3'>
                  <div className='flex items-baseline justify-between gap-3'>
                    <span className='text-sm font-medium'>Chat Completions</span>
                    <span className='text-muted-foreground text-xs'>
                      {t('Always offered')}
                    </span>
                  </div>
                  <FormField
                    control={form.control}
                    name='responses_enabled'
                    render={({ field }) => (
                      <FormItem className='flex items-center justify-between gap-3 space-y-0'>
                        <FormLabel className='text-sm font-medium'>Responses API</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  {responsesMode === 'none' ? (
                    <p className='text-muted-foreground -mt-1 text-xs'>{RESPONSES_HINT.none}</p>
                  ) : (
                    <FormField
                      control={form.control}
                      name='responses_kind'
                      render={({ field }) => (
                        <FormItem className='space-y-2'>
                          <Tabs value={field.value} onValueChange={(v) => field.onChange(v as ResponsesKind)}>
                            <TabsList className='w-full'>
                              {RESPONSES_KINDS.map((kind) => (
                                <TabsTrigger key={kind} value={kind}>
                                  {RESPONSES_LABEL[kind]}
                                </TabsTrigger>
                              ))}
                            </TabsList>
                          </Tabs>
                          <FormDescription className='text-xs'>
                            {RESPONSES_HINT[field.value]}
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  )}
                </div>
                <FormField
                  control={form.control}
                  name='anthropic_base_url'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='text-sm'>
                        {t('Anthropic-compatible base URL')}
                        <span className='text-muted-foreground ms-1 text-xs font-normal'>
                          {t('(optional)')}
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder='https://api.example.com/anthropic' />
                      </FormControl>
                      <FormDescription className='text-xs'>
                        {t(
                          'Fill it in like ANTHROPIC_BASE_URL. Calls to /v1/messages are forwarded to <address>/v1/messages as-is, never converted. Leave empty if the upstream has no Anthropic API.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className='text-muted-foreground text-xs'>
                  {t('Apps can call')}: <code>/v1/chat/completions</code>
                  {responsesMode !== 'none' && (
                    <>
                      {', '}
                      <code>/v1/responses</code>
                      {responsesMode === 'convert' && ` (${t('converted by the gateway')})`}
                    </>
                  )}
                  {hasAnthropic && (
                    <>
                      {', '}
                      <code>/v1/messages</code>
                    </>
                  )}
                </p>
              </div>
              <FormField
                control={form.control}
                name='key'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Key')}</FormLabel>
                    <FormControl>
                      {/* 用文本框加 CSS 遮盖：type=password 会让 Chrome 把整个表单当成登录表单，
                          无视 autocomplete=off，把“API 地址”当用户名弹出已保存的账号 */}
                      <Input
                        {...field}
                        type='text'
                        spellCheck={false}
                        className='[-webkit-text-security:disc]'
                        placeholder={
                          isUpdate
                            ? t('Leave empty to keep the current key')
                            : t('Enter the upstream API key')
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Upstream models')}
                description={t(
                  'Models this upstream offers. Aliases are configured per app and pick from this list.'
                )}
                icon={<Boxes className='size-4' />}
                iconTone='success'
              />
              <FormField
                control={form.control}
                name='models'
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <MultiSelect
                        options={field.value.map((m) => ({ label: m, value: m }))}
                        selected={field.value}
                        onChange={field.onChange}
                        allowCreate
                        placeholder={t('Model name as the upstream expects it')}
                      />
                    </FormControl>
                    <FormDescription>
                      {isUpdate
                        ? t('Type a model name and press Enter, or fetch the list from the upstream')
                        : t('Type a model name and press Enter; after saving you can also fetch the list from the upstream')}
                    </FormDescription>
                    {isUpdate && (
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        className='w-fit'
                        disabled={isFetchingModels}
                        onClick={handleFetchModels}
                      >
                        {isFetchingModels ? (
                          <Loader2 className='size-4 animate-spin' />
                        ) : (
                          <Download className='size-4' />
                        )}
                        {t('Fetch models from upstream')}
                      </Button>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Advanced Settings')}
                icon={<Settings2 className='size-4' />}
              />
              <FormField
                control={form.control}
                name='test_model'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Test Model')}</FormLabel>
                    <FormControl>
                      <NativeSelect
                        className='w-full'
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      >
                        <NativeSelectOption value=''>
                          {t('First model')}
                        </NativeSelectOption>
                        {models.map((m) => (
                          <NativeSelectOption key={m} value={m}>
                            {m}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='enabled'
                render={({ field }) => (
                  <FormItem className={sideDrawerSwitchItemClassName()}>
                    <FormLabel className='text-sm'>{t('Enabled')}</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='remark'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Remark')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} className='resize-none' />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose
            render={<Button variant='outline' className='w-full sm:w-auto' />}
          >
            {t('Close')}
          </SheetClose>
          <Button
            type='submit'
            form='channel-form'
            disabled={isSubmitting}
            className='w-full sm:w-auto'
          >
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

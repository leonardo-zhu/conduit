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
 * MiniMax，这里沿用原抽屉的布局组件和模型映射编辑器，只保留用得到的字段。
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, Route, Settings2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createChannel, updateChannel } from '../../api'
import { CHANNEL_STATUS } from '../../constants'
import { channelsQueryKeys, getChannelTypeLabel } from '../../lib'
import type { Channel } from '../../types'
import { ModelMappingEditor } from '../model-mapping-editor'

/** Conduit 接入的上游类型：1 OpenAI 兼容，8 自定义，45 火山方舟，35 MiniMax */
const UPSTREAM_TYPES = [1, 8, 45, 35] as const

function getSchema(t: (key: string) => string, isUpdate: boolean) {
  return z.object({
    name: z.string().trim().min(1, t('Please enter a name')),
    type: z.number(),
    base_url: z.string().trim(),
    // 编辑时留空表示不改密钥
    key: isUpdate
      ? z.string()
      : z.string().trim().min(1, t('Please enter the API key')),
    models: z.array(z.string()).min(1, t('Add at least one model alias')),
    model_mapping: z.string(),
    test_model: z.string(),
    auto_ban: z.boolean(),
    enabled: z.boolean(),
    remark: z.string(),
  })
}

type FormValues = z.infer<ReturnType<typeof getSchema>>

const EMPTY_VALUES: FormValues = {
  name: '',
  type: 1,
  base_url: '',
  key: '',
  models: [],
  model_mapping: '',
  test_model: '',
  auto_ban: true,
  enabled: true,
  remark: '',
}

function toFormValues(channel: Channel): FormValues {
  return {
    name: channel.name,
    type: channel.type,
    base_url: channel.base_url ?? '',
    key: '',
    models: channel.models.split(',').filter(Boolean),
    model_mapping: channel.model_mapping ?? '',
    test_model: channel.test_model ?? '',
    auto_ban: (channel.auto_ban ?? 1) === 1,
    enabled: channel.status === CHANNEL_STATUS.ENABLED,
    remark: channel.remark ?? '',
  }
}

function toPayload(values: FormValues): Partial<Channel> {
  return {
    name: values.name,
    type: values.type,
    base_url: values.base_url.replace(/\/+$/, '') || null,
    models: values.models.join(','),
    model_mapping: values.model_mapping.trim() || null,
    test_model: values.test_model || null,
    auto_ban: values.auto_ban ? 1 : 0,
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
            {t('Configure an upstream provider and the model aliases it serves')}
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
                      <Input {...field} placeholder={t('e.g. Ark Agent Plan')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='type'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Type')}</FormLabel>
                    <FormControl>
                      <NativeSelect
                        className='w-full'
                        value={String(field.value)}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      >
                        {UPSTREAM_TYPES.map((type) => (
                          <NativeSelectOption key={type} value={type}>
                            {t(getChannelTypeLabel(type))}
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
                name='base_url'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Base URL')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder='https://ark.cn-beijing.volces.com/api/v3'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='key'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Key')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='password'
                        autoComplete='off'
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
                title={t('Model aliases')}
                description={t(
                  'Apps call these aliases; map each alias to the model name the upstream expects'
                )}
                icon={<Route className='size-4' />}
                iconTone='success'
              />
              <FormField
                control={form.control}
                name='models'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Aliases')}</FormLabel>
                    <FormControl>
                      <MultiSelect
                        options={field.value.map((m) => ({ label: m, value: m }))}
                        selected={field.value}
                        onChange={field.onChange}
                        allowCreate
                        placeholder={t('e.g. vita-chat')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='model_mapping'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Alias to upstream model')}</FormLabel>
                    <FormControl>
                      <ModelMappingEditor
                        value={field.value}
                        onChange={field.onChange}
                        sourceModelOptions={models}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Changing the upstream model here takes effect immediately; apps keep using the alias'
                      )}
                    </FormDescription>
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
                          {t('First alias')}
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
                name='auto_ban'
                render={({ field }) => (
                  <FormItem className={sideDrawerSwitchItemClassName()}>
                    <div className='flex flex-col gap-0.5'>
                      <FormLabel className='text-sm'>
                        {t('Auto-disable channel')}
                      </FormLabel>
                      <FormDescription className='text-xs'>
                        {t('Disable this upstream automatically when requests keep failing')}
                      </FormDescription>
                    </div>
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

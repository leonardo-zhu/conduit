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
 * Conduit: 应用（NewAPI 用户）的新建 / 编辑抽屉。
 *
 * 应用不登录，所以去掉了 NewAPI 的密码、角色、分组、管理员权限矩阵和二次验证；
 * 只保留应用标识、显示名、额度（token）和备注，另加 Conduit 的模型别名和 API 密钥。
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AppWindow, Plus, Route, Trash2, WalletCards } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
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
} from '@/components/drawer-layout'
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
import { Textarea } from '@/components/ui/textarea'
import { getChannels } from '@/features/channels/api'
import { AppKeysSection } from '@/features/keys/components/app-keys-section'
import { handleServerError } from '@/lib/handle-server-error'

import { createUser, getAppAliases, saveAppAliases, updateUser } from '../api'
import type { User } from '../types'
import { useUsers } from './users-provider'

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

function getSchema(t: (key: string) => string) {
  return z.object({
    username: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]*$/, t('Use lowercase letters, digits and hyphens')),
    display_name: z.string().trim(),
    quota: z.number().int().min(0),
    quota_period: z.enum(['none', 'month']),
    remark: z.string(),
    aliases: z.array(
      z.object({
        name: z
          .string()
          .trim()
          .regex(ALIAS_PATTERN, t('Use lowercase letters, digits and . _ -')),
        upstream_id: z.number().int().positive(t('Select an upstream')),
        upstream_model: z.string().trim().min(1, t('Enter the upstream model')),
      })
    ),
  })
}

type FormValues = z.infer<ReturnType<typeof getSchema>>

const EMPTY_VALUES: FormValues = {
  username: '',
  display_name: '',
  quota: 0,
  quota_period: 'none',
  remark: '',
  aliases: [],
}

type UsersMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: User
}

export function UsersMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: UsersMutateDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isUpdate = !!currentRow
  const { triggerRefresh } = useUsers()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: EMPTY_VALUES,
  })
  const aliasFields = useFieldArray({ control: form.control, name: 'aliases' })

  const { data: upstreams = [] } = useQuery({
    queryKey: ['conduit-upstream-options'],
    queryFn: async () => (await getChannels({ p: 1, page_size: 100 })).data?.items ?? [],
    enabled: open,
  })
  const { data: savedAliases, isLoading: aliasesLoading } = useQuery({
    queryKey: ['app-aliases', currentRow?.id],
    queryFn: () => getAppAliases(currentRow!.id),
    enabled: open && !!currentRow,
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      currentRow
        ? {
            username: currentRow.username,
            display_name: currentRow.display_name ?? '',
            quota: currentRow.quota,
            quota_period: currentRow.quota_period ?? 'none',
            remark: currentRow.remark ?? '',
            aliases: (savedAliases ?? []).map(({ name, upstream_id, upstream_model }) => ({
              name,
              upstream_id,
              upstream_model,
            })),
          }
        : EMPTY_VALUES
    )
  }, [open, currentRow, savedAliases, form])

  const slug = form.watch('username')
  const aliases = form.watch('aliases')

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      const payload = {
        username: values.username,
        display_name: values.display_name || values.username,
        quota: values.quota,
        quota_period: values.quota_period,
        remark: values.remark,
      }
      const result = currentRow
        ? await updateUser({ ...payload, id: currentRow.id })
        : await createUser({ ...payload, role: 1 })
      if (!result.success || !result.data?.id) {
        handleServerError(result, t('Failed to save app'))
        return
      }
      // 应用先存好，再整体保存别名；新建时用返回的 id
      const aliasResult = await saveAppAliases(result.data.id, values.aliases)
      if (!aliasResult.success) {
        handleServerError(aliasResult, t('App saved, but its aliases could not be saved'))
        triggerRefresh()
        return
      }
      toast.success(currentRow ? t('App updated') : t('App created'))
      await queryClient.invalidateQueries({ queryKey: ['app-aliases'] })
      onOpenChange(false)
      triggerRefresh()
    } catch (error) {
      handleServerError(error, t('Failed to save app'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[640px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{isUpdate ? t('Update App') : t('Create App')}</SheetTitle>
          <SheetDescription>
            {t('An app groups the keys of one client or service and shares its budget')}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='app-form'
            onSubmit={form.handleSubmit(onSubmit)}
            inert={isSubmitting ? true : undefined}
            className={sideDrawerFormClassName('gap-5')}
          >
            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Basic Information')}
                icon={<AppWindow className='size-4' />}
                iconTone='info'
              />
              <FormField
                control={form.control}
                name='display_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder='Vita' />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='username'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('App ID')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder='vita' disabled={isUpdate} />
                    </FormControl>
                    <FormDescription>
                      {isUpdate
                        ? t('The app ID cannot be changed after creation')
                        : t('A unique ID shown in usage logs, filters and alerts; it cannot be changed later. Also the default prefix of key names and aliases')}
                    </FormDescription>
                    <FormMessage />
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

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Model aliases')}
                description={t(
                  'Optional. An alias is the app\'s own model name pointing to a provider model; repointing it takes effect immediately without changing the app.'
                )}
                icon={<Route className='size-4' />}
                iconTone='success'
              />
              {aliasesLoading ? (
                <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
              ) : (
                <div className='space-y-3'>
                  {aliasFields.fields.map((item, index) => {
                    const upstream = upstreams.find(
                      (u) => u.id === aliases[index]?.upstream_id
                    )
                    const upstreamModels = (upstream?.models ?? '')
                      .split(',')
                      .filter(Boolean)
                    const currentModel = aliases[index]?.upstream_model
                    // 已保存的模型后来从服务商的列表里删掉了，也要能显示出来
                    const modelOptions =
                      currentModel && !upstreamModels.includes(currentModel)
                        ? [currentModel, ...upstreamModels]
                        : upstreamModels
                    return (
                      <div
                        key={item.id}
                        className='grid grid-cols-[1fr_auto] gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]'
                      >
                        <FormField
                          control={form.control}
                          name={`aliases.${index}.name`}
                          render={({ field }) => (
                            <FormItem className='col-span-1'>
                              <FormLabel className='text-xs'>{t('Alias')}</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder={`${slug || 'app'}-chat`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='text-muted-foreground hover:text-destructive mt-5 self-start sm:order-last'
                          aria-label={t('Remove alias')}
                          onClick={() => aliasFields.remove(index)}
                        >
                          <Trash2 className='size-4' />
                        </Button>
                        <FormField
                          control={form.control}
                          name={`aliases.${index}.upstream_id`}
                          render={({ field }) => (
                            <FormItem className='col-span-2 sm:col-span-1'>
                              <FormLabel className='text-xs'>{t('Upstream')}</FormLabel>
                              <FormControl>
                                <NativeSelect
                                  className='w-full'
                                  value={String(field.value || '')}
                                  onChange={(e) => {
                                    const id = Number(e.target.value)
                                    field.onChange(id)
                                    // 换了服务商，模型跟着换成它列表里的第一个
                                    const models = (
                                      upstreams.find((u) => u.id === id)?.models ?? ''
                                    )
                                      .split(',')
                                      .filter(Boolean)
                                    form.setValue(
                                      `aliases.${index}.upstream_model`,
                                      models[0] ?? ''
                                    )
                                  }}
                                >
                                  <NativeSelectOption value=''>
                                    {t('Select an upstream')}
                                  </NativeSelectOption>
                                  {upstreams.map((u) => (
                                    <NativeSelectOption key={u.id} value={u.id}>
                                      {u.name}
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
                          name={`aliases.${index}.upstream_model`}
                          render={({ field }) => (
                            <FormItem className='col-span-2 sm:col-span-1'>
                              <FormLabel className='text-xs'>{t('Upstream model')}</FormLabel>
                              {/* 从服务商填的模型列表里选；列表在服务商抽屉里维护 */}
                              <FormControl>
                                <NativeSelect
                                  className='w-full'
                                  value={field.value}
                                  onChange={(e) => field.onChange(e.target.value)}
                                  disabled={!upstream}
                                >
                                  <NativeSelectOption value=''>
                                    {upstream && modelOptions.length === 0
                                      ? t('This provider has no models yet')
                                      : t('Select a model')}
                                  </NativeSelectOption>
                                  {modelOptions.map((m) => (
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
                      </div>
                    )
                  })}
                  {aliasFields.fields.length === 0 && (
                    <p className='text-muted-foreground rounded-md border border-dashed py-4 text-center text-sm'>
                      {t('No aliases. Keys of this app can still call provider-id/model directly, e.g. minimax/MiniMax-M2.')}
                    </p>
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={upstreams.length === 0}
                    onClick={() => {
                      const only = upstreams.length === 1 ? upstreams[0] : undefined
                      aliasFields.append({
                        name: slug ? `${slug}-` : '',
                        upstream_id: only?.id ?? 0,
                        upstream_model: only?.models.split(',').find(Boolean) ?? '',
                      })
                    }}
                  >
                    <Plus className='size-4' />
                    {t('Add alias')}
                  </Button>
                  {upstreams.length === 0 && (
                    <p className='text-muted-foreground text-xs'>
                      {t('Add an upstream first, then aliases can point to it')}
                    </p>
                  )}
                </div>
              )}
            </SideDrawerSection>

            <AppKeysSection
              appId={currentRow?.id}
              appSlug={currentRow?.username ?? slug}
            />

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Budget')}
                icon={<WalletCards className='size-4' />}
                iconTone='warning'
              />
              <FormField
                control={form.control}
                name='quota'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Total quota (tokens)')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step={1}
                        value={field.value}
                        onChange={(e) =>
                          field.onChange(Number.parseInt(e.target.value, 10) || 0)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Shared by all keys of this app; 0 means unlimited')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='quota_period'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Quota period')}</FormLabel>
                    <FormControl>
                      <NativeSelect
                        className='w-full'
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      >
                        <NativeSelectOption value='none'>{t('Never reset')}</NativeSelectOption>
                        <NativeSelectOption value='month'>
                          {t('Reset on the 1st of each month')}
                        </NativeSelectOption>
                      </NativeSelect>
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
            form='app-form'
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

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
 * 只保留应用标识、显示名、总额度（token）和备注。
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { AppWindow, WalletCards } from 'lucide-react'
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createUser, updateUser } from '../api'
import type { User } from '../types'
import { useUsers } from './users-provider'

function getSchema(t: (key: string) => string) {
  return z.object({
    username: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]*$/, t('Use lowercase letters, digits and hyphens')),
    display_name: z.string().trim(),
    quota: z.number().int().min(0),
    remark: z.string(),
  })
}

type FormValues = z.infer<ReturnType<typeof getSchema>>

const EMPTY_VALUES: FormValues = {
  username: '',
  display_name: '',
  quota: 0,
  remark: '',
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
  const isUpdate = !!currentRow
  const { triggerRefresh } = useUsers()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(getSchema(t)),
    defaultValues: EMPTY_VALUES,
  })

  useEffect(() => {
    if (!open) return
    form.reset(
      currentRow
        ? {
            username: currentRow.username,
            display_name: currentRow.display_name ?? '',
            quota: currentRow.quota,
            remark: currentRow.remark ?? '',
          }
        : EMPTY_VALUES
    )
  }, [open, currentRow, form])

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      const payload = {
        username: values.username,
        display_name: values.display_name || values.username,
        quota: values.quota,
        remark: values.remark,
      }
      const result = currentRow
        ? await updateUser({ ...payload, id: currentRow.id })
        : await createUser({ ...payload, role: 1 })
      if (!result.success) {
        handleServerError(result, t('Failed to save app'))
        return
      }
      toast.success(currentRow ? t('App updated') : t('App created'))
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
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[600px]')}>
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
                name='username'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('App ID')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder='vita' disabled={isUpdate} />
                    </FormControl>
                    <FormDescription>
                      {t('Used as the prefix of key names and aliases, e.g. vita-chat')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='display_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Display Name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder='Vita' />
                    </FormControl>
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
                title={t('Budget')}
                icon={<WalletCards className='size-4' />}
                iconTone='success'
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
                      {t('Shared by all keys of this app; each key can have its own cap')}
                    </FormDescription>
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

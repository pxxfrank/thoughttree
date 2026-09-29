import { useCallback } from 'react'
import { useAppState } from '../state/context'
import { translate, type Locale } from './strings'

export type Translate = (key: string, params?: Record<string, string | number>) => string

export function useI18n(): { t: Translate; locale: Locale } {
  const { locale } = useAppState()
  const t = useCallback<Translate>(
    (key, params) => translate(locale, key, params),
    [locale],
  )
  return { t, locale }
}

export { LOCALES, detectLocale, translate } from './strings'
export type { Locale } from './strings'

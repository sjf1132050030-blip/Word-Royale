import { computed, ref } from 'vue'
import { messages } from './messages'

const stored = localStorage.getItem('wr_lang')
const locale = ref(stored === 'en' || stored === 'zh' ? stored : 'zh')

export function useI18n() {
  const t = (key, params = {}) => {
    const table = messages[locale.value] || messages.zh
    let s = table[key] ?? messages.zh[key] ?? key
    Object.keys(params).forEach((k) => {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]))
    })
    return s
  }

  function setLocale(lang) {
    if (lang !== 'zh' && lang !== 'en') return
    locale.value = lang
    localStorage.setItem('wr_lang', lang)
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }

  function toggleLocale() {
    setLocale(locale.value === 'zh' ? 'en' : 'zh')
  }

  return {
    locale: computed(() => locale.value),
    t,
    setLocale,
    toggleLocale,
  }
}

export { locale }

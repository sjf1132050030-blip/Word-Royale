<script setup>
import { useI18n } from '../i18n'

const { locale, setLocale, t } = useI18n()
</script>

<template>
  <div class="lang" :title="t('lang')">
    <button type="button" :class="{ on: locale === 'zh' }" @click="setLocale('zh')">中</button>
    <button type="button" :class="{ on: locale === 'en' }" @click="setLocale('en')">EN</button>
  </div>
</template>

<style scoped>
.lang {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25);
}

.lang button {
  border: none;
  background: transparent;
  color: var(--muted);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.lang button.on {
  background: linear-gradient(135deg, #3dffb5, #4cc9f0);
  color: #041018;
}
</style>

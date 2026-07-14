<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useI18n } from '../i18n'
import LangSwitch from '../components/LangSwitch.vue'

const router = useRouter()
const store = useUserStore()
const { t } = useI18n()
const mode = ref('login')
const email = ref('')
const password = ref('')
const nickname = ref('')
const error = ref('')

async function submit() {
  error.value = ''
  try {
    if (mode.value === 'login') {
      await store.login({ email: email.value, password: password.value })
    } else {
      await store.register({
        email: email.value,
        password: password.value,
        nickname: nickname.value || undefined,
      })
    }
    router.push('/')
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="page login-page">
    <div class="lang-row"><LangSwitch /></div>
    <div class="hero panel">
      <div class="badge">{{ t('competitive') }}</div>
      <h1 class="brand">{{ t('appName') }}</h1>
      <p class="tagline">{{ t('tagline') }}</p>
      <ul class="features">
        <li>⚡ Combo XP + longer matches</li>
        <li>📖 {{ t('allMeanings') }}</li>
        <li>🤖 {{ t('aiCoach') }} · Gemini / Agnes / Qwen</li>
      </ul>
    </div>

    <form class="panel form" @submit.prevent="submit">
      <div class="tabs">
        <button type="button" :class="{ active: mode === 'login' }" @click="mode = 'login'">{{ t('login') }}</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="mode = 'register'">{{ t('register') }}</button>
      </div>

      <label>
        <span>{{ t('email') }}</span>
        <input v-model="email" class="input" type="email" required placeholder="you@example.com" />
      </label>
      <label v-if="mode === 'register'">
        <span>{{ t('nickname') }}</span>
        <input v-model="nickname" class="input" maxlength="24" :placeholder="t('nicknamePh')" />
      </label>
      <label>
        <span>{{ t('password') }}</span>
        <input v-model="password" class="input" type="password" required minlength="6" placeholder="******" />
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="btn btn-primary full" type="submit" :disabled="store.loading">
        {{ store.loading ? t('processing') : mode === 'login' ? t('enterBattle') : t('createAccount') }}
      </button>
      <p class="muted tip">{{ t('loopTip') }}</p>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  display: grid;
  gap: 18px;
  max-width: 440px;
  padding-top: 32px;
}
.lang-row {
  display: flex;
  justify-content: flex-end;
}
.hero {
  padding: 28px 24px;
  text-align: center;
}
.badge {
  display: inline-block;
  font-family: Orbitron, sans-serif;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: #041018;
  background: linear-gradient(90deg, #ffd166, #3dffb5);
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 800;
}
.brand {
  margin: 14px 0 6px;
  font-size: 34px;
  background: linear-gradient(90deg, #fff, #4cc9f0, #3dffb5);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tagline {
  margin: 0 0 16px;
  color: var(--muted);
}
.features {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
  text-align: left;
}
.features li {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
}
.form {
  padding: 22px;
  display: grid;
  gap: 14px;
}
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.tabs button {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  font-weight: 700;
}
.tabs button.active {
  color: #041018;
  background: linear-gradient(135deg, #3dffb5, #4cc9f0);
  border-color: transparent;
}
label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
.full {
  width: 100%;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 14px;
}
.tip {
  margin: 0;
  font-size: 12px;
  text-align: center;
}
</style>

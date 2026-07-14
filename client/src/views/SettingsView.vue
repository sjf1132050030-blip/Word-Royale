<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import http, { aiPost } from '../api/http'
import { useUserStore } from '../stores/user'
import { useI18n } from '../i18n'
import LangSwitch from '../components/LangSwitch.vue'

const router = useRouter()
const store = useUserStore()
const { t, locale } = useI18n()

const nickname = ref('')
const aiProvider = ref('gemini')
const aiFallback = ref(true)
const wordbookCode = ref('cet4')
const wordbooks = ref([])
const providers = ref([])
const saving = ref(false)
const testing = ref(false)
const msg = ref('')
const err = ref('')
const pingResult = ref('')

onMounted(async () => {
  try {
    if (!store.user) await store.fetchMe()
    nickname.value = store.user?.nickname || ''
    aiProvider.value = store.user?.settings?.ai_provider || 'gemini'
    aiFallback.value = store.user?.settings?.ai_fallback !== false
    wordbookCode.value = store.user?.settings?.wordbook_code || 'cet4'
    const [{ data: aiData }, { data: today }] = await Promise.all([
      http.get('/ai/providers'),
      http.get('/today'),
    ])
    providers.value = aiData.providers || []
    wordbooks.value = today.wordbooks || []
  } catch (e) {
    err.value = e.message
  }
})

async function save() {
  saving.value = true
  msg.value = ''
  err.value = ''
  try {
    const { data } = await http.patch('/auth/me/settings', {
      nickname: nickname.value,
      ai_provider: aiProvider.value,
      ai_fallback: aiFallback.value,
      wordbook_code: wordbookCode.value,
    })
    store.applyUser(data.user)
    msg.value = t('settingsSaved')
  } catch (e) {
    err.value = e.message
  } finally {
    saving.value = false
  }
}

async function testAi() {
  testing.value = true
  pingResult.value = ''
  err.value = ''
  try {
    const { data } = await aiPost('/ai/ping', {
      lang: locale.value,
      provider: aiProvider.value,
    })
    if (data.text) {
      const think = data.thinking ? `\n(${t('aiThinkLabel')}: ${data.thinking})` : ''
      pingResult.value = `[${data.provider}] ${data.text}${think}`
    } else {
      err.value = data.error || t('aiFail')
    }
  } catch (e) {
    err.value = e.message
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="top panel">
      <div>
        <div class="brand title">{{ t('settings') }}</div>
        <div class="muted">{{ t('settingsSub') }}</div>
      </div>
      <div class="actions">
        <LangSwitch />
        <button class="btn btn-ghost" @click="router.push('/')">{{ t('toLobby') }}</button>
      </div>
    </header>

    <section class="panel block">
      <h2>{{ t('profile') }}</h2>
      <label>
        <span>{{ t('nickname') }}</span>
        <input v-model="nickname" class="input" maxlength="24" />
      </label>
    </section>

    <section class="panel block">
      <h2>{{ t('wordbooks') }}</h2>
      <p class="muted desc">{{ t('wordbookHint') }}</p>
      <div class="providers">
        <label
          v-for="b in wordbooks"
          :key="b.code"
          class="prov"
          :class="{ on: wordbookCode === b.code }"
        >
          <input v-model="wordbookCode" type="radio" :value="b.code" />
          <div>
            <div class="pname">{{ b.name_zh }} / {{ b.name_en }}</div>
            <div class="muted small">{{ b.word_count }} {{ t('wordsUnit') }} · {{ b.description }}</div>
          </div>
        </label>
      </div>
    </section>

    <section class="panel block">
      <h2>{{ t('aiModel') }}</h2>
      <p class="muted desc">{{ t('aiModelDesc') }}</p>

      <div class="providers">
        <label
          v-for="p in providers"
          :key="p.id"
          class="prov"
          :class="{ on: aiProvider === p.id, off: !p.available }"
        >
          <input v-model="aiProvider" type="radio" :value="p.id" />
          <div>
            <div class="pname">{{ p.label }}</div>
            <div class="muted small">
              {{ p.model }} · {{ p.available ? t('available') : t('unavailable') }}
              <span v-if="p.id === 'qwen' && !p.available"> · 远程 Ollama 不可达</span>
            </div>
          </div>
        </label>
      </div>
      <p v-if="providers.some((p) => p.id === 'qwen' && !p.available)" class="muted small">
        远程 Qwen（Ollama）：
        <code>http://117.72.54.166:11434/api/chat</code>
        · 模型 <code>qwen2.5:0.5b</code>。请确认服务器已开放 11434 端口。
      </p>

      <label class="check">
        <input v-model="aiFallback" type="checkbox" />
        <span>{{ t('aiFallback') }}</span>
      </label>
      <p class="muted small">{{ t('aiFallbackDesc') }}</p>

      <div class="row-btns">
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? t('processing') : t('save') }}
        </button>
        <button class="btn btn-ghost" :disabled="testing" @click="testAi">
          {{ testing ? t('processing') : t('testAi') }}
        </button>
      </div>

      <p v-if="msg" class="ok">{{ msg }}</p>
      <p v-if="err" class="error">{{ err }}</p>
      <div v-if="pingResult" class="ping">{{ pingResult }}</div>
    </section>
  </div>
</template>

<style scoped>
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.title {
  font-size: 18px;
  font-weight: 800;
}
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.block {
  padding: 16px 18px;
  margin-bottom: 14px;
  display: grid;
  gap: 12px;
}
.block h2 {
  margin: 0;
  font-size: 16px;
}
label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
.desc {
  margin: 0;
  font-size: 13px;
}
.providers {
  display: grid;
  gap: 10px;
}
.prov {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  color: var(--text);
}
.prov.on {
  border-color: rgba(61, 255, 181, 0.5);
  background: rgba(61, 255, 181, 0.08);
}
.prov.off {
  opacity: 0.5;
}
.pname {
  font-weight: 800;
}
.small {
  font-size: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  grid-template-columns: none;
}
.row-btns {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.ok {
  color: var(--ok);
  margin: 0;
}
.error {
  color: var(--danger);
  margin: 0;
}
.ping {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
  white-space: pre-wrap;
  line-height: 1.5;
}
</style>

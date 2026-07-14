<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import http, { aiPost } from '../api/http'
import { useUserStore } from '../stores/user'
import { useI18n } from '../i18n'
import LangSwitch from '../components/LangSwitch.vue'

const route = useRoute()
const router = useRouter()
const store = useUserStore()
const { t, locale } = useI18n()

const loading = ref(true)
const dropping = ref(false)
const error = ref('')
const sessionId = ref(null)
const lessonTitle = ref('')
const questions = ref([])
const index = ref(0)
const hearts = ref(8)
const heartsMax = ref(8)
const combo = ref(0)
const comboMax = ref(0)
const correctCount = ref(0)
const wrongCount = ref(0)
const feedback = ref(null)
const locked = ref(false)
const result = ref(null)
const royale = ref(null)
const killFeed = ref([])

/** per-option mnemonic: { loading, tip, thinking, thinkOpen, waitSec, provider, error, elapsed_ms } */
const mnemonics = ref({})
/** timers for loading seconds */
const waitTimers = {}

const picked = ref([])
const remaining = ref([])

const current = computed(() => questions.value[index.value] || null)
const progress = computed(() =>
  questions.value.length ? (index.value / questions.value.length) * 100 : 0
)
const isLast = computed(() => index.value >= questions.value.length - 1)
const aiModelLabel = computed(() => {
  const p = store.user?.settings?.ai_provider || 'gemini'
  if (p === 'agnes') return 'Agnes'
  if (p === 'qwen') return 'Qwen2.5'
  return 'Gemini'
})
const circlePct = computed(() => royale.value?.circle_radius ?? 100)
const feedText = (item) => (locale.value === 'en' ? item.text_en : item.text_zh)
const circleName = computed(() =>
  locale.value === 'en' ? royale.value?.circle_name_en : royale.value?.circle_name_zh
)
const dropZone = computed(() =>
  locale.value === 'en' ? royale.value?.drop_zone_en : royale.value?.drop_zone_zh
)

function pushFeed(items = []) {
  for (const it of items) {
    killFeed.value = [it, ...killFeed.value].slice(0, 6)
  }
}

function typeLabel(type) {
  const map = {
    en_to_zh: t('type_en_to_zh'),
    zh_to_en: t('type_zh_to_en'),
    cloze: t('type_cloze'),
    sentence_order: t('type_sentence_order'),
    spelling: t('type_spelling'),
  }
  return map[type] || type
}

async function start() {
  loading.value = true
  dropping.value = true
  error.value = ''
  result.value = null
  mnemonics.value = {}
  killFeed.value = []
  try {
    const { data } = await http.post(`/lessons/${route.params.lessonId}/start`)
    sessionId.value = data.session_id
    lessonTitle.value = data.lesson.title
    questions.value = data.questions
    hearts.value = data.hearts
    heartsMax.value = data.hearts || 8
    royale.value = data.royale || null
    if (data.royale?.feed) pushFeed(data.royale.feed)
    index.value = 0
    combo.value = 0
    comboMax.value = 0
    correctCount.value = 0
    wrongCount.value = 0
    feedback.value = null
    setupOrder()
    // skydiving intro
    await new Promise((r) => setTimeout(r, 1600))
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    dropping.value = false
  }
}

function setupOrder() {
  picked.value = []
  remaining.value = current.value?.type === 'sentence_order' ? [...current.value.tokens] : []
}

async function submitAnswer(answer) {
  if (locked.value || feedback.value) return
  locked.value = true
  try {
    const { data } = await http.post('/answer', {
      session_id: sessionId.value,
      question_index: index.value,
      answer,
      lang: locale.value,
    })
    feedback.value = data
    mnemonics.value = {}
    combo.value = data.combo
    comboMax.value = data.combo_max
    hearts.value = data.hearts_left
    if (data.hearts_max) heartsMax.value = data.hearts_max
    correctCount.value = data.correct_count
    wrongCount.value = data.wrong_count
    if (data.royale) {
      royale.value = { ...royale.value, ...data.royale }
      pushFeed(data.royale.feed || [])
    }
  } catch (e) {
    error.value = e.message
  } finally {
    locked.value = false
  }
}

function chooseOption(key) {
  submitAnswer(key)
}

function pickToken(token, i) {
  if (feedback.value) return
  remaining.value.splice(i, 1)
  picked.value.push(token)
}

function undoToken() {
  if (feedback.value || !picked.value.length) return
  const t = picked.value.pop()
  remaining.value.push(t)
}

function confirmOrder() {
  if (!picked.value.length) return
  submitAnswer([...picked.value])
}

function clearWaitTimer(key) {
  if (waitTimers[key]) {
    clearInterval(waitTimers[key])
    delete waitTimers[key]
  }
}

function startWaitTimer(key) {
  clearWaitTimer(key)
  waitTimers[key] = setInterval(() => {
    const cur = mnemonics.value[key]
    if (!cur?.loading) {
      clearWaitTimer(key)
      return
    }
    mnemonics.value = {
      ...mnemonics.value,
      [key]: { ...cur, waitSec: (cur.waitSec || 0) + 1 },
    }
  }, 1000)
}

function toggleThink(key) {
  const cur = mnemonics.value[key]
  if (!cur) return
  mnemonics.value = {
    ...mnemonics.value,
    [key]: { ...cur, thinkOpen: !cur.thinkOpen },
  }
}

async function requestMnemonic(o) {
  const key = o.key || o.word
  if (!key) return
  const word = o.word || o.text
  if (!word || String(word).includes('干扰') || o.meaning_zh?.includes('干扰')) {
    mnemonics.value = {
      ...mnemonics.value,
      [key]: {
        loading: false,
        tip: t('mnemonicSkip'),
        thinking: null,
        thinkOpen: false,
        provider: 'local',
        waitSec: 0,
      },
    }
    return
  }

  mnemonics.value = {
    ...mnemonics.value,
    [key]: {
      loading: true,
      tip: '',
      thinking: null,
      // while generating: show thinking area expanded
      thinkOpen: true,
      waitSec: 0,
      provider: null,
      error: null,
    },
  }
  startWaitTimer(key)

  try {
    const { data } = await aiPost('/ai/mnemonic', {
      word,
      meaning_zh: o.meaning_zh || '',
      meaning_en: o.meaning_en || '',
      phonetic: o.phonetic || '',
      pos: o.pos || '',
      lang: locale.value,
    })
    clearWaitTimer(key)
    const hasThink = !!(data.thinking && String(data.thinking).trim())
    mnemonics.value = {
      ...mnemonics.value,
      [key]: {
        loading: false,
        tip: data.tip,
        thinking: data.thinking || null,
        // after result: collapse thinking
        thinkOpen: false,
        hasThink,
        provider: data.provider,
        model: data.model,
        elapsed_ms: data.elapsed_ms,
        waitSec: Math.round((data.elapsed_ms || 0) / 1000),
        error: null,
      },
    }
  } catch (e) {
    clearWaitTimer(key)
    mnemonics.value = {
      ...mnemonics.value,
      [key]: {
        loading: false,
        tip: '',
        thinking: null,
        thinkOpen: false,
        provider: null,
        error: e.message,
        waitSec: mnemonics.value[key]?.waitSec || 0,
      },
    }
  }
}

async function requestKeyWordMnemonic() {
  if (!feedback.value?.key_word) return
  await requestMnemonic({
    key: 'key_word',
    word: feedback.value.key_word.word,
    meaning_zh: feedback.value.key_word.meaning_zh,
    meaning_en: feedback.value.key_word.meaning_en,
    phonetic: feedback.value.key_word.phonetic,
  })
}

async function next() {
  if (!feedback.value) return
  if (isLast.value) {
    await finish()
    return
  }
  index.value += 1
  feedback.value = null
  mnemonics.value = {}
  setupOrder()
}

async function finish() {
  locked.value = true
  try {
    const { data } = await http.post('/finish', { session_id: sessionId.value })
    result.value = data
    store.applyUser(data.user)
  } catch (e) {
    error.value = e.message
  } finally {
    locked.value = false
  }
}

onMounted(start)
</script>

<template>
  <div class="page battle">
    <div class="top-tools">
      <button type="button" class="btn btn-ghost btn-home" @click="router.push('/')">
        ← {{ t('toLobby') }}
      </button>
      <div class="top-right">
        <span class="tag model-tag">AI: {{ aiModelLabel }}</span>
        <LangSwitch />
      </div>
    </div>

    <div v-if="loading || dropping" class="panel center drop-screen">
      <div class="plane">🪂</div>
      <h2>{{ dropping ? t('skydiving') : t('matching') }}</h2>
      <p class="muted">{{ dropZone || lessonTitle }} · 100 {{ t('players') }}</p>
      <div class="drop-bar"><div class="fill" /></div>
    </div>
    <div v-else-if="error && !sessionId" class="panel center">
      <p class="error">{{ error }}</p>
      <button class="btn btn-ghost" @click="router.push('/')">{{ t('backLobby') }}</button>
    </div>

    <div v-else-if="result" class="panel result pop" :class="{ chicken: result.royale?.chicken }">
      <div v-if="result.royale?.chicken" class="chicken-banner">WINNER WINNER<br />CHICKEN DINNER</div>
      <div class="place-num">#{{ result.royale?.placement || '—' }}</div>
      <h1 class="place-title">
        {{ locale === 'en' ? result.royale?.title_en : result.royale?.title_zh || t('resultTitle') }}
      </h1>
      <div class="stars">{{ '★'.repeat(result.stars) }}{{ '☆'.repeat(3 - result.stars) }}</div>
      <div class="grid">
        <div><span class="muted">{{ t('placement') }}</span><strong>#{{ result.royale?.placement }}</strong></div>
        <div><span class="muted">{{ t('kills') }}</span><strong>{{ result.royale?.kills || 0 }}</strong></div>
        <div><span class="muted">XP</span><strong>+{{ result.xp_earned }}</strong></div>
        <div><span class="muted">{{ t('coins') }}</span><strong>+{{ result.coins_earned }}</strong></div>
        <div><span class="muted">{{ t('maxCombo') }}</span><strong>{{ result.combo_max }}</strong></div>
        <div><span class="muted">{{ t('streak') }}</span><strong>🔥 {{ result.streak }}</strong></div>
      </div>
      <div class="result-actions">
        <button class="btn btn-primary" @click="router.push('/')">{{ t('toLobby') }}</button>
        <button class="btn btn-ghost" @click="router.push('/leaderboard')">{{ t('viewBoard') }}</button>
      </div>
    </div>

    <template v-else>
      <!-- Royale HUD -->
      <header class="hud royale-hud panel">
        <div class="hud-cell alive">
          <div class="k">{{ t('alive') }}</div>
          <div class="v danger-text">{{ royale?.alive ?? 100 }}</div>
        </div>
        <div class="hud-cell">
          <div class="k">{{ t('kills') }}</div>
          <div class="v gold-text">{{ royale?.kills ?? 0 }}</div>
        </div>
        <div class="hud-cell">
          <div class="k">{{ t('rankLive') }}</div>
          <div class="v">#{{ royale?.live_rank ?? '—' }}</div>
        </div>
        <div class="hud-cell">
          <div class="k">HP</div>
          <div class="v hearts">
            {{ '❤️'.repeat(Math.max(0, hearts)) }}{{ '🖤'.repeat(Math.max(0, heartsMax - hearts)) }}
          </div>
        </div>
        <div class="hud-cell combo" :class="{ hot: combo >= 3 }">
          <div class="k">{{ t('combo') }}</div>
          <div class="v combo-num">{{ combo }}</div>
        </div>
      </header>

      <div class="circle-row panel">
        <div class="circle-meta">
          <span class="tag poison">{{ circleName }}</span>
          <span class="muted small">{{ dropZone }} · {{ index + 1 }}/{{ questions.length }}</span>
        </div>
        <div class="circle-track">
          <div class="circle-safe" :style="{ width: circlePct + '%' }" />
        </div>
      </div>

      <!-- Kill feed -->
      <div class="kill-feed" v-if="killFeed.length">
        <div v-for="(f, i) in killFeed" :key="i" class="feed-item" :class="f.type">
          {{ feedText(f) }}
        </div>
      </div>

      <div class="progress-bar">
        <div class="fill" :style="{ width: progress + '%' }" />
      </div>

      <section
        v-if="current"
        class="panel stage"
        :class="{
          shake: feedback && !feedback.correct,
          'flash-ok': feedback?.correct,
          'flash-bad': feedback && !feedback.correct,
        }"
      >
        <div class="q-type">
          {{ feedback?.correct ? '⚔️ ' + t('fightWin') : '🎯 ' + typeLabel(current.type) }}
          · {{ index + 1 }}/{{ questions.length }}
        </div>
        <h2 class="prompt">{{ current.prompt }}</h2>
        <p class="sub muted">{{ current.sub }}</p>
        <div v-if="feedback?.royale?.round_kills" class="kill-pop pop">
          +{{ feedback.royale.round_kills }} {{ t('eliminations') }}
        </div>

        <div v-if="current.options && !feedback" class="options">
          <button
            v-for="opt in current.options"
            :key="opt.key"
            class="opt"
            :disabled="locked"
            @click="chooseOption(opt.key)"
          >
            <span class="key">{{ opt.key }}</span>
            <span>{{ opt.text }}</span>
          </button>
        </div>

        <div v-else-if="!feedback" class="order">
          <div class="picked-line">
            <button
              v-for="(tok, i) in picked"
              :key="'p' + i + tok"
              class="token on"
              @click="undoToken"
            >
              {{ tok }}
            </button>
            <span v-if="!picked.length" class="muted">{{ t('rebuildHint') }}</span>
          </div>
          <div class="pool">
            <button
              v-for="(tok, i) in remaining"
              :key="'r' + i + tok"
              class="token"
              @click="pickToken(tok, i)"
            >
              {{ tok }}
            </button>
          </div>
          <button class="btn btn-primary" :disabled="!picked.length || locked" @click="confirmOrder">
            {{ t('confirmOrder') }}
          </button>
        </div>

        <div v-if="feedback" class="feedback pop" :class="feedback.correct ? 'ok' : 'bad'">
          <div class="fb-title">
            {{ feedback.correct ? '💥 ' + t('hit') : '🩹 ' + t('miss') }}
            <span v-if="feedback.royale?.round_kills" class="kill-inline">
              +{{ feedback.royale.round_kills }} {{ t('kills') }}
            </span>
          </div>
          <div v-if="!feedback.correct && feedback.explanation" class="fb-exp">
            {{ t('correctWord') }}:
            {{
              Array.isArray(feedback.correct_answer)
                ? feedback.correct_answer.join(' ')
                : feedback.explanation
            }}
          </div>
          <div v-if="feedback.full_sentence" class="fb-exp">{{ feedback.full_sentence }}</div>

          <div v-if="feedback.options_reveal?.length" class="reveal-box">
            <div class="reveal-title">
              {{ t('allMeanings') }}
              <span class="muted tip-inline">· {{ t('mnemonicHint') }}</span>
            </div>

            <div
              v-for="o in feedback.options_reveal"
              :key="o.key"
              class="reveal-row"
              :class="{ correct: o.correct, selected: o.selected }"
            >
              <div class="r-head">
                <span class="r-key">{{ o.key }}</span>
                <strong>{{ o.word || o.text }}</strong>
                <span v-if="o.correct" class="pill ok">{{ t('correctWord') }}</span>
                <span v-if="o.selected && !o.correct" class="pill bad">{{ t('selected') }}</span>
              </div>
              <div class="r-body">
                <div v-if="o.phonetic" class="muted">
                  {{ o.phonetic }} <span v-if="o.pos">· {{ o.pos }}</span>
                </div>
                <div>{{ o.meaning_zh }}</div>
                <div class="muted en">{{ o.meaning_en }}</div>
              </div>

              <div class="mnemo-actions">
                <button
                  type="button"
                  class="btn-mnemo"
                  :disabled="mnemonics[o.key]?.loading"
                  @click.stop="requestMnemonic(o)"
                >
                  {{
                    mnemonics[o.key]?.loading
                      ? `${t('aiThinking')} ${mnemonics[o.key].waitSec || 0}s`
                      : mnemonics[o.key]?.tip
                        ? t('mnemonicAgain')
                        : t('mnemonicBtn')
                  }}
                </button>
              </div>

              <!-- loading / thinking -->
              <div v-if="mnemonics[o.key]?.loading" class="mnemo-loading">
                <div class="pulse-dot" />
                <span>{{ t('aiThinkingHint') }} · {{ mnemonics[o.key].waitSec || 0 }}s</span>
              </div>

              <div v-if="mnemonics[o.key]?.thinking || mnemonics[o.key]?.tip" class="mnemo-panel pop">
                <div class="muted small meta-line">
                  {{ t('aiCoach') }} · {{ mnemonics[o.key].provider || aiModelLabel }}
                  <span v-if="mnemonics[o.key].elapsed_ms">
                    · {{ Math.round(mnemonics[o.key].elapsed_ms / 1000) }}s
                  </span>
                </div>

                <button
                  v-if="mnemonics[o.key].thinking"
                  type="button"
                  class="think-toggle"
                  @click.stop="toggleThink(o.key)"
                >
                  {{ mnemonics[o.key].thinkOpen ? '▼' : '▶' }}
                  {{ t('aiThinkLabel') }}
                  <span class="muted">{{ mnemonics[o.key].thinkOpen ? t('collapse') : t('expand') }}</span>
                </button>
                <div v-if="mnemonics[o.key].thinking && mnemonics[o.key].thinkOpen" class="think-body">
                  {{ mnemonics[o.key].thinking }}
                </div>

                <div v-if="mnemonics[o.key].tip" class="mnemo-answer">
                  <div class="ans-label">{{ t('aiAnswerLabel') }}</div>
                  <p>{{ mnemonics[o.key].tip }}</p>
                </div>
              </div>

              <div v-else-if="mnemonics[o.key]?.error" class="error small">
                {{ mnemonics[o.key].error }}
              </div>
            </div>
          </div>

          <div v-if="feedback.key_word" class="reveal-box">
            <div class="reveal-title">Key word</div>
            <div class="reveal-row correct">
              <strong>{{ feedback.key_word.word }}</strong>
              <div>{{ feedback.key_word.meaning_zh }}</div>
              <div class="muted">{{ feedback.key_word.meaning_en }}</div>
              <div class="mnemo-actions">
                <button
                  type="button"
                  class="btn-mnemo"
                  :disabled="mnemonics.key_word?.loading"
                  @click="requestKeyWordMnemonic"
                >
                  {{
                    mnemonics.key_word?.loading
                      ? `${t('aiThinking')} ${mnemonics.key_word.waitSec || 0}s`
                      : mnemonics.key_word?.tip
                        ? t('mnemonicAgain')
                        : t('mnemonicBtn')
                  }}
                </button>
              </div>
              <div v-if="mnemonics.key_word?.loading" class="mnemo-loading">
                <div class="pulse-dot" />
                <span>{{ t('aiThinkingHint') }} · {{ mnemonics.key_word.waitSec || 0 }}s</span>
              </div>
              <div v-if="mnemonics.key_word?.thinking || mnemonics.key_word?.tip" class="mnemo-panel pop">
                <button
                  v-if="mnemonics.key_word.thinking"
                  type="button"
                  class="think-toggle"
                  @click="toggleThink('key_word')"
                >
                  {{ mnemonics.key_word.thinkOpen ? '▼' : '▶' }} {{ t('aiThinkLabel') }}
                </button>
                <div v-if="mnemonics.key_word.thinking && mnemonics.key_word.thinkOpen" class="think-body">
                  {{ mnemonics.key_word.thinking }}
                </div>
                <div v-if="mnemonics.key_word.tip" class="mnemo-answer">
                  <p>{{ mnemonics.key_word.tip }}</p>
                </div>
              </div>
            </div>
          </div>

          <button class="btn btn-primary" @click="next">
            {{ isLast ? t('seeResult') : t('nextQ') }}
          </button>
        </div>
      </section>

      <p v-if="error" class="error">{{ error }}</p>
    </template>
  </div>
</template>

<style scoped>
.top-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.top-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.btn-home {
  padding: 8px 14px;
  font-size: 13px;
}
.model-tag {
  font-size: 12px;
  color: var(--gold);
}
.center {
  padding: 40px;
  text-align: center;
}
.drop-screen .plane {
  font-size: 56px;
  animation: float 1.2s ease-in-out infinite;
}
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(12px);
  }
}
.drop-bar {
  height: 6px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
  margin-top: 16px;
}
.drop-bar .fill {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #ffd166, #ff4d6d);
  animation: load 1.5s linear forwards;
}
@keyframes load {
  to {
    width: 100%;
  }
}
.royale-hud {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  padding: 12px;
  margin-bottom: 10px;
}
.hud-cell {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px;
  text-align: center;
}
.hud-cell .k {
  font-size: 11px;
  color: var(--muted);
}
.hud-cell .v {
  font-weight: 800;
  font-size: 18px;
  margin-top: 2px;
  font-family: Orbitron, sans-serif;
}
.hud-cell .hearts {
  font-size: 12px;
  letter-spacing: 0;
  font-family: inherit;
}
.danger-text {
  color: #ff6b6b !important;
}
.gold-text {
  color: var(--gold) !important;
}
.hud-cell.combo.hot {
  border-color: rgba(255, 77, 109, 0.5);
  color: #ff8fab;
}
.combo-num {
  font-size: 22px !important;
}
.circle-row {
  padding: 10px 14px;
  margin-bottom: 10px;
}
.circle-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  gap: 8px;
  flex-wrap: wrap;
}
.tag.poison {
  background: rgba(155, 93, 229, 0.25);
  border-color: rgba(155, 93, 229, 0.5);
  color: #e0b3ff;
}
.circle-track {
  height: 10px;
  border-radius: 99px;
  background: rgba(255, 77, 109, 0.25);
  overflow: hidden;
  border: 1px solid rgba(255, 77, 109, 0.35);
}
.circle-safe {
  height: 100%;
  background: linear-gradient(90deg, #3dffb5, #4cc9f0);
  transition: width 0.4s ease;
}
.kill-feed {
  position: sticky;
  top: 0;
  z-index: 5;
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
  max-width: 420px;
}
.feed-item {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  border-left: 3px solid #ffd166;
  animation: pop 0.25s ease;
}
.feed-item.kill,
.feed-item.multi {
  border-left-color: #ff4d6d;
}
.feed-item.circle {
  border-left-color: #9b5de5;
}
.feed-item.loot {
  border-left-color: #3dffb5;
}
.feed-item.hurt {
  border-left-color: #ff8fab;
}
.kill-pop {
  display: inline-block;
  margin-bottom: 10px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 77, 109, 0.2);
  color: #ff8fab;
  font-weight: 800;
  font-size: 13px;
}
.kill-inline {
  margin-left: 8px;
  color: #ffd166;
  font-size: 14px;
}
.chicken-banner {
  font-family: Orbitron, sans-serif;
  font-size: 22px;
  font-weight: 800;
  color: #ffd166;
  text-shadow: 0 0 24px rgba(255, 209, 102, 0.55);
  margin-bottom: 8px;
  line-height: 1.25;
}
.place-num {
  font-family: Orbitron, sans-serif;
  font-size: 56px;
  font-weight: 800;
  color: var(--accent);
  line-height: 1;
}
.place-title {
  font-size: 18px !important;
  margin: 8px 0 !important;
}
.result.chicken {
  border: 1px solid rgba(255, 209, 102, 0.45);
  box-shadow: 0 0 40px rgba(255, 209, 102, 0.15);
}
@media (max-width: 640px) {
  .royale-hud {
    grid-template-columns: repeat(3, 1fr);
  }
}
.progress-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  margin-bottom: 12px;
}
.progress-bar .fill {
  height: 100%;
  background: linear-gradient(90deg, #9b5de5, #4cc9f0, #3dffb5);
  transition: width 0.25s ease;
}
.stage {
  padding: 20px 18px 24px;
  min-height: 360px;
}
.q-type {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: #041018;
  background: linear-gradient(90deg, #ffd166, #ff8fab);
  padding: 4px 10px;
  border-radius: 999px;
  margin-bottom: 12px;
}
.prompt {
  margin: 0 0 8px;
  font-size: 26px;
  line-height: 1.25;
  word-break: break-word;
}
.sub {
  margin: 0 0 18px;
  font-size: 14px;
}
.options {
  display: grid;
  gap: 10px;
}
.opt {
  display: flex;
  gap: 12px;
  align-items: center;
  text-align: left;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  cursor: pointer;
  font-weight: 600;
}
.opt:hover:not(:disabled) {
  border-color: rgba(76, 201, 240, 0.55);
}
.key {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.3);
  font-family: Orbitron, sans-serif;
  font-size: 12px;
}
.order {
  display: grid;
  gap: 12px;
}
.picked-line {
  min-height: 56px;
  padding: 10px;
  border-radius: 12px;
  border: 1px dashed var(--border);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.pool {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.token {
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 600;
}
.token.on {
  background: rgba(61, 255, 181, 0.15);
  border-color: rgba(61, 255, 181, 0.4);
}
.feedback {
  margin-top: 8px;
  padding: 14px;
  border-radius: 14px;
  display: grid;
  gap: 10px;
}
.feedback.ok {
  background: rgba(61, 255, 181, 0.08);
  border: 1px solid rgba(61, 255, 181, 0.3);
}
.feedback.bad {
  background: rgba(255, 77, 109, 0.08);
  border: 1px solid rgba(255, 77, 109, 0.3);
}
.fb-title {
  font-weight: 800;
  font-size: 18px;
}
.fb-exp {
  color: var(--muted);
  font-size: 14px;
}
.reveal-box {
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.22);
  padding: 10px 12px;
  display: grid;
  gap: 10px;
}
.reveal-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--gold);
}
.tip-inline {
  font-weight: 500;
  letter-spacing: 0;
}
.reveal-row {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  display: grid;
  gap: 6px;
}
.reveal-row.correct {
  border-color: rgba(61, 255, 181, 0.35);
  background: rgba(61, 255, 181, 0.08);
}
.reveal-row.selected:not(.correct) {
  border-color: rgba(255, 77, 109, 0.35);
}
.r-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.r-key {
  font-family: Orbitron, sans-serif;
  font-size: 11px;
  opacity: 0.8;
}
.pill {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 700;
}
.pill.ok {
  background: rgba(61, 255, 181, 0.2);
  color: var(--ok);
}
.pill.bad {
  background: rgba(255, 77, 109, 0.2);
  color: #ff8fab;
}
.r-body .en {
  font-size: 13px;
}
.mnemo-actions {
  margin-top: 2px;
}
.btn-mnemo {
  border: 1px solid rgba(255, 209, 102, 0.45);
  background: rgba(255, 209, 102, 0.12);
  color: var(--gold);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.btn-mnemo:disabled {
  opacity: 0.6;
  cursor: wait;
}
.btn-mnemo:hover:not(:disabled) {
  background: rgba(255, 209, 102, 0.22);
}
.mnemo-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
  padding: 6px 0;
}
.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--gold);
  animation: blink 1s infinite;
}
@keyframes blink {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}
.mnemo-panel {
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(155, 93, 229, 0.12);
  border: 1px solid rgba(155, 93, 229, 0.3);
  display: grid;
  gap: 8px;
}
.meta-line {
  font-size: 12px;
}
.think-toggle {
  border: none;
  background: rgba(0, 0, 0, 0.2);
  color: var(--text);
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}
.think-toggle .muted {
  font-weight: 500;
  margin-left: 6px;
  font-size: 12px;
}
.think-body {
  white-space: pre-wrap;
  line-height: 1.5;
  font-size: 13px;
  color: var(--muted);
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
  border-left: 3px solid rgba(255, 209, 102, 0.5);
}
.mnemo-answer {
  white-space: pre-wrap;
  line-height: 1.55;
  font-size: 14px;
}
.mnemo-answer .ans-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--accent);
  margin-bottom: 4px;
  letter-spacing: 0.04em;
}
.mnemo-answer p {
  margin: 0;
}
.result {
  padding: 28px 22px;
  text-align: center;
}
.grade {
  font-family: Orbitron, sans-serif;
  font-size: 64px;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 8px;
}
.grade.S {
  color: var(--gold);
}
.grade.A {
  color: var(--accent);
}
.grade.B {
  color: var(--blue);
}
.grade.C {
  color: var(--muted);
}
.result h1 {
  margin: 0 0 8px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 18px 0;
  text-align: left;
}
.grid > div {
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.result-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 12px;
}
.error {
  color: var(--danger);
}
</style>

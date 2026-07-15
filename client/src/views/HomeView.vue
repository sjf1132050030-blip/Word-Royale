<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import http from '../api/http'
import { useUserStore } from '../stores/user'
import { useI18n } from '../i18n'
import LangSwitch from '../components/LangSwitch.vue'

const router = useRouter()
const store = useUserStore()
const { t } = useI18n()
const loading = ref(true)
const error = ref('')
const lessons = ref([])
const quests = ref([])
const dueReview = ref(0)
const mastered = ref(0)
const wordTotal = ref(0)
const wordsSeen = ref(0)
const wordbooks = ref([])
const activeBook = ref(null)
const switchingBook = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get('/today')
    store.applyUser(data.user)
    lessons.value = data.lessons
    quests.value = data.quests
    dueReview.value = data.due_review
    mastered.value = data.mastered
    wordTotal.value = data.word_total || 0
    wordsSeen.value = data.words_seen || 0
    wordbooks.value = data.wordbooks || []
    activeBook.value = data.active_wordbook || null
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function selectBook(code) {
  if (!code || code === activeBook.value?.code) return
  switchingBook.value = true
  error.value = ''
  try {
    const { data } = await http.patch('/auth/me/settings', { wordbook_code: code })
    store.applyUser(data.user)
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    switchingBook.value = false
  }
}

function enter(lesson) {
  if (!lesson.unlocked) return
  router.push(`/battle/${lesson.id}`)
}

function logout() {
  store.logout()
  router.push('/login')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="top panel">
      <div>
        <div class="brand title">{{ t('appName') }}</div>
        <div class="muted">{{ t('hello') }}，{{ store.user?.nickname || '—' }} · {{ t('weeklySprint') }}</div>
      </div>
      <div class="actions">
        <LangSwitch />
        <button
          v-if="store.user?.is_admin"
          class="btn btn-ghost"
          @click="router.push('/admin')"
        >🛠 管理</button>
        <button class="btn btn-ghost" @click="router.push('/settings')">⚙️ {{ t('settings') }}</button>
        <button class="btn btn-ghost" @click="router.push('/leaderboard')">🏆 {{ t('leaderboard') }}</button>
        <button class="btn btn-ghost" @click="logout">{{ t('logout') }}</button>
      </div>
    </header>

    <section class="panel block books">
      <div class="block-head">
        <h2>{{ t('wordbooks') }}</h2>
        <span class="tag">{{ activeBook?.name_zh || '—' }}</span>
      </div>
      <p class="muted small-coach">{{ t('wordbookHint') }}</p>
      <div class="book-grid">
        <button
          v-for="b in wordbooks"
          :key="b.code"
          type="button"
          class="book"
          :class="{ on: activeBook?.code === b.code }"
          :disabled="switchingBook"
          @click="selectBook(b.code)"
        >
          <div class="b-name">{{ b.name_zh }}</div>
          <div class="muted small">{{ b.name_en }} · {{ b.word_count }} {{ t('wordsUnit') }}</div>
        </button>
      </div>
    </section>

    <section v-if="store.stats" class="stats panel">
      <div class="stat">
        <div class="k">{{ t('level') }}</div>
        <div class="v">Lv.{{ store.stats.level }}</div>
      </div>
      <div class="stat">
        <div class="k">{{ t('totalXp') }}</div>
        <div class="v xp">{{ store.stats.total_xp }}</div>
      </div>
      <div class="stat">
        <div class="k">{{ t('weeklyXp') }}</div>
        <div class="v gold">{{ store.stats.weekly_xp }}</div>
      </div>
      <div class="stat">
        <div class="k">{{ t('streak') }}</div>
        <div class="v fire">🔥 {{ store.stats.current_streak }}</div>
      </div>
      <div class="stat">
        <div class="k">{{ t('coins') }}</div>
        <div class="v">🪙 {{ store.stats.coins }}</div>
      </div>
      <div class="stat">
        <div class="k">{{ t('atlas') }}</div>
        <div class="v">{{ mastered }} {{ t('mastered') }}</div>
      </div>
      <div class="stat wide">
        <div class="k">{{ activeBook?.name_zh || t('wordbooks') }} · {{ t('progress') }}</div>
        <div class="v">{{ wordsSeen }} / {{ wordTotal }}</div>
        <div class="muted tiny">{{ t('wordProgressHint') }}</div>
      </div>
    </section>

    <section class="panel block">
      <div class="block-head">
        <h2>{{ t('dailyQuests') }}</h2>
        <span class="tag">{{ t('autoReward') }}</span>
      </div>
      <div v-if="loading" class="muted">{{ t('loading') }}</div>
      <div v-else class="quests">
        <div v-for="q in quests" :key="q.id" class="quest" :class="{ done: q.done }">
          <div class="q-title">
            <span>{{ q.title }}</span>
            <span class="muted">+{{ q.reward_xp }}XP / +{{ q.reward_coins }}</span>
          </div>
          <div class="bar">
            <div class="fill" :style="{ width: Math.min(100, (q.progress / q.target) * 100) + '%' }" />
          </div>
          <div class="q-foot">
            <span>{{ Math.min(q.progress, q.target) }} / {{ q.target }}</span>
            <span v-if="q.claimed" class="ok">{{ t('claimed') }}</span>
            <span v-else-if="q.done" class="ok">{{ t('claimable') }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="panel block">
      <div class="block-head">
        <h2>{{ t('arena') }}</h2>
        <span class="tag">{{ t('dueReview') }} {{ dueReview }}</span>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="lessons">
        <button
          v-for="(l, idx) in lessons"
          :key="l.id"
          class="lesson"
          :class="{ locked: !l.unlocked, clear: l.stars > 0 }"
          :disabled="!l.unlocked"
          @click="enter(l)"
        >
          <div class="idx">#{{ idx + 1 }}</div>
          <div class="meta">
            <div class="name">{{ l.title }}</div>
            <div class="muted">
              <span v-if="!l.unlocked">🔒 {{ t('lockedNeed', { xp: l.unlock_xp }) }}</span>
              <span v-else-if="l.stars">
                <span class="stars">{{ '★'.repeat(l.stars) }}{{ '☆'.repeat(3 - l.stars) }}</span>
                · {{ t('played', { n: l.times_played }) }}
              </span>
              <span v-else>{{ t('playable') }}</span>
            </div>
          </div>
          <div class="cta">{{ l.unlocked ? '🪂 ' + t('fight') : t('locked') }}</div>
        </button>
      </div>
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
  flex-wrap: wrap;
  align-items: center;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 14px;
  margin-bottom: 14px;
}
.stat {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
}
.k {
  font-size: 12px;
  color: var(--muted);
}
.v {
  font-size: 18px;
  font-weight: 800;
  margin-top: 4px;
}
.v.xp {
  color: var(--blue);
}
.v.gold {
  color: var(--gold);
}
.v.fire {
  color: #ff8c42;
}
.stat.wide {
  grid-column: 1 / -1;
}
.tiny {
  font-size: 11px;
  margin-top: 4px;
}
.block {
  padding: 16px 18px;
  margin-bottom: 14px;
}
.block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.block-head h2 {
  margin: 0;
  font-size: 16px;
}
.quests {
  display: grid;
  gap: 10px;
}
.quest {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.18);
}
.quest.done {
  border-color: rgba(61, 255, 181, 0.35);
}
.q-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  margin-bottom: 8px;
}
.bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: linear-gradient(90deg, #4cc9f0, #3dffb5);
}
.q-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
.ok {
  color: var(--ok);
}
.lessons {
  display: grid;
  gap: 10px;
}
.lesson {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  text-align: left;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  cursor: pointer;
}
.lesson:not(.locked):hover {
  border-color: rgba(61, 255, 181, 0.45);
}
.lesson.locked {
  opacity: 0.55;
  cursor: not-allowed;
}
.idx {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-family: Orbitron, sans-serif;
  font-weight: 700;
  background: linear-gradient(135deg, rgba(155, 93, 229, 0.4), rgba(76, 201, 240, 0.25));
}
.name {
  font-weight: 700;
  margin-bottom: 4px;
}
.cta {
  font-weight: 800;
  color: var(--accent);
}
.error {
  color: var(--danger);
}
.small-coach {
  margin: 0;
  font-size: 12px;
}
.book-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 10px;
}
.book {
  text-align: left;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  cursor: pointer;
}
.book.on {
  border-color: rgba(61, 255, 181, 0.55);
  background: rgba(61, 255, 181, 0.1);
  box-shadow: 0 0 16px rgba(61, 255, 181, 0.12);
}
.b-name {
  font-weight: 800;
  margin-bottom: 4px;
}
.small {
  font-size: 12px;
}
@media (max-width: 640px) {
  .book-grid {
    grid-template-columns: 1fr;
  }
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import http from '../api/http'
import { useI18n } from '../i18n'
import LangSwitch from '../components/LangSwitch.vue'

const router = useRouter()
const { t } = useI18n()
const loading = ref(true)
const error = ref('')
const rows = ref([])
const weekKey = ref('')
const myRank = ref(null)

async function load() {
  loading.value = true
  try {
    const { data } = await http.get('/leaderboard')
    rows.value = data.leaderboard
    weekKey.value = data.week_key
    myRank.value = data.my_rank
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function medal(rank) {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `#${rank}`
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="top panel">
      <div>
        <div class="brand title">{{ t('weeklyTitle') }}</div>
        <div class="muted">{{ t('seasonWeek') }} · {{ weekKey }} · {{ t('byWeeklyXp') }}</div>
      </div>
      <div class="actions">
        <LangSwitch />
        <button class="btn btn-ghost" @click="router.push('/')">{{ t('toLobby') }}</button>
      </div>
    </header>

    <section class="panel board">
      <div class="me-rank" v-if="myRank">{{ t('yourRank', { n: myRank }) }}</div>
      <div v-if="loading" class="muted">{{ t('loadBoard') }}</div>
      <p v-else-if="error" class="error">{{ error }}</p>
      <div v-else-if="!rows.length" class="muted empty">{{ t('emptyBoard') }}</div>
      <div v-else class="list">
        <div v-for="r in rows" :key="r.user_id" class="row" :class="{ me: r.is_me, top: r.rank <= 3 }">
          <div class="rank">{{ medal(r.rank) }}</div>
          <div class="info">
            <div class="name">
              {{ r.nickname }} <span v-if="r.is_me" class="you">{{ t('you') }}</span>
            </div>
            <div class="muted small">Lv.{{ r.level }} · 🔥{{ r.streak }} · XP {{ r.total_xp }}</div>
          </div>
          <div class="weekly">
            {{ r.weekly_xp }} <span>{{ t('weeklyXp') }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  margin-bottom: 14px;
  gap: 10px;
  flex-wrap: wrap;
}
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.title {
  font-size: 18px;
  font-weight: 800;
}
.board {
  padding: 16px;
}
.me-rank {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 209, 102, 0.12);
  border: 1px solid rgba(255, 209, 102, 0.3);
  font-weight: 700;
}
.list {
  display: grid;
  gap: 8px;
}
.row {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
}
.row.me {
  border-color: rgba(61, 255, 181, 0.45);
  background: rgba(61, 255, 181, 0.08);
}
.rank {
  font-family: Orbitron, sans-serif;
  font-weight: 700;
  text-align: center;
}
.name {
  font-weight: 700;
}
.you {
  font-size: 11px;
  background: var(--accent);
  color: #041018;
  border-radius: 999px;
  padding: 1px 6px;
  margin-left: 4px;
}
.small {
  font-size: 12px;
  margin-top: 2px;
}
.weekly {
  font-family: Orbitron, sans-serif;
  font-weight: 800;
  color: var(--gold);
  text-align: right;
}
.weekly span {
  display: block;
  font-family: 'Noto Sans SC', sans-serif;
  font-size: 11px;
  color: var(--muted);
  font-weight: 500;
}
.empty {
  padding: 24px;
  text-align: center;
}
.error {
  color: var(--danger);
}
</style>

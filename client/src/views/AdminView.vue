<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import http from '../api/http'
import { useUserStore } from '../stores/user'

const router = useRouter()
const store = useUserStore()

const tab = ref('users') // users | overview | sessions
const loading = ref(false)
const error = ref('')
const notice = ref('')

const overview = ref(null)
const users = ref([])
const userTotal = ref(0)
const userPage = ref(1)
const userPageSize = 20
const userQuery = ref('')

const sessions = ref([])
const sessionTotal = ref(0)
const sessionPage = ref(1)

const selectedUserId = ref(null)
const detail = ref(null)
const detailLoading = ref(false)
const sessionDetail = ref(null)

const showCreate = ref(false)
const createForm = ref({ email: '', password: '', nickname: '', is_admin: false })

const editForm = ref({
  nickname: '',
  email: '',
  is_admin: false,
  wordbook_code: 'cet4',
  ai_provider: 'gemini',
  total_xp: 0,
  coins: 0,
  hearts: 5,
  current_streak: 0,
  weekly_xp: 0,
})

const resetPwd = ref('')
const lastResetPassword = ref('')

const userPages = computed(() => Math.max(1, Math.ceil(userTotal.value / userPageSize)))
const sessionPages = computed(() => Math.max(1, Math.ceil(sessionTotal.value / 20)))

function flash(msg) {
  notice.value = msg
  setTimeout(() => {
    if (notice.value === msg) notice.value = ''
  }, 3500)
}

async function loadOverview() {
  const { data } = await http.get('/admin/overview')
  overview.value = data
}

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get('/admin/users', {
      params: { page: userPage.value, pageSize: userPageSize, q: userQuery.value || undefined },
    })
    users.value = data.users
    userTotal.value = data.total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function loadSessions() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await http.get('/admin/sessions', {
      params: { page: sessionPage.value, pageSize: 20 },
    })
    sessions.value = data.sessions
    sessionTotal.value = data.total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function openUser(id) {
  selectedUserId.value = id
  detailLoading.value = true
  sessionDetail.value = null
  error.value = ''
  try {
    const { data } = await http.get(`/admin/users/${id}`)
    detail.value = data
    editForm.value = {
      nickname: data.user.nickname || '',
      email: data.user.email || '',
      is_admin: !!data.is_admin,
      wordbook_code: data.user.settings?.wordbook_code || 'cet4',
      ai_provider: data.user.settings?.ai_provider || 'gemini',
      total_xp: data.user.stats?.total_xp || 0,
      coins: data.user.stats?.coins || 0,
      hearts: data.user.stats?.hearts ?? 5,
      current_streak: data.user.stats?.current_streak || 0,
      weekly_xp: data.user.stats?.weekly_xp || 0,
    }
    resetPwd.value = ''
    lastResetPassword.value = ''
  } catch (e) {
    error.value = e.message
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  selectedUserId.value = null
  detail.value = null
  sessionDetail.value = null
}

async function createUser() {
  error.value = ''
  try {
    await http.post('/admin/users', createForm.value)
    showCreate.value = false
    createForm.value = { email: '', password: '', nickname: '', is_admin: false }
    flash('用户已创建')
    await loadUsers()
    await loadOverview()
  } catch (e) {
    error.value = e.message
  }
}

async function saveUser() {
  if (!selectedUserId.value) return
  error.value = ''
  try {
    await http.patch(`/admin/users/${selectedUserId.value}`, {
      ...editForm.value,
      total_xp: Number(editForm.value.total_xp),
      coins: Number(editForm.value.coins),
      hearts: Number(editForm.value.hearts),
      current_streak: Number(editForm.value.current_streak),
      weekly_xp: Number(editForm.value.weekly_xp),
    })
    flash('用户信息已保存')
    await openUser(selectedUserId.value)
    await loadUsers()
  } catch (e) {
    error.value = e.message
  }
}

async function doResetPassword() {
  if (!selectedUserId.value) return
  if (!confirm('确认重置该用户密码？')) return
  error.value = ''
  try {
    const body = resetPwd.value ? { password: resetPwd.value } : {}
    const { data } = await http.post(`/admin/users/${selectedUserId.value}/reset-password`, body)
    lastResetPassword.value = data.password
    flash('密码已重置')
  } catch (e) {
    error.value = e.message
  }
}

async function deleteUser(id, nickname) {
  if (!confirm(`确认删除用户「${nickname}」？此操作不可恢复。`)) return
  error.value = ''
  try {
    await http.delete(`/admin/users/${id}`)
    flash('用户已删除')
    if (selectedUserId.value === id) closeDetail()
    await loadUsers()
    await loadOverview()
  } catch (e) {
    error.value = e.message
  }
}

async function openSession(id) {
  error.value = ''
  try {
    const { data } = await http.get(`/admin/sessions/${id}`)
    sessionDetail.value = data
  } catch (e) {
    error.value = e.message
  }
}

async function refreshAll() {
  error.value = ''
  try {
    if (tab.value === 'overview') await loadOverview()
    else if (tab.value === 'users') await loadUsers()
    else await loadSessions()
  } catch (e) {
    error.value = e.message
  }
}

watch(tab, () => {
  refreshAll()
})

watch(userPage, () => loadUsers())
watch(sessionPage, () => loadSessions())

onMounted(async () => {
  if (!store.user?.is_admin) {
    router.replace('/')
    return
  }
  try {
    await Promise.all([loadOverview(), loadUsers()])
  } catch (e) {
    error.value = e.message
  }
})
</script>

<template>
  <div class="page admin-page">
    <header class="top panel">
      <div>
        <div class="brand title">管理后台</div>
        <div class="muted">用户 · 画像 · 对局记录 · 权限控制</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" @click="router.push('/')">← 返回大厅</button>
        <button class="btn btn-ghost" @click="refreshAll">刷新</button>
      </div>
    </header>

    <p v-if="notice" class="banner ok">{{ notice }}</p>
    <p v-if="error" class="banner err">{{ error }}</p>

    <nav class="tabs panel">
      <button :class="{ on: tab === 'overview' }" @click="tab = 'overview'">总览</button>
      <button :class="{ on: tab === 'users' }" @click="tab = 'users'">用户管理</button>
      <button :class="{ on: tab === 'sessions' }" @click="tab = 'sessions'">对局记录</button>
    </nav>

    <!-- Overview -->
    <section v-if="tab === 'overview' && overview" class="panel block">
      <div class="grid stats-grid">
        <div class="card"><div class="k">用户</div><div class="v">{{ overview.overview.users }}</div></div>
        <div class="card"><div class="k">管理员</div><div class="v">{{ overview.overview.admins }}</div></div>
        <div class="card"><div class="k">今日活跃</div><div class="v">{{ overview.overview.active_today }}</div></div>
        <div class="card"><div class="k">对局总数</div><div class="v">{{ overview.overview.sessions }}</div></div>
        <div class="card"><div class="k">已完成对局</div><div class="v">{{ overview.overview.finished_sessions }}</div></div>
        <div class="card"><div class="k">词库词条</div><div class="v">{{ overview.overview.words }}</div></div>
      </div>

      <div class="two-col">
        <div>
          <h3>XP 排行 Top 10</h3>
          <table class="table">
            <thead>
              <tr><th>昵称</th><th>邮箱</th><th>Lv</th><th>XP</th><th>周 XP</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in overview.top_xp" :key="u.id">
                <td>{{ u.nickname }}</td>
                <td class="muted">{{ u.email }}</td>
                <td>{{ u.level }}</td>
                <td class="xp">{{ u.total_xp }}</td>
                <td>{{ u.weekly_xp }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>最近对局</h3>
          <table class="table">
            <thead>
              <tr><th>用户</th><th>关卡</th><th>对错</th><th>XP</th><th>时间</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in overview.recent_sessions" :key="s.id" class="clickable" @click="openSession(s.id)">
                <td>{{ s.nickname }}</td>
                <td>{{ s.lesson_title || s.lesson_id }}</td>
                <td>{{ s.correct_count }}/{{ s.wrong_count }}</td>
                <td>{{ s.xp_earned }}</td>
                <td class="muted">{{ s.started_at }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Users -->
    <section v-if="tab === 'users'" class="panel block">
      <div class="toolbar">
        <input
          v-model="userQuery"
          class="input search"
          placeholder="搜索邮箱 / 昵称"
          @keyup.enter="userPage = 1; loadUsers()"
        />
        <button class="btn btn-ghost" @click="userPage = 1; loadUsers()">搜索</button>
        <button class="btn btn-primary" @click="showCreate = !showCreate">+ 新建用户</button>
      </div>

      <form v-if="showCreate" class="create panel-inner" @submit.prevent="createUser">
        <h3>新建用户</h3>
        <div class="form-grid">
          <label>邮箱<input v-model="createForm.email" class="input" type="email" required /></label>
          <label>密码<input v-model="createForm.password" class="input" type="text" minlength="6" required /></label>
          <label>昵称<input v-model="createForm.nickname" class="input" maxlength="24" /></label>
          <label class="check"><input v-model="createForm.is_admin" type="checkbox" /> 管理员</label>
        </div>
        <button class="btn btn-primary" type="submit">创建</button>
      </form>

      <div v-if="loading" class="muted">加载中…</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>昵称</th>
            <th>邮箱</th>
            <th>角色</th>
            <th>Lv / XP</th>
            <th>对局</th>
            <th>词进度</th>
            <th>最近学习</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.id }}</td>
            <td>{{ u.nickname }}</td>
            <td class="muted">{{ u.email }}</td>
            <td>
              <span class="tag" :class="{ admin: u.is_admin }">{{ u.is_admin ? '管理员' : '用户' }}</span>
            </td>
            <td>Lv.{{ u.stats.level }} · {{ u.stats.total_xp }}</td>
            <td>{{ u.activity.sessions }}</td>
            <td>{{ u.activity.words_mastered }}/{{ u.activity.words_seen }}</td>
            <td class="muted">{{ u.activity.last_session_at || u.stats.last_study_date || '—' }}</td>
            <td class="ops">
              <button class="btn btn-ghost sm" @click="openUser(u.id)">详情</button>
              <button class="btn btn-danger sm" @click="deleteUser(u.id, u.nickname)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="pager">
        <button class="btn btn-ghost sm" :disabled="userPage <= 1" @click="userPage--">上一页</button>
        <span class="muted">{{ userPage }} / {{ userPages }} · 共 {{ userTotal }}</span>
        <button class="btn btn-ghost sm" :disabled="userPage >= userPages" @click="userPage++">下一页</button>
      </div>
    </section>

    <!-- Sessions list -->
    <section v-if="tab === 'sessions'" class="panel block">
      <div v-if="loading" class="muted">加载中…</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>用户</th>
            <th>关卡</th>
            <th>状态</th>
            <th>对 / 错</th>
            <th>星</th>
            <th>XP</th>
            <th>开始时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id">
            <td>{{ s.id }}</td>
            <td>{{ s.nickname }} <span class="muted">{{ s.email }}</span></td>
            <td>{{ s.lesson_title || s.lesson_id }}</td>
            <td>{{ s.status }}</td>
            <td>{{ s.correct_count }} / {{ s.wrong_count }}</td>
            <td>{{ s.stars }}</td>
            <td>{{ s.xp_earned }}</td>
            <td class="muted">{{ s.started_at }}</td>
            <td><button class="btn btn-ghost sm" @click="openSession(s.id)">查看</button></td>
          </tr>
        </tbody>
      </table>
      <div class="pager">
        <button class="btn btn-ghost sm" :disabled="sessionPage <= 1" @click="sessionPage--">上一页</button>
        <span class="muted">{{ sessionPage }} / {{ sessionPages }} · 共 {{ sessionTotal }}</span>
        <button class="btn btn-ghost sm" :disabled="sessionPage >= sessionPages" @click="sessionPage++">下一页</button>
      </div>
    </section>

    <!-- User detail drawer -->
    <div v-if="selectedUserId" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer panel">
        <div class="drawer-head">
          <h2>用户画像 #{{ selectedUserId }}</h2>
          <button class="btn btn-ghost sm" @click="closeDetail">关闭</button>
        </div>
        <div v-if="detailLoading" class="muted">加载中…</div>
        <template v-else-if="detail">
          <div class="profile-cards">
            <div class="card">
              <div class="k">对局</div>
              <div class="v">{{ detail.profile.sessions.total }}</div>
              <div class="muted tiny">完成 {{ detail.profile.sessions.finished }} · 正确率 {{ detail.profile.sessions.accuracy }}%</div>
            </div>
            <div class="card">
              <div class="k">词汇</div>
              <div class="v">{{ detail.profile.words.mastered }}/{{ detail.profile.words.seen }}</div>
              <div class="muted tiny">掌握 / 见过</div>
            </div>
            <div class="card">
              <div class="k">连胜</div>
              <div class="v">🔥 {{ detail.user.stats.current_streak }}</div>
              <div class="muted tiny">最长 {{ detail.user.stats.longest_streak }}</div>
            </div>
            <div class="card">
              <div class="k">最近对局</div>
              <div class="v small-v">{{ detail.profile.sessions.last_session_at || '—' }}</div>
            </div>
          </div>

          <h3>编辑资料 / 数值</h3>
          <div class="form-grid">
            <label>昵称<input v-model="editForm.nickname" class="input" /></label>
            <label>邮箱<input v-model="editForm.email" class="input" type="email" /></label>
            <label>词库
              <select v-model="editForm.wordbook_code" class="input">
                <option value="gaokao">高考</option>
                <option value="cet4">四级</option>
                <option value="cet6">六级</option>
                <option value="game">游戏</option>
              </select>
            </label>
            <label>AI
              <select v-model="editForm.ai_provider" class="input">
                <option value="gemini">Gemini</option>
                <option value="agnes">Agnes</option>
                <option value="qwen">Qwen</option>
              </select>
            </label>
            <label>总 XP<input v-model.number="editForm.total_xp" class="input" type="number" min="0" /></label>
            <label>周 XP<input v-model.number="editForm.weekly_xp" class="input" type="number" min="0" /></label>
            <label>金币<input v-model.number="editForm.coins" class="input" type="number" min="0" /></label>
            <label>心<input v-model.number="editForm.hearts" class="input" type="number" min="0" max="20" /></label>
            <label>连胜<input v-model.number="editForm.current_streak" class="input" type="number" min="0" /></label>
            <label class="check"><input v-model="editForm.is_admin" type="checkbox" /> 管理员</label>
          </div>
          <div class="ops">
            <button class="btn btn-primary" @click="saveUser">保存修改</button>
            <button class="btn btn-danger" @click="deleteUser(selectedUserId, detail.user.nickname)">删除用户</button>
          </div>

          <h3>重置密码</h3>
          <div class="form-grid">
            <label>新密码（可空=随机）
              <input v-model="resetPwd" class="input" type="text" minlength="6" placeholder="留空则随机生成" />
            </label>
          </div>
          <button class="btn btn-ghost" @click="doResetPassword">重置密码</button>
          <p v-if="lastResetPassword" class="banner ok">新密码：<code>{{ lastResetPassword }}</code>（请立即告知用户）</p>

          <h3>薄弱词 Top</h3>
          <table class="table compact">
            <thead><tr><th>词</th><th>释义</th><th>对</th><th>错</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="w in detail.weak_words" :key="'w'+w.id">
                <td>{{ w.word }}</td>
                <td class="muted">{{ w.meaning_zh }}</td>
                <td>{{ w.correct_count }}</td>
                <td class="bad">{{ w.wrong_count }}</td>
                <td>{{ w.status }}</td>
              </tr>
              <tr v-if="!detail.weak_words?.length"><td colspan="5" class="muted">暂无</td></tr>
            </tbody>
          </table>

          <h3>最近学习词</h3>
          <table class="table compact">
            <thead><tr><th>词</th><th>释义</th><th>对/错</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-for="w in detail.recent_words" :key="'r'+w.id">
                <td>{{ w.word }}</td>
                <td class="muted">{{ w.meaning_zh }}</td>
                <td>{{ w.correct_count }}/{{ w.wrong_count }}</td>
                <td class="muted">{{ w.last_result_at || '—' }}</td>
              </tr>
            </tbody>
          </table>

          <h3>关卡进度</h3>
          <table class="table compact">
            <thead><tr><th>关卡</th><th>星</th><th>最佳</th><th>次数</th><th>完成时间</th></tr></thead>
            <tbody>
              <tr v-for="l in detail.lessons" :key="'l'+l.id">
                <td>{{ l.title }}</td>
                <td>{{ l.stars }}</td>
                <td>{{ l.best_score }}</td>
                <td>{{ l.times_played }}</td>
                <td class="muted">{{ l.completed_at || '—' }}</td>
              </tr>
              <tr v-if="!detail.lessons?.length"><td colspan="5" class="muted">暂无</td></tr>
            </tbody>
          </table>

          <h3>对局历史</h3>
          <table class="table compact">
            <thead><tr><th>ID</th><th>关卡</th><th>对/错</th><th>XP</th><th>状态</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in detail.sessions" :key="'s'+s.id">
                <td>{{ s.id }}</td>
                <td>{{ s.lesson_title || s.lesson_id }}</td>
                <td>{{ s.correct_count }}/{{ s.wrong_count }}</td>
                <td>{{ s.xp_earned }}</td>
                <td>{{ s.status }}</td>
                <td><button class="btn btn-ghost sm" @click="openSession(s.id)">明细</button></td>
              </tr>
            </tbody>
          </table>

          <h3>每日任务记录</h3>
          <table class="table compact">
            <thead><tr><th>日期</th><th>任务</th><th>进度</th><th>领取</th></tr></thead>
            <tbody>
              <tr v-for="(q, i) in detail.quests" :key="'q'+i">
                <td>{{ q.day_key }}</td>
                <td>{{ q.title }}</td>
                <td>{{ q.progress }}/{{ q.target }}</td>
                <td>{{ q.claimed ? '是' : '否' }}</td>
              </tr>
              <tr v-if="!detail.quests?.length"><td colspan="4" class="muted">暂无</td></tr>
            </tbody>
          </table>
        </template>
      </aside>
    </div>

    <!-- Session detail modal -->
    <div v-if="sessionDetail" class="drawer-mask" @click.self="sessionDetail = null">
      <aside class="drawer panel session-drawer">
        <div class="drawer-head">
          <h2>对局 #{{ sessionDetail.session.id }}</h2>
          <button class="btn btn-ghost sm" @click="sessionDetail = null">关闭</button>
        </div>
        <p>
          {{ sessionDetail.session.nickname }} · {{ sessionDetail.session.email }} ·
          {{ sessionDetail.session.lesson_title || sessionDetail.session.lesson_id }}
        </p>
        <p class="muted">
          {{ sessionDetail.session.status }} · 对 {{ sessionDetail.session.correct_count }} /
          错 {{ sessionDetail.session.wrong_count }} · ⭐{{ sessionDetail.session.stars }} ·
          +{{ sessionDetail.session.xp_earned }}XP · combo {{ sessionDetail.session.combo_max }}
        </p>
        <p class="muted tiny">{{ sessionDetail.session.started_at }} → {{ sessionDetail.session.ended_at || '进行中' }}</p>

        <h3>答题记录</h3>
        <table class="table compact">
          <thead><tr><th>#</th><th>结果</th><th>题型</th><th>提示</th><th>作答</th></tr></thead>
          <tbody>
            <tr v-for="(a, i) in sessionDetail.answers" :key="'a'+i">
              <td>{{ i + 1 }}</td>
              <td :class="a.correct ? 'ok-text' : 'bad'">{{ a.correct ? '✓' : '✗' }}</td>
              <td>{{ sessionDetail.questions[a.q_index || i]?.type || a.type || '—' }}</td>
              <td class="muted">{{ sessionDetail.questions[a.q_index || i]?.prompt || a.prompt || '—' }}</td>
              <td>{{ a.selected_key || a.answer || a.input || JSON.stringify(a).slice(0, 40) }}</td>
            </tr>
            <tr v-if="!sessionDetail.answers?.length"><td colspan="5" class="muted">暂无答题明细</td></tr>
          </tbody>
        </table>

        <h3>题目快照（{{ sessionDetail.questions?.length || 0 }}）</h3>
        <div class="q-list">
          <div v-for="(q, i) in sessionDetail.questions" :key="'qsnap'+i" class="q-item">
            <div class="muted tiny">#{{ i + 1 }} · {{ q.type }} · word#{{ q.word_id }}</div>
            <div>{{ q.prompt }} <span class="muted">{{ q.sub }}</span></div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.admin-page {
  max-width: 1200px;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.title {
  font-size: 1.25rem;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.tabs {
  display: flex;
  gap: 8px;
  padding: 10px;
  margin-bottom: 14px;
}
.tabs button {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 10px;
  padding: 8px 14px;
  cursor: pointer;
  font-weight: 700;
}
.tabs button.on {
  background: linear-gradient(135deg, rgba(61, 255, 181, 0.2), rgba(76, 201, 240, 0.2));
  border-color: var(--accent);
}
.block {
  padding: 16px;
  margin-bottom: 16px;
}
.banner {
  padding: 10px 14px;
  border-radius: 12px;
  margin: 0 0 12px;
}
.banner.ok {
  background: rgba(61, 255, 181, 0.12);
  border: 1px solid rgba(61, 255, 181, 0.35);
}
.banner.err {
  background: rgba(255, 77, 109, 0.12);
  border: 1px solid rgba(255, 77, 109, 0.35);
  color: #ffb3c1;
}
.grid.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}
.card {
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
}
.card .k {
  color: var(--muted);
  font-size: 12px;
}
.card .v {
  font-size: 1.4rem;
  font-weight: 800;
  margin-top: 4px;
}
.card .small-v {
  font-size: 0.95rem;
  word-break: break-all;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 900px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th,
.table td {
  text-align: left;
  padding: 8px 6px;
  border-bottom: 1px solid rgba(120, 180, 255, 0.1);
  vertical-align: top;
}
.table.compact th,
.table.compact td {
  padding: 6px 4px;
  font-size: 12px;
}
.table tr.clickable {
  cursor: pointer;
}
.table tr.clickable:hover {
  background: rgba(255, 255, 255, 0.03);
}
.xp {
  color: var(--accent);
  font-weight: 700;
}
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.search {
  max-width: 280px;
}
.create {
  margin-bottom: 14px;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: 12px;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  margin: 10px 0;
}
.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
.form-grid label.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 22px;
}
.ops {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.sm {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 8px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.tag.admin {
  background: rgba(155, 93, 229, 0.2);
  border-color: rgba(155, 93, 229, 0.45);
  color: #d4b3ff;
}
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 50;
  display: flex;
  justify-content: flex-end;
}
.drawer {
  width: min(560px, 100%);
  height: 100%;
  overflow: auto;
  padding: 16px;
  border-radius: 0;
  border-left: 1px solid var(--border);
}
.session-drawer {
  width: min(720px, 100%);
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.profile-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}
.bad {
  color: var(--danger);
  font-weight: 700;
}
.ok-text {
  color: var(--ok);
  font-weight: 700;
}
.tiny {
  font-size: 11px;
}
.q-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}
.q-item {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border);
}
h3 {
  margin: 18px 0 8px;
  font-size: 15px;
}
code {
  color: var(--gold);
}
</style>

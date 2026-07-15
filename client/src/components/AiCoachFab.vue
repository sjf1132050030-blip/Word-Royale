<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { aiPost } from '../api/http'
import { useI18n } from '../i18n'
import { useCoachStore } from '../stores/coach'
import { useUserStore } from '../stores/user'

const coach = useCoachStore()
const userStore = useUserStore()
const { t, locale } = useI18n()

const SIZE = 56
const LONG_MS = 520
const DRAG_THRESHOLD = 8

const fabRef = ref(null)
const panelRef = ref(null)
const listRef = ref(null)
const input = ref('')
const loading = ref(false)
const error = ref('')
const closeMode = ref(false)
const isDragging = ref(false)

const x = ref(0)
const y = ref(0)

const providerLabel = computed(() => {
  const p = userStore.user?.settings?.ai_provider
  if (p === 'agnes') return 'Agnes'
  if (p === 'qwen') return 'Qwen2.5'
  return 'Gemini'
})

function defaultPos() {
  const pad = 20
  return {
    x: Math.max(pad, window.innerWidth - SIZE - pad),
    y: Math.max(pad, window.innerHeight - SIZE - 96),
  }
}

function clampPos(nx, ny) {
  const pad = 8
  const maxX = Math.max(pad, window.innerWidth - SIZE - pad)
  const maxY = Math.max(pad, window.innerHeight - SIZE - pad)
  return {
    x: Math.min(maxX, Math.max(pad, nx)),
    y: Math.min(maxY, Math.max(pad, ny)),
  }
}

function applySavedOrDefault() {
  const saved = coach.pos
  const d = defaultPos()
  const next = clampPos(saved?.x ?? d.x, saved?.y ?? d.y)
  x.value = next.x
  y.value = next.y
}

function onResize() {
  const next = clampPos(x.value, y.value)
  x.value = next.x
  y.value = next.y
  coach.setPos(next.x, next.y)
}

// —— drag / long-press / click ——
let pointerId = null
let startX = 0
let startY = 0
let originX = 0
let originY = 0
let moved = false
let longTimer = null

function clearLong() {
  if (longTimer) {
    clearTimeout(longTimer)
    longTimer = null
  }
}

function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return
  // close button handled separately
  if (e.target?.closest?.('.fab-close')) return

  pointerId = e.pointerId
  startX = e.clientX
  startY = e.clientY
  originX = x.value
  originY = y.value
  moved = false
  isDragging.value = false
  fabRef.value?.setPointerCapture?.(pointerId)

  clearLong()
  longTimer = setTimeout(() => {
    if (!moved) {
      closeMode.value = true
      try {
        navigator.vibrate?.(12)
      } catch {
        /* ignore */
      }
    }
  }, LONG_MS)
}

function onPointerMove(e) {
  if (pointerId == null || e.pointerId !== pointerId) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    moved = true
    isDragging.value = true
    clearLong()
    closeMode.value = false
  }
  if (isDragging.value) {
    const next = clampPos(originX + dx, originY + dy)
    x.value = next.x
    y.value = next.y
  }
}

function onPointerUp(e) {
  if (pointerId == null || e.pointerId !== pointerId) return
  clearLong()
  const wasDrag = isDragging.value
  const wasMoved = moved
  pointerId = null
  isDragging.value = false

  if (wasDrag) {
    const next = clampPos(x.value, y.value)
    x.value = next.x
    y.value = next.y
    coach.setPos(next.x, next.y)
    return
  }

  // pure click (not drag, not long-press close mode just triggered without move)
  if (!wasMoved && !closeMode.value) {
    coach.toggleOpen()
  }
}

function onPointerCancel() {
  clearLong()
  pointerId = null
  isDragging.value = false
}

function hideWidget() {
  closeMode.value = false
  coach.hide()
}

function onDocPointerDown(e) {
  if (!closeMode.value) return
  if (fabRef.value?.contains(e.target)) return
  closeMode.value = false
}

async function scrollToBottom() {
  await nextTick()
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => coach.messages.length,
  () => scrollToBottom()
)
watch(
  () => coach.open,
  (v) => {
    if (v) {
      closeMode.value = false
      scrollToBottom()
    }
  }
)

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return

  error.value = ''
  coach.addMessage({ role: 'user', content: text })
  input.value = ''
  loading.value = true
  await scrollToBottom()

  const history = coach.messages
    .slice(0, -1)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-12)

  try {
    const { data } = await aiPost('/ai/chat', {
      message: text,
      lang: locale.value,
      history,
    })
    const reply = data.reply || (locale.value === 'en' ? 'AI is busy, try again.' : 'AI 暂时繁忙，请稍后再试。')
    coach.addMessage({
      role: 'assistant',
      content: reply,
      thinking: data.thinking || null,
      provider: data.provider || '',
    })
    if (data.error && !data.reply) error.value = data.error
  } catch (e) {
    error.value = e.message
    coach.addMessage({
      role: 'assistant',
      content: e.message || t('aiFail'),
      provider: 'error',
    })
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function clearChat() {
  coach.clearMessages()
  error.value = ''
}

onMounted(() => {
  applySavedOrDefault()
  window.addEventListener('resize', onResize)
  document.addEventListener('pointerdown', onDocPointerDown, true)
})

onUnmounted(() => {
  clearLong()
  window.removeEventListener('resize', onResize)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <div class="coach-root">
    <!-- chat panel -->
    <Transition name="coach-panel">
      <div
        v-if="coach.open"
        ref="panelRef"
        class="panel chat-panel"
        role="dialog"
        :aria-label="t('coach')"
      >
        <header class="chat-head">
          <div>
            <div class="chat-title">🤖 {{ t('coach') }}</div>
            <div class="muted tiny">{{ providerLabel }} · {{ t('coachMultiHint') }}</div>
          </div>
          <div class="chat-actions">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="!coach.messages.length"
              :title="t('coachClear')"
              @click="clearChat"
            >
              {{ t('coachClear') }}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm icon-only"
              :title="t('coachClosePanel')"
              @click="coach.setOpen(false)"
            >
              ✕
            </button>
          </div>
        </header>

        <div ref="listRef" class="chat-list">
          <div v-if="!coach.messages.length" class="empty muted">
            {{ t('coachEmpty') }}
          </div>
          <div
            v-for="(m, i) in coach.messages"
            :key="i"
            class="bubble"
            :class="m.role"
          >
            <div v-if="m.thinking" class="think muted tiny">
              {{ t('aiThinkLabel') }}: {{ m.thinking }}
            </div>
            <div class="body">{{ m.content }}</div>
            <div v-if="m.provider && m.role === 'assistant'" class="meta muted tiny">
              {{ m.provider }}
            </div>
          </div>
          <div v-if="loading" class="bubble assistant loading">
            <span class="dots">{{ t('aiThinking') }}…</span>
          </div>
        </div>

        <p v-if="error" class="err">{{ error }}</p>

        <footer class="chat-foot">
          <textarea
            v-model="input"
            class="input area"
            rows="2"
            :placeholder="t('coachPh')"
            :disabled="loading"
            @keydown="onKeydown"
          />
          <button
            type="button"
            class="btn btn-primary send"
            :disabled="loading || !input.trim()"
            @click="send"
          >
            {{ loading ? t('processing') : t('send') }}
          </button>
        </footer>
      </div>
    </Transition>

    <!-- floating robot -->
    <div
      ref="fabRef"
      class="fab"
      :class="{ open: coach.open, 'close-mode': closeMode, dragging: isDragging }"
      :style="{ left: x + 'px', top: y + 'px' }"
      role="button"
      :aria-label="t('coach')"
      :title="closeMode ? t('coachLongPressTip') : t('coach')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <button
        v-if="closeMode"
        type="button"
        class="fab-close"
        :aria-label="t('coachHide')"
        @pointerdown.stop
        @click.stop.prevent="hideWidget"
      >
        ×
      </button>
      <span class="fab-emoji" aria-hidden="true">🤖</span>
    </div>
  </div>
</template>

<style scoped>
.coach-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9990;
}

.fab {
  position: fixed;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: grab;
  pointer-events: auto;
  user-select: none;
  touch-action: none;
  background: linear-gradient(145deg, #3dffb5, #4cc9f0 55%, #9b5de5);
  box-shadow:
    0 8px 28px rgba(61, 255, 181, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.15) inset;
  transition: box-shadow 0.2s ease, transform 0.15s ease;
  animation: pulse-glow 2.8s ease-in-out infinite;
}

.fab:hover {
  transform: scale(1.05);
}

.fab.open {
  box-shadow:
    0 8px 32px rgba(76, 201, 240, 0.45),
    0 0 0 2px rgba(61, 255, 181, 0.5);
}

.fab.dragging {
  cursor: grabbing;
  animation: none;
  transform: scale(1.08);
}

.fab.close-mode {
  animation: none;
  box-shadow: 0 8px 28px rgba(255, 77, 109, 0.35);
}

.fab-emoji {
  font-size: 28px;
  line-height: 1;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25));
  pointer-events: none;
}

.fab-close {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  padding: 0;
  background: #ff4d6d;
  color: #fff;
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  z-index: 2;
}

.fab-close:hover {
  filter: brightness(1.1);
}

.chat-panel {
  position: fixed;
  right: 16px;
  bottom: 88px;
  width: min(380px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  overflow: hidden;
  padding: 0;
}

.chat-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.chat-title {
  font-weight: 800;
  font-size: 15px;
}

.chat-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.btn-sm {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 10px;
}

.icon-only {
  width: 32px;
  padding: 6px 0;
}

.tiny {
  font-size: 11px;
  margin-top: 2px;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 180px;
  max-height: 340px;
}

.empty {
  text-align: center;
  padding: 28px 12px;
  font-size: 13px;
  line-height: 1.5;
}

.bubble {
  max-width: 92%;
  padding: 10px 12px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble.user {
  align-self: flex-end;
  background: linear-gradient(135deg, rgba(61, 255, 181, 0.22), rgba(76, 201, 240, 0.18));
  border: 1px solid rgba(61, 255, 181, 0.35);
  border-bottom-right-radius: 4px;
}

.bubble.assistant {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}

.bubble.loading {
  opacity: 0.85;
}

.think {
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--border);
}

.meta {
  margin-top: 6px;
  opacity: 0.7;
}

.err {
  color: var(--danger);
  margin: 0 14px 8px;
  font-size: 12px;
}

.chat-foot {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  align-items: end;
}

.area {
  resize: none;
  min-height: 52px;
  font-size: 13px;
}

.send {
  height: 44px;
  padding: 0 16px;
  white-space: nowrap;
}

.coach-panel-enter-active,
.coach-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.coach-panel-enter-from,
.coach-panel-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

@media (max-width: 480px) {
  .chat-panel {
    left: 12px;
    right: 12px;
    width: auto;
    bottom: 80px;
  }
}
</style>

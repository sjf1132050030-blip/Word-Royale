import { defineStore } from 'pinia'
import { ref } from 'vue'

const VISIBLE_KEY = 'wr_coach_visible'
const POS_KEY = 'wr_coach_pos'

function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p
  } catch {
    /* ignore */
  }
  return null
}

export const useCoachStore = defineStore('coach', () => {
  /** Floating icon visible (can hide via long-press X; re-enable in Settings) */
  const visible = ref(localStorage.getItem(VISIBLE_KEY) !== '0')
  const open = ref(false)
  /** @type {import('vue').Ref<{ role: 'user'|'assistant', content: string, thinking?: string|null, provider?: string }[]>} */
  const messages = ref([])
  const pos = ref(loadPos())

  function setVisible(v) {
    visible.value = !!v
    localStorage.setItem(VISIBLE_KEY, visible.value ? '1' : '0')
    if (!visible.value) open.value = false
  }

  function show() {
    setVisible(true)
  }

  function hide() {
    setVisible(false)
  }

  function toggleOpen() {
    open.value = !open.value
  }

  function setOpen(v) {
    open.value = !!v
  }

  function clearMessages() {
    messages.value = []
  }

  function addMessage(msg) {
    messages.value.push(msg)
  }

  function setPos(x, y) {
    pos.value = { x, y }
    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }))
  }

  return {
    visible,
    open,
    messages,
    pos,
    setVisible,
    show,
    hide,
    toggleOpen,
    setOpen,
    clearMessages,
    addMessage,
    setPos,
  }
})

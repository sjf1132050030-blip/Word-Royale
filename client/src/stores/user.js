import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '../api/http'

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('wr_token') || '')
  const user = ref(null)
  const loading = ref(false)

  const isLoggedIn = computed(() => !!token.value)
  const stats = computed(() => user.value?.stats || null)

  function setSession(t, u) {
    token.value = t
    user.value = u
    localStorage.setItem('wr_token', t)
  }

  function clearSession() {
    token.value = ''
    user.value = null
    localStorage.removeItem('wr_token')
  }

  async function register(payload) {
    loading.value = true
    try {
      const { data } = await http.post('/auth/register', payload)
      setSession(data.token, data.user)
      return data
    } finally {
      loading.value = false
    }
  }

  async function login(payload) {
    loading.value = true
    try {
      const { data } = await http.post('/auth/login', payload)
      setSession(data.token, data.user)
      return data
    } finally {
      loading.value = false
    }
  }

  async function fetchMe() {
    if (!token.value) return null
    const { data } = await http.get('/auth/me')
    user.value = data.user
    return data.user
  }

  function applyUser(u) {
    if (u) user.value = u
  }

  function logout() {
    clearSession()
  }

  return {
    token,
    user,
    loading,
    isLoggedIn,
    stats,
    register,
    login,
    fetchMe,
    applyUser,
    logout,
  }
})

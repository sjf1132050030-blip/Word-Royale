import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '../stores/user'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { guest: true },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { auth: true },
  },
  {
    path: '/battle/:lessonId',
    name: 'battle',
    component: () => import('../views/BattleView.vue'),
    meta: { auth: true },
  },
  {
    path: '/leaderboard',
    name: 'leaderboard',
    component: () => import('../views/LeaderboardView.vue'),
    meta: { auth: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { auth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const store = useUserStore()
  if (store.token && !store.user) {
    try {
      await store.fetchMe()
    } catch {
      store.logout()
    }
  }
  if (to.meta.auth && !store.token) return { name: 'login' }
  if (to.meta.guest && store.token) return { name: 'home' }
  return true
})

export default router

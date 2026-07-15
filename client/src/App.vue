<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AiCoachFab from './components/AiCoachFab.vue'
import { useCoachStore } from './stores/coach'
import { useUserStore } from './stores/user'

const store = useUserStore()
const coach = useCoachStore()
const route = useRoute()

const showCoach = computed(
  () => !!store.token && !!store.user && coach.visible && route.name !== 'login'
)
</script>

<template>
  <router-view />
  <AiCoachFab v-if="showCoach" />
</template>

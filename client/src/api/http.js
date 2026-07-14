import axios from 'axios'

const http = axios.create({
  baseURL: '/api',
  timeout: 20000,
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('wr_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (res) => res,
  (err) => {
    let msg = err.response?.data?.error || err.message || '请求失败'
    if (err.code === 'ECONNABORTED' || /timeout/i.test(msg)) {
      msg = '请求超时：AI 生成较慢，请再点一次或换模型'
    }
    if (err.response?.status === 401) {
      localStorage.removeItem('wr_token')
    }
    return Promise.reject(new Error(msg))
  }
)

/** Longer timeout for AI endpoints (mnemonic / chat / ping) */
export function aiPost(url, body, config = {}) {
  return http.post(url, body, {
    timeout: 60000,
    ...config,
  })
}

export default http

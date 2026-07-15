# Word Royale · 单词吃鸡

游戏化英语单词/句子学习（竞技吃鸡向）。

**核心闭环**：注册登录 → 长局对战 → 选项全释义 + AI 讲解 → XP/连胜/任务 → 周榜 · 中英文 UI。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 + Vite + Pinia + Vue Router + i18n(zh/en) |
| 后端 | Node.js + Express（位于 `client/server`） |
| 数据库 | SQLite（`sql.js`，`client/server/data/word_royale.db`） |
| AI | Gemini Flash（优先）→ Agnes 2.0 Flash（兜底） |

## 目录结构

```
client/                 # 前端
  dist/                 # 打包产物（生产由 server 托管）
  server/               # 后端 API
    data/               # SQLite 数据
    .env                # 密钥（勿提交）
  src/                  # Vue 源码
package.json            # 根目录便捷脚本（无 workspaces）
```

## 快速启动

前后端各自安装依赖（**不再使用根目录统一 `node_modules` / npm workspaces**）。

```bash
# 配置密钥
cp client/server/.env.example client/server/.env
# 编辑 client/server/.env 填入 GEMINI_API_KEY / AGNES_API_KEY

# 分别安装依赖
npm install --prefix client
npm install --prefix client/server
# 或：npm run install:all

# 终端 1 · API
npm run dev:server
# http://localhost:3001

# 终端 2 · 前端
npm run dev:client
# http://localhost:5173
```

浏览器打开 http://localhost:5173 。

## 生产部署（API + 打包前端同端口）

前端打包后由 Express 直接托管 `client/dist`，同一端口提供 API 与页面：

```bash
npm run install:all
npm run build:client
npm start
```

浏览器打开 http://localhost:3001 。`/api/*` 走接口，其余路径返回 SPA（支持 Vue Router history）。

## 已实现能力

1. 多用户 JWT + 进度/周榜隔离  
2. **更长对局**：约 30–40 题/关（英中、填空、组句、拼写干扰）+ 8 心；心尽仍可打完本局  
3. **选择后展示全部选项**的中/英释义、音标  
4. **AI 教练**：答题讲解 + 大厅陪练（Gemini → Agnes）  
5. **中 / EN** 界面切换  
6. 5 个关卡、40 词词库  

## API 摘要

- `POST /api/auth/register` `POST /api/auth/login` `GET /api/auth/me`
- `GET /api/today` `GET /api/leaderboard`
- `POST /api/lessons/:id/start` `POST /api/answer` `POST /api/finish`
- `POST /api/ai/chat` `GET /api/ai/status`

## 密钥说明

密钥只放在 `client/server/.env`（已加入 `.gitignore`），**不要写进前端**。

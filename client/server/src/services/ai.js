/**
 * Multi-provider AI: Gemini / Agnes / remote Ollama Qwen2.5:0.5b.
 * Keys & base URLs from env only.
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_URL =
  process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta/models';

const AGNES_KEY = process.env.AGNES_API_KEY || '';
const AGNES_BASE = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1';
const AGNES_MODEL = process.env.AGNES_MODEL || 'agnes-2.0-flash';

/**
 * Remote Ollama (ollama-chat format)
 * baseUrl: http://117.72.54.166:11434
 * endpoint: /api/chat
 * model: qwen2.5:0.5b
 */
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || 'http://117.72.54.166:11434').replace(
  /\/$/,
  ''
);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || '/api/chat';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || '';
/** Optional: force available even if tags probe fails this boot */
const OLLAMA_FORCE = process.env.OLLAMA_FORCE === '1' || process.env.OLLAMA_FORCE === 'true';

/** Server-side AI wait (ms). Mnemonic often 15–30s on remote models. */
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 55000);

/** Cached Ollama reachability (refreshed periodically) */
let ollamaAvailableCache = { ok: false, checkedAt: 0 };

async function probeOllama() {
  const now = Date.now();
  if (now - ollamaAvailableCache.checkedAt < 15000) return ollamaAvailableCache.ok;
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { method: 'GET' });
    if (!res.ok) {
      ollamaAvailableCache = { ok: OLLAMA_FORCE, checkedAt: now };
      return ollamaAvailableCache.ok;
    }
    const data = await res.json().catch(() => ({}));
    const names = (data.models || []).map((m) => m.name || m.model || '');
    // match exact or prefix (qwen2.5:0.5b / qwen2.5:0.5b-...)
    const has =
      names.some((n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL}`) || n.includes('qwen2.5')) ||
      OLLAMA_FORCE ||
      names.length > 0; // ollama up — show as available even if model not pulled yet
    ollamaAvailableCache = { ok: !!has || res.ok, checkedAt: now };
    // Prefer true if server is up so UI shows 可用; generate will error if model missing
    ollamaAvailableCache.ok = res.ok;
    return ollamaAvailableCache.ok;
  } catch {
    ollamaAvailableCache = { ok: OLLAMA_FORCE, checkedAt: now };
    return ollamaAvailableCache.ok;
  }
}

// Sync available() for listProviders — uses cache, triggers background probe
function ollamaAvailableSync() {
  if (Date.now() - ollamaAvailableCache.checkedAt > 15000) {
    probeOllama().catch(() => {});
  }
  return ollamaAvailableCache.ok || OLLAMA_FORCE;
}

const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Gemini Flash',
    model: GEMINI_MODEL,
    available: () => !!GEMINI_KEY,
  },
  agnes: {
    id: 'agnes',
    label: 'Agnes 2.0 Flash',
    model: AGNES_MODEL,
    available: () => !!AGNES_KEY,
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen2.5 0.5B (远程)',
    model: OLLAMA_MODEL,
    available: () => ollamaAvailableSync(),
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

function normalizeProvider(id) {
  if (id === 'qwen' || id === 'ollama' || id === 'qwen2.5:0.5b') return 'qwen';
  if (id === 'agnes') return 'agnes';
  if (id === 'gemini') return 'gemini';
  return 'gemini';
}

async function withTimeout(promise, ms = AI_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`AI timeout (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Split model output into thinking + final answer.
 * Supports: <think>, <thinking>, ```thinking, reasoning fields, THINKING:/ANSWER:
 */
function splitThinking(rawText, extraThinking = '') {
  let text = (rawText || '').trim();
  let thinking = (extraThinking || '').trim();

  const patterns = [
    /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i,
    /```(?:thinking|thought|reasoning)\s*([\s\S]*?)```/i,
    /【思考】([\s\S]*?)【助记】/i,
    /THINKING:\s*([\s\S]*?)\s*ANSWER:\s*/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const chunk = (m[1] || '').trim();
      if (chunk) thinking = thinking ? `${thinking}\n${chunk}` : chunk;
      text = text.replace(m[0], m[0].includes('ANSWER:') ? '' : '').replace(re, '').trim();
      // For THINKING:/ANSWER: form, remainder after match is answer
      if (/THINKING:/i.test(m[0]) && /ANSWER:/i.test(rawText)) {
        const ans = rawText.split(/ANSWER:\s*/i)[1];
        if (ans) text = ans.trim();
      }
      if (/【助记】/.test(rawText)) {
        const ans = rawText.split(/【助记】/)[1];
        if (ans) text = ans.trim();
      }
      break;
    }
  }

  // Strip leftover tags
  text = text
    .replace(/<\/?think(?:ing)?>/gi, '')
    .replace(/^ANSWER:\s*/i, '')
    .trim();

  return { text, thinking: thinking || null };
}

function extractFromGeminiData(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let textParts = [];
  let thinkingParts = [];
  for (const p of parts) {
    if (p.thought === true || p.thoughtSignature) {
      if (p.text) thinkingParts.push(p.text);
      continue;
    }
    if (p.text) textParts.push(p.text);
  }
  // some APIs put thinking in separate field
  if (data?.candidates?.[0]?.thinking) {
    thinkingParts.push(String(data.candidates[0].thinking));
  }
  const joined = textParts.join('');
  const extra = thinkingParts.join('\n').trim();
  return splitThinking(joined, extra);
}

function extractFromAgnesData(data) {
  const msg = data?.choices?.[0]?.message || {};
  let content = msg.content || '';
  // OpenAI-compatible reasoning fields
  const extra = [msg.reasoning_content, msg.reasoning, msg.thinking, data?.choices?.[0]?.reasoning]
    .filter(Boolean)
    .join('\n');
  // content may be array of parts
  if (Array.isArray(content)) {
    content = content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('');
  }
  return splitThinking(String(content), extra);
}

async function callGemini(prompt, systemHint = '') {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY missing');
  const full = systemHint ? `${systemHint}\n\n${prompt}` : prompt;
  const url = `${GEMINI_URL}/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': GEMINI_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: full }] }],
      generationConfig: {
        temperature: 0.65,
        maxOutputTokens: 600,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
  }
  const { text, thinking } = extractFromGeminiData(data);
  if (!text.trim()) throw new Error('Gemini empty response');
  return {
    text: text.trim(),
    thinking,
    provider: 'gemini',
    model: GEMINI_MODEL,
  };
}

async function callAgnes(prompt, systemHint = '') {
  if (!AGNES_KEY) throw new Error('AGNES_API_KEY missing');
  const res = await fetch(`${AGNES_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AGNES_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AGNES_MODEL,
      messages: [
        {
          role: 'system',
          content:
            systemHint ||
            'You are a concise English learning coach. Be clear and brief.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.65,
      max_tokens: 600,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `Agnes HTTP ${res.status}`);
  }
  const { text, thinking } = extractFromAgnesData(data);
  if (!text.trim()) throw new Error('Agnes empty response');
  return {
    text: text.trim(),
    thinking,
    provider: 'agnes',
    model: AGNES_MODEL,
  };
}

/**
 * Remote Ollama chat — format: ollama-chat
 * POST {baseUrl}/api/chat
 * Body: { model, messages, stream: false, options }
 */
async function callQwen(prompt, systemHint = '') {
  const messages = [
    {
      role: 'system',
      content:
        systemHint ||
        'You are a concise English learning coach. Be clear and brief. Reply in Chinese when user uses Chinese.',
    },
    { role: 'user', content: prompt },
  ];

  const headers = { 'Content-Type': 'application/json' };
  if (OLLAMA_API_KEY) {
    headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;
  }

  const path = OLLAMA_ENDPOINT.startsWith('/') ? OLLAMA_ENDPOINT : `/${OLLAMA_ENDPOINT}`;
  const url = `${OLLAMA_BASE}${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: { temperature: 0.6, num_predict: 400 },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        `Ollama HTTP ${res.status} @ ${url} (model=${OLLAMA_MODEL})`
    );
  }

  // ollama-chat: { message: { role, content }, ... }
  const raw = data?.message?.content || data?.response || '';
  const { text, thinking } = splitThinking(String(raw));
  if (!text.trim()) throw new Error('Qwen/Ollama empty response');

  ollamaAvailableCache = { ok: true, checkedAt: Date.now() };
  return {
    text: text.trim(),
    thinking,
    provider: 'qwen',
    model: OLLAMA_MODEL,
  };
}

function listProviders() {
  // kick probe for ollama freshness
  probeOllama().catch(() => {});
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    model: p.model,
    available: p.available(),
  }));
}

function runnerFor(provider, prompt, system) {
  const id = normalizeProvider(provider);
  if (id === 'qwen') return () => callQwen(prompt, system);
  if (id === 'agnes') return () => callAgnes(prompt, system);
  return () => callGemini(prompt, system);
}

/**
 * @param {string} prompt
 * @param {{ provider?: string, fallback?: boolean, system?: string }} opts
 */
async function generateText(prompt, opts = {}) {
  const preferred = normalizeProvider(opts.provider);
  const fallback = opts.fallback !== false;
  const system = opts.system || '';

  // Preferred first, then others as backup order
  const order = [preferred, ...PROVIDER_IDS.filter((id) => id !== preferred)];
  const runners = (fallback ? order : [preferred]).map((id) => runnerFor(id, prompt, system));

  const errors = [];
  for (const run of runners) {
    try {
      return await withTimeout(run(), AI_TIMEOUT_MS);
    } catch (e) {
      errors.push(e.message);
    }
  }

  return {
    text: '',
    thinking: null,
    provider: 'none',
    model: null,
    error: errors.join(' | ') || 'AI unavailable',
  };
}

function buildMnemonicPrompt(wordInfo, lang = 'zh') {
  const word = wordInfo.word || wordInfo.text || '';
  const zh = wordInfo.meaning_zh || '';
  const en = wordInfo.meaning_en || '';
  const ph = wordInfo.phonetic || '';
  const pos = wordInfo.pos || '';

  if (lang === 'en') {
    return `Word mnemonic task.
Word: ${word} ${ph} [${pos}]
Meaning: ${en || zh}

Format EXACTLY:
<think>
one short reason for the mnemonic (max 30 words)
</think>
Then the final mnemonic + 1 example sentence (max 50 words total after think).`;
  }

  return `为单词写助记（要快、要短）。
词: ${word} ${ph} ${pos}
义: ${zh} / ${en}

请严格按此格式输出：
<think>
一句话说明你怎么记（不超过 30 字）
</think>
助记正文（谐音或拆分或画面，1 句）+ 1 个英文例句带中文（总共不超过 60 字）`;
}

async function mnemonicForWord(wordInfo, { provider, lang = 'zh', fallback = true } = {}) {
  const prompt = buildMnemonicPrompt(wordInfo, lang);
  const system =
    lang === 'en'
      ? 'Mnemonic coach. Follow the <think> format. Be brief and fast.'
      : '你是单词助记教练。必须用 <think>...</think> 写简短思考，再给助记正文。简洁快速。';

  const result = await generateText(prompt, { provider, fallback, system });
  if (result.text) {
    // re-split in case generateText returned combined
    const again = splitThinking(result.text, result.thinking || '');
    return {
      ...result,
      text: again.text || result.text,
      thinking: again.thinking || result.thinking || null,
    };
  }

  const w = wordInfo.word || wordInfo.text || '';
  const zh = wordInfo.meaning_zh || '';
  if (lang === 'en') {
    return {
      text: `${w}: ${wordInfo.meaning_en || zh}. Link its sound to a personal image.`,
      thinking: 'Offline fallback (model timed out).',
      provider: 'local',
      model: 'local',
    };
  }
  return {
    text: `【${w}】${zh}\n助记：把拼写拆开，结合中文意思编一个小画面。\n例：I will remember ${w}. 我会记住 ${w}。`,
    thinking: '模型超时，使用本地备用助记。',
    provider: 'local',
    model: 'local',
  };
}

async function coachChat(message, { lang = 'zh', provider, fallback = true } = {}) {
  const system =
    lang === 'en'
      ? 'Friendly English coach. Keep under 100 words. Optional: wrap brief reasoning in <think></think>.'
      : '中文英语教练，120 字内。可用 <think></think> 写一句简短思考再给答案。';
  const result = await generateText(message, { provider, fallback, system });
  if (result.text) {
    const again = splitThinking(result.text, result.thinking || '');
    return {
      ...result,
      text: again.text || result.text,
      thinking: again.thinking || result.thinking || null,
    };
  }
  return result;
}

module.exports = {
  generateText,
  mnemonicForWord,
  coachChat,
  callGemini,
  callAgnes,
  callQwen,
  listProviders,
  PROVIDERS,
  PROVIDER_IDS,
  normalizeProvider,
  probeOllama,
  splitThinking,
  AI_TIMEOUT_MS,
  OLLAMA_MODEL,
};

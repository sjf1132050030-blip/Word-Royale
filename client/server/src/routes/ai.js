const express = require('express');
const { z } = require('zod');
const { authRequired } = require('../middleware/auth');
const { getDb } = require('../db/database');
const { coachChat, mnemonicForWord, listProviders, generateText } = require('../services/ai');

const router = express.Router();
router.use(authRequired);

function userAiPrefs(userId) {
  const { get } = getDb();
  const { normalizeProvider } = require('../services/ai');
  const row = get('SELECT ai_provider, ai_fallback FROM users WHERE id = ?', [userId]);
  return {
    provider: normalizeProvider(row?.ai_provider),
    fallback: row?.ai_fallback === undefined || row?.ai_fallback === null ? true : !!row.ai_fallback,
  };
}

router.get('/providers', async (_req, res) => {
  const { probeOllama } = require('../services/ai');
  await probeOllama();
  res.json({ providers: listProviders() });
});

router.get('/status', async (_req, res) => {
  const { probeOllama } = require('../services/ai');
  await probeOllama();
  const providers = listProviders();
  res.json({
    gemini: providers.find((p) => p.id === 'gemini')?.available || false,
    agnes: providers.find((p) => p.id === 'agnes')?.available || false,
    qwen: providers.find((p) => p.id === 'qwen')?.available || false,
    providers,
  });
});

/** Manual mnemonic for one option/word — on-demand only */
router.post('/mnemonic', async (req, res) => {
  const schema = z.object({
    word: z.string().min(1).max(80),
    meaning_zh: z.string().max(200).optional(),
    meaning_en: z.string().max(300).optional(),
    phonetic: z.string().max(80).optional(),
    pos: z.string().max(40).optional(),
    lang: z.enum(['zh', 'en']).optional(),
    /** override settings for this call */
    provider: z.enum(['gemini', 'agnes', 'qwen']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '参数错误' });

  const prefs = userAiPrefs(req.user.id);
  const provider = parsed.data.provider || prefs.provider;
  const lang = parsed.data.lang || 'zh';

  const started = Date.now();
  try {
    const result = await mnemonicForWord(
      {
        word: parsed.data.word,
        meaning_zh: parsed.data.meaning_zh || '',
        meaning_en: parsed.data.meaning_en || '',
        phonetic: parsed.data.phonetic || '',
        pos: parsed.data.pos || '',
      },
      { provider, lang, fallback: prefs.fallback }
    );

    if (!result.text) {
      return res.status(502).json({
        error: result.error || 'AI 暂不可用（可能超时，请重试或切换模型）',
        provider: result.provider,
        elapsed_ms: Date.now() - started,
      });
    }

    res.json({
      tip: result.text,
      thinking: result.thinking || null,
      provider: result.provider,
      model: result.model,
      elapsed_ms: Date.now() - started,
    });
  } catch (e) {
    res.status(502).json({
      error: e.message || 'AI 请求失败',
      elapsed_ms: Date.now() - started,
    });
  }
});

router.post('/chat', async (req, res) => {
  const schema = z.object({
    message: z.string().min(1).max(1000),
    lang: z.enum(['zh', 'en']).optional(),
    provider: z.enum(['gemini', 'agnes', 'qwen']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '参数错误' });

  const prefs = userAiPrefs(req.user.id);
  const { message, lang = 'zh' } = parsed.data;
  const provider = parsed.data.provider || prefs.provider;

  try {
    const result = await coachChat(message, {
      lang,
      provider,
      fallback: prefs.fallback,
    });
    res.json({
      reply: result.text || (lang === 'en' ? 'AI is busy, try again.' : 'AI 暂时繁忙，请稍后再试。'),
      thinking: result.thinking || null,
      provider: result.provider,
      model: result.model,
      error: result.error || null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'AI 请求失败' });
  }
});

router.post('/ping', async (req, res) => {
  const prefs = userAiPrefs(req.user.id);
  const lang = req.body?.lang === 'en' ? 'en' : 'zh';
  const provider = req.body?.provider || prefs.provider;
  const prompt =
    lang === 'en'
      ? 'Say hello in one short sentence as an English coach. Optional: wrap a 5-word thought in <think></think> first.'
      : '用一句话向英语学习者问好。可选：先用 <think>五字内思考</think> 再写问候。';
  const result = await generateText(prompt, {
    provider,
    fallback: prefs.fallback,
  });
  const { splitThinking } = require('../services/ai');
  const again = splitThinking(result.text || '', result.thinking || '');
  res.json({
    ...result,
    text: again.text || result.text,
    thinking: again.thinking || result.thinking || null,
  });
});

module.exports = router;

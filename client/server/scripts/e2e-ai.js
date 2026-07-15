const base = 'http://localhost:3001/api';

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${data.error || res.statusText}`);
  return data;
}

async function main() {
  const health = await req('/health'.replace('/api/health', '/health').includes('x') ? '/../health' : '');
}
// fix: health is not under same helper easily
async function run() {
  const h = await fetch('http://localhost:3001/api/health').then((r) => r.json());
  console.log('health', h);

  const email = `ai_${Date.now()}@test.com`;
  const reg = await req('/auth/register', {
    method: 'POST',
    body: { email, password: '123456', nickname: 'AITester' },
  });
  const token = reg.token;
  console.log('register ok');

  const today = await req('/today', { token });
  console.log('lessons', today.lessons.length, 'words packs expanded');

  const start = await req(`/lessons/${today.lessons[0].id}/start`, { method: 'POST', token });
  console.log('questions count', start.total, 'hearts', start.hearts);

  const q0 = start.questions[0];
  const answer = q0.options ? q0.options[0].key : [...q0.tokens].reverse();
  const ans = await req('/answer', {
    method: 'POST',
    token,
    body: { session_id: start.session_id, question_index: 0, answer, lang: 'zh' },
  });
  console.log('answer correct?', ans.correct);
  console.log('options_reveal', ans.options_reveal?.length, ans.options_reveal?.map((o) => o.word || o.text));
  console.log('ai_provider', ans.ai_provider);
  console.log('ai_tip', (ans.ai_tip || '').slice(0, 160));

  const chat = await req('/ai/chat', {
    method: 'POST',
    token,
    body: { message: '用一句话解释 compete 和 challenge 的区别', lang: 'zh' },
  });
  console.log('chat provider', chat.provider);
  console.log('chat', (chat.reply || '').slice(0, 200));
  console.log('OK');
}

run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});

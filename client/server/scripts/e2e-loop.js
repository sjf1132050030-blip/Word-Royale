/* Quick closed-loop API test */
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
  const email = `royale_${Date.now()}@test.com`;
  const reg = await req('/auth/register', {
    method: 'POST',
    body: { email, password: '123456', nickname: '吃鸡选手' },
  });
  console.log('✓ register', reg.user.nickname, 'xp', reg.user.stats.total_xp);
  const token = reg.token;

  const today = await req('/today', { token });
  console.log('✓ today lessons', today.lessons.length, 'quests', today.quests.length);
  const lessonId = today.lessons[0].id;

  const start = await req(`/lessons/${lessonId}/start`, { method: 'POST', token });
  console.log('✓ start session', start.session_id, 'questions', start.total);

  let combo = 0;
  for (let i = 0; i < start.questions.length; i++) {
    const q = start.questions[i];
    let answer;
    if (q.type === 'sentence_order') {
      // wrong order sometimes to test hearts — mostly guess from tokens
      answer = [...q.tokens].reverse();
    } else {
      // pick A always — mixed results
      answer = 'A';
    }
    const r = await req('/answer', {
      method: 'POST',
      token,
      body: { session_id: start.session_id, question_index: i, answer },
    });
    combo = r.combo_max;
    process.stdout.write(r.correct ? 'O' : 'X');
  }
  console.log('\n✓ answered all, combo_max tracked server-side');

  const fin = await req('/finish', {
    method: 'POST',
    token,
    body: { session_id: start.session_id },
  });
  console.log('✓ finish', {
    stars: fin.stars,
    grade: fin.grade,
    xp: fin.xp_earned,
    streak: fin.streak,
    weekly: fin.user.stats.weekly_xp,
    total: fin.user.stats.total_xp,
  });

  const lb = await req('/leaderboard', { token });
  console.log('✓ leaderboard size', lb.leaderboard.length, 'my_rank', lb.my_rank);
  console.log('CLOSED LOOP OK');
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});

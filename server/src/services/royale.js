/**
 * Battle Royale simulation layer for Word Royale ("单词吃鸡").
 * Deterministic from session stats so client/server stay in sync.
 */

const ROYALE_START_PLAYERS = 100;
const BOT_NAMES = [
  '暗夜猎手', '词霸007', '语法杀手', '空投小王子', '毒圈幸存者',
  '连击狂魔', '摸包达人', '决赛圈刚枪', '伏地魔99', '海岛菜鸟',
  '地铁跑图', '信号枪王', '三级头本头', '绷带工匠', '平底锅侠',
  'M416狂暴', '98K一枪', '烟雾弹艺术家', '翻墙小能手', '决赛圈躺鸡',
];

function hashSeed(n) {
  // simple deterministic pseudo-random 0..1 from integer seed
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function botName(seed) {
  return BOT_NAMES[Math.floor(hashSeed(seed) * BOT_NAMES.length)];
}

/**
 * Circle phase 1..5 as match progresses
 */
function circlePhase(qIndex, totalQ) {
  if (totalQ <= 1) return 1;
  const t = qIndex / (totalQ - 1);
  if (t < 0.2) return 1;
  if (t < 0.4) return 2;
  if (t < 0.6) return 3;
  if (t < 0.8) return 4;
  return 5;
}

const CIRCLE_LABELS = {
  1: { zh: '热身空降', en: 'Drop zone', radius: 100 },
  2: { zh: '缩圈 I', en: 'Circle I', radius: 75 },
  3: { zh: '缩圈 II', en: 'Circle II', radius: 50 },
  4: { zh: '决赛圈', en: 'Final circle', radius: 25 },
  5: { zh: '天选之圈', en: 'Last stand', radius: 10 },
};

/**
 * After answering question at index qIndex (0-based), with current tallies.
 */
function calcRoyaleLive({ correct, wrong, combo, comboMax, qIndex, totalQ }) {
  const phase = circlePhase(qIndex, totalQ);
  const circle = CIRCLE_LABELS[phase];

  // Your eliminations: base 3 per correct, combo multiplies
  let kills = 0;
  // approximate cumulative kills (deterministic)
  // each correct ~ 3-8 kills depending on combo streaks we only have final combo max
  kills = correct * 3 + Math.min(comboMax, 12) * 2 + Math.floor(correct / 2);

  // Natural deaths: circle + other fights
  const natural = qIndex * 3 + phase * 4 + wrong * 2;
  let alive = ROYALE_START_PLAYERS - kills - natural;
  alive = Math.max(1, Math.min(ROYALE_START_PLAYERS, alive));

  // This round's event
  let roundKills = 0;
  let feed = [];
  let event = 'idle';

  if (correct) {
    roundKills = 2 + Math.min(combo, 6) + (combo >= 5 ? 2 : 0) + (phase >= 4 ? 1 : 0);
    event = combo >= 5 ? 'multi_kill' : 'knock';
    const names = [];
    for (let i = 0; i < Math.min(3, roundKills); i++) {
      names.push(botName(qIndex * 17 + correct * 3 + i + 1));
    }
    if (roundKills === 1) {
      feed.push({ type: 'kill', text_zh: `你淘汰了 ${names[0]}`, text_en: `You eliminated ${names[0]}` });
    } else {
      feed.push({
        type: 'multi',
        text_zh: `你完成 ${roundKills} 连淘汰！${names.slice(0, 2).join('、')} 等倒下了`,
        text_en: `${roundKills} eliminations! ${names.slice(0, 2).join(', ')} down`,
      });
    }
    if (combo >= 5) {
      feed.push({ type: 'streak', text_zh: `🔥 连击 x${combo} 暴走`, text_en: `🔥 Combo x${combo} rampage` });
    }
    // loot
    if (combo >= 3 || phase >= 3) {
      feed.push({
        type: 'loot',
        text_zh: '捡到空投补给 +金币',
        text_en: 'Airdrop loot +coins',
      });
    }
  } else {
    event = 'hurt';
    feed.push({
      type: 'hurt',
      text_zh: phase >= 4 ? '你在毒圈中受伤了！' : '你被对手击中，掉血！',
      text_en: phase >= 4 ? 'Circle damage!' : 'You took a hit!',
    });
    // others still die
    feed.push({
      type: 'world',
      text_zh: `${botName(qIndex + 99)} 被第三人箱了`,
      text_en: `${botName(qIndex + 99)} was third-partied`,
    });
  }

  // circle shrink notice on phase boundaries
  if (qIndex > 0 && circlePhase(qIndex - 1, totalQ) !== phase) {
    feed.unshift({
      type: 'circle',
      text_zh: `⚠️ 缩圈！进入「${circle.zh}」`,
      text_en: `⚠️ Circle shrink → ${circle.en}`,
    });
  }

  // estimate live rank among remaining
  const liveRank = Math.max(1, Math.min(alive, Math.round(alive * 0.15) + 1 + wrong - Math.floor(correct / 4)));

  return {
    start_players: ROYALE_START_PLAYERS,
    alive: alive,
    kills,
    round_kills: correct ? roundKills : 0,
    circle_phase: phase,
    circle_name_zh: circle.zh,
    circle_name_en: circle.en,
    circle_radius: circle.radius,
    live_rank: Math.max(1, liveRank),
    event,
    feed,
    mode: 'royale',
  };
}

/**
 * Final placement + chicken dinner title
 */
function calcRoyaleFinish({ correct, wrong, comboMax, total }) {
  const accuracy = total ? correct / total : 0;
  const live = calcRoyaleLive({
    correct,
    wrong,
    combo: comboMax,
    comboMax,
    qIndex: Math.max(0, total - 1),
    totalQ: total,
  });

  // Placement: better accuracy & kills → better rank
  let place;
  if (wrong === 0 && correct === total && total > 0) {
    place = 1; // chicken dinner
  } else if (accuracy >= 0.95 && wrong <= 1) {
    place = 1;
  } else if (accuracy >= 0.85) {
    place = 2 + (wrong > 2 ? 1 : 0);
  } else if (accuracy >= 0.75) {
    place = 4 + Math.min(3, wrong);
  } else if (accuracy >= 0.6) {
    place = 10 + wrong * 2;
  } else if (accuracy >= 0.45) {
    place = 25 + wrong * 3;
  } else {
    place = 50 + wrong * 4;
  }
  place = Math.max(1, Math.min(100, Math.round(place)));

  let title_zh = '参与奖';
  let title_en = 'Participant';
  let chicken = false;
  if (place === 1) {
    title_zh = '🍗 吃鸡成功！WINNER WINNER';
    title_en = '🍗 CHICKEN DINNER!';
    chicken = true;
  } else if (place <= 3) {
    title_zh = '🥈 大逃杀亚军圈';
    title_en = '🥈 Podium finish';
  } else if (place <= 10) {
    title_zh = '🏅 前十晋级';
    title_en = '🏅 Top 10';
  } else if (place <= 25) {
    title_zh = '挺进四分之一';
    title_en = 'Top 25';
  } else if (place <= 50) {
    title_zh = '半区生存';
    title_en = 'Top 50';
  }

  // placement bonus XP/coins
  let placeXp = 0;
  let placeCoins = 0;
  if (place === 1) {
    placeXp = 120;
    placeCoins = 80;
  } else if (place <= 3) {
    placeXp = 70;
    placeCoins = 40;
  } else if (place <= 10) {
    placeXp = 40;
    placeCoins = 25;
  } else if (place <= 25) {
    placeXp = 20;
    placeCoins = 10;
  }

  return {
    ...live,
    alive: place === 1 ? 1 : live.alive,
    placement: place,
    title_zh,
    title_en,
    chicken,
    place_xp: placeXp,
    place_coins: placeCoins,
    kills: live.kills,
  };
}

function dropZoneName(lessonTitle = '') {
  // map lesson to a themed drop
  const zones = [
    { zh: 'P城词库区', en: 'Pochinki Lexicon' },
    { zh: '学校语法楼', en: 'School Grammar' },
    { zh: '机场听力跑道', en: 'Airport Listening' },
    { zh: 'G港写作码头', en: 'Gatka Writing' },
    { zh: '军事基地阅读', en: 'Military Reading' },
    { zh: '诺维克夫听力', en: 'Novorepnoye' },
  ];
  let h = 0;
  for (let i = 0; i < lessonTitle.length; i++) h = (h + lessonTitle.charCodeAt(i) * (i + 1)) % zones.length;
  return zones[h];
}

module.exports = {
  ROYALE_START_PLAYERS,
  calcRoyaleLive,
  calcRoyaleFinish,
  dropZoneName,
  circlePhase,
};

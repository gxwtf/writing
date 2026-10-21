// 首页「每日一句」文案库
//
// 参考「一言（hitokoto）」这类句子站的做法：本地内置句子库 + 按日期轮换，
// 不联网、不调 AI，保证首页秒开且每天固定一句（同一天刷新不变，跨天自动换）。
//
// 选句标准：与「积累 / 写作 / 坚持 / 阅读」相关，适合作为作文积累的每日提神句；
// 英文原句 + 中文释义 + 出处，方便直接抄进素材本。

export interface DailyQuote {
  /** 英文原句 */
  en: string;
  /** 中文释义 */
  zh: string;
  /** 作者 / 出处 */
  source: string;
}

export const DAILY_QUOTES: DailyQuote[] = [
  {
    en: 'The palest ink is better than the best memory.',
    zh: '再淡的墨迹，也胜过最好的记性。',
    source: '中国谚语',
  },
  {
    en: 'Reading is to the mind what exercise is to the body.',
    zh: '阅读之于头脑，正如运动之于身体。',
    source: 'Joseph Addison',
  },
  {
    en: 'Little strokes fell great oaks.',
    zh: '小斧不断砍，巨橡终会倒。',
    source: 'Benjamin Franklin',
  },
  {
    en: 'Genius is one percent inspiration and ninety-nine percent perspiration.',
    zh: '天才是百分之一的灵感加上百分之九十九的汗水。',
    source: 'Thomas Edison',
  },
  {
    en: 'A word after a word after a word is power.',
    zh: '一个词接一个词，接下去就是力量。',
    source: 'Margaret Atwood',
  },
  {
    en: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.',
    zh: '我们重复做的事造就了我们，卓越不是行为，而是习惯。',
    source: 'Aristotle',
  },
  {
    en: 'The journey of a thousand miles begins with a single step.',
    zh: '千里之行，始于足下。',
    source: '《道德经》',
  },
  {
    en: 'Words are, of course, the most powerful drug used by mankind.',
    zh: '文字无疑是人类使用过的最有力的药。',
    source: 'Rudyard Kipling',
  },
  {
    en: 'Patience and perseverance, in the end, overcomes all obstacles.',
    zh: '耐心与坚持，终能跨越一切障碍。',
    source: 'Leonardo da Vinci',
  },
  {
    en: 'You do not write because you want to say something, you write because you have something to say.',
    zh: '你写作不是因为有话想说，而是因为你确有话要说。',
    source: 'F. Scott Fitzgerald',
  },
  {
    en: 'To learn to read is to light a fire; every syllable that is spelled out is a spark.',
    zh: '学会阅读就是点燃一把火，拼出的每一个音节都是火花。',
    source: 'Victor Hugo',
  },
  {
    en: 'The limits of my language mean the limits of my world.',
    zh: '我的语言的边界，就是我世界的边界。',
    source: 'Ludwig Wittgenstein',
  },
  {
    en: 'Knowing yourself is the beginning of all wisdom.',
    zh: '认识自己，是一切智慧的开端。',
    source: 'Aristotle',
  },
  {
    en: 'It is never too late to be what you might have been.',
    zh: '成为你本可以成为的人，永远不晚。',
    source: 'George Eliot',
  },
  {
    en: 'Quality is not an act, it is a habit.',
    zh: '优秀不是一次行动，而是一种习惯。',
    source: 'Aristotle',
  },
  {
    en: 'Books are a uniquely portable magic.',
    zh: '书是一种独一无二、可以随身携带的魔法。',
    source: 'Stephen King',
  },
  {
    en: 'A reader lives a thousand lives before he dies.',
    zh: '读书的人在死前活过一千种人生。',
    source: 'George R. R. Martin',
  },
  {
    en: 'The more that you read, the more things you will know.',
    zh: '你读得越多，知道的就越多。',
    source: 'Dr. Seuss',
  },
  {
    en: 'Nothing in life is to be feared, it is only to be understood.',
    zh: '生活中没有什么可怕的东西，只有需要理解的东西。',
    source: 'Marie Curie',
  },
  {
    en: 'Those who cannot remember the past are condemned to repeat it.',
    zh: '忘记过去的人，注定要重蹈覆辙。',
    source: 'George Santayana',
  },
  {
    en: 'We write to taste life twice, in the moment and in retrospect.',
    zh: '我们写作，是为了把生活尝两遍：当下一次，回望又一次。',
    source: 'Anaïs Nin',
  },
  {
    en: 'The unexamined life is not worth living.',
    zh: '未经省察的人生不值得过。',
    source: 'Socrates',
  },
  {
    en: 'If I have seen further, it is by standing on the shoulders of giants.',
    zh: '如果我看得更远，是因为站在巨人的肩膀上。',
    source: 'Isaac Newton',
  },
  {
    en: 'Not all those who wander are lost.',
    zh: '并非所有徘徊的人都迷了路。',
    source: 'J. R. R. Tolkien',
  },
  {
    en: 'Simplicity is the ultimate sophistication.',
    zh: '简约是终极的精致。',
    source: 'Leonardo da Vinci',
  },
  {
    en: 'What we know is a drop, what we do not know is an ocean.',
    zh: '我们所知的只是一滴水，未知的却是一片海。',
    source: 'Isaac Newton',
  },
  {
    en: 'It always seems impossible until it is done.',
    zh: '事情在做成之前，总显得不可能。',
    source: 'Nelson Mandela',
  },
  {
    en: 'Smooth seas do not make skillful sailors.',
    zh: '平静的海面练不出熟练的水手。',
    source: '非洲谚语',
  },
  {
    en: 'The best way out is always through.',
    zh: '最好的出路，永远是穿过去。',
    source: 'Robert Frost',
  },
  {
    en: 'Turn your wounds into wisdom.',
    zh: '把你的伤口变成智慧。',
    source: 'Oprah Winfrey',
  },
  {
    en: 'Learning never exhausts the mind.',
    zh: '学习永远不会让头脑疲惫。',
    source: 'Leonardo da Vinci',
  },
  {
    en: 'Half of writing is reading, and the other half is living.',
    zh: '写作一半是阅读，另一半是生活。',
    source: '写作格言',
  },
  {
    en: 'Do not go where the path may lead, go instead where there is no path and leave a trail.',
    zh: '不要走别人铺好的路，要去没有路的地方，留下自己的足迹。',
    source: 'Ralph Waldo Emerson',
  },
  {
    en: 'Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.',
    zh: '试过，失败过。没关系，再试，再失败，只是要失败得更好。',
    source: 'Samuel Beckett',
  },
  {
    en: 'Words, once they are printed, have a life of their own.',
    zh: '文字一旦印出，便有了自己的生命。',
    source: 'Carol Burnett',
  },
  {
    en: 'The secret of getting ahead is getting started.',
    zh: '领先的秘诀，就是开始。',
    source: 'Mark Twain',
  },
  {
    en: 'A pen becomes a sword only when it is used with courage.',
    zh: '笔只有在被勇敢地使用时，才会成为剑。',
    source: '写作格言',
  },
  {
    en: 'Every great writer was once a beginner who refused to give up.',
    zh: '每一位伟大的作家，都曾经是拒绝放弃的新手。',
    source: '写作格言',
  },
  {
    en: 'Read a thousand books, and your words will flow like a river.',
    zh: '读书破万卷，下笔如有神。',
    source: '杜甫',
  },
  {
    en: 'Learning without thought is labor lost; thought without learning is perilous.',
    zh: '学而不思则罔，思而不学则殆。',
    source: '《论语》',
  },
  {
    en: 'A mountain however high has a path for those who climb.',
    zh: '山再高，向上攀，总能登顶。',
    source: '中国谚语',
  },
  {
    en: 'The obstacle is the way.',
    zh: '障碍本身就是道路。',
    source: 'Marcus Aurelius',
  },
  {
    en: 'Think like a wise man but communicate in the language of the people.',
    zh: '像智者一样思考，像普通人一样说话。',
    source: 'W. B. Yeats',
  },
  {
    en: 'One today is worth two tomorrows.',
    zh: '一个今天，胜过两个明天。',
    source: 'Benjamin Franklin',
  },
  {
    en: 'Curiosity is the wick in the candle of learning.',
    zh: '好奇心是学习这支蜡烛的灯芯。',
    source: 'William Arthur Ward',
  },
  {
    en: 'Small daily improvements are the key to staggering long-term results.',
    zh: '每天进步一点点，是长期惊人成果的关键。',
    source: 'Robin Sharma',
  },
  {
    en: 'Amateurs sit and wait for inspiration; the rest of us just get up and go to work.',
    zh: '业余者坐着等灵感，其余的人起身去干活。',
    source: 'Stephen King',
  },
  {
    en: 'Aim for the moon. Even if you miss, you will land among the stars.',
    zh: '瞄准月亮。即便错过，你也将落在群星之间。',
    source: 'Norman Vincent Peale',
  },
];

/** 当年第几天（1 起；按本地日期计算，与 UTC 无关） */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000) + 1;
}

/**
 * 取「今天」的句子：同一自然日内固定，跨天自动换。
 * 用黄金比步长打散顺序，避免相邻两天撞到语义相近的句子。
 */
export function getDailyQuote(date: Date = new Date()): DailyQuote {
  const total = DAILY_QUOTES.length;
  const index = Math.floor(dayOfYear(date) * 149) % total;
  return DAILY_QUOTES[index];
}

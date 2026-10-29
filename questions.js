// Question ideas for the Ask tab's "i" button: ten topics, fifteen questions each. Ten show per topic; one asked from the
// chat (or already asked before) drops out and the next one in the list takes its place. Copied verbatim to
// kundli-public/questions.js because the public site cannot import from frontend/src/.
export const QUESTION_TOPICS = [
  ['Career and job', [
    'Will I get a promotion this year?', 'When is a good time to change my job?', 'Which career suits me best?', 'Will I get a government job?',
    'Is this a good time to ask for a raise?', 'Should I take up a job offer in another city?', 'Will I get a job abroad?', 'How will my career grow over the next 5 years?',
    'Will I have problems with my boss or colleagues?', 'Is a job or a business better for me?', 'When will I get a stable job?', 'Will I get success in competitive exams?',
    'Is this a good time to switch fields completely?', 'Will I get recognition and respect at work?', 'When will my career peak?'],
  ],
  ['Business', [
    'How will my business perform this year?', 'Is this a good time to start a new business?', 'Which business suits me best?', 'Should I take a partner in my business?',
    'Will my business grow or shrink in the next 2 years?', 'Is this a good time to expand my business?', 'Will I face losses or legal trouble in business?', 'When will my business see its best period?',
    'Is it a good time to take a business loan?', 'Should I start a business in my own name or with family?', 'Will my current partnership last?', 'Which direction should my shop or office face?',
    'Is this a good time to launch a new product?', 'Will I be able to clear my business debts?', 'Should I sell my business?'],
  ],
  ['Money and wealth', [
    'Will I have financial gains this year?', 'When will my financial problems end?', 'Will I become wealthy?', 'Is this a good time to invest in the stock market?',
    'Is this a good time to invest in gold or real estate?', 'Will I get an inheritance?', 'Will I be able to clear my loans?', 'When is a good time to take a loan?',
    'Will I get sudden gains or a windfall?', 'Which months this year are best for money?', 'Will I be able to save well?', 'Should I lend money to someone I know?',
    'Is a lottery or speculation good for me?', 'When will my income grow?', 'Will I have money worries in old age?'],
  ],
  ['Marriage and relationships', [
    'When will I get married?', 'How will my married life be?', 'Will I have a love marriage or an arranged marriage?', 'What kind of life partner will I get?',
    'Is the person I am seeing right for me?', 'Will there be delays in my marriage?', 'Will my relationship with my partner improve?', 'Is there a chance of separation or divorce?',
    'Will I find love this year?', 'Is this a good time to propose?', 'Will I marry someone from my own community?', 'Will my spouse support my career?',
    'Is a second marriage indicated?', 'How will my in-laws be with me?', 'Which period is best for my marriage?'],
  ],
  ['Family and children', [
    'Will I have children?', 'When is a good time to plan a child?', 'Will my child do well in life?', 'How will my relationship with my parents be?',
    'Will there be disputes in my family?', 'How will my relationship with my brothers and sisters be?', 'Will my children study abroad?', 'Is this a good time to expand my family?',
    'Will my parents have good health?', 'Will there be a celebration in the family this year?', 'Will I get support from my family?', 'Will there be a property dispute in the family?',
    'How will my relationship with my children be?', 'Will my child get a good marriage?', 'Will I become a grandparent?'],
  ],
  ['Health', [
    'How is my health expected to be?', 'Which health problems should I be careful about?', 'Will I recover from my current illness?', 'Is any surgery indicated?',
    'Which period needs the most care for my health?', 'Will I have good energy and stamina?', 'How will my mental peace be?', 'Is there a risk of accidents?',
    'Will I have problems with sleep or stress?', 'Is this a good time for a medical procedure?', 'Which foods or habits help me?', 'Will my weight come under control?',
    'How will my health be in old age?', 'Will my family member recover soon?', 'Are there any chronic issues I should look at early?'],
  ],
  ['Education', [
    'Will I do well in my studies?', 'Which stream should I choose after school?', 'Will I get into a good college?', 'Should I study abroad?',
    'Will I clear my competitive exam?', 'When is a good time to start higher studies?', 'Is research or teaching right for me?', 'Will my child study well?',
    'Which subject suits me best?', 'Will I get a scholarship?', 'Is this a good time to do a professional course?', 'Will I get a degree in my chosen field?',
    'Should I change my course?', 'Will I succeed in an interview?', 'When will my education bring results?'],
  ],
  ['Property and vehicles', [
    'Is this a good time to buy a house or property?', 'Will I own my own home?', 'Is this a good time to buy a vehicle?', 'Should I buy a flat or a plot?',
    'Which direction is good for my house?', 'Is this a good time to sell my property?', 'Will I face legal trouble over a property?', 'Should I rent or buy?',
    'Is this a good time to shift to a new house?', 'Will I get ancestral property?', 'Will I be able to build my own house?', 'Is this a good time to renovate?',
    'Will I gain from a land deal?', 'Which city suits me for settling down?', 'Will I buy more than one property?'],
  ],
  ['Travel and foreign', [
    'Will I settle abroad?', 'When will I travel abroad?', 'Is this a good time to move to another country?', 'Will I get a visa?',
    'Will foreign travel help my career?', 'Is a foreign education good for me?', 'Will I come back to India?', 'Which country suits me best?',
    'Will I travel for pilgrimage?', 'Is a long journey good for me this year?', 'Will I get an overseas job offer?', 'Is it a good time to invest abroad?',
    'Will I move to another city soon?', 'Will my child settle abroad?', 'Will my business grow with foreign clients?'],
  ],
  ['Remedies and spiritual life', [
    'What remedies will help me the most right now?', 'Which gemstone suits me?', 'Which mantra should I chant?', 'Which day should I fast on?',
    'Which deity should I worship?', 'Is there any dosha in my chart?', 'Am I going through Sade Sati?', 'What does my current dasha mean for me?',
    'Which colours are lucky for me?', 'Which numbers are lucky for me?', 'Is this a good time to start a spiritual practice?', 'What donations will help me?',
    'Which temple should I visit?', 'What is my life purpose according to my chart?', 'Which period of my life is the strongest?'],
  ],
];

/** Ten questions per topic that have not been asked yet (asked = the list of past question texts). */
export function ideasFor(asked) {
  const done = asked.map((q) => q.toLowerCase());
  // A question counts as asked when it sits inside any past question, so ideas joined into one message drop out too.
  return QUESTION_TOPICS.map(([topic, list]) => [topic, list.filter((q) => !done.some((d) => d.includes(q.toLowerCase()))).slice(0, 10)]).filter(([, l]) => l.length);
}

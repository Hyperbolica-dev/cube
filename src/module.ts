export const moduleMeta = {
  id: 'cube',
  languages: ['en', 'zh-CN'],
  text: {
    en: {
      title: 'Three-ring cube',
      description: 'Explore a real 2×2×2 cube through three rings: drag, turn, scramble, and undo.',
    },
    'zh-CN': {
      title: '三环魔方',
      description: '用三个圆环探索真实的 2×2×2 魔方：自由拖动、旋转、打乱与撤销。',
    },
  },
} as const;

export type CubeLanguage = typeof moduleMeta.languages[number];

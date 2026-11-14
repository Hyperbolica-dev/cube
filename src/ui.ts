import type { Color, Face } from './cube.ts';
import type { CubeLanguage } from './module.ts';

interface CubeText {
  region: string;
  reference: string;
  fixed: string;
  diagram: string;
  diagramTitle: string;
  pairs: string;
  identities: string;
  generators: string;
  heading: string;
  instructions: string;
  undo: string;
  scramble: string;
  reset: string;
  animation: string;
  moves: string;
  history: string;
  hint: string;
  summary: string;
  states: string;
  noScript: string;
  solved: string;
  unsolved: string;
  initial: string;
  failed: string;
  snappedBack: string;
  cancelled: string;
  resetDone: string;
  colors: Record<Color, string>;
  moveLabel: (face: Face, inverse: boolean) => string;
  cubie: (id: string, colors: string[], slot: string, orientation: number) => string;
  performed: (move: string, status: string) => string;
  dragging: (ring: string, steps?: string) => string;
  snapped: (move: string, steps: number, status: string) => string;
  undone: (move: string, status: string) => string;
  scrambled: (status: string) => string;
}

export const cubeText: Record<CubeLanguage, CubeText> = {
  en: {
    region: 'Interactive three-ring cube',
    reference: 'Fixed reference corner H',
    fixed: 'Fixed H',
    diagram: 'Three-ring cube. Drag either way around a ring, turn multiple steps, and release to snap to the nearest slot.',
    diagramTitle: 'A 2×2×2 cube represented by three rings',
    pairs: 'Red ↔ orange · White ↔ yellow · Blue ↔ green',
    identities: 'Show identities',
    generators: 'Turn generators',
    heading: 'Drag along a ring',
    instructions: 'Drag either way along a ring. Reverse direction or turn multiple steps without lifting. Release to snap immediately to the nearest slot, without a finishing animation.',
    undo: 'Undo one step',
    scramble: 'Scramble × 20',
    reset: 'Reset to solved',
    animation: 'Animate button turns',
    moves: 'Moves made',
    history: 'Move history',
    hint: 'Drag with either mouse button. A click still turns clockwise with the left button, counterclockwise with the right. Use the buttons or focus this region and press F / U / R; hold Shift to reverse. Ring labels also accept Enter or Space.',
    summary: 'Position × orientation · H fixed',
    states: '7! × 3⁶ = 3,674,160 legal states',
    noScript: 'Enable JavaScript to interact with the three-ring cube.',
    solved: 'Solved',
    unsolved: 'Unsolved',
    initial: 'Solved · Drag around a ring and release to snap',
    failed: 'The operation failed. Reset the cube and try again.',
    snappedBack: 'Snapped back · No move made',
    cancelled: 'Drag cancelled; the state is unchanged',
    resetDone: 'Reset to the solved state',
    colors: { red: 'red', white: 'white', blue: 'blue', yellow: 'yellow', orange: 'orange', green: 'green' },
    moveLabel: (face, inverse) => `${face}: ${inverse ? 'counterclockwise' : 'clockwise'} quarter turn`,
    cubie: (id, colors, slot, orientation) => `Corner ${id} · ${colors.join(', ')} · Slot ${slot} · Orientation ${orientation}`,
    performed: (move, status) => `Turned ${move} · ${status}`,
    dragging: (ring, steps) => `${ring} · ${steps === undefined ? 'Drag freely either way' : `${steps} steps`} · Release to snap`,
    snapped: (move, steps, status) => `Snapped · ${move} × ${steps} · ${status}`,
    undone: (move, status) => `Undid ${move} · ${status}`,
    scrambled: status => `Scrambled with 20 random turns · ${status}`,
  },
  'zh-CN': {
    region: '三环魔方交互区',
    reference: '固定参考角块 H',
    fixed: '固定 H',
    diagram: '三环魔方，沿圆周自由双向拖动，可连续转多步，松开吸附到最近槽位',
    diagramTitle: '2×2×2 魔方二维三环表示',
    pairs: '红 ↔ 橙　白 ↔ 黄　蓝 ↔ 绿',
    identities: '显示身份',
    generators: '旋转生成元',
    heading: '沿环拖动',
    instructions: '按住圆周自由顺拖、逆拖，可中途反向、连续转多步。松开直接吸附到最近槽位，不补播动画。',
    undo: '撤销一步',
    scramble: '随机打乱 × 20',
    reset: '重置还原态',
    animation: '启用按钮旋转动画',
    moves: '已执行步数',
    history: '操作记录',
    hint: '左右键均可自由拖动；点按仍为左顺、右逆。也可使用按钮，或聚焦此交互区后按 F / U / R；Shift 为逆转。圆环标签也支持回车或空格。',
    summary: '位置 × 取向 · H 固定',
    states: '7! × 3⁶ = 3,674,160 个合法状态',
    noScript: '请启用 JavaScript 以操作三环魔方。',
    solved: '已还原',
    unsolved: '未还原',
    initial: '已还原 · 沿圆周拖动，松开吸附',
    failed: '操作失败，请重置后重试',
    snappedBack: '已吸附回原位 · 未执行操作',
    cancelled: '拖动已取消，状态未改变',
    resetDone: '已重置到还原态',
    colors: { red: '红', white: '白', blue: '蓝', yellow: '黄', orange: '橙', green: '绿' },
    moveLabel: (face, inverse) => `${face} ${inverse ? '逆转' : '正转'}四分之一圈`,
    cubie: (id, colors, slot, orientation) => `角块 ${id} · ${colors.join('')} · 槽位 ${slot} · 取向 ${orientation}`,
    performed: (move, status) => `已执行 ${move} · ${status}`,
    dragging: (ring, steps) => `${ring} · ${steps === undefined ? '自由沿环拖动' : `${steps} 步`} · 松开吸附`,
    snapped: (move, steps, status) => `已吸附 · ${move} × ${steps} · ${status}`,
    undone: (move, status) => `已撤销 ${move} · ${status}`,
    scrambled: status => `已随机执行 20 步 · ${status}`,
  },
};

// All strings originate in the dictionaries above; no host content is interpolated.
export function cubeMarkup(language: CubeLanguage): string {
  const t = cubeText[language];
  const controls = (['F', 'U', 'R'] as const).map((face, index) => `
    <div class="move-row">${[false, true].map(inverse => `
      <button type="button" data-move="${face}${inverse ? "'" : ''}" aria-label="${t.moveLabel(face, inverse)}" title="${t.moveLabel(face, inverse)}"><small aria-hidden="true">${['α', 'β', 'γ'][index]}</small>${face}${inverse ? '′' : ''}</button>`).join('')}
    </div>`).join('');
  return `
    <div class="workspace">
      <div class="stage">
        <div class="stage-top"><span>${t.reference}</span><span data-cube="badge" data-solved="true">${t.solved}</span></div>
        <svg data-cube="diagram" viewBox="0 0 680 540" role="group" aria-label="${t.diagram}"><title>${t.diagramTitle}</title></svg>
        <div class="stage-bottom"><span>${t.pairs}</span><label><input data-cube="identities" type="checkbox" checked /> ${t.identities}</label></div>
      </div>
      <aside class="panel" aria-label="${t.generators}">
        <div class="eyebrow">${t.generators}</div><h2>${t.heading}</h2><p class="muted">${t.instructions}</p>
        <div class="controls">${controls}</div>
        <div class="tools"><button type="button" data-cube="undo" disabled>${t.undo}</button><button type="button" data-cube="scramble">${t.scramble}</button><button type="button" data-cube="reset">${t.reset}</button></div>
        <label class="setting"><input data-cube="animation" type="checkbox" checked /> ${t.animation}</label>
        <div class="readout"><span>${t.moves}</span><strong data-cube="count">0</strong></div>
        <p data-cube="status" role="status" aria-live="polite">${t.initial}</p>
        <div class="history"><span class="eyebrow">${t.history}</span><p data-cube="history">—</p></div>
        <p class="hint">${t.hint}</p>
      </aside>
    </div>
    <div class="summary"><span>${t.summary}</span><span>${t.states}</span></div>`;
}

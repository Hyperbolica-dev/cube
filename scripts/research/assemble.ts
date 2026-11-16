import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IDS, CUBIE_COLORS, solvedState, isSolved, assertLegal, type CubeState } from '../../src/cube.ts';
import { BASE_ANGLES } from '../../src/layout.ts';
import { effect, execute, inverse, parse, format, simplify, conjugate, record, type Word } from './algebra.ts';
import { createMethod, P, T, S, type Method } from './methods.ts';
import { STATES, PERMUTATIONS, ORIENTATIONS, unrankPermutation, unrankOrientation } from './codec.ts';
import { isObject, readObject, isOperation, isStage, type TransversalRow as Row, type StabilizerStage as Stage } from './artifacts.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const commutators = readObject(root + 'research/commutators.json');
const chain = readObject(root + 'research/stabilizers.json');
const strategies = readObject(root + 'research/strategies.json');
assert.ok(isObject(commutators.search));
assert.equal(commutators.search.completedDeclaredFamilies, true); assert.equal(commutators.search.cutoff, null);
assert.ok(isObject(commutators.highlights) && isOperation(commutators.highlights.cleanThreeCycle));
assert.ok(isObject(chain.chain));
assert.equal(chain.chain.complete, true); assert.equal(chain.chain.orbitProduct, STATES);
assert.ok(Array.isArray(chain.chain.stages) && chain.chain.stages.every(isStage));
assert.ok(typeof strategies.modelSha256 === 'string' && /^[a-f0-9]{64}$/.test(strategies.modelSha256));
assert.ok(Array.isArray(strategies.strategies));
const hub = createMethod('hub-hinges'), leaf = createMethod('leaf-buffer');
const finalStage = chain.chain.stages.find(stage => stage.base === 'C')!;
const swap = parse(finalStage.transversals.find(row => row.cornerState[0] === 'A' && row.cornerState[1] === 0)!.sequence);
const pairTwist = conjugate(hub.twistPreparations.get('2')!.word, T);
const swapEffect = effect(swap), twistEffect = effect(pairTwist);
assert.deepEqual(swapEffect.destination, [2, 1, 0, 3, 4, 5, 6, 7]);
assert.ok(swapEffect.twist.every(t => t === 0));
assert.deepEqual(twistEffect.twist, [2, 0, 1, 0, 0, 0, 0, 0]);
assert.ok(twistEffect.destination.every((p, source) => p === source));
const finalWords = [[], swap, pairTwist, inverse(pairTwist), [...pairTwist, ...swap], [...inverse(pairTwist), ...swap]] as Word[];
const finalRows: Row[] = finalWords.map(word => {
  const r = record(word, 'improved-final-pair-transversal', 'C0 to the listed state; fix B,D,E,F,G,H.');
  const e = effect(word);
  return { ...r, cornerState: [IDS[e.destination[2]], e.twist[2]] };
});
assert.equal(new Set(finalRows.map(row => row.cornerState.join(','))).size, 6);
const improvedStages = chain.chain.stages.map(stage => stage.base === 'C' ? { ...stage, transversals: finalRows } : stage);

function chainSolve(stages: Stage[], initial: CubeState) {
  let state = initial;
  const word: Word = [];
  for (const stage of stages) {
    const id = IDS.indexOf(stage.base as typeof IDS[number]), slot = state.cubieAt.indexOf(id), orientation = state.orientationAt[slot];
    const row = stage.transversals.find(row => row.cornerState[0] === IDS[slot] && row.cornerState[1] === orientation);
    assert.ok(row);
    const correction = inverse(parse(row.sequence));
    word.push(...correction);
    state = execute(state, correction);
    assertLegal(state);
    for (const protectedId of [...stage.protected, stage.base]) {
      const p = IDS.indexOf(protectedId as typeof IDS[number]);
      assert.equal(state.cubieAt[p], p); assert.equal(state.orientationAt[p], 0);
    }
  }
  assert.ok(isSolved(state));
  return word;
}
function chainStatistics(stages: Stage[], id: string) {
  // Unique stabilizer-chain decomposition: all Cartesian combinations of rows
  // occur exactly once. Cost convolution therefore gives exact uniform-state stats.
  let histogram = [1];
  for (const stage of stages) {
    const costs = stage.transversals.map(row => parse(row.sequence).length);
    const next = Array(histogram.length + Math.max(...costs)).fill(0) as number[];
    histogram.forEach((count, cost) => { for (const increment of costs) next[cost + increment] += count; });
    histogram = next;
  }
  const count = histogram.reduce((a, b) => a + b, 0);
  assert.equal(count, STATES);
  const maximum = histogram.length - 1;
  const longest = stages.map(stage => stage.transversals.reduce((a, b) => parse(a.sequence).length >= parse(b.sequence).length ? a : b));
  const worstState = execute(solvedState(), [...longest].reverse().flatMap(row => parse(row.sequence)));
  const worstWord = chainSolve(stages, worstState);
  assert.equal(worstWord.length, maximum, 'Maximum must have an actual official-replayed witness');
  let seed = 0x63756265, sampleTotal = 0, sampleMax = 0, simplifiedTotal = 0;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
  for (let sample = 0; sample < 2000; sample++) {
    const p = random() % PERMUTATIONS, o = random() % ORIENTATIONS;
    const word = chainSolve(stages, { cubieAt: unrankPermutation(p), orientationAt: unrankOrientation(o) });
    sampleTotal += word.length; sampleMax = Math.max(sampleMax, word.length); simplifiedTotal += simplify(word).length;
  }
  return { id, coverage: { states: count, type: 'Complete stabilizer closure certificates and unique coset decomposition; cost convolution, not raw word replay of every state' },
    cost: { mean: histogram.reduce((sum, n, cost) => sum + n * cost, 0) / count, maximum, histogram, metric: 'QTM, no cross-stage cancellation' },
    randomOfficialReplay: { seed: '0x63756265', count: 2000, mean: sampleTotal / 2000, maximum: sampleMax, meanAfterCrossStageSimplification: simplifiedTotal / 2000, successRate: 1 },
    worstExample: { ...worstState, executionLength: worstWord.length, sequenceAfterCrossStageSimplification: format(worstWord), simplifiedLength: simplify(worstWord).length },
  };
}
const chainResults = [chainStatistics(chain.chain.stages, 'full-stabilizer-chain'), chainStatistics(improvedStages, 'stabilizer-with-pair-twist-tail')];
const selected: { id: string; word: Word; structure: string; use: string }[] = [
  { id: 'S', word: S, structure: '[F,U]', use: '基础相消骨架；自身是双换位，不是三循环。' },
  { id: 'P', word: P, structure: '[S,R]', use: '工作台 A→B→C→A；只保护这三个槽位之外的完整状态。' },
  { id: 'T', word: T, structure: '[S²,R\u2032]', use: '工作台 A−1、D+1；所有位置不变。' },
  { id: 'clean-3-cycle', word: parse(commutators.highlights.cleanThreeCycle.sequence), structure: '[F²,[R,U\u2032]]', use: '零取向增量的 A→B→G→A，用于区分净三循环和干净三循环。' },
  { id: 'X', word: parse("F U F U' R' F' R"), structure: '7 个四分之一转', use: '最后 A/B/C 区域；交换 B/C，同时扭 A/B。' },
  { id: 'Y', word: parse("F' R' F R U F U'"), structure: '7 个四分之一转', use: '最后 A/B/C 区域；交换 A/C，同时扭 B/C。' },
  { id: 'Z', word: parse("F' U F R U R' U'"), structure: '7 个四分之一转', use: '最后 A/B/C 区域；交换 A/B，三者均加 1。' },
  { id: 'a', word: swap, structure: 'Z Y⁻¹ X⁻¹，约简后 19 QTM', use: '完整保护 B/D/E/F/G/H 的干净 A/C 换位；不能只用交换子构成这个奇置换。' },
  { id: 'c', word: pairTwist, structure: '(R\u2032 F\u2032) T (F R)，约简后 20 QTM', use: '完整保护 B/D/E/F/G/H 的 A−1、C+1，缩短稳定子链的最后收尾。' },
];
const localOperations = {
  schemaVersion: 1, model: { source: 'src/cube.ts', sha256: strategies.modelSha256 },
  convention: { execution: 'left to right', destination: 'source p goes to destination[p]', sourceTwist: 'add to the old orientation at source p, then deposit at destination[p]', qtm: 'F/U/R and inverse cost 1; half turn costs 2' },
  qualityAssessment: 'Memory/recognition assessments are structural judgments, not measured human-study results; no global shortest-word claim.',
  operations: selected.map(({ id, word, structure, use }) => {
    const { orientation, ...r } = record(word, 'curated-human-basis', use);
    return { id, structure, ...r, sourceTwist: orientation, inverseSequence: format(inverse(word)), recognition: use,
      reversibility: 'Reverse block order and invert every move; K⁻¹ undoes preparation.', reuse: id === 'P' || id === 'T' ? 'Conjugate using the generated preparation tables.' : 'Reference or advanced last-three/last-pair operation.' };
  }),
};
const summary = { schemaVersion: 1, modelSha256: strategies.modelSha256, costMetric: 'QTM, normalized within a macro/stage, no cancellation across macro/stage boundaries; not optimal distances',
  strategies: [...strategies.strategies, ...chainResults],
  improvedTail: { protected: ['B', 'D', 'E', 'F', 'G', 'H'], transversals: finalRows, finalPairMaxQTM: 39,
    reasoning: 'A clean swap a and pair twist c generate the six last-pair states; replacing the previous a/b table is a local improvement, not a shortest-path solver.' },
};
mkdirSync(root + 'research', { recursive: true });
mkdirSync(root + 'docs', { recursive: true });
writeFileSync(root + 'research/local-operations.json', JSON.stringify(localOperations, null, 2) + '\n');
writeFileSync(root + 'research/summary.json', JSON.stringify(summary, null, 2) + '\n');

function matrix(method: Method): string {
  const slots = IDS.slice(0, 7).filter((_, p) => p !== method.hub);
  const lines = [`| u \\ v | ${slots.join(' | ')} |`, `| --- | ${slots.map(() => '---').join(' | ')} |`];
  for (const u of slots) {
    const values = slots.map(v => {
      if (u === v) return '—';
      const tuple = [IDS.indexOf(u), IDS.indexOf(v)];
      const tracked = method.hub === 0 ? tuple : [method.hub, ...tuple];
      const word = method.pairPreparations.get(tracked.join(','))!.word;
      return word.length ? '`' + format(word) + '`' : '空';
    });
    lines.push(`| ${u} | ${values.join(' | ')} |`);
  }
  return lines.join('\n');
}
const lines = ['# 复原准备表（程序生成）', '', '由 `npm run research` 生成；不要手动维护公式。所有序列从左到右执行。F 是生成元时指 α 环，槽位 F 是右上角位置，两者不要混淆。', '',
  '## G 缓冲：位置阶段的 K', '', '行 u、列 v：K 把 G、u、v 分别送到工作台 A、B、C。执行 `K P K⁻¹` 后净循环为 `(G u v)`；其他槽位完整恢复。', '', matrix(leaf), '',
  '## G 缓冲：取向阶段的 K', '', '| 目标槽位 p | K（把 G→A、p→D） |', '| --- | --- |'];
for (const p of leaf.orientationOrder) lines.push(`| ${IDS[p]} | \`${format(leaf.twistPreparations.get([leaf.hub, p].join(','))!.word)}\` |`);
lines.push('', '执行 `K T K⁻¹` 使 p 加 1、G 减 1；需要减 1 时用 `K T⁻¹ K⁻¹`。', '', '## A 枢纽变体：位置阶段的 K', '', '行 u、列 v：K 位置固定 A，并把 u→B、v→C。K 只由三对双步接力拼成：`UF ↔ F′U′`、`FR ↔ R′F′`、`RU ↔ U′R′`。它们不保证 A 的取向不变。', '', matrix(hub), '', '## A 枢纽变体：取向阶段的 K', '', '| 目标槽位 p | K（A 仍在 A，p→D） |', '| --- | --- |');
for (const p of hub.orientationOrder) { const word = hub.twistPreparations.get(String(p))!.word; lines.push(`| ${IDS[p]} | ${word.length ? '`' + format(word) + '`' : '空'} |`); }
lines.push('', '## 改良稳定子链：最后的 C', '', '这一表只在 B、D、E、F、G、H 均完整复原后使用。a=干净 A/C 换位；c= A−1、C+1。找到角块 C 当前的槽位及取向，执行下列**修正**（不是准备）即可结束。', '', '| C 当前状态 | 从 C0 出发的代表 | 应执行的修正 | QTM |', '| --- | --- | --- | --- |');
const symbolic = ['e', 'a', 'c', 'c⁻¹', 'c a', 'c⁻¹ a'];
const corrections = ['空', 'a', 'c⁻¹', 'c', 'a c⁻¹', 'a c'];
finalRows.forEach((row, i) => lines.push(`| ${row.cornerState.join(' / ')} | ${symbolic[i]} | ${corrections[i]} | ${row.length} |`));
lines.push('', '完整稳定子链前五阶段的 75 个轨道代表（含恒等项），见 `research/stabilizers.json` 的 `chain.stages`；每阶段按角块当前位置和取向选行，再执行该行序列的逆。不要将这些表描述为无需识别或无需记忆的初学公式。', '');
writeFileSync(root + 'docs/solving-setup-tables.md', lines.join('\n'));
for (const result of chainResults) console.log(`${result.id}: exact uniform mean ${result.cost.mean.toFixed(6)} QTM, max ${result.cost.maximum}; ${result.randomOfficialReplay.count} official paired-state replays passed`);
console.log(`Catalog: ${localOperations.operations.length} curated full effects; generated human preparation tables.`);

assert.ok(CUBIE_COLORS.every(colors => colors[0] === 'white' || colors[0] === 'yellow'), 'Orientation clock requires a white/yellow first-color reference');
const clockHour = (angle: number) => (((angle + 90) / 30 % 12 + 12) % 12) || 12;
const orientationLines = [
  '# 取向识别表（程序生成）', '',
  '由正式模型的局部坐标定义及 `src/layout.ts` 的 `BASE_ANGLES` 导出。每块的第 0 色是白或黄；只看当前角块的白/黄叶片，按它当前所在槽位查表，不按它的身份查。钟点指叶片中心方向，12 点是屏幕正上方。', '',
  '| 当前槽位 | o=0 | o=1 | o=2 |', '| --- | --- | --- | --- |',
  ...IDS.map((id, p) => `| ${id} | ${clockHour(BASE_ANGLES[p])} 点 | ${clockHour(BASE_ANGLES[p] + 120)} 点 | ${clockHour(BASE_ANGLES[p] + 240)} 点 |`), '',
  'H 固定为参考，合法操作中只出现 H 的 o=0。取向加 1 表示三叶图案顺时针转 120°；这与圆环公转步数不同。槽位名称由还原态定义，不随角块身份字母一起移动。', '',
];
writeFileSync(root + 'docs/solving-orientation-reference.md', orientationLines.join('\n'));
const chainLines = ['# 稳定子复原修正表（程序生成）', '', '从 G、F、D、E、B 依次处理；观察目标角块当前槽位及白/黄叶片取向，执行表中的**修正**。取向读法见 `solving-orientation-reference.md`。每行执行完才算一个保护边界；中途允许已完成角块被临时搬动。', ''];
for (const stage of chain.chain.stages.slice(0, 5)) {
  chainLines.push(`## 复原 ${stage.base}；已保护 ${stage.protected.join('、') || '无'}`, '', '| 目标角块当前槽位 | 当前 o | 应执行的修正（从左到右） | QTM |', '| --- | --- | --- | --- |');
  for (const row of stage.transversals) {
    const correction = format(inverse(parse(row.sequence)));
    chainLines.push(`| ${row.cornerState[0]} | ${row.cornerState[1]} | ${correction ? '`' + correction + '`' : '空'} | ${row.length} |`);
  }
  chainLines.push('');
}
chainLines.push('## 最后 C 与 A', '', `前五块均完整复原后，按 \`solving-setup-tables.md\` 的最后六行使用 a/c 收尾；A 的状态随后被位置与取向和约束强制还原。此改良表的全程最坏为 ${chainResults[1].cost.maximum} QTM，均匀合法状态平均为 ${chainResults[1].cost.mean.toFixed(6)} QTM。计数按表中每个宏内部约简，不跨阶段抵消；不是最短距离或人类实测成绩。`, '');
writeFileSync(root + 'docs/solving-stabilizer-tables.md', chainLines.join('\n'));

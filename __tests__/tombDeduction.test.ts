import {
  assessClues,
  extractTrustStatements,
  TRUSTED_QUOTES,
} from '@/lib/tomb/deduction';
import {
  createDialogueState,
  askNpc,
} from '@/lib/tomb/dialogueEngine';
import { DIALOGUE } from '@/lib/tomb/dialogue';

/** 造一份「某人说过了某句」的问答记录 */
function logsOf(entries: Array<[string, string]>): Record<string, { answer: string }[]> {
  const logs: Record<string, { answer: string }[]> = {};
  for (const [who, answer] of entries) {
    logs[who] = [...(logs[who] ?? []), { answer }];
  }
  return logs;
}

describe('关键词证词 × 线索交叉验证', () => {
  test('没有可信证词时，所有线索都是「真伪待验证」', () => {
    const statements = extractTrustStatements(logsOf([['xiaoyuan', '我不清楚这件事。']]));
    expect(statements).toHaveLength(0);
    const assessed = assessClues(['artifact', 'crevice', 'mural'], statements);
    expect(assessed.every((item) => item.verdict === 'unverified')).toBe(true);
  });

  test('拿到「高教授和我，是确定的好人」后，能判定碎片2为伪造', () => {
    const statements = extractTrustStatements(
      logsOf([['xiaoyuan', '高教授和我，是确定的好人。']]),
    );
    const assessed = assessClues(['artifact'], statements);
    expect(assessed[0].verdict).toBe('forged');
    expect(assessed[0].reason).toContain('矛盾');
  });

  test('同一条证词同时判定碎片4为伪造', () => {
    const statements = extractTrustStatements(
      logsOf([['xiaoyuan', '高教授和我，是确定的好人。']]),
    );
    const assessed = assessClues(['crevice'], statements);
    expect(assessed[0].verdict).toBe('forged');
  });

  test('没有「三真两假」这条证词时，其余线索仍待验证', () => {
    const statements = extractTrustStatements(
      logsOf([['xiaoyuan', '高教授和我，是确定的好人。']]),
    );
    const assessed = assessClues(['artifact', 'mural', 'rubble'], statements);
    expect(assessed.map((item) => item.verdict)).toEqual([
      'forged',
      'unverified',
      'unverified',
    ]);
  });

  test('凑齐两条伪造 + 「三真两假」后，其余线索反推为真', () => {
    const statements = extractTrustStatements(
      logsOf([
        ['xiaoyuan', '高教授和我，是确定的好人。'],
        ['xiaoyuan', '古墓遗留线索一共五条，三真两假。'],
      ]),
    );
    const assessed = assessClues(['artifact', 'crevice', 'mural', 'rubble', 'gategap'], statements);
    const byId = Object.fromEntries(assessed.map((item) => [item.clueId, item.verdict]));
    expect(byId.artifact).toBe('forged');
    expect(byId.crevice).toBe('forged');
    expect(byId.mural).toBe('genuine');
    expect(byId.rubble).toBe('genuine');
    expect(byId.gategap).toBe('genuine');
  });

  test('高教授的证词也能作为可信基准', () => {
    const statements = extractTrustStatements(
      logsOf([['gao', '古墓的线索被动过手脚，真假混杂。']]),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0].source).toBe('gao');
  });

  test('伪人 / 随机身份角色的话不会被当成可信证词', () => {
    const statements = extractTrustStatements(
      logsOf([
        ['xiaolin', '高教授和我，是确定的好人。'],
        ['aze', '古墓遗留线索一共五条，三真两假。'],
      ]),
    );
    expect(statements).toHaveLength(0);
  });

  test('每条可信证词都能对应到对话数据库里的原文', () => {
    const pools = Object.values(DIALOGUE).map((entry) => entry.good as { task: string[] });
    const taskLines = pools.flatMap((pool) => pool.task);
    for (const item of TRUSTED_QUOTES) {
      expect(taskLines).toContain(item.quote);
    }
  });
});

describe('固定好人的台词抽取方式', () => {
  test('小远「固定全部真话」：按顺序轮转，问满一轮拿到全部 6 句', () => {
    const state = createDialogueState();
    const answers: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      answers.push(askNpc('xiaoyuan', false, '你是伪人吗', state).text);
    }
    const pool = (DIALOGUE.xiaoyuan.good as { task: string[] }).task;
    expect(new Set(answers).size).toBe(pool.length);
    expect([...answers].sort()).toEqual([...pool].sort());
  });

  test('小远的每一句都是真话', () => {
    const state = createDialogueState();
    for (let i = 0; i < 6; i += 1) {
      const reply = askNpc('xiaoyuan', false, '伪人在哪', state);
      expect(reply.truth).toBe(true);
      expect(reply.lied).toBe(false);
    }
  });

  test('高教授仍是「随机真话含糊句」，但每句都为真', () => {
    const pool = (DIALOGUE.gao.good as { task: string[] }).task;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const reply = askNpc('gao', false, '伪人在哪');
      expect(reply.truth).toBe(true);
      expect(pool).toContain(reply.text);
      seen.add(reply.text);
    }
    // 随机抽取应该能覆盖到多句
    expect(seen.size).toBeGreaterThan(1);
  });

  test('伪人仍然每次提问独立随机 20% 真话 / 80% 假话', () => {
    const truth = (DIALOGUE.xiaolin.impostor as { truth: string[]; lies: string[] }).truth;
    const lies = (DIALOGUE.xiaolin.impostor as { truth: string[]; lies: string[] }).lies;
    let truthCount = 0;
    const rounds = 4000;
    for (let i = 0; i < rounds; i += 1) {
      const reply = askNpc('xiaolin', true, '你是伪人吗');
      if (reply.truth) {
        truthCount += 1;
        expect(truth).toContain(reply.text);
      } else {
        expect(lies).toContain(reply.text);
      }
    }
    const rate = truthCount / rounds;
    expect(rate).toBeGreaterThan(0.15);
    expect(rate).toBeLessThan(0.25);
  });
});

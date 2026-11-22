import {
  CASUAL_KEYWORDS,
  IMPOSTOR_TRUTH_CHANCE,
  TASK_KEYWORDS,
  askNpc,
  classifyQuestion,
} from '@/lib/tomb/dialogueEngine';
import {
  DIALOGUE,
  type DialoguePools,
  FIXED_GOOD,
  NPC_NAMES,
  RANDOM_ROLE_NPCS,
  type NpcId,
} from '@/lib/tomb/dialogue';
import {
  CLUES,
  REQUIRED_CLUES,
  createInitialState,
  evaluateEnding,
  goodNpcIds,
  type TombState,
} from '@/lib/tomb/rules';

const ALL_NPCS: NpcId[] = [...FIXED_GOOD, ...RANDOM_ROLE_NPCS];

function makeState(overrides: Partial<TombState> = {}): TombState {
  return {
    playerIsImpostor: false,
    impostorIds: ['xiaolin'],
    deadNpcs: [],
    playerKills: [],
    clueIds: [],
    attackedByImpostor: false,
    reachedGate: false,
    identityRevealed: false,
    ...overrides,
  };
}

describe('关键词匹配', () => {
  test('任务核心关键词全部命中任务池', () => {
    for (const keyword of TASK_KEYWORDS) {
      expect(classifyQuestion(`请问${keyword}呢`)).toBe('task');
    }
  });

  test('闲聊私人关键词命中闲聊池', () => {
    for (const keyword of CASUAL_KEYWORDS) {
      expect(classifyQuestion(`聊聊你的${keyword}`)).toBe('casual');
    }
  });

  test('无关键词走默认回复', () => {
    expect(classifyQuestion('今天天气不错')).toBe('default');
    expect(classifyQuestion('')).toBe('default');
    expect(classifyQuestion('   ')).toBe('default');
  });

  test('任务关键词优先于闲聊关键词（同时命中时不下落到闲聊池）', () => {
    expect(classifyQuestion('你的名字是谁')).toBe('task');
    expect(classifyQuestion('你以前在哪里人')).toBe('casual');
    expect(classifyQuestion('你是伪人吗，你以前是做什么的')).toBe('task');
  });
});

describe('角色对话', () => {
  test('固定好人（高教授 / 小远）说任务词时永远为真', () => {
    for (const id of FIXED_GOOD) {
      for (let i = 0; i < 200; i += 1) {
        const reply = askNpc(id, false, '谁是伪人');
        expect(reply.kind).toBe('task');
        expect(reply.lied).toBe(false);
        expect(reply.truth).toBe(true);
        expect((DIALOGUE[id].good as DialoguePools).task).toContain(reply.text);
      }
    }
  });

  test('身份随机且当前为好人时，只说真话池', () => {
    for (const id of RANDOM_ROLE_NPCS) {
      const truthPool = DIALOGUE[id].impostor!.truth;
      for (let i = 0; i < 200; i += 1) {
        const reply = askNpc(id, false, '出口在哪里');
        expect(reply.lied).toBe(false);
        expect(truthPool).toContain(reply.text);
      }
    }
  });

  test('伪人每次提问独立随机：约 20% 真话 / 80% 假话', () => {
    const id: NpcId = 'xiaolin';
    const truthPool = DIALOGUE[id].impostor!.truth;
    const liePool = DIALOGUE[id].impostor!.lies;
    let truthful = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      const reply = askNpc(id, true, '你是伪人吗');
      expect(reply.kind).toBe('task');
      if (reply.truth) {
        truthful += 1;
        expect(truthPool).toContain(reply.text);
      } else {
        expect(liePool).toContain(reply.text);
      }
    }
    const ratio = truthful / samples;
    expect(ratio).toBeGreaterThan(IMPOSTOR_TRUTH_CHANCE - 0.04);
    expect(ratio).toBeLessThan(IMPOSTOR_TRUTH_CHANCE + 0.04);
  });

  test('伪人真话池短、假话池长（这是玩家可利用的分布差异）', () => {
    for (const id of RANDOM_ROLE_NPCS) {
      const pools = DIALOGUE[id].impostor!;
      expect(pools.truth.length).toBeLessThan(pools.lies.length);
      expect(pools.lies.length).toBeGreaterThanOrEqual(20);
    }
  });

  test('闲聊与默认回复不触发真话池', () => {
    for (const id of ALL_NPCS) {
      const casual = askNpc(id, true, '你几岁了');
      expect(casual.kind).toBe('casual');
      expect(casual.lied).toBe(false);
      const fallback = askNpc(id, true, '随便聊聊天气');
      expect(fallback.kind).toBe('default');
      expect(fallback.text).toBeTruthy();
    }
  });
});

describe('开局身份与伪人数量', () => {
  test('高教授与小远永远是好人，永远不会进伪人名单', () => {
    for (let i = 0; i < 500; i += 1) {
      const state = createInitialState();
      for (const fixed of FIXED_GOOD) {
        expect(state.impostorIds).not.toContain(fixed);
      }
    }
  });

  test('伪人总数（含玩家）在 2~4 之间', () => {
    for (let i = 0; i < 500; i += 1) {
      const state = createInitialState();
      const total = state.impostorIds.length + (state.playerIsImpostor ? 1 : 0);
      expect(total).toBeGreaterThanOrEqual(2);
      expect(total).toBeLessThanOrEqual(4);
    }
  });

  test('伪人只会从身份随机的三人里产生', () => {
    for (let i = 0; i < 500; i += 1) {
      const state = createInitialState();
      for (const id of state.impostorIds) {
        expect(RANDOM_ROLE_NPCS).toContain(id);
      }
      expect(new Set(state.impostorIds).size).toBe(state.impostorIds.length);
    }
  });

  test('玩家身份开局随机（好人 / 伪人 各约一半）', () => {
    let impostor = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i += 1) {
      if (createInitialState().playerIsImpostor) impostor += 1;
    }
    const ratio = impostor / samples;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });
});

describe('线索', () => {
  test('共 5 条线索，三真两假', () => {
    expect(CLUES).toHaveLength(5);
    expect(CLUES.filter((clue) => clue.genuine)).toHaveLength(3);
    expect(CLUES.filter((clue) => !clue.genuine)).toHaveLength(2);
    expect(REQUIRED_CLUES).toBe(3);
  });

  test('线索 id 唯一且都带场景位置', () => {
    const ids = CLUES.map((clue) => clue.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const clue of CLUES) {
      expect(clue.location).toBeTruthy();
      expect(clue.text).toBeTruthy();
    }
  });
});

describe('结局判定优先级', () => {
  test('优先级 1：肃清伪人', () => {
    const state = makeState({
      playerIsImpostor: false,
      impostorIds: ['xiaolin', 'aze'],
      clueIds: ['mural', 'rubble', 'gategap'],
      playerKills: ['xiaolin', 'aze'],
      deadNpcs: ['xiaolin', 'aze'],
    });
    expect(evaluateEnding(state, false)).toBe('purge');
  });

  test('优先级 1 需要伪人死于玩家之手，仅仅死亡不够', () => {
    const state = makeState({
      playerIsImpostor: false,
      impostorIds: ['xiaolin', 'aze'],
      clueIds: ['mural', 'rubble', 'gategap'],
      deadNpcs: ['xiaolin', 'aze'],
    });
    expect(evaluateEnding(state, false)).toBeNull();
  });

  test('优先级 1 需要固定好人存活', () => {
    const state = makeState({
      playerIsImpostor: false,
      impostorIds: ['xiaolin'],
      clueIds: ['mural', 'rubble', 'gategap'],
      playerKills: ['xiaolin'],
      deadNpcs: ['xiaolin', 'gao'],
    });
    expect(evaluateEnding(state, false)).not.toBe('purge');
  });

  test('优先级 2：同谋屠戮（玩家是伪人且两位固定好人全灭）', () => {
    const state = makeState({
      playerIsImpostor: true,
      impostorIds: ['xiaolin'],
      deadNpcs: ['gao', 'xiaoyuan'],
    });
    expect(evaluateEnding(state, false)).toBe('accomplice');
  });

  test('优先级 3：自我崩坏（玩家是伪人、集齐 3 条线索、熬到计时结束）', () => {
    const state = makeState({
      playerIsImpostor: true,
      impostorIds: ['xiaolin'],
      clueIds: ['mural', 'rubble', 'gategap'],
    });
    expect(evaluateEnding(state, true)).toBe('collapse');
  });

  test('优先级 3 需要至少 3 条线索（线不够就只是困死）', () => {
    const state = makeState({
      playerIsImpostor: true,
      impostorIds: ['xiaolin'],
      clueIds: ['mural', 'rubble'],
    });
    expect(evaluateEnding(state, true)).toBe('trapped');
  });

  test('伪人集齐线索后不再立刻崩坏，先去石门走表决', () => {
    const state = makeState({
      playerIsImpostor: true,
      impostorIds: ['xiaolin'],
      clueIds: ['mural', 'rubble', 'gategap'],
    });
    expect(evaluateEnding(state, false)).toBeNull();
  });

  test('优先级 4：被伪人清除', () => {
    const state = makeState({
      playerIsImpostor: false,
      impostorIds: ['xiaolin'],
      attackedByImpostor: true,
    });
    expect(evaluateEnding(state, false)).toBe('prey');
  });

  test('优先级 5：线索逃生（好人 + 3 条线索 + 走到石门 + 队里已无伪人）', () => {
    const state = makeState({
      playerIsImpostor: false,
      impostorIds: ['xiaolin'],
      deadNpcs: ['xiaolin'],
      clueIds: ['mural', 'rubble', 'gategap'],
      reachedGate: true,
    });
    expect(evaluateEnding(state, false)).toBe('escape');
  });

  test('优先级 5 需要集齐 3 条线索才能开门', () => {
    const state = makeState({
      playerIsImpostor: false,
      impostorIds: ['xiaolin'],
      clueIds: ['mural', 'rubble'],
      reachedGate: true,
    });
    expect(evaluateEnding(state, false)).toBeNull();
  });

  test('优先级 6：计时结束兜底为困死古墓', () => {
    const state = makeState({ playerIsImpostor: false, impostorIds: ['xiaolin'] });
    expect(evaluateEnding(state, true)).toBe('trapped');
  });

  test('高优先级结局会盖过低优先级（被袭击但已集齐线索并守住石门时先判逃生）', () => {
    const state = makeState({
      playerIsImpostor: false,
      impostorIds: ['xiaolin'],
      clueIds: ['mural', 'rubble', 'gategap'],
      reachedGate: true,
      attackedByImpostor: true,
    });
    // 优先级 4（被清除）在优先级 5（逃生）之前
    expect(evaluateEnding(state, false)).toBe('prey');
  });

  test('什么都没发生时不触发任何结局', () => {
    expect(evaluateEnding(makeState(), false)).toBeNull();
  });
});

describe('好人名单', () => {
  test('好人 = 固定两人 + 随机三人中当前不是伪人的那些', () => {
    const state = makeState({ impostorIds: ['xiaolin', 'laozhang'] });
    const good = goodNpcIds(state);
    expect(good).toContain('gao');
    expect(good).toContain('xiaoyuan');
    expect(good).toContain('aze');
    expect(good).not.toContain('xiaolin');
    expect(good).not.toContain('laozhang');
    expect(good).toHaveLength(3);
  });

  test('每个 NPC 都有中文名', () => {
    for (const id of ALL_NPCS) {
      expect(NPC_NAMES[id]).toBeTruthy();
    }
  });
});

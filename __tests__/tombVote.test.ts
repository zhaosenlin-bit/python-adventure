import {
  CITATION_LIMIT,
  castVotes,
  livingNpcIds,
  playerVoteWeight,
  previewSentiment,
  voteEnding,
  type VoteResult,
} from '@/lib/tomb/vote';
import { CLUE_CHALLENGES, checkSimpleSolution, getCodeChallenge } from '@/lib/tomb/codeChallenges';
import type { TombState } from '@/lib/tomb/rules';
import type { NpcId } from '@/lib/tomb/dialogue';

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

function makeVoteResult(overrides: Partial<VoteResult> = {}): VoteResult {
  return {
    records: [],
    tallies: [],
    condemned: null,
    tieAtTop: false,
    playerBallot: 'abstain',
    playerWeight: 1,
    note: '',
    ...overrides,
  };
}

describe('投票人名单', () => {
  test('活着的 NPC 才进表决席', () => {
    const state = makeState({ deadNpcs: ['aze', 'laozhang'] });
    expect(livingNpcIds(state)).toEqual(['gao', 'xiaoyuan', 'xiaolin']);
  });
});

describe('玩家一票的分量', () => {
  test('没有证据就是 1 票', () => {
    expect(playerVoteWeight([])).toBe(1);
  });

  test('呈堂一条已验真线索 +0.5，两条封顶 2.0', () => {
    expect(playerVoteWeight([{ clueId: 'mural', verdict: 'genuine' }])).toBe(1.5);
    expect(
      playerVoteWeight([
        { clueId: 'mural', verdict: 'genuine' },
        { clueId: 'rubble', verdict: 'genuine' },
      ]),
    ).toBe(2);
  });

  test('呈堂被证伪的线索会掉权重，最低 0.5', () => {
    expect(playerVoteWeight([{ clueId: 'artifact', verdict: 'forged' }])).toBe(0.5);
    expect(
      playerVoteWeight([
        { clueId: 'artifact', verdict: 'forged' },
        { clueId: 'crevice', verdict: 'forged' },
      ]),
    ).toBe(0.5);
  });

  test('待验证线索不给分量', () => {
    expect(playerVoteWeight([{ clueId: 'mural', verdict: 'unverified' }])).toBe(1);
  });

  test('超过上限的呈堂线索不计入', () => {
    const citations = [
      { clueId: 'mural', verdict: 'genuine' as const },
      { clueId: 'rubble', verdict: 'genuine' as const },
      { clueId: 'gategap', verdict: 'genuine' as const },
    ];
    expect(citations.length).toBeGreaterThan(CITATION_LIMIT);
    expect(playerVoteWeight(citations)).toBe(2);
  });
});

describe('票型', () => {
  test('每个人的票都记下来，玩家的票永远最后揭晓', () => {
    const state = makeState();
    const result = castVotes({
      state,
      playerBallot: 'gao',
      citations: [{ clueId: 'mural', verdict: 'genuine' }],
      seed: 2026,
    });
    expect(result.records).toHaveLength(livingNpcIds(state).length + 1);
    expect(result.records[result.records.length - 1].voter).toBe('player');
    expect(result.records[result.records.length - 1].weight).toBe(1.5);
  });

  test('票分之和等于所有票重之和', () => {
    const result = castVotes({ state: makeState(), playerBallot: 'laozhang', seed: 7 });
    const weightSum = result.records.reduce((sum, item) => sum + item.weight, 0);
    const scoreSum = result.tallies.reduce((sum, item) => sum + item.score, 0);
    expect(scoreSum).toBeCloseTo(weightSum, 5);
  });

  test('被票出的人一定是分最高的（或僵局）', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const result = castVotes({ state: makeState({ impostorIds: ['xiaolin', 'aze'] }), playerBallot: 'xiaolin', seed });
      if (!result.condemned) continue;
      const top = result.tallies[0];
      const condemnedTally = result.tallies.find((item) => item.target === result.condemned);
      expect(condemnedTally).toBeTruthy();
      expect(condemnedTally!.score).toBeCloseTo(top.score, 2);
    }
  });

  test('同一局面同一种子，票型完全可复现', () => {
    const state = makeState({ impostorIds: ['xiaolin', 'laozhang'], playerKills: ['aze'], deadNpcs: ['aze'] });
    const a = castVotes({ state, playerBallot: 'xiaolin', seed: 99 });
    const b = castVotes({ state, playerBallot: 'xiaolin', seed: 99 });
    expect(a.records).toEqual(b.records);
    expect(a.condemned).toBe(b.condemned);
  });
});

describe('伪人的投票行为', () => {
  test('伪人绝不投同类（含玩家是伪人的情况）', () => {
    const impostors: NpcId[] = ['xiaolin', 'aze', 'laozhang'];
    for (let seed = 1; seed <= 80; seed += 1) {
      const result = castVotes({
        state: makeState({ impostorIds: impostors, playerIsImpostor: true }),
        playerBallot: 'gao',
        seed,
      });
      for (const record of result.records) {
        if (record.voter === 'player') continue;
        if (!impostors.includes(record.voter)) continue;
        expect(impostors).not.toContain(record.target);
      }
    }
  });

  test('伪人会把票集中到同一个好人身上（抱团甩票）', () => {
    const state = makeState({ impostorIds: ['xiaolin', 'aze', 'laozhang'] });
    for (let seed = 1; seed <= 40; seed += 1) {
      const result = castVotes({ state, playerBallot: 'gao', seed });
      const blocVotes = result.records
        .filter((record) => ['xiaolin', 'aze', 'laozhang'].includes(record.voter as string))
        .map((record) => record.target);
      expect(new Set(blocVotes).size).toBe(1);
    }
  });
});

describe('行为证据', () => {
  test('玩家动过手之后，好人更愿意投玩家', () => {
    const base = makeState({ deadNpcs: [] });
    const killer = makeState({ playerKills: ['aze'], deadNpcs: ['aze'] });

    let baseVotes = 0;
    let killerVotes = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const without = castVotes({ state: base, playerBallot: 'gao', seed });
      const withKill = castVotes({ state: killer, playerBallot: 'gao', seed });
      baseVotes += without.records.filter((record) => record.target === 'player').length;
      killerVotes += withKill.records.filter((record) => record.target === 'player').length;
    }
    expect(killerVotes).toBeGreaterThan(baseVotes);
  });
});

describe('风向预告', () => {
  test('每个活着的 NPC 都有一条倾向，且不会指向自己', () => {
    const state = makeState({ deadNpcs: ['aze'] });
    const entries = previewSentiment(state);
    expect(entries).toHaveLength(livingNpcIds(state).length);
    for (const entry of entries) {
      expect(entry.target).not.toBe(entry.voter);
    }
  });
});

describe('表决结局', () => {
  test('僵局：没有裁定', () => {
    expect(voteEnding(makeState(), makeVoteResult())).toBe('deadlock');
  });

  test('玩家被票出：好人被放逐，伪人身份败露', () => {
    expect(voteEnding(makeState(), makeVoteResult({ condemned: 'player' }))).toBe('exiled');
    expect(voteEnding(makeState({ playerIsImpostor: true }), makeVoteResult({ condemned: 'player' }))).toBe('exposed');
  });

  test('票出好人 = 错杀', () => {
    const state = makeState({ impostorIds: ['xiaolin'] });
    expect(voteEnding(state, makeVoteResult({ condemned: 'laozhang' }))).toBe('mistrial');
  });

  test('票出最后一个伪人 = 石门审判', () => {
    const state = makeState({ impostorIds: ['xiaolin'] });
    expect(voteEnding(state, makeVoteResult({ condemned: 'xiaolin' }))).toBe('verdict');
  });

  test('票出伪人但还有同伙 = 漏网', () => {
    const state = makeState({ impostorIds: ['xiaolin', 'aze'] });
    expect(voteEnding(state, makeVoteResult({ condemned: 'xiaolin' }))).toBe('partial');
  });

  test('玩家自己就是伪人，清掉同类也不算肃清', () => {
    const state = makeState({ playerIsImpostor: true, impostorIds: ['xiaolin'] });
    expect(voteEnding(state, makeVoteResult({ condemned: 'xiaolin' }))).toBe('partial');
  });
});

describe('线索编程机关', () => {
  test('每条线索都有关卡，档位与填法齐全', () => {
    for (const clueId of ['mural', 'artifact', 'rubble', 'crevice', 'gategap']) {
      const challenge = getCodeChallenge(clueId);
      expect(challenge).toBeTruthy();
      expect([1, 2, 3]).toContain(challenge!.tier);
      expect(challenge!.fillChecks.length).toBeGreaterThan(0);
      expect(challenge!.initialCode).toContain('___');
    }
    expect(CLUE_CHALLENGES).toHaveLength(5);
  });

  test('简易校验要求整行填法，而不是随便出现一个数字', () => {
    const mural = getCodeChallenge('mural')!;
    // 乱写一个 1（比如 range(1,3)）不该算通过
    const sloppy = `low, high = 2, 4
count = 0
for n in range(1, high + 1):
    count += count
print(count)`;
    expect(checkSimpleSolution(sloppy, mural)).toBe(false);
    expect(checkSimpleSolution(mural.initialCode.replace('___', '1'), mural)).toBe(true);
    // 空格随便打也不影响
    expect(checkSimpleSolution(mural.initialCode.replace('count += ___', 'count+=1'), mural)).toBe(true);
  });

  test('还留着 ___ 一律不放行', () => {
    const crevice = getCodeChallenge('crevice')!;
    expect(checkSimpleSolution(crevice.initialCode, crevice)).toBe(false);
    expect(checkSimpleSolution(crevice.initialCode.replace('___', 'not in'), crevice)).toBe(true);
  });
});

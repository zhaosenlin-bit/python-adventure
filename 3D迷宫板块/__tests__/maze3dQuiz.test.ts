/**
 * 3D 编程迷宫 —— Python 语法题库
 */

import { PYTHON_QUIZ, pickQuiz } from '@/lib/maze3d/quiz';

describe('PYTHON_QUIZ', () => {
    it('每道题都有 4 个选项且答案下标合法', () => {
        expect(PYTHON_QUIZ.length).toBeGreaterThanOrEqual(12);
        PYTHON_QUIZ.forEach((question) => {
            expect(question.options).toHaveLength(4);
            expect(new Set(question.options).size).toBe(4);
            expect(question.answer).toBeGreaterThanOrEqual(0);
            expect(question.answer).toBeLessThan(question.options.length);
            expect(question.prompt.length).toBeGreaterThan(0);
            expect(question.explain.length).toBeGreaterThan(0);
        });
    });

    it('题目 id 不重复', () => {
        const ids = PYTHON_QUIZ.map((question) => question.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('pickQuiz', () => {
    it('同一个种子永远抽到同一题', () => {
        expect(pickQuiz(42).id).toBe(pickQuiz(42).id);
    });

    it('会跳过已经答过的题', () => {
        const first = pickQuiz(3);
        const second = pickQuiz(3, [first.id]);

        expect(second.id).not.toBe(first.id);
    });

    it('所有题都被排除时仍然返回题目', () => {
        const allIds = PYTHON_QUIZ.map((question) => question.id);
        expect(pickQuiz(7, allIds)).toBeDefined();
    });
});

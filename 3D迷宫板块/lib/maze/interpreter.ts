/**
 * 迷宫探险门 —— 迷你 Python 解释器
 *
 * 只支持孩子在迷宫里需要的那一小部分语法：
 *   注释        # ...
 *   指令调用    move()  move(3)  turn_left()  turn_right()
 *   计数循环    for i in range(3):
 *
 * 函数名一律用真正的 Python 标识符（英文小写），中文只出现在注释、提示和报错里，
 * 这样孩子写的每一行都是可以直接搬进普通 Python 程序的代码。
 *
 * 之所以不直接用浏览器里的 Pyodide：本地 public/pyodide 的 wasm 与锁文件版本互相
 * 不匹配（instantiate 直接失败），而迷宫只需要「按顺序吐出指令」这一件事，
 * 自带解释器可以离线运行、即时反馈、也可以被单元测试完整覆盖。
 */

import type { MazeCommand } from './levels';

export const COMMAND_LIMIT = 500;

const COMMAND_NAMES: Record<string, MazeCommand> = {
    move: 'forward',
    turn_left: 'left',
    turn_right: 'right',
};

const COMMAND_LIST_TEXT = 'move()、turn_left()、turn_right()';

type Node =
    | { type: 'call'; name: string; args: number[]; line: number }
    | { type: 'for'; from: number; to: number; step: number; body: Node[]; line: number };

interface SourceLine {
    text: string;
    indent: number;
    line: number;
}

export interface InterpretResult {
    ok: boolean;
    commands: MazeCommand[];
    error?: string;
}

class MazeCodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MazeCodeError';
    }
}

function toSourceLines(code: string): SourceLine[] {
    const result: SourceLine[] = [];

    code.split('\n').forEach((raw, index) => {
        const withoutComment = raw.split('#')[0].replace(/\s+$/, '');
        if (withoutComment.trim() === '') return;

        const leading = withoutComment.match(/^[ \t]*/)?.[0] ?? '';
        const indent = leading.replace(/\t/g, '    ').length;
        result.push({ text: withoutComment.trim(), indent, line: index + 1 });
    });

    return result;
}

function parseNumberList(raw: string, line: number): number[] {
    const parts = raw.split(',').map((part) => part.trim());
    const numbers = parts.map((part) => {
        if (!/^-?\d+$/.test(part)) {
            throw new MazeCodeError(`第 ${line} 行：range() 里只能写整数，这里是「${part || '空'}」`);
        }
        return Number(part);
    });

    if (numbers.length < 1 || numbers.length > 3) {
        throw new MazeCodeError(`第 ${line} 行：range() 需要 1 到 3 个整数`);
    }

    return numbers;
}

function parseForRange(text: string, line: number): { from: number; to: number; step: number } {
    const match = text.match(/^for\s+[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*\s+in\s+range\s*\((.*)\)\s*:$/);
    if (!match) {
        throw new MazeCodeError(`第 ${line} 行：for 循环要写成 for i in range(3): 这样的格式`);
    }

    const numbers = parseNumberList(match[1], line);
    if (numbers.length === 1) return { from: 0, to: numbers[0], step: 1 };
    if (numbers.length === 2) return { from: numbers[0], to: numbers[1], step: 1 };
    return { from: numbers[0], to: numbers[1], step: numbers[2] };
}

function parseCall(text: string, line: number, actorLabel: string): Node {
    const match = text.match(/^([^\s(]+)\s*\((.*)\)$/);
    if (!match) {
        const bareCommand = text.trim();
        const normalized = bareCommand.toLowerCase();
        if (bareCommand in COMMAND_NAMES || normalized in COMMAND_NAMES) {
            const name = bareCommand in COMMAND_NAMES ? bareCommand : normalized;
            throw new MazeCodeError(`第 ${line} 行：${name} 后面要加括号，写成 ${name}()`);
        }
        throw new MazeCodeError(`第 ${line} 行看不懂：「${text}」`);
    }

    const name = match[1];
    const args = match[2].trim() === '' ? [] : parseNumberList(match[2], line);

    if (!(name in COMMAND_NAMES)) {
        const normalized = name.toLowerCase();
        if (normalized in COMMAND_NAMES) {
            throw new MazeCodeError(`第 ${line} 行：Python 区分大小写，要全部小写，写成 ${normalized}()`);
        }
        throw new MazeCodeError(
            `第 ${line} 行：${actorLabel}不认识 ${name}()，它只听得懂 ${COMMAND_LIST_TEXT}`,
        );
    }

    return { type: 'call', name, args, line };
}

function parseBlock(
    lines: SourceLine[],
    start: number,
    indent: number,
    actorLabel: string,
): { nodes: Node[]; next: number } {
    const nodes: Node[] = [];
    let index = start;

    while (index < lines.length && lines[index].indent >= indent) {
        const current = lines[index];

        if (current.indent > indent) {
            throw new MazeCodeError(`第 ${current.line} 行：缩进对不上，检查一下前面的空格`);
        }

        if (current.text.startsWith('for')) {
            const { from, to, step } = parseForRange(current.text, current.line);
            const bodyStart = index + 1;

            if (bodyStart >= lines.length || lines[bodyStart].indent <= indent) {
                throw new MazeCodeError(`第 ${current.line} 行：for 循环下面要写缩进的代码`);
            }

            const body = parseBlock(lines, bodyStart, lines[bodyStart].indent, actorLabel);
            nodes.push({ type: 'for', from, to, step, body: body.nodes, line: current.line });
            index = body.next;
            continue;
        }

        nodes.push(parseCall(current.text, current.line, actorLabel));
        index += 1;
    }

    return { nodes, next: index };
}

function runNodes(nodes: Node[], commands: MazeCommand[]): void {
    for (const node of nodes) {
        if (node.type === 'call') {
            const command = COMMAND_NAMES[node.name];
            const repeat = node.args[0] ?? 1;

            for (let i = 0; i < repeat; i++) {
                if (commands.length >= COMMAND_LIMIT) {
                    throw new MazeCodeError(`指令超过 ${COMMAND_LIMIT} 条啦，检查一下是不是循环次数写太大了`);
                }
                commands.push(command);
            }
            continue;
        }

        if (node.step === 0) {
            throw new MazeCodeError(`第 ${node.line} 行：range() 的步长不能是 0`);
        }

        for (let value = node.from; node.step > 0 ? value < node.to : value > node.to; value += node.step) {
            runNodes(node.body, commands);
        }
    }
}

export function interpretMazeCode(code: string, actorLabel = '机器人'): InterpretResult {
    try {
        const lines = toSourceLines(code);
        if (lines.length === 0) {
            return { ok: false, commands: [], error: '代码是空的：先写一句 move() 试试' };
        }

        const { nodes } = parseBlock(lines, 0, lines[0].indent, actorLabel);
        const commands: MazeCommand[] = [];
        runNodes(nodes, commands);

        if (commands.length === 0) {
            return { ok: false, commands: [], error: '代码里没有发出任何指令 —— 记得调用 move() 哦' };
        }

        return { ok: true, commands };
    } catch (error) {
        return {
            ok: false,
            commands: [],
            error: error instanceof MazeCodeError ? error.message : '代码执行出错',
        };
    }
}

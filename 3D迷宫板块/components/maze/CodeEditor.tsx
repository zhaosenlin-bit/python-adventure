'use client';

/**
 * 迷宫探险门 —— 轻量 Python 代码编辑器
 *
 * textarea 负责输入，底下叠一层同样式的 <pre> 做语法高亮
 * （textarea 文字透明、只留光标）。不引入 Monaco：
 * 迷宫只用得到一撮语法，离线秒开比完整 IDE 更合适。
 */

import { useRef, type ReactNode } from 'react';

const TOKEN_RULES: RegExp[] = [
    /#.*$/, // 注释
    /\b(?:for|in)\b/, // 关键字
    /\b(?:range|move|turn_left|turn_right)\b/, // 内置与机器人函数
    /\b\d+\b/, // 数字
];

const TOKEN_CLASSES = [
    'text-slate-500 italic',
    'text-fuchsia-300 font-semibold',
    'text-amber-300',
    'text-sky-300',
];

function highlightLine(line: string, keyPrefix: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let rest = line;
    let index = 0;

    while (rest.length > 0) {
        let best: { start: number; end: number; rule: number } | null = null;
        for (let rule = 0; rule < TOKEN_RULES.length; rule++) {
            const match = TOKEN_RULES[rule].exec(rest);
            if (match && (best === null || match.index < best.start)) {
                best = { start: match.index, end: match.index + match[0].length, rule };
            }
        }

        if (!best) {
            nodes.push(rest);
            break;
        }
        if (best.start > 0) {
            nodes.push(rest.slice(0, best.start));
        }
        nodes.push(
            <span key={`${keyPrefix}-${index++}`} className={TOKEN_CLASSES[best.rule]}>
                {rest.slice(best.start, best.end)}
            </span>,
        );
        rest = rest.slice(best.end);
    }
    return nodes;
}

export default function CodeEditor({
    value,
    onChange,
    onRun,
    height = 340,
}: {
    value: string;
    onChange: (next: string) => void;
    onRun?: () => void;
    /** 编辑器高度（px）。3D 迷宫这类小屏场景可以传更矮的值把画面让出来。 */
    height?: number;
}) {
    const preRef = useRef<HTMLPreElement>(null);

    const handleScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
        if (preRef.current) {
            preRef.current.scrollTop = event.currentTarget.scrollTop;
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const target = event.currentTarget;
        const { selectionStart, selectionEnd, value } = target;

        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onRun?.();
            return;
        }

        if (event.key === 'Tab') {
            event.preventDefault();
            const next = value.slice(0, selectionStart) + '    ' + value.slice(selectionEnd);
            onChange(next);
            requestAnimationFrame(() => {
                target.selectionStart = target.selectionEnd = selectionStart + 4;
            });
            return;
        }

        if (event.key === 'Enter') {
            const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
            const currentLine = value.slice(lineStart, selectionStart);
            const indent = currentLine.match(/^ */)?.[0] ?? '';
            const extra = currentLine.trimEnd().endsWith(':') ? '    ' : '';

            if (indent.length > 0 || extra.length > 0) {
                event.preventDefault();
                const insert = '\n' + indent + extra;
                const next = value.slice(0, selectionStart) + insert + value.slice(selectionEnd);
                onChange(next);
                const caret = selectionStart + insert.length;
                requestAnimationFrame(() => {
                    target.selectionStart = target.selectionEnd = caret;
                });
            }
        }
    };

    // 矮面板（3D 迷宫）用更紧的字号与内边距，默认尺寸保持原来的观感
    const compact = height <= 260;
    const textClass = compact ? 'px-3 py-2 text-[12px] leading-5' : 'px-4 py-3 text-[13px] leading-6';

    return (
        <div className="relative w-full overflow-hidden bg-[#0d0b14]" style={{ height }}>
            <pre
                ref={preRef}
                aria-hidden
                className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words font-mono text-slate-200 ${textClass}`}
            >
                {value.split('\n').map((line, index) => (
                    <div key={index}>{highlightLine(line, `l${index}`)}</div>
                ))}
            </pre>
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onScroll={handleScroll}
                spellCheck={false}
                className={`absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent font-mono text-transparent caret-amber-200 outline-none selection:bg-amber-400/30 ${textClass}`}
            />
        </div>
    );
}

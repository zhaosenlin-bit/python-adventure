/**
 * 3D 编程迷宫 —— Python 语法练习题
 *
 * 玩家踩错陷阱门时抽一道题，答对才被放回迷宫。
 * 题库只用「一眼能看出对错」的小题，覆盖缩进、range、变量、字符串、
 * 调用与括号这些真正会绊倒初学者（尤其是小学生）的点。
 */

export interface QuizQuestion {
    id: string;
    prompt: string;
    code?: string;
    options: string[];
    answer: number;
    explain: string;
}

export const PYTHON_QUIZ: readonly QuizQuestion[] = [
    {
        id: 'indent',
        prompt: 'Python 里 for 循环下面那一行必须怎么写？',
        code: 'for i in range(3):\n    move()',
        options: ['向右缩进', '顶格顶在最左边', '行尾加一个分号', '用大括号包起来'],
        answer: 0,
        explain: 'Python 用缩进表示「这一行属于上面的循环」，不缩进就会报 IndentationError。',
    },
    {
        id: 'repeat',
        prompt: '这段代码会让角色前进几步？',
        code: 'for i in range(3):\n    move()',
        options: ['3 步', '1 步', '4 步', '0 步'],
        answer: 0,
        explain: 'range(3) 依次给出 0、1、2 三个数，循环体执行 3 次，所以走 3 步。',
    },
    {
        id: 'print',
        prompt: 'print("Hi") 会输出什么？',
        options: ['Hi', '"Hi"', 'print("Hi")', '什么都不输出'],
        answer: 0,
        explain: '引号只是告诉 Python「这里是一段文字」，打印的时候引号本身不会印出来。',
    },
    {
        id: 'range2',
        prompt: 'range(2, 5) 会依次给出哪些数字？',
        options: ['2、3、4', '2、3、4、5', '3、4、5', '2、5'],
        answer: 0,
        explain: 'range 包含起点、不包含终点：从 2 开始，到 5 之前停，所以是 2、3、4。',
    },
    {
        id: 'comment',
        prompt: 'Python 里写注释用哪个符号？',
        options: ['#', '//', '<!--', '--'],
        answer: 0,
        explain: '# 后面的一整行都会被 Python 忽略，用来写给人看的说明。',
    },
    {
        id: 'variable',
        prompt: '运行后打印出来的是什么？',
        code: 'name = "Tom"\nprint(name)',
        options: ['Tom', 'name', '"Tom"', '报错'],
        answer: 0,
        explain: 'name 是变量名，存着字符串 "Tom"，print(name) 打印的是变量的值。',
    },
    {
        id: 'equal',
        prompt: '判断两个值「是否相等」要用哪个符号？',
        options: ['==', '=', '===', 'eq'],
        answer: 0,
        explain: '一个 = 是赋值（把值放进变量），两个 == 才是比较是否相等。',
    },
    {
        id: 'string-quote',
        prompt: '在 Python 里，一段文字（字符串）必须用什么包起来？',
        options: ['引号', '圆括号', '方括号', '什么都不用'],
        answer: 0,
        explain: '字符串要用单引号或双引号包住，比如 "maze" 或 \'maze\'。',
    },
    {
        id: 'call-parens',
        prompt: 'turn_left 和 turn_left() 有什么区别？',
        options: [
            '加括号才是真的执行转弯',
            '加括号只是写个名字，不会执行',
            '两者完全一样',
            '加括号表示转向右边',
        ],
        answer: 0,
        explain: '函数名后面加上括号才叫「调用」，才会真的执行；只写名字等于把函数本身拿来引用。',
    },
    {
        id: 'range-zero',
        prompt: '这段代码执行几次循环？',
        code: 'for i in range(0):\n    move()',
        options: ['0 次', '1 次', '2 次', '一直循环不停'],
        answer: 0,
        explain: 'range(0) 一个数都不给，循环体一次也不会执行。',
    },
    {
        id: 'list-index',
        prompt: 'a[0] 的值是多少？',
        code: 'a = [1, 2, 3]\nprint(a[0])',
        options: ['1', '2', '3', '报错'],
        answer: 0,
        explain: 'Python 的下标从 0 开始数，所以 a[0] 是第一个元素 1。',
    },
    {
        id: 'len',
        prompt: 'print(len("maze")) 输出什么？',
        options: ['4', '5', 'maze', '报错'],
        answer: 0,
        explain: 'len() 数的是字符个数，m-a-z-e 一共 4 个字符。',
    },
    {
        id: 'if-colon',
        prompt: '下面哪一行是合法的 Python？',
        options: ['if x > 3:', 'if x > 3', 'if (x > 3)', 'IF x > 3:'],
        answer: 0,
        explain: 'if 语句以冒号结尾；Python 关键字必须小写，条件外面也不需要额外括号。',
    },
    {
        id: 'arithmetic',
        prompt: '最后 y 是多少？',
        code: 'x = 3\ny = x + 2',
        options: ['5', '3', '2', '"32"'],
        answer: 0,
        explain: 'x 是数字 3，3 + 2 = 5，所以 y 是 5。',
    },
    {
        id: 'bool',
        prompt: 'Python 里「真」的标准写法是？',
        options: ['True', 'true', 'TRUE', 'yes'],
        answer: 0,
        explain: 'Python 的布尔值只有 True 和 False，首字母必须大写。',
    },
    {
        id: 'range-step',
        prompt: 'range(5, 0, -1) 的第一个数字是几？',
        options: ['5', '4', '1', '0'],
        answer: 0,
        explain: 'range(起点, 终点, 步长)，起点 5 会先给出，然后 4、3、2、1。',
    },
    {
        id: 'concat',
        prompt: 'print("2" + "3") 输出什么？',
        options: ['23', '5', '报错', '"23"'],
        answer: 0,
        explain: '两个带引号的东西是文字，加号会把它们首尾拼起来，得到 "23"。',
    },
    {
        id: 'indent-width',
        prompt: '关于缩进的空格数，下面哪种说法对？',
        options: [
            '同一段代码里保持一致就行，习惯上用 4 个空格',
            '必须正好 8 个空格',
            '必须用 Tab 键，不能用空格',
            'Python 不需要缩进',
        ],
        answer: 0,
        explain: 'Python 只要求同一个代码块里的缩进一致，社区习惯是 4 个空格。',
    },
];

export function pickQuiz(seed: number, exclude: readonly string[] = []): QuizQuestion {
    const pool = PYTHON_QUIZ.filter((question) => !exclude.includes(question.id));
    const list = pool.length > 0 ? pool : PYTHON_QUIZ;
    const index = Math.abs(Math.trunc(seed)) % list.length;
    return list[index];
}

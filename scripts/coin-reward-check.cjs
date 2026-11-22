/**
 * 金币奖励发放自动巡检：
 *  - 注册/登录 QA 账号
 *  - 用前端实际使用的各个 source 调 /coins/add
 *  - 校验白名单内的来源能发到账、超限来源会被后端拦下来
 */
const { removeUserByUsername } = require('./qaUserCleanup.cjs');
const { readBackendPort } = require('./backendPort.cjs');

const QA_USER = {
    username: 'qa_coin_bot',
    email: 'qa_coin_bot@example.com',
    password: 'QaCoin#2026',
};
const API = `http://localhost:${readBackendPort()}/api/v1`;

const ALLOWED_SOURCES = [
    ['level_complete', 50],
    ['wheel_spin', 100],
    ['campaign_level_complete', 300],
    ['campaign_complete', 500],
    ['code_research', 300],
];

async function request(pathname, method, body, token) {
    const response = await fetch(`${API}${pathname}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = JSON.parse(text);
    } catch {
        payload = text;
    }
    return { status: response.status, payload };
}

(async () => {
    let auth = (await request('/auth/register', 'POST', QA_USER)).payload;
    if (!auth || !auth.access_token) {
        auth = (await request('/auth/login', 'POST', {
            username: QA_USER.username,
            password: QA_USER.password,
        })).payload;
    }
    if (!auth || !auth.access_token) {
        console.log('QA 账号登录失败');
        process.exitCode = 1;
        return;
    }

    const token = auth.access_token;
    let failed = false;
    let expectedTotal = 0;

    // 新账号有初始金币，所以按「余额增量」核对
    const balanceBefore = await request('/coins/balance', 'GET', null, token);
    const coinsBefore = (balanceBefore.payload && balanceBefore.payload.coins) || 0;

    for (const [source, amount] of ALLOWED_SOURCES) {
        const result = await request('/coins/add', 'POST', {
            amount,
            type: 'earn',
            source,
            description: `QA ${source}`,
        }, token);
        const ok = result.status === 200;
        console.log(`${source.padEnd(24)} ${ok ? 'PASS' : 'FAIL'} status=${result.status} amount=${amount}` +
            (ok ? '' : ` detail=${JSON.stringify(result.payload)}`));
        if (ok) expectedTotal += amount;
        else failed = true;
    }

    // 超额请求要继续被拦下来，别因为放开了白名单就漏了风控
    const overLimit = await request('/coins/add', 'POST', {
        amount: 999999,
        type: 'earn',
        source: 'campaign_complete',
        description: 'QA over limit',
    }, token);
    const limitOk = overLimit.status === 400;
    console.log(`超额拦截              ${limitOk ? 'PASS' : 'FAIL'} status=${overLimit.status}`);
    if (!limitOk) failed = true;

    const balance = await request('/coins/balance', 'GET', null, token);
    const coins = balance.payload && balance.payload.coins;
    const gained = coins - coinsBefore;
    const balanceOk = balance.status === 200 && gained === expectedTotal;
    console.log(`余额核对              ${balanceOk ? 'PASS' : 'FAIL'} 增量=${gained} 预期=${expectedTotal}（初始 ${coinsBefore}）`);
    if (!balanceOk) failed = true;

    removeUserByUsername(QA_USER.username);
    console.log('QA 账号已清理');

    if (failed) process.exitCode = 1;
})();

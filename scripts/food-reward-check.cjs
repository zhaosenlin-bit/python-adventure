/**
 * 食物奖励发放自动巡检：
 *  - 注册/登录 QA 账号
 *  - 依次调用 /food/reward（关卡完成、代码质量、Boss 击败等奖励类型）
 *  - 校验接口不 500、背包数量真的加上了
 */
const path = require('path');
const { removeUserByUsername, DB_PATH } = require('./qaUserCleanup.cjs');
const { readBackendPort } = require('./backendPort.cjs');

const QA_USER = {
    username: 'qa_food_bot',
    email: 'qa_food_bot@example.com',
    password: 'QaFood#2026',
};
const API = `http://localhost:${readBackendPort()}/api/v1`;

const REWARD_TYPES = [
    'level_easy',
    'level_medium',
    'level_hard',
    'code_quality_a',
    'boss_defeat',
    'daily_login',
];

async function postJson(pathname, body, token) {
    const response = await fetch(`${API}${pathname}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
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

async function getJson(pathname, token) {
    const response = await fetch(`${API}${pathname}`, {
        headers: { Authorization: `Bearer ${token}` },
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
    const registered = await postJson('/auth/register', QA_USER);
    let auth = registered.payload;
    if (!auth || !auth.access_token) {
        auth = (await postJson('/auth/login', {
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
    const userId = auth.user.id;
    let failed = false;

    for (const rewardType of REWARD_TYPES) {
        const result = await postJson('/food/reward', { reward_type: rewardType }, token);
        const ok = result.status === 200 && result.payload && result.payload.success;
        const items = (result.payload && result.payload.items) || [];
        console.log(
            `${rewardType.padEnd(16)} ${ok ? 'PASS' : 'FAIL'} status=${result.status} items=${items.length}` +
                (ok ? '' : ` detail=${JSON.stringify(result.payload)}`),
        );
        if (!ok) failed = true;
    }

    // 背包要能查到刚才发的食物
    const inventory = await getJson('/food/inventory', token);
    const inventoryItems = (inventory.payload && inventory.payload.inventory) || [];
    const inventoryOk = inventory.status === 200 && inventoryItems.length > 0;
    console.log(
        `背包查询          ${inventoryOk ? 'PASS' : 'FAIL'} status=${inventory.status} items=${inventoryItems.length}`,
    );
    if (!inventoryOk) failed = true;

    // 发放要真的落库
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB_PATH);
    const rows = db
        .prepare('select food_id, quantity from food_inventory where user_id = ? order by food_id')
        .all(userId);
    db.close();
    const storedOk = rows.length > 0 && rows.every((row) => row.quantity > 0);
    console.log(`落库校验          ${storedOk ? 'PASS' : 'FAIL'} rows=${JSON.stringify(rows)}`);
    if (!storedOk) failed = true;

    removeUserByUsername(QA_USER.username);
    console.log('QA 账号已清理');

    if (failed) process.exitCode = 1;
})();

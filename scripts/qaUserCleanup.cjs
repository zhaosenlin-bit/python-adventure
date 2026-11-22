/** QA 临时账号清理：注册会写入很多外键关联表，直接删 users 行会被外键挡住 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'backend', 'code_adventure.db');

function removeUserByUsername(username) {
    if (!fs.existsSync(DB_PATH)) return false;

    let db;
    try {
        const { DatabaseSync } = require('node:sqlite');
        db = new DatabaseSync(DB_PATH);
    } catch {
        return false;
    }

    try {
        const row = db.prepare('select id from users where username = ?').get(username);
        if (!row) return false;

        const userId = row.id;
        const tables = db
            .prepare("select name from sqlite_master where type = 'table'")
            .all()
            .map((item) => item.name);

        // 先清掉所有指向 users 的外键行，再删用户本体
        for (const table of tables) {
            let foreignKeys = [];
            try {
                foreignKeys = db.prepare(`pragma foreign_key_list("${table}")`).all();
            } catch {
                continue;
            }

            for (const foreignKey of foreignKeys) {
                if (foreignKey.table !== 'users') continue;
                db.prepare(`delete from "${table}" where "${foreignKey.from}" = ?`).run(userId);
            }

            // 没有声明外键但带 user_id 的表也一并清掉
            try {
                const columns = db.prepare(`pragma table_info("${table}")`).all();
                if (columns.some((column) => column.name === 'user_id')) {
                    db.prepare(`delete from "${table}" where user_id = ?`).run(userId);
                }
            } catch {
                // 忽略读不出来的表
            }
        }

        db.prepare('delete from users where username = ?').run(username);
        return true;
    } catch {
        return false;
    } finally {
        try {
            db.close();
        } catch {
            // 忽略关闭异常
        }
    }
}

module.exports = { removeUserByUsername, DB_PATH };

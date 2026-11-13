"""
🍖 食物 / 宠物系统数据库迁移脚本

修掉的老问题
------------
1. 旧版本把数据库路径写死成 ``game.db``，和实际使用的 ``code_adventure.db``
   不是同一个文件。跑起来会在脚本旁边建一个空库，然后因为
   ``no such table: pets`` 直接报错 —— 而且这个空库没人知道它是干嘛的。
2. 旧版本按一份硬编码清单给 ``pets`` 表加字段（hunger / happiness /
   current_form），但这三个字段在当前的 Pet 模型里已经不存在了，
   代码里也没有任何地方引用，属于往 schema 里塞死列。

现在的行为
----------
- 数据库路径统一来自 ``settings.DATABASE_URL``
  （见 ``app.core.database.require_sqlite_db_path``），配置错了会直接报错，
  不会再偷偷建一个空库。
- ``pets`` 表只按**当前 ORM 模型**补列：模型里声明了但库里没有的才加，
  模型里没有的绝不多加。模型改了这里自动跟上。
- ``food_inventory`` 表照建（应用侧的服务里也有 ``CREATE TABLE IF NOT EXISTS``，
  这里建一次属于兜底）。

用法::

    python migrate_food_system.py
"""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import require_sqlite_db_path  # noqa: E402


def _sync_pets_columns(cursor) -> None:
    """按当前 Pet 模型补齐 pets 表缺失的列。"""
    from sqlalchemy.dialects import sqlite

    from app.models.pet import Pet

    cursor.execute("PRAGMA table_info(pets)")
    existing = {row[1] for row in cursor.fetchall()}
    if not existing:
        print("  ⚠️  pets 表不存在，跳过列同步")
        return

    added = 0
    for column in Pet.__table__.columns:
        if column.name in existing:
            continue

        if not column.nullable and column.default is None and column.server_default is None:
            print(f"  ⚠️  {column.name} 非空且无默认值，跳过（需要手工处理）")
            continue

        ddl_type = column.type.compile(dialect=sqlite.dialect())
        cursor.execute(f"ALTER TABLE pets ADD COLUMN {column.name} {ddl_type}")
        print(f"  ✅ 添加 {column.name} {ddl_type}")
        added += 1

    if not added:
        print("  ✅ pets 表结构已与模型一致")


def migrate() -> None:
    """执行迁移"""
    db_path = require_sqlite_db_path()
    print("🍖 开始迁移食物系统...")
    print(f"   数据库: {db_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 1. 创建食物背包表（应用侧也会建，这里兜底）
        print("📦 创建 food_inventory 表...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS food_inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                food_id VARCHAR(50) NOT NULL,
                quantity INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, food_id)
            )
        """)
        print("  ✅ food_inventory 就绪")

        # 2. 按当前模型同步 pets 表
        print("🐕 同步 pets 表结构...")
        _sync_pets_columns(cursor)

        conn.commit()
        print("✅ 迁移完成！")

    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()

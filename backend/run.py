"""
启动FastAPI服务器
"""
import os
import uvicorn
import sys
import io

# 设置Windows控制台编码
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

if __name__ == "__main__":
    # 端口跟前端 .env.local 的 NEXT_PUBLIC_API_PORT 保持一致
    port = int(os.environ.get("BACKEND_PORT") or os.environ.get("NEXT_PUBLIC_API_PORT") or 8000)

    print("="*60)
    print("   启动编程冒险岛后端服务")
    print("="*60)
    print()
    print("[启动] 正在启动服务器...")
    print()
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,  # 开发模式自动重载
        log_level="info",
        ws_ping_interval=20,  # WebSocket ping间隔
        ws_ping_timeout=20,   # WebSocket ping超时
        timeout_keep_alive=30  # 保持连接超时
    )




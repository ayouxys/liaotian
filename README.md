# 无痕聊天 💬

一个「不留痕」的实时聊天网页：消息可一键清空、可阅后即焚、支持定时自动清空。

## 特性

- ✅ 实时聊天（WebSocket），界面接近微信
- ✅ 昵称区分发言人
- ✅ **阅后即焚**：发送时点 🔥，对方点击查看后自动从服务器和所有端消失
- ✅ **一键清空全部记录**（服务器 + 所有在线端同时清空）
- ✅ **定时自动清空**（可选，通过环境变量开启）
- ✅ **进入密码**：服务端校验，源码看不到密码（通过环境变量 `ROOM_PASSWORD` 设置）
- ✅ **发图片**：支持图片消息，图片也支持阅后即焚
- ✅ 消息落盘（能收离线消息），清空后彻底删除
- ✅ 零第三方依赖，仅需 Node.js 18+

## 快速开始（本地体验）

```bash
# 1. 启动服务（端口默认 3000）
node server.js

# 2. 浏览器打开
#    本机：http://localhost:3000
#    同一 WiFi 下：http://<你的IP>:3000
```

### 开启定时自动清空

```bash
# Windows (PowerShell)
$env:AUTO_CLEAR="60"; node server.js    # 每 60 秒自动清空

# macOS / Linux
AUTO_CLEAR=60 node server.js
```

### 其他可选环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 监听端口 | 3000 |
| `AUTO_CLEAR` | 自动清空间隔（秒），0=关闭 | 0 |
| `BURN_AFTER` | 阅后即焚消息查看后延迟删除秒数 | 5 |
| `DATA_FILE` | 消息持久化文件路径 | ./messages.json |
| `ROOM_PASSWORD` | 进入密码（空 = 不校验，开放进入） | 空 |

## 阅后即焚怎么用

1. 输入框左侧点 **🔥**（变橙色表示已开启）
2. 输入内容发送
3. 对方看到的是「🔥 阅后即焚消息 · 点击查看」的占位卡片，**看不到内容**
4. 对方点击后，内容短暂显示（默认 5 秒），随后**自动从所有人界面和服务器消失**
5. 发送方自己能看到自己发的内容，并标 🔥 提示

## 让异地朋友访问（公网）

本地 `node server.js` 只有同一 WiFi 能访问。要异地手机访问，二选一：

### 方案 A：内网穿透（临时，最简单）

用 [cpolar](https://www.cpolar.com/) 或 [花生壳](https://hsk.oray.com/)：

```bash
cpolar http 3000
```

会生成一个 `https://xxx.cpolar.top` 地址，发给朋友即可。

### 方案 B：部署到免费云平台（长期）

项目已包含 `Dockerfile` 和 `render.yaml`，可直接部署到：

- [Render](https://render.com)（免费）
- [Railway](https://railway.app)（有免费额度）
- [Fly.io](https://fly.io)

以 Render 为例：
1. 把整个「无痕聊天」文件夹上传到 GitHub
2. Render 新建 Web Service，连接该仓库
3. 构建命令 `npm install`（如用 Docker 则自动）
4. 启动命令 `node server.js`
5. 得到 `https://xxx.onrender.com` 地址

## 隐私说明

- 消息默认保存在服务器 `messages.json` 文件里（为收离线消息）
- **清空**会同时删除该文件内容 + 通知所有在线端
- 若希望「服务器彻底不落盘」，删除/重命名 `messages.json` 后仍可运行，消息仅在内存中（重启即消失）

## 文件结构

```
无痕聊天/
├── server.js        # 后端（HTTP + WebSocket，零依赖）
├── index.html       # 前端（微信风格界面）
├── messages.json    # 消息持久化（自动生成）
├── package.json     # 声明（用于云平台识别 Node 项目）
├── Dockerfile       # 容器化部署
├── render.yaml      # Render 平台配置
└── README.md
```

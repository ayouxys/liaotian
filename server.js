/**
 * 无痕聊天 - 后端服务
 * 特性：
 *  - WebSocket 实时聊天，支持昵称区分发言人
 *  - 消息可持久化到 JSON 文件（能收离线消息）
 *  - 一键清空全部记录（服务器 + 通知所有在线客户端）
 *  - 定时自动清空（可配置，默认关闭）
 *  - 阅后即焚：消息点击查看后自动从服务器和所有端删除
 *  - 零第三方依赖，Node.js 原生实现
 *
 * 启动：node server.js
 * 环境变量（可选）：
 *   PORT        监听端口，默认 3000
 *   AUTO_CLEAR  定时自动清空秒数，0 表示关闭，默认 0
 *   BURN_AFTER  阅后即焚消息查看后延迟删除的秒数，默认 5
 *   DATA_FILE   持久化文件路径，默认 ./messages.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============ 配置（全部来自环境变量，启动时校验） ============
const PORT = parseInt(process.env.PORT || '3000', 10);
const AUTO_CLEAR = parseInt(process.env.AUTO_CLEAR || '0', 10); // 秒，0=关闭
const BURN_AFTER = parseInt(process.env.BURN_AFTER || '5', 10); // 阅后即焚查看后延迟删除秒数
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'messages.json');
const ROOM_PASSWORD = process.env.ROOM_PASSWORD || ''; // 进入密码（空 = 不校验，开放进入）
const PUBLIC_DIR = __dirname;

if (Number.isNaN(PORT) || PORT <= 0 || PORT > 65535) {
  console.error('[配置错误] PORT 无效:', process.env.PORT);
  process.exit(1);
}
if (Number.isNaN(AUTO_CLEAR) || AUTO_CLEAR < 0) {
  console.error('[配置错误] AUTO_CLEAR 无效:', process.env.AUTO_CLEAR);
  process.exit(1);
}
if (Number.isNaN(BURN_AFTER) || BURN_AFTER < 1) {
  console.error('[配置错误] BURN_AFTER 无效:', process.env.BURN_AFTER);
  process.exit(1);
}

// ============ 内存状态 ============
/** @type {Array<{id:string, name:string, text:string, time:number, burn?:boolean, revealed?:boolean}>} */
let messages = [];
/** @type {Set<import('ws').WebSocket>} 简化：用原生 WebSocket 集合 */
const clients = new Set();

// ============ 持久化 ============
function loadMessages() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        messages = parsed;
        console.log(`[存储] 已加载 ${messages.length} 条历史消息`);
        return;
      }
    }
  } catch (err) {
    console.error('[存储] 加载失败，从空记录开始:', err.message);
    messages = [];
  }
}

function saveMessages() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(messages), 'utf8');
  } catch (err) {
    console.error('[存储] 保存失败:', err.message);
  }
}

// ============ 工具 ============
function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) { // OPEN
      try { ws.send(data); } catch (_) {}
    }
  }
}

// 阅后即焚消息：对接收方隐藏明文，只给占位
function maskForOthers(record) {
  if (record.burn && !record.revealed) {
    return { id: record.id, name: record.name, time: record.time, burn: true, hidden: true };
  }
  return record;
}

// ============ 消息处理 ============
function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (_) {
    ws.send(JSON.stringify({ type: 'error', text: '消息格式错误' }));
    return;
  }

  switch (msg.type) {
    case 'join': {
      // 服务端校验进入密码（若设置了 ROOM_PASSWORD）
      if (ROOM_PASSWORD) {
        const pwd = String(msg.password || '');
        if (pwd !== ROOM_PASSWORD) {
          ws.send(JSON.stringify({ type: 'auth_failed', text: '密码错误，请重试' }));
          return;
        }
      }
      // 客户端带昵称加入，回发历史记录
      const name = String(msg.name || '').trim().slice(0, 30) || '匿名';
      ws.nickname = name;
      ws.send(JSON.stringify({
        type: 'history',
        messages: messages.map(maskForOthers),
        autoClear: AUTO_CLEAR,
        burnAfter: BURN_AFTER,
        selfId: ws.selfId,
      }));
      broadcast({
        type: 'presence',
        online: [...clients].filter(c => c.readyState === 1).map(c => c.nickname || '匿名'),
      });
      break;
    }

    case 'chat': {
      const name = String(msg.name || ws.nickname || '匿名').trim().slice(0, 30) || '匿名';
      const text = String(msg.text || '').trim();
      const image = String(msg.image || ''); // base64 图片数据
      if (!text && !image) return;
      // 图片消息大小限制（约 3MB base64）
      if (image && image.length > 4000000) {
        ws.send(JSON.stringify({ type: 'error', text: '图片过大（最大约 3MB）' }));
        return;
      }
      if (text.length > 2000) {
        ws.send(JSON.stringify({ type: 'error', text: '消息过长（最多 2000 字）' }));
        return;
      }
      const record = {
        id: newId(),
        name,
        text: text.slice(0, 2000),
        time: Date.now(),
        burn: msg.burn === true, // 阅后即焚标记
        revealed: false,         // 是否已被查看
      };
      if (image) {
        record.image = image;
      }
      messages.push(record);
      // 只保留最近 200 条，防止图片导致膨胀
      if (messages.length > 200) {
        messages = messages.slice(messages.length - 200);
      }
      saveMessages();
      // 下发给其他端的消息：阅后即焚的消息不携带明文内容，只给一个占位
      broadcast({ type: 'chat', message: maskForOthers(record) });
      break;
    }

    case 'reveal': {
      // 阅后即焚：某端点击查看，标记已读，延迟后删除
      const id = String(msg.id || '');
      const record = messages.find(m => m.id === id);
      if (!record) return;
      if (!record.burn) return;
      if (record.revealed) return; // 已被查看过，不再处理

      record.revealed = true;
      saveMessages();

      // 把明文发给请求查看的那一端
      ws.send(JSON.stringify({ type: 'revealed', message: record }));

      // 通知其他端：这条消息已被查看，将消失
      broadcast({
        type: 'burned',
        id: record.id,
        text: record.text, // 允许其他端短暂看到"已被查看"提示
      });

      // 延迟 BURN_AFTER 秒后彻底删除
      setTimeout(() => {
        messages = messages.filter(m => m.id !== id);
        saveMessages();
        broadcast({ type: 'remove', id });
        console.log(`[阅后即焚] 消息已删除: ${record.name}`);
      }, BURN_AFTER * 1000);
      break;
    }

    case 'clear': {
      // 一键清空：清服务器 + 通知所有人
      messages = [];
      saveMessages();
      broadcast({ type: 'cleared' });
      console.log('[清空] 所有聊天记录已被清空');
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', text: '未知消息类型' }));
  }
}

// ============ 定时自动清空 ============
if (AUTO_CLEAR > 0) {
  setInterval(() => {
    if (messages.length === 0) return;
    messages = [];
    saveMessages();
    broadcast({ type: 'cleared', auto: true });
    console.log(`[自动清空] 每 ${AUTO_CLEAR} 秒自动清空一次`);
  }, AUTO_CLEAR * 1000);
  console.log(`[定时] 自动清空已开启：每 ${AUTO_CLEAR} 秒清空一次`);
} else {
  console.log('[定时] 自动清空未开启（设置环境变量 AUTO_CLEAR 秒数可开启）');
}

// ============ HTTP 服务器（静态文件 + WebSocket 升级） ============
const server = http.createServer((req, res) => {
  // 健康检查
  if (req.url === '/health' || req.url === '/ready') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', online: clients.size, messages: messages.length }));
    return;
  }

  // 静态文件服务
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const resolved = path.join(PUBLIC_DIR, filePath);
  // 防止路径穿越
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const extMap = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  const ext = path.extname(resolved).toLowerCase();
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': extMap[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ============ WebSocket 升级（原生实现，无第三方依赖） ============
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );

  const ws = {
    socket,
    nickname: '匿名',
    selfId: newId(),
    readyState: 1,
    send(data) {
      try {
        // 帧编码（服务器→客户端：不允许 mask，故不加 0x80 mask 位）
        const payload = Buffer.from(data, 'utf8');
        let header;
        if (payload.length < 126) {
          header = Buffer.alloc(2);
          header[1] = payload.length;
        } else if (payload.length < 65536) {
          header = Buffer.alloc(4);
          header[1] = 126;
          header.writeUInt16BE(payload.length, 2);
        } else {
          header = Buffer.alloc(10);
          header[1] = 127;
          header.writeBigUInt64BE(BigInt(payload.length), 2);
        }
        header[0] = 0x81; // FIN + text frame
        socket.write(Buffer.concat([header, payload]));
      } catch (_) {}
    },
  };
  clients.add(ws);

  let buffer = Buffer.alloc(0);
  let fragmented = null; // 分帧消息累积缓冲区

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    // 解析 WebSocket 帧（支持分帧重组，处理大图片消息）
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (buffer.length < 4) break;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) break;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey = null;
      if (masked) {
        if (buffer.length < offset + 4) break;
        maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + len) break;

      let payload = buffer.slice(offset, offset + len);
      buffer = buffer.slice(offset + len);

      if (masked && maskKey) {
        payload = Buffer.from(payload.map((b, i) => b ^ maskKey[i % 4]));
      }

      // 处理控制帧
      if (opcode === 0x8) { // close
        socket.end();
        return;
      }
      if (opcode === 0x9) { // ping -> pong
        const pong = Buffer.alloc(2);
        pong[0] = 0x8a;
        pong[1] = 0x80;
        socket.write(Buffer.concat([pong, Buffer.from([0, 0, 0, 0])]));
        continue;
      }

      // 数据帧：处理分帧重组（大消息会被浏览器拆成多个帧）
      if (opcode === 0x1 || opcode === 0x2) {
        // 新的文本/二进制帧开始
        fragmented = fragmented ? Buffer.concat([fragmented, payload]) : payload;
        if (fin) {
          const complete = fragmented;
          fragmented = null;
          if (opcode === 0x1) {
            handleMessage(ws, complete.toString('utf8'));
          }
        }
        continue;
      }
      if (opcode === 0x0) {
        // continuation 续帧：追加到累积缓冲区
        if (fragmented) {
          fragmented = Buffer.concat([fragmented, payload]);
          if (fin) {
            const complete = fragmented;
            fragmented = null;
            handleMessage(ws, complete.toString('utf8'));
          }
        }
        continue;
      }
    }
  });

  socket.on('close', () => {
    clients.delete(ws);
    broadcast({
      type: 'presence',
      online: [...clients].filter(c => c.readyState === 1).map(c => c.nickname || '匿名'),
    });
  });
  socket.on('error', () => {
    clients.delete(ws);
  });
});

// ============ 优雅停机 ============
function shutdown() {
  console.log('[停机] 正在保存并关闭...');
  saveMessages();
  for (const ws of clients) {
    try { ws.socket.end(); } catch (_) {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============ 启动 ============
loadMessages();
server.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log('  无痕聊天 已启动');
  console.log(`  本机访问：  http://localhost:${PORT}`);
  console.log(`  局域网访问：http://<本机IP>:${PORT}`);
  console.log(`  健康检查：  http://localhost:${PORT}/health`);
  console.log(`  自动清空：  ${AUTO_CLEAR > 0 ? '每 ' + AUTO_CLEAR + ' 秒' : '关闭'}`);
  console.log(`  阅后即焚：  查看后 ${BURN_AFTER} 秒自动删除`);
  console.log(`  数据文件：  ${DATA_FILE}`);
  console.log('==============================================');
});

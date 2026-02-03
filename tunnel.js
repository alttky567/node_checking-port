const net = require('net');
const SERVICE_ID = process.env.TUNNEL_SERVICE || 'rdp';
const LOCAL_PORT = parseInt(process.env.TUNNEL_LOCAL_PORT) || 3389;
const REMOTE_HOST = process.env.TUNNEL_REMOTE_HOST;
const REMOTE_PORT = parseInt(process.env.TUNNEL_REMOTE_PORT);
const SECRET_KEY = process.env.TUNNEL_SECRET;
if (!REMOTE_HOST || !REMOTE_PORT || !SECRET_KEY) {
  console.error("Thiếu cấu hình: REMOTE_HOST, REMOTE_PORT hoặc TUNNEL_SECRET!");
  process.exit(1);
}
let controlSocket = null;
let heartbeatTimer = null;
function optimizeSocket(socket) {
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 5000);
  socket.setTimeout(0);
}
function createControlConnection() {
  console.log(`[SYSTEM] Đang kết nối tunnel cho: ${SERVICE_ID}`);
  controlSocket = net.connect({
    host: REMOTE_HOST,
    port: REMOTE_PORT
  }, () => {
    optimizeSocket(controlSocket);
    console.log('[CONTROL] Đã kết nối tới server trung gian.');
    controlSocket.write(`TUNNEL|${SERVICE_ID}|${SECRET_KEY}\n`);
  });
  controlSocket.on('data', (data) => {
    const msg = data.toString();
    if (msg.startsWith('OK')) {
      console.log(`✅ TUNNEL ACTIVE - Optimized for RDP`);
      startHeartbeat();
      listenForNewConnections();
    } else if (msg.startsWith('ERROR')) {
      console.error(`[AUTH] Lỗi xác thực: ${msg.trim()}`);
      process.exit(1);
    }
  });
  controlSocket.on('error', (err) => {
    console.error('[CONTROL] Lỗi:', err.message);
  });
  controlSocket.on('close', () => {
    console.log('[CONTROL] Kết nối bị ngắt. Đang thử lại...');
    stopHeartbeat();
    setTimeout(createControlConnection, 5000);
  });
}
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (controlSocket && controlSocket.writable) {
      controlSocket.write('PING\n');
    }
  }, 10000); //
}
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
function listenForNewConnections() {
  let buffer = Buffer.alloc(0);
  controlSocket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).toString('utf8');
      buffer = buffer.slice(idx + 1);
      const [cmd, connId] = line.split('|');
      if (cmd === 'NEW') {
        handleNewConnection(connId);
      }
    }
  });
}
function handleNewConnection(connId) {
  const localSocket = net.connect({
    host: '127.0.0.1',
    port: LOCAL_PORT
  }, () => {
    optimizeSocket(localSocket);
    const dataSocket = net.connect({
      host: REMOTE_HOST,
      port: REMOTE_PORT
    }, () => {
      optimizeSocket(dataSocket);
      dataSocket.write(`DATA|${SERVICE_ID}|${connId}\n`);
      localSocket.pipe(dataSocket);
      dataSocket.pipe(localSocket);
    });
    dataSocket.on('error', () => localSocket.destroy());
    localSocket.on('error', () => dataSocket.destroy());
  });
}
createControlConnection();

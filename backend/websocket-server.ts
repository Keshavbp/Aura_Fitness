import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken } from './api/utils/auth';

const PORT = Number(process.env.WS_PORT) || 8080;

const wss = new WebSocketServer({ port: PORT });

console.log(`[Aura Secure WebSocket Server] Running on wss://localhost:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  let authenticated = false;
  console.log('[Aura WS] Client initiated connection, awaiting JWT handshake...');

  // Set a timeout to automatically drop the socket if handshake is not completed within 5 seconds
  const handshakeTimeout = setTimeout(() => {
    if (!authenticated) {
      console.log('[Aura WS] Handshake timeout. Closing socket.');
      ws.send(JSON.stringify({ error: 'Auth Timeout: Expected JWT handshake frame.' }));
      ws.close(1008); // Policy Violation
    }
  }, 5000);

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);

      if (!authenticated) {
        // First frame MUST be the authentication handshake
        if (data.type === 'auth' && data.token) {
          const payload = verifyAccessToken(data.token);
          if (payload) {
            authenticated = true;
            clearTimeout(handshakeTimeout);
            console.log(`[Aura WS] Authentication succeeded. User: ${payload.userId}, Role: ${payload.role}`);
            ws.send(JSON.stringify({ status: 'authenticated', message: 'Handshake complete' }));
          } else {
            console.log('[Aura WS] Authentication failed: Invalid token.');
            ws.send(JSON.stringify({ error: 'Unauthorized: Invalid Access Token.' }));
            ws.close(1008);
          }
        } else {
          console.log('[Aura WS] Protocol violation: First frame must be type "auth" with JWT.');
          ws.send(JSON.stringify({ error: 'Protocol Violation: Expected auth frame.' }));
          ws.close(1002); // Protocol Error
        }
        return;
      }

      // If already authenticated, handle telemetry data packets
      if (data.type === 'telemetry') {
        // Here, the backend can parse and stream MediaPipe joint coordinates in real-time
        // console.log('[Aura WS] Telemetry frame received:', data.landmarks?.length);
        
        // Echo back status or warnings
        ws.send(JSON.stringify({
          status: 'processed',
          timestamp: Date.now()
        }));
      }

    } catch (err) {
      console.error('[Aura WS] Error processing message frame:', err);
      ws.send(JSON.stringify({ error: 'Bad Request: Invalid frame payload.' }));
    }
  });

  ws.on('close', () => {
    clearTimeout(handshakeTimeout);
    console.log('[Aura WS] Client disconnected.');
  });
});

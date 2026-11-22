import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const sha = (value) => createHash('sha256').update(value).digest('base64');
export class Obs {
  socket;
  ready = false;
  opening;
  sequence = 0;
  pending = new Map();

  async connect() {
    if (this.ready) return;
    if (!this.opening) {
      this.opening = this.open().finally(() => { this.opening = undefined; });
    }
    await this.opening;
  }

  async open() {
    const tunnelPort = process.env.OBS_REMOTE_WS_PORT;
    if (tunnelPort) {
      const encodedPassword = process.env.OBS_REMOTE_WS_PASSWORD_B64;
      const password = encodedPassword ? Buffer.from(encodedPassword, 'base64').toString('utf8')
        : process.env.OBS_REMOTE_WS_PASSWORD;
      await this.handshake('ws://127.0.0.1:' + tunnelPort, password);
      return;
    }
    const config = join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    const settings = JSON.parse((await readFile(config, 'utf8')).replace(/^\uFEFF/, ''));
    if (settings.server_enabled === false || !settings.server_port) {
      throw new Error('Включи сервер WebSocket в OBS.');
    }

    for (const address of ['[::1]', '127.0.0.1']) {
      try {
        await this.handshake('ws://' + address + ':' + settings.server_port, settings.server_password);
        return;
      } catch {}
    }
    throw new Error('OBS не отвечает. Проверь, что программа и сервер WebSocket запущены.');
  }

  handshake(url, password) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let connected = false;
      const disconnect = () => {
        clearTimeout(timer);
        if (this.socket === socket) {
          this.ready = false;
          for (const request of this.pending.values()) {
            clearTimeout(request.timer);
            request.reject(new Error('Связь с OBS потеряна.'));
          }
          this.pending.clear();
        }
        if (!connected) reject(new Error('OBS WebSocket недоступен.'));
      };
      const timer = setTimeout(() => { socket.close(); disconnect(); }, 2200);
      socket.addEventListener('error', disconnect);
      socket.addEventListener('close', disconnect);
      socket.addEventListener('message', ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.op === 0) {
          const auth = msg.d.authentication;
          const authValue = auth && typeof password === 'string'
            ? sha(sha(password + auth.salt) + auth.challenge)
            : undefined;
          socket.send(JSON.stringify({
            op: 1, d: { rpcVersion: 1, authentication: authValue, eventSubscriptions: 0 },
          }));
        } else if (msg.op === 2) {
          clearTimeout(timer);
          connected = true;
          this.socket = socket;
          this.ready = true;
          resolve();
        } else if (msg.op === 7 && this.socket === socket) {
          const request = this.pending.get(msg.d.requestId);
          if (!request) return;
          this.pending.delete(msg.d.requestId);
          clearTimeout(request.timer);
          if (msg.d.requestStatus.result) request.resolve(msg.d.responseData || {});
          else request.reject(new Error('OBS отклонил команду (' + msg.d.requestStatus.code + ').'));
        }
      });
    });
  }

  async call(requestType, requestData = {}) {
    await this.connect();
    return new Promise((resolve, reject) => {
      const requestId = String(++this.sequence);
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('OBS не ответил на команду.'));
      }, 3800);
      this.pending.set(requestId, { resolve, reject, timer });

      try {
        this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }
}


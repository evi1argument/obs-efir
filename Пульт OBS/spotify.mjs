import { execFile } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
let helper;
function spotifyHelper() {
  if (helper) return helper;
  if (!isSea()) return fileURLToPath(new URL('./spotify.ps1', import.meta.url));
  const folder = mkdtempSync(join(tmpdir(), 'obs-efir-spotify-'));
  const files = ['spotify.ps1', 'SpotifyVolume.cs'];
  process.once('exit', () => {
    for (const file of files) {
      try { unlinkSync(join(folder, file)); } catch {}
    }
    try { rmdirSync(folder); } catch {}
  });
  for (const file of files) writeFileSync(join(folder, file), Buffer.from(getAsset(file)), { flag: 'wx' });
  helper = join(folder, 'spotify.ps1');
  return helper;
}
const allowedTypes = '(track|album|playlist|artist|episode|show)';
const uriPattern = new RegExp('^spotify:' + allowedTypes + ':([A-Za-z0-9]{22})$');
const pathPattern = new RegExp('^/' + allowedTypes + '/([A-Za-z0-9]{22})/?$');
let currentState;
let pending;
let stateVersion = 0;

function spotifyUri(input) {
  if (typeof input !== 'string' || input.length > 300) throw new Error('Вставь ссылку Spotify.');
  const text = input.trim();
  if (uriPattern.test(text)) return text;
  try {
    const url = new URL(text);
    const route = url.pathname.replace(/^\/intl-[a-z]{2}(?:-[a-z]{2})?(?=\/)/i, '');
    const match = route.match(pathPattern);
    if (url.origin === 'https://open.spotify.com' && !url.username && !url.password && match) {
      return 'spotify:' + match[1] + ':' + match[2];
    }
  } catch {}
  throw new Error('Нужна ссылка open.spotify.com на трек, альбом или плейлист.');
}

async function run(action, link, volume) {
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', spotifyHelper(), '-Action', action];
  if (link) args.push('-Link', link);
  if (volume !== undefined) args.push('-Volume', String(volume));
  const { stdout } = await exec('powershell.exe', args, { windowsHide: true, timeout: 7500, maxBuffer: 8192 });
  const data = JSON.parse(stdout);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Spotify helper response.');
  return data;
}

export function readSpotify() {
  if (currentState && Date.now() - currentState.at < 1800) return Promise.resolve(currentState.data);
  if (!pending) {
    const version = stateVersion;
    pending = run('state').then((data) => {
      if (version === stateVersion) currentState = { at: Date.now(), data };
      return currentState?.data ?? data;
    }).finally(() => { pending = undefined; });
  }
  return pending;
}

export async function setSpotifyVolume(volume) {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error('Громкость должна быть от 0 до 100.');
  const result = await run('volume', undefined, volume).catch(() => null);
  if (!result?.ok) throw new Error('Запусти трек, чтобы Windows открыла звуковой канал Spotify.');
  stateVersion++;
  if (currentState) currentState.data = { ...currentState.data, volume: result.volume };
  return { volume: result.volume };
}

export async function spotifyAction(data) {
  if (!data || !['open', 'play', 'pause', 'next', 'previous'].includes(data.action)) {
    throw new Error('Неизвестная команда Spotify.');
  }
  const link = data.action === 'open' && data.link ? spotifyUri(data.link) : undefined;
  let result;
  try {
    result = await run(data.action, link);
  } catch {
    throw new Error('Spotify не ответил. Проверь, что приложение установлено и открыто.');
  }
  currentState = undefined;
  stateVersion++;
  if (!result.ok && !result.available) {
    throw new Error('Выбери трек в Spotify на компьютере или через Spotify Connect.');
  }
  if (!result.ok) throw new Error('Spotify сейчас не принимает эту команду.');
}


import { createServer, request } from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces, tmpdir } from 'node:os';
import { isIPv4 } from 'node:net';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { isSea, getAsset } from 'node:sea';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Obs } from './obs.mjs';
import { attachVideo } from './video.mjs';
import { readSpotify, setSpotifyVolume, spotifyAction } from './spotify.mjs';

const port = Number(process.env.OBS_REMOTE_PORT || 8787);
const serverMode = process.env.OBS_REMOTE_MODE === 'server';
const bridgePort = process.env.OBS_REMOTE_BRIDGE_PORT;
const bridgeCode = process.env.OBS_REMOTE_BRIDGE_CODE;
const tunnelPort = process.env.OBS_REMOTE_WS_PORT;
const desktopFeatures = !serverMode;
const validPort = (value) => /^\d{1,5}$/.test(value) && Number(value) >= 1024 && Number(value) <= 65535;
const loopbackOnly = serverMode || process.env.OBS_REMOTE_LOOPBACK_ONLY === '1';
const networks = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
  entries.filter(({ family, internal, address }) =>
    family === 'IPv4' && !internal && /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(address),
  ).map((entry) => ({ name, ...entry })));
const lan = networks.find((item) => item.address === process.env.OBS_REMOTE_HOST)
  || networks.find((item) => /wi.?fi|wireless|беспроводн/i.test(item.name))
  || networks.find((item) => /ethernet/i.test(item.name))
  || networks[0];
const desktopHost = '127.0.0.1:' + port;
const phoneHost = !loopbackOnly && lan && lan.address + ':' + port;
const publicOrigin = process.env.OBS_REMOTE_PUBLIC_ORIGIN;
if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin ||
    (new URL(publicOrigin).protocol !== 'https:' && !(serverMode && publicOrigin === 'http://127.0.0.1:' + port)))) {
  throw new Error('OBS_REMOTE_PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash.');
}
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const inheritedCode = process.env.OBS_REMOTE_PAIR_CODE;
delete process.env.OBS_REMOTE_PAIR_CODE;
if (serverMode && (!/^[A-Z2-9]{12}$/.test(inheritedCode || '') || !publicOrigin ||
    (bridgePort ? !validPort(bridgePort) || !/^[A-Z2-9]{12}$/.test(bridgeCode || '') : !validPort(tunnelPort)))) {
  throw new Error('Configure the server origin, pairing code and loopback OBS connection.');
}
const code = /^[A-Z2-9]{12}$/.test(inheritedCode) ? inheritedCode
  : Array.from(randomBytes(12), (byte) => alphabet[byte & 31]).join('');
const expected = Buffer.from(code);
const obs = new Obs();
const packaged = isSea();
const dataFolder = packaged ? pathToFileURL(join(process.env.LOCALAPPDATA || tmpdir(), 'OBS-Efir') + sep)
  : new URL('./', import.meta.url);
const spotifySource = 'Музыка · Spotify';
const shelfScene = 'Заготовки · Пульт OBS';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/pair', ['pair.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/editor.js', ['editor.js', 'text/javascript; charset=utf-8']],
  ['/live.js', ['live.js', 'text/javascript; charset=utf-8']],
  ['/pair.js', ['pair.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

const headers = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

function reply(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...headers, 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

const integerIP = (value) => value.split('.').reduce((value, part) => (value << 8) | Number(part), 0);
function isLocalPeer(req) {
  const address = req.socket.remoteAddress;
  if (address === '127.0.0.1') return true;
  if (!lan || !isIPv4(address)) return false;
  const mask = integerIP(lan.netmask);
  return (integerIP(address) & mask) === (integerIP(lan.address) & mask);
}

function authorized(req) {
  const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  const got = Buffer.from(req.headers['x-obs-code'] || bearer || '');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

function output(data) {
  return { active: data.outputActive, paused: !!data.outputPaused, elapsed: data.outputDuration || 0 };
}

async function audioInputs(items) {
  const results = await Promise.all(items.map(async (item) => {
    try { await obs.call('GetInputVolume', { inputName: item.sourceName }); return item; }
    catch { return null; }
  }));
  return results.filter(Boolean);
}
const isTrack = (item) => item.inputKind === 'ffmpeg_source';
const isText = (item) => item.inputKind === 'text_gdiplus_v3';
const isSpotify = (item) => item.inputKind === 'wasapi_process_output_capture' && item.sourceName === spotifySource;

async function spotifyMix(item) {
  if (!item) return null;
  const mute = await obs.call('GetInputMute', { inputName: spotifySource });
  return { muted: mute.inputMuted || !item.sceneItemEnabled };
}

async function shelfItems(scenes) {
  if (!scenes.some((scene) => scene.sceneName === shelfScene)) return [];
  const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: shelfScene });
  return sceneItems.sort((a, b) => b.sceneItemIndex - a.sceneItemIndex).map((item) => ({
    id: item.sceneItemId, name: item.sourceName, kind: item.inputKind || 'scene',
  }));
}

async function trackSnapshot(item) {
  const inputName = item.sourceName;
  const [media, volume, settings] = await Promise.all([
    obs.call('GetMediaInputStatus', { inputName }),
    obs.call('GetInputVolume', { inputName }),
    obs.call('GetInputSettings', { inputName }),
  ]);
  return {
    id: item.sceneItemId, name: inputName, title: /^Музыка · .+ · [a-f0-9]{6}$/.test(inputName) ? inputName.slice(9, -9) : inputName,
    playing: item.sceneItemEnabled && media.mediaState === 'OBS_MEDIA_STATE_PLAYING',
    paused: item.sceneItemEnabled && media.mediaState === 'OBS_MEDIA_STATE_PAUSED',
    volume: Math.round(volume.inputVolumeMul * 100), loop: !!settings.inputSettings.looping,
    duration: media.mediaDuration || 0, cursor: media.mediaCursor || 0,
  };
}

async function snapshot() {
  const [list, stream, recording, studio, video] = await Promise.all([
    obs.call('GetSceneList'), obs.call('GetStreamStatus'), obs.call('GetRecordStatus'),
    obs.call('GetStudioModeEnabled'), obs.call('GetVideoSettings'),
  ]);
  const current = list.currentProgramSceneName;
  const items = (await obs.call('GetSceneItemList', { sceneName: current })).sceneItems;
  const sounds = await audioInputs(items).then((audioItems) => Promise.all(audioItems.map(async (item) => ({
    id: item.sourceName, kind: 'audio',
    muted: (await obs.call('GetInputMute', { inputName: item.sourceName })).inputMuted,
   }))));
  const [tracks, spotifyAudio, shelf] = await Promise.all([
    Promise.all(items.filter(isTrack).map((item) => trackSnapshot(item).catch(() => null))).then((tracks) => tracks.filter(Boolean)),
    spotifyMix(items.find(isSpotify)), shelfItems(list.scenes),
  ]);
  return {
    current, studio: studio.studioModeEnabled,
    canvas: { width: video.baseWidth, height: video.baseHeight },
    items: items.slice().sort((a, b) => b.sceneItemIndex - a.sceneItemIndex).map((item) => ({
      id: item.sceneItemId, index: item.sceneItemIndex, enabled: item.sceneItemEnabled,
      locked: item.sceneItemLocked, name: item.sourceName, transform: item.sceneItemTransform, text: isText(item),
      kind: item.inputKind || (item.isGroup ? 'group' : 'scene'),
    })),
    scenes: list.scenes.filter((scene) => scene.sceneName !== shelfScene)
      .sort((a, b) => a.sceneIndex - b.sceneIndex).map((scene) => scene.sceneName),
    stream: output(stream), recording: output(recording), sounds, tracks, spotifyAudio, shelf, desktopFeatures,
    chat: null,
  };
}

let stateSnapshot;
let pendingState;
let stateRevision = 0;
function sharedSnapshot() {
  if (stateSnapshot && Date.now() - stateSnapshot.at < 700) return stateSnapshot.value;
  if (!pendingState) {
    const revision = stateRevision;
    const request = snapshot().then((value) => {
      if (revision === stateRevision) stateSnapshot = { value, at: Date.now() };
      return value;
    }).finally(() => {
      if (pendingState === request) pendingState = undefined;
    });
    pendingState = request;
  }
  return pendingState;
}

let currentPreview;
let pendingPreview;
async function preview() {
  if (currentPreview && Date.now() - currentPreview.time < 650) return currentPreview;
  if (!pendingPreview) {
    pendingPreview = (async () => {
      const current = await obs.call('GetCurrentProgramScene');
      const img = await obs.call('GetSourceScreenshot', {
        sourceName: current.currentProgramSceneName, imageFormat: 'jpg',
        imageWidth: 640, imageCompressionQuality: 62,
      });
      const bytes = Buffer.from(img.imageData.split(',')[1], 'base64');
      currentPreview = { bytes, scene: current.currentProgramSceneName, time: Date.now() };
      return currentPreview;
    })().finally(() => { pendingPreview = undefined; });
  }
  return pendingPreview;
}

async function readBody(req, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Файл или команда превышает допустимый размер.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

const validCoordinate = (number) => Number.isFinite(number) && Math.abs(number) <= 32768;
const geometryFields = ['rotation', 'scaleX', 'scaleY', 'boundsWidth', 'boundsHeight',
  'boundsType', 'boundsAlignment', 'alignment', 'cropTop', 'cropBottom', 'cropLeft', 'cropRight', 'cropToBounds'];

function setItemTransform(item, key, data) {
  const previous = item.sceneItemTransform;
  if (data.from && (!item.sceneItemEnabled || previous.positionX !== data.from.x || previous.positionY !== data.from.y ||
    geometryFields.some((field) => Object.hasOwn(data.from, field) && data.from[field] !== previous[field]))) {
    throw new Error('Источник изменился в OBS. Повтори действие.');
  }
  const sx = data.factorX ?? data.scale ?? 1;
  const sy = data.factorY ?? data.scale ?? 1;
  if (!validCoordinate(data.x) || !validCoordinate(data.y)
      || ![sx, sy].every((factor) => Number.isFinite(factor) && factor >= 0.05 && factor <= 20)
      || (data.rotation !== undefined && !validCoordinate(data.rotation))) {
    throw new Error('Проверь координаты, масштаб и поворот.');
  }
  if (!previous.sourceWidth || !previous.sourceHeight) throw new Error('У источника нет видимой области.');
  const sceneItemTransform = { positionX: data.x, positionY: data.y };
  if (data.rotation !== undefined) sceneItemTransform.rotation = data.rotation;
  if (sx !== 1 || sy !== 1) {
    if (previous.boundsType === 'OBS_BOUNDS_NONE') {
      sceneItemTransform.scaleX = previous.scaleX * sx;
      sceneItemTransform.scaleY = previous.scaleY * sy;
      const width = sceneItemTransform.scaleX * (previous.sourceWidth - previous.cropLeft - previous.cropRight);
      const height = sceneItemTransform.scaleY * (previous.sourceHeight - previous.cropTop - previous.cropBottom);
      if (!validCoordinate(width) || !validCoordinate(height)) throw new Error('Размер слоя слишком большой.');
    } else {
      sceneItemTransform.boundsWidth = previous.boundsWidth * sx;
      sceneItemTransform.boundsHeight = previous.boundsHeight * sy;
      if (!validCoordinate(sceneItemTransform.boundsWidth) || !validCoordinate(sceneItemTransform.boundsHeight)) {
        throw new Error('Размер рамки слишком большой.');
      }
    }
  }
  return obs.call('SetSceneItemTransform', { ...key, sceneItemTransform });
}

const sourceFrames = new Map();
let activeSourceCaptures = 0;
async function getSourceFrame(sceneName, itemId) {
  const current = await obs.call('GetCurrentProgramScene');
  if (current.currentProgramSceneName !== sceneName) return { status: 409 };
  const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
  const item = sceneItems.find((entry) => entry.sceneItemId === itemId && entry.sceneItemEnabled);
  if (!item?.sceneItemTransform?.sourceWidth || !item.sceneItemTransform.sourceHeight) return { status: 404 };
  const key = item.sourceUuid || item.sourceName;
  const cached = sourceFrames.get(key);
  if (cached?.pending) return cached.pending;
  if (cached?.expires > Date.now()) return { status: 200, bytes: cached.bytes };
  if (activeSourceCaptures >= 2) return { status: 429 };
  activeSourceCaptures++;
  const ttl = item.inputKind === 'image_source' ? 12000 : 1600;
  const captureSize = item.sceneItemTransform.sourceWidth >= item.sceneItemTransform.sourceHeight
    ? { imageWidth: 400 } : { imageHeight: 400 };
  const pending = obs.call('GetSourceScreenshot', {
    sourceName: item.sourceName, imageFormat: 'png', ...captureSize,
  }).then(({ imageData }) => {
    const bytes = Buffer.from(imageData.split(',')[1], 'base64');
    sourceFrames.set(key, { bytes, expires: Date.now() + ttl });
    return { status: 200, bytes };
  }).catch(() => {
    sourceFrames.delete(key);
    return { status: 404 };
  }).finally(() => { activeSourceCaptures--; });
  if (sourceFrames.size >= 24 && !sourceFrames.has(key)) {
    const old = [...sourceFrames].find(([, entry]) => !entry.pending);
    if (old) sourceFrames.delete(old[0]);
  }
  sourceFrames.set(key, { pending });
  return pending;
}

async function control(data) {
  if (!desktopFeatures && data.kind === 'spotify-player') throw new Error('Подключи локальный режим для Spotify.');
  if (data.kind === 'spotify-player') return spotifyAction(data);
  const list = await obs.call('GetSceneList');
  if (data.kind === 'scene' && data.name !== shelfScene && list.scenes.some((scene) => scene.sceneName === data.name)) {
    await obs.call('SetCurrentProgramScene', { sceneName: data.name });
    currentPreview = undefined;
    return;
  }
  if (data.scene !== list.currentProgramSceneName) {
    throw new Error('Сцена обновилась. Повтори действие.');
  }
  const sceneName = list.currentProgramSceneName;
  const items = (await obs.call('GetSceneItemList', { sceneName })).sceneItems;
  if (data.kind === 'shelf-place' || data.kind === 'shelf-remove') {
    if (sceneName === shelfScene) throw new Error('Сначала включи эфирную сцену в OBS.');
    const templates = await shelfItems(list.scenes);
    const item = templates.find((entry) => entry.id === data.id && entry.name === data.name);
    if (!item) throw new Error('Заготовку уже убрали с полки.');
    if (data.kind === 'shelf-remove') {
      if (data.confirmed !== true) throw new Error('Подтверди удаление заготовки.');
      return obs.call('RemoveSceneItem', { sceneName: shelfScene, sceneItemId: item.id });
    }
    return placeTemplate(sceneName, item, data);
  }
  if (data.kind === 'add-text') return addText(sceneName, data);
  if (data.kind === 'add-window') return addWindow(sceneName, data.value);
  if (data.kind === 'add-existing') {
    const { inputs } = await obs.call('GetInputList');
    if (!inputs.some((input) => input.inputName === data.value)) throw new Error('Источник OBS больше недоступен.');
    if (items.some((item) => item.sourceName === data.value)) throw new Error('Источник уже есть в сцене.');
    const { sceneItemId } = await obs.call('CreateSceneItem', {
      sceneName, sourceName: data.value, sceneItemEnabled: false,
    });
    return { id: sceneItemId, scene: sceneName };
  }
  const spotify = items.find(isSpotify);
  if (spotify && data.kind === 'spotify-mix') {
    if (typeof data.enabled === 'boolean') {
      await obs.call('SetInputMute', { inputName: spotifySource, inputMuted: !data.enabled });
      if (data.enabled && !spotify.sceneItemEnabled) await obs.call('SetSceneItemEnabled', {
        sceneName, sceneItemId: spotify.sceneItemId, sceneItemEnabled: true,
      });
      return;
    }
    if (desktopFeatures && Number.isInteger(data.volume) && data.volume >= 0 && data.volume <= 100) {
      return setSpotifyVolume(data.volume);
    }
  }
  if (data.kind === 'mute' && typeof data.enabled === 'boolean' &&
      (await audioInputs(items)).some((item) => item.sourceName === data.name)) {
    await obs.call('SetInputMute', { inputName: data.name, inputMuted: !data.enabled });
    return;
  }
  const item = items.find((item) => item.sceneItemId === data.id && item.sourceName === data.name);
  if (item) {
    const key = { sceneName, sceneItemId: item.sceneItemId };
    if (data.kind === 'edit-text' && isText(item)) {
      await obs.call('SetInputSettings', { inputName: item.sourceName, inputSettings: textSettings(data) });
    } else if (data.kind === 'track' && item.inputKind === 'ffmpeg_source') {
      await controlTrack(item, key, data);
    } else if (data.kind === 'visibility' && typeof data.enabled === 'boolean') {
      await obs.call('SetSceneItemEnabled', { ...key, sceneItemEnabled: data.enabled });
    } else if (data.kind === 'lock' && typeof data.enabled === 'boolean') {
      await obs.call('SetSceneItemLocked', { ...key, sceneItemLocked: data.enabled });
    } else if (data.kind === 'shelf-save') {
      const t = item.sceneItemTransform;
      if (sceneName === shelfScene || isSpotify(item) || item.isGroup || !t?.sourceWidth || !t.sourceHeight) {
        throw new Error('На полку можно добавить визуальный источник из эфирной сцены.');
      }
      await saveTemplate(list.scenes, key, item);
    } else if (item.sceneItemLocked) {
      throw new Error('Сними блокировку источника.');
    } else if (data.kind === 'remove' && data.confirmed === true) {
      await obs.call('RemoveSceneItem', key);
    } else if (data.kind === 'window' && item.inputKind === 'window_capture') {
      await setWindow(item.sourceName, data.value);
    } else if (data.kind === 'transform') {
      await setItemTransform(item, key, data);
    } else if (data.kind === 'order' && [-1, 1].includes(data.step)) {
      const index = item.sceneItemIndex + data.step;
      if (index >= 0 && index < items.length) {
        await obs.call('SetSceneItemIndex', { ...key, sceneItemIndex: index });
      }
    } else {
      throw new Error('Команда источника недоступна.');
    }
    currentPreview = undefined;
    return;
  }
  throw new Error('Этот элемент недоступен в текущей сцене.');
}

const imageLimit = 18 * 1024 * 1024;
const imageFolder = new URL('./images/', dataFolder);
const musicLimit = 32 * 1024 * 1024;
const musicFolder = new URL('./music/', dataFolder);
const videoLimit = 64 * 1024 * 1024;
const videoFolder = new URL('./media/', dataFolder);

async function saveTemplate(scenes, key, item) {
  if (!scenes.some((scene) => scene.sceneName === shelfScene)) {
    await obs.call('CreateScene', { sceneName: shelfScene });
  }
  const existing = (await obs.call('GetSceneItemList', { sceneName: shelfScene })).sceneItems
    .find((entry) => entry.sourceName === item.sourceName);
  if (existing) {
    const t = item.sceneItemTransform;
    const properties = ['alignment', 'boundsAlignment', 'boundsHeight', 'boundsType', 'boundsWidth',
      'cropBottom', 'cropLeft', 'cropRight', 'cropToBounds', 'cropTop', 'positionX', 'positionY', 'rotation', 'scaleX', 'scaleY'];
    await obs.call('SetSceneItemTransform', { sceneName: shelfScene, sceneItemId: existing.sceneItemId,
      sceneItemTransform: Object.fromEntries(properties.filter((name) => t[name] !== undefined).map((name) => [name, t[name]])),
    });
    return;
  }
  const created = await obs.call('DuplicateSceneItem', { ...key, destinationSceneName: shelfScene });
  await obs.call('SetSceneItemEnabled', { sceneName: shelfScene, sceneItemId: created.sceneItemId, sceneItemEnabled: false });
}

async function placeTemplate(sceneName, item, data) {
  if (!validCoordinate(data.x) || !validCoordinate(data.y)) throw new Error('Координаты вне рабочего поля.');
  const { sceneItemTransform: t } = await obs.call('GetSceneItemTransform', {
    sceneName: shelfScene, sceneItemId: item.id,
  });
  const bounded = t.boundsType !== 'OBS_BOUNDS_NONE';
  const w = bounded ? t.boundsWidth : (t.sourceWidth - t.cropLeft - t.cropRight) * t.scaleX;
  const h = bounded ? t.boundsHeight : (t.sourceHeight - t.cropTop - t.cropBottom) * t.scaleY;
  const dx = (t.alignment & 1 ? .5 : t.alignment & 2 ? -.5 : 0) * w;
  const dy = (t.alignment & 4 ? .5 : t.alignment & 8 ? -.5 : 0) * h;
  const angle = t.rotation * Math.PI / 180;
  const { sceneItemId } = await obs.call('DuplicateSceneItem', {
    sceneName: shelfScene, sceneItemId: item.id, destinationSceneName: sceneName,
  });
  const key = { sceneName, sceneItemId };
  try {
    await obs.call('SetSceneItemLocked', { ...key, sceneItemLocked: false });
    await obs.call('SetSceneItemTransform', { ...key, sceneItemTransform: {
      positionX: data.x - dx * Math.cos(angle) + dy * Math.sin(angle),
      positionY: data.y - dx * Math.sin(angle) - dy * Math.cos(angle),
    } });
    await obs.call('SetSceneItemEnabled', { ...key, sceneItemEnabled: true });
  } catch (error) {
    await obs.call('RemoveSceneItem', key).catch(() => {});
    throw error;
  }
  currentPreview = undefined;
  return { id: sceneItemId, scene: sceneName };
}

async function windowChoices(inputName) {
  const { inputs } = await obs.call('GetInputList', { inputKind: 'window_capture' });
  const input = inputName ? inputs.find((i) => i.inputName === inputName) : inputs[0];
  if (!input) throw new Error('OBS не нашёл источник «Захват окна».');
  const { propertyItems } = await obs.call('GetInputPropertiesListPropertyItems', {
    inputName: input.inputName, propertyName: 'window',
  });
  return propertyItems.filter((item) => item.itemEnabled !== false && typeof item.itemValue === 'string' && item.itemValue)
    .map((item) => ({ label: item.itemName, value: item.itemValue }));
}

async function setWindow(inputName, value) {
  if (!(await windowChoices(inputName)).some((item) => item.value === value)) {
    throw new Error('Окно закрылось. Обнови список окон.');
  }
  return obs.call('SetInputSettings', { inputName, inputSettings: { window: value } });
}

async function addWindow(sceneName, value) {
  const selected = (await windowChoices()).find((item) => item.value === value);
  if (!selected) throw new Error('Окно закрылось. Обнови список окон.');
  const title = selected.label.replace(/^\[[^\]]+\]:\s*/, '').trim().slice(0, 48) || 'Приложение';
  const inputName = 'Окно · ' + title + ' · ' + randomBytes(3).toString('hex');
  const { sceneItemId } = await obs.call('CreateInput', {
    sceneName, inputName, inputKind: 'window_capture', inputSettings: { window: value, priority: 2 }, sceneItemEnabled: false,
  });
  try { await fitNewVisual(sceneName, sceneItemId); }
  catch (error) {
    await obs.call('RemoveInput', { inputName }).catch(() => {});
    throw error;
  }
  return { id: sceneItemId, scene: sceneName };
}

async function fitNewVisual(sceneName, sceneItemId) {
  const video = await obs.call('GetVideoSettings');
  await obs.call('SetSceneItemTransform', { sceneName, sceneItemId, sceneItemTransform: {
    alignment: 5, positionX: video.baseWidth * .2, positionY: video.baseHeight * .2,
    boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: video.baseWidth * .6, boundsHeight: video.baseHeight * .6,
  } });
}

async function stageNewVisual(sceneName, video, width, height) {
  const { baseWidth, baseHeight } = video;
  const scale = Math.min(1, baseWidth * 0.25 / width, baseHeight * 0.36 / height);
  const size = height * scale;
  const gap = Math.round(baseHeight * 0.04);
  let y = Math.round(baseHeight * 0.10);
  const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
  const parked = sceneItems.map((item) => item.sceneItemTransform).filter((t) =>
    t?.alignment === 5 && t.rotation === 0 && t.positionX >= baseWidth && t.height > 0,
  ).sort((a, b) => a.positionY - b.positionY);
  for (const item of parked) {
    if (item.positionY - gap >= y + size) break;
    y = Math.max(y, item.positionY + Math.abs(item.height) + gap);
  }
  if (y + size > baseHeight - gap) y = Math.round((baseHeight - size) / 2);
  return { alignment: 5, scaleX: scale, scaleY: scale,
    positionX: baseWidth + Math.round(baseWidth * 0.018), positionY: Math.round(y) };
}

function textSettings({ text, color, size }) {
  if (typeof text !== 'string' || !text.trim() || text.length > 500 ||
      !Number.isInteger(size) || size < 16 || size > 160 || !/^#[a-f\d]{6}$/i.test(color)) {
    throw new Error('Введи текст до 500 знаков и укажи размер от 16 до 160.');
  }
  const bgr = color.slice(1).match(/../g).reverse().join('');
  return {
    text: text.trim(), color: parseInt(bgr, 16), font: { face: 'Segoe UI', size, style: 'Semibold' },
    outline: true, outline_color: 0, outline_size: 3, read_from_file: false,
    use_extents: true, extents_cx: 1200, extents_cy: 220, extents_wrap: true,
  };
}

async function addText(sceneName, data) {
  const inputSettings = textSettings(data);
  const inputName = 'Текст · ' + randomBytes(3).toString('hex');
  const video = await obs.call('GetVideoSettings');
  const placement = await stageNewVisual(sceneName, video, inputSettings.extents_cx, inputSettings.extents_cy);
  const { sceneItemId } = await obs.call('CreateInput', {
    sceneName, inputName, inputKind: 'text_gdiplus_v3', inputSettings, sceneItemEnabled: false,
  });
  const key = { sceneName, sceneItemId };
  try {
    await obs.call('SetSceneItemTransform', { ...key, sceneItemTransform: placement });
    await obs.call('SetSceneItemEnabled', { ...key, sceneItemEnabled: true });
  } catch (error) {
    await obs.call('RemoveInput', { inputName }).catch(() => {});
    throw error;
  }
  return { id: sceneItemId, scene: sceneName };
}

async function controlTrack(item, key, data) {
  const inputName = item.sourceName;
  if (data.operation === 'seek' && Number.isFinite(data.value) && data.value >= 0) {
    const media = await obs.call('GetMediaInputStatus', { inputName });
    if (!media.mediaDuration) throw new Error('Сначала запусти файл.');
    return obs.call('SetMediaInputCursor', { inputName, mediaCursor: Math.min(media.mediaDuration, Math.round(data.value)) });
  }
  if (data.operation === 'volume' && Number.isInteger(data.value) && data.value >= 0 && data.value <= 100) {
    return obs.call('SetInputVolume', { inputName, inputVolumeMul: data.value / 100 });
  }
  if (data.operation === 'loop' && typeof data.value === 'boolean') {
    const prior = await obs.call('GetMediaInputStatus', { inputName });
    await obs.call('SetInputSettings', { inputName, inputSettings: { looping: data.value } });
    const playing = prior.mediaState === 'OBS_MEDIA_STATE_PLAYING' || prior.mediaState === 'OBS_MEDIA_STATE_PAUSED';
    if (item.sceneItemEnabled && playing && typeof prior.mediaCursor === 'number') {
      await obs.call('SetMediaInputCursor', { inputName, mediaCursor: prior.mediaCursor }).catch(() => {});
    }
    return;
  }
  const allowed = { play: 'PLAY', pause: 'PAUSE', stop: 'STOP', restart: 'RESTART' };
  if (!Object.hasOwn(allowed, data.operation)) throw new Error('Неизвестная команда музыки.');
  const media = await obs.call('GetMediaInputStatus', { inputName });
  if (!item.sceneItemEnabled && ['play', 'restart'].includes(data.operation)) {
    await obs.call('SetSceneItemEnabled', { ...key, sceneItemEnabled: true });
  }
  const selected = data.operation === 'play' && media.mediaState !== 'OBS_MEDIA_STATE_PAUSED'
    ? 'RESTART' : allowed[data.operation];
  await obs.call('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_' + selected });
}

async function addMediaFile(sceneName, name, bytes, video) {
  if ((await obs.call('GetCurrentProgramScene')).currentProgramSceneName !== sceneName) {
    throw new Error('Сцена сменилась. Выбери файл снова.');
  }
  const head = bytes.subarray(0, 12);
  const ext = name.split('.').at(-1)?.toLowerCase();
  const ascii = head.toString('ascii');
  const audioFormat = ext === 'mp3' && (ascii.startsWith('ID3') || (head[0] === 255 && (head[1] & 224) === 224))
    || ext === 'wav' && ascii.startsWith('RIFF') && ascii.endsWith('WAVE')
    || ext === 'ogg' && ascii.startsWith('OggS') || ext === 'flac' && ascii.startsWith('fLaC')
    || ext === 'm4a' && ascii.slice(4, 8) === 'ftyp';
  const videoFormat = (ext === 'mp4' || ext === 'mov') && ascii.slice(4, 8) === 'ftyp'
    || (ext === 'webm' || ext === 'mkv') && head.subarray(0, 4).toString('hex') === '1a45dfa3';
  if (video ? !videoFormat : !audioFormat) throw new Error(video
    ? 'Выбери MP4, MOV, WebM или MKV.' : 'Выбери файл MP3, WAV, OGG, FLAC или M4A.');
  const suffix = randomBytes(6).toString('hex');
  const title = name.slice(0, -ext.length - 1).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 60) || 'Трек';
  const inputName = (video ? 'Видео · ' : 'Музыка · ') + title + ' · ' + suffix.slice(0, 6);
  const folder = video ? videoFolder : musicFolder;
  const file = new URL(suffix + '.' + ext, folder);
  await mkdir(folder, { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' });
  try {
    const { sceneItemId } = await obs.call('CreateInput', {
      sceneName, inputName, inputKind: 'ffmpeg_source', sceneItemEnabled: false,
      inputSettings: { is_local_file: true, local_file: fileURLToPath(file), restart_on_activate: false, close_when_inactive: true },
    });
    if (video) await fitNewVisual(sceneName, sceneItemId);
    await obs.call('SetInputVolume', { inputName, inputVolumeMul: 0.25 });
    return { id: sceneItemId, scene: sceneName };
  } catch (error) {
    const removeResult = await obs.call('RemoveInput', { inputName }).then(() => 'removed', (error) => error.message);
    if (removeResult === 'removed' || removeResult.includes('(600)')) await unlink(file).catch(() => {});
    throw error;
  }
}
async function addImage(sceneName, name, bytes) {
  const current = await obs.call('GetCurrentProgramScene');
  if (current.currentProgramSceneName !== sceneName) throw new Error('Сцена сменилась. Выбери файл снова.');
  if (bytes.length < 45 || bytes.subarray(0, 16).toString('hex') !== '89504e470d0a1a0a0000000d49484452'
      || bytes.subarray(-12).toString('hex') !== '0000000049454e44ae426082') {
    throw new Error('Файл не является PNG.');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || Math.max(width, height) > 2048) throw new Error('Проверь размер изображения.');
  const suffix = randomBytes(6).toString('hex');
  const label = name.replace(/[\x00-\x1f\x7f]/g, '').replace(/\.[^.]*$/, '').trim().slice(0, 60) || 'Картинка';
  const inputName = label + ' · ' + suffix.slice(0, 6);
  const file = new URL(suffix + '.png', imageFolder);
  const video = await obs.call('GetVideoSettings');
  const placement = await stageNewVisual(sceneName, video, width, height);
  await mkdir(imageFolder, { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' });
  let key;
  try {
    const created = await obs.call('CreateInput', {
      sceneName, inputName, inputKind: 'image_source', inputSettings: { file: fileURLToPath(file) },
      sceneItemEnabled: false,
    });
    key = { sceneName, sceneItemId: created.sceneItemId };
    await obs.call('SetSceneItemTransform', { ...key, sceneItemTransform: placement });
    await obs.call('SetSceneItemEnabled', { ...key, sceneItemEnabled: true });
  } catch (error) {
    const removeResult = await obs.call('RemoveInput', { inputName })
      .then(() => 'removed', (error) => error.message);
    if (removeResult === 'removed' || removeResult.includes('(600)')) await unlink(file).catch(() => {});
    throw error;
  }
  currentPreview = undefined;
  return { id: key.sceneItemId, scene: sceneName };
}

let pairingQR;
function getPairingQR() {
  if (!pairingQR) {
    pairingQR = new Promise((resolve, reject) => {
      const source = [
        'import sys, cv2',
        'source = sys.stdin.read().strip()',
        'qr = cv2.QRCodeEncoder_create().encode(source)',
        'qr = cv2.copyMakeBorder(qr, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)',
        'qr = cv2.resize(qr, None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)',
        'ok, png = cv2.imencode(".png", qr)',
        'assert ok',
        'sys.stdout.buffer.write(png.tobytes())',
      ].join('\n');
      const child = execFile('python', ['-c', source], {
        encoding: 'buffer', timeout: 3500, maxBuffer: 65536, windowsHide: true,
      }, (error, bytes) => error ? reject(error) : resolve(bytes));
      child.stdin.on('error', () => {});
      child.stdin.end('http://' + phoneHost + '/#' + code);
    }).catch(() => { pairingQR = undefined; return null; });
  }
  return pairingQR;
}
let action = Promise.resolve();
let queuedActions = 0;
let activeUploads = 0;
async function runAction(res, perform) {
  if (queuedActions >= 24) return reply(res, 429, { error: 'Пульт занят. Повтори команду через секунду.' });
  queuedActions++;
  const next = action.then(async () => {
    if (res.destroyed) return;
    try {
      return await perform();
    } finally {
      stateRevision++;
      stateSnapshot = pendingState = undefined;
    }
  });
  action = next.catch(() => {});
  try {
    const result = await next;
    if (!res.destroyed) return reply(res, 200, result ?? { ok: true });
  } catch (error) {
    if (!res.destroyed) return reply(res, 409, { error: error.message });
  } finally {
    queuedActions--;
  }
}

async function handle(req, res) {
  const host = req.headers.host;
  if (!isLocalPeer(req) || ![desktopHost, phoneHost].includes(host)) return reply(res, 403, { error: 'Доступ только из локальной сети.' });
  if (!req.url?.startsWith('/') || req.url.startsWith('//')) return reply(res, 400, { error: 'Некорректный адрес запроса.' });
  const path = new URL(req.url, 'http://' + desktopHost).pathname;
  const local = req.socket.remoteAddress === '127.0.0.1' && host === desktopHost;
  const proxied = req.headers['x-obs-remote-proxy'] === '1';
  if (proxied && (!local || !publicOrigin)) return reply(res, 403, { error: 'HTTPS-шлюз не настроен.' });
  if (path === '/pair' || path === '/api/pair' || path === '/api/pair/qr') {
    if (serverMode) return reply(res, 404, { error: 'Код задаётся при установке пульта.' });
    if (!local || proxied) return reply(res, 403, { error: 'Код доступен на компьютере с OBS.' });
  }
  if (req.method === 'GET' && assets.has(path)) {
    const [name, kind] = assets.get(path);
    const content = packaged ? Buffer.from(getAsset('public/' + name)) : await readFile(new URL('./public/' + name, import.meta.url));
    if (serverMode && path === '/') {
      return reply(res, 200, content.toString().replace('<html lang="ru">', '<html lang="ru" data-hosted>'), kind);
    }
    return reply(res, 200, content, kind);
  }
  if (req.method === 'GET' && path === '/api/pair') {
    return reply(res, 200, { code, url: 'http://' + (phoneHost || desktopHost) + '/', phone: !!phoneHost });
  }
  if (req.method === 'GET' && path === '/api/pair/qr') {
    const qr = phoneHost && await getPairingQR();
    if (!qr) return reply(res, 404, { error: 'Используй код подключения.' });
    return reply(res, 200, qr, 'image/png');
  }
  if (!path.startsWith('/api/')) return reply(res, 404, { error: 'Страница не найдена.' });
  if (!authorized(req)) return reply(res, 401, { error: 'Введи код с компьютера.' });
  if (serverMode && req.method === 'POST' && req.headers.origin !== publicOrigin) {
    return reply(res, 403, { error: 'Запрос отклонён.' });
  }
  if (serverMode && bridgePort) return relayToDesktop(req, res);
  if (!desktopFeatures && ['/api/video', '/api/spotify', '/api/image', '/api/music', '/api/media-file'].includes(path)) {
    return reply(res, 501, { error: 'Для этой функции подключи локальный режим.' });
  }

  if (req.method === 'GET' && path === '/api/state') return reply(res, 200, await sharedSnapshot());
  if (req.method === 'GET' && path === '/api/video') return attachVideo(obs, res, headers);
  if (req.method === 'GET' && path === '/api/spotify') {
    try { return reply(res, 200, await readSpotify()); }
    catch { return reply(res, 503, { error: 'Windows не предоставил состояние Spotify.' }); }
  }
  if (req.method === 'GET' && path === '/api/source-options') {
    const query = new URL(req.url, 'http://' + desktopHost).searchParams;
    const current = await obs.call('GetCurrentProgramScene');
    const sceneName = current.currentProgramSceneName;
    if (query.get('scene') !== sceneName) return reply(res, 409, { error: 'Сцена сменилась.' });
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
    const itemId = query.get('id');
    const item = itemId === null ? null : sceneItems.find((i) => i.sceneItemId === Number(itemId));
    const kind = query.get('kind');
    if (kind === 'window' && (itemId === null || item?.inputKind === 'window_capture')) {
      const choices = await windowChoices(item?.sourceName);
      const active = item ? (await obs.call('GetInputSettings', { inputName: item.sourceName })).inputSettings.window : null;
      return reply(res, 200, { choices, active });
    }
    if (kind === 'existing') {
      const { inputs } = await obs.call('GetInputList');
      const choices = inputs.filter((i) => !sceneItems.some((s) => s.sourceName === i.inputName))
        .map((i) => ({ label: i.inputName, value: i.inputName }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
      return reply(res, 200, { choices });
    }
    if (kind === 'media' && item?.inputKind === 'ffmpeg_source') return reply(res, 200, await trackSnapshot(item));
    return reply(res, 404, { error: 'Свойства источника недоступны.' });
  }
  if (req.method === 'GET' && path === '/api/text') {
    const query = new URL(req.url, 'http://' + desktopHost).searchParams;
    const current = await obs.call('GetCurrentProgramScene');
    const sceneName = current.currentProgramSceneName;
    if (query.get('scene') !== sceneName) return reply(res, 409, { error: 'Сцена сменилась.' });
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
    const item = sceneItems.find((i) => i.sceneItemId === Number(query.get('id')) && isText(i));
    if (!item) return reply(res, 404, { error: 'Текстовый источник не найден.' });
    const { inputSettings: s } = await obs.call('GetInputSettings', { inputName: item.sourceName });
    const color = (s.color ?? 16777215).toString(16).padStart(6, '0').match(/../g).reverse().join('');
    return reply(res, 200, { text: s.text, size: s.font?.size || 64, color: '#' + color });
  }
  if (req.method === 'GET' && path === '/api/preview') {
    const frame = await preview();
    res.setHeader('X-OBS-Scene', encodeURIComponent(frame.scene));
    return reply(res, 200, frame.bytes, 'image/jpeg');
  }
  if (req.method === 'GET' && path === '/api/source-frame') {
    const query = new URL(req.url, 'http://' + desktopHost).searchParams;
    const id = query.get('id');
    if (!id || !/^\d+$/.test(id)) return reply(res, 400, { error: 'Источник не задан.' });
    const { status, bytes } = await getSourceFrame(query.get('scene'), Number(id));
    if (status !== 200) return reply(res, status, { error: 'Снимок источника пока недоступен.' });
    return reply(res, 200, bytes, 'image/png');
  }
  if (req.method === 'POST' && ['/api/control', '/api/image', '/api/music', '/api/media-file'].includes(path)) {
    const origin = req.headers.origin;
    const upload = path !== '/api/control';
    const media = path === '/api/music' || path === '/api/media-file';
    const video = path === '/api/media-file';
    const type = media ? 'application/octet-stream' : upload ? 'image/png' : 'application/json';
    const expectedOrigin = proxied || serverMode ? publicOrigin : 'http://' + host;
    if (origin !== expectedOrigin || req.headers['content-type']?.split(';')[0] !== type) {
      return reply(res, 403, { error: 'Запрос отклонён.' });
    }
    const limit = video ? videoLimit : media ? musicLimit : upload ? imageLimit : 4096;
    if (Number(req.headers['content-length']) > limit || (upload && activeUploads >= 2)) {
      res.setHeader('Connection', 'close');
      return Number(req.headers['content-length']) > limit
        ? reply(res, 413, { error: 'Файл слишком большой.' })
        : reply(res, 429, { error: 'Дождись завершения текущих загрузок.' });
    }
    if (upload) activeUploads++;
    try {
      const bytes = await readBody(req, limit);
      if (upload) {
        const query = new URL(req.url, 'http://' + desktopHost).searchParams;
        const scene = query.get('scene');
        const name = query.get('name') || 'Картинка';
        return await runAction(res, () => media ? addMediaFile(scene, name, bytes, video) : addImage(scene, name, bytes));
      }
      const data = JSON.parse(bytes);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(res, 400, { error: 'Команда должна быть объектом.' });
      return await runAction(res, () => control(data));
    } catch (error) {
      if (!res.destroyed) return reply(res, 400, { error: error.message });
    } finally {
      if (upload) activeUploads--;
    }
  }
  return reply(res, 404, { error: 'Команда не найдена.' });
}

function relayToDesktop(req, res) {
  const upstreamHeaders = { 'X-OBS-Code': bridgeCode, 'X-OBS-Remote-Proxy': '1' };
  for (const name of ['origin', 'content-type', 'content-length']) {
    if (req.headers[name] !== undefined) upstreamHeaders[name] = req.headers[name];
  }
  const upstream = request({
    hostname: '127.0.0.1', port: bridgePort, method: req.method, path: req.url, headers: upstreamHeaders,
  }, (response) => {
    clearTimeout(timeout);
    res.writeHead(response.statusCode, response.headers);
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  const timeout = setTimeout(() => upstream.destroy(), 20000);
  upstream.on('error', () => {
    clearTimeout(timeout);
    if (!res.headersSent && !res.destroyed) reply(res, 503, { error: 'Локальный пульт недоступен. Проверь SSH-туннель.' });
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

function serve(address) {
  const server = createServer({ requestTimeout: 60000, headersTimeout: 15000 }, (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 503, { error: 'OBS недоступен. Пульт переподключится автоматически.' });
      else res.end();
    });
  });
  server.maxConnections = 100;
  server.on('error', (error) => {
    console.error(address + ':' + port + ' ' + error.code);
    process.exitCode = 1;
  });
  server.listen(port, address, () => {
    console.log('OBS remote listening at http://' + address + ':' + port);
  });
}
serve('127.0.0.1');
if (!loopbackOnly && lan) serve(lan.address);




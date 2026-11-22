const $ = (id) => document.getElementById(id);
const hosted = document.documentElement.hasAttribute('data-hosted');
const local = location.hostname === '127.0.0.1' && !hosted;
const cleanCode = (value) => value.length <= 64 ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
const pairingCode = cleanCode(location.hash.slice(1));
const savedCode = cleanCode(sessionStorage.getItem('obs-remote-code') || '');
let code = pairingCode.length === 12 ? pairingCode : savedCode.length === 12 ? savedCode : '';
let state;
let pending = false;
let busy = false;
let generation = 0;
let pictureURL;
let lastFrame = 0;
let lastSceneList = '';
let lastControlsKey;
const tabNames = ['scenes', 'studio', 'layers', 'mixer'];
function tabFromURL() {
  const view = new URLSearchParams(location.search).get('view');
  return tabNames.includes(view) ? view : 'scenes';
}
let tab = tabFromURL();
let selection;
let layerKey;
let formKey;
let drag;
let trackKey;
let textTarget;
let editMode = false;
let spotify;
let spotifyPending = false;
let spotifyUpdated = 0;
let choiceTarget;
let mediaTarget;
let removeTarget;
let shelfKey;
let shelfPick;
let shelfDrag;
let shelfSkipClickUntil = 0;
let workspace = 'wide';
const sourceKinds = {
  window_capture: 'Окно', game_capture: 'Игра', image_source: 'Картинка',
  ffmpeg_source: 'Медиа', text_gdiplus_v3: 'Текст', browser_source: 'Браузер',
  wasapi_input_capture: 'Микрофон', wasapi_process_output_capture: 'Звук', dshow_input: 'Камера',
  monitor_capture: 'Экран', scene: 'Сцена', group: 'Группа',
};

if (location.hash) history.replaceState(null, '', location.pathname + location.search);
if (hosted) $('pair-hint').textContent = 'Введи код подключения, заданный при установке сервера.';
$('pair-link').hidden = !local;
$('admin-pair-link').hidden = !local;

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store', signal: AbortSignal.timeout(5500), ...options,
    headers: { ...options.headers, 'X-OBS-Code': code },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || 'Нет связи с пультом.'), { status: response.status });
  }
  return response;
}

function pair(error = '') {
  live.stop();
  $('pair').hidden = false;
  $('remote').hidden = true;
  $('top-outputs').hidden = true;
  $('pair-error').textContent = error;
  $('connection').dataset.state = 'offline';
  $('connection').lastElementChild.textContent = 'Ожидание';
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

function outputLabel(id, data) {
  const out = $(id);
  out.dataset.active = data.active;
  out.textContent = data.active ? (data.paused ? 'Пауза · ' : '') + formatTime(data.elapsed) : 'Выкл.';
}

function makeButton(name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.scene = name;
  const label = document.createElement('span');
  label.textContent = name;
  const status = document.createElement('span');
  status.className = 'scene-current';
  status.textContent = 'Активна';
  status.hidden = true;
  button.append(label, status);
  button.addEventListener('click', () => command({ kind: 'scene', name }));
  return button;
}

function controlRow(label, active, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch-row';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-checked', active);
  button.disabled = busy;
  button.addEventListener('click', handler);
  const text = document.createElement('span');
  text.textContent = label;
  const right = document.createElement('span');
  right.className = 'switch-value';
  right.textContent = active ? 'Вкл' : 'Выкл';
  const toggle = document.createElement('span');
  toggle.className = 'switch';
  toggle.setAttribute('aria-hidden', 'true');
  right.append(toggle);
  button.append(text, right);
  return button;
}

function render() {
  if (!state) return;
  $('pair').hidden = true;
  $('remote').hidden = false;
  $('top-outputs').hidden = false;
  $('connection').dataset.state = 'online';
  $('connection').lastElementChild.textContent = 'OBS на связи';
  $('program').textContent = state.current;
  for (const button of document.querySelectorAll('[data-tab], [data-studio-jump], #edit, #expand-preview')) {
    button.disabled = false;
  }
  $('studio').textContent = state.studio ? 'Режим студии · Программа' : 'Программа';
  outputLabel('stream', state.stream);
  outputLabel('recording', state.recording);

  const sceneKey = JSON.stringify(state.scenes);
  if (lastSceneList !== sceneKey) {
    $('scenes').replaceChildren(...state.scenes.map(makeButton));
    lastSceneList = sceneKey;
  }
  for (const button of $('scenes').children) {
    const current = button.dataset.scene === state.current;
    button.setAttribute('aria-pressed', current);
    button.lastElementChild.hidden = !current;
    button.disabled = busy || current;
  }
  $('pause').hidden = true;
  const hasDesktop = state.desktopFeatures !== false;
  for (const id of ['upload', 'add-video', 'add-music', 'spotify-panel']) $(id).hidden = !hasDesktop;

  const controlsKey = JSON.stringify([state.current, state.sounds, state.chat, busy]);
  if (controlsKey !== lastControlsKey) {
    renderControls();
    lastControlsKey = controlsKey;
  }
  $('upload').disabled = busy;
  $('add-text').disabled = busy;
  $('add-music').disabled = busy;
  $('add-source').disabled = busy;
  renderSpotify();
  renderTracks();
  renderLayers();
}

function renderControls() {
  const rows = state.sounds.map(({ id, muted }) => controlRow(
    id, !muted,
    () => command({ kind: 'mute', name: id, enabled: muted }),
  ));
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'notice';
    empty.textContent = 'В этой сцене нет доступных переключателей.';
    rows.push(empty);
  }
  const focused = document.activeElement?.getAttribute('aria-label');
  $('controls').replaceChildren(...rows);
  if (focused) rows.find((row) => row.getAttribute('aria-label') === focused)?.focus({ preventScroll: true });
}

const getSelected = () => selection?.scene === state?.current
  ? state?.items.find((item) => item.id === selection.id) : undefined;

function elementButton(text, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', handler);
  return button;
}

function layerCommand(item, kind, values) {
  if (item) return command({ kind, id: item.id, name: item.name, ...values });
}

function selectItem(item) {
  selection = { scene: state.current, id: item.id };
  renderLayers();
}

function setShelfPick(entry) {
  shelfPick = entry ? { ...entry, scene: state.current } : null;
  $('workbench-caption').textContent = entry ? 'Коснись места для вставки' : 'За кадром · снимки источников';
  renderShelf();
}

function placeShelf(entry, event, stage = stageGeometry()) {
  if (entry.scene !== state.current || busy) return;
  const x = (event.clientX - stage.frame.left) / stage.sx;
  const y = (event.clientY - stage.frame.top) / stage.sy;
  perform(async () => {
    selection = await send({ kind: 'shelf-place', id: entry.id, name: entry.name, x, y }, entry.scene)
      .then((response) => response.json());
  }, 'Добавляю заготовку…');
}

function renderShelf() {
  const entries = state.shelf;
  $('shelf-count').hidden = !entries.length;
  $('shelf-count').textContent = entries.length;
  const key = JSON.stringify(entries);
  const list = $('shelf-items');
  if (key !== shelfKey) {
    const rows = entries.map((entry) => {
      const row = document.createElement('li');
      const pick = elementButton(entry.name, 'quiet shelf-item', () => {
        if (Date.now() < shelfSkipClickUntil) return;
        if (!editMode) setEdit(true);
        setShelfPick(shelfPick?.id === entry.id ? null : entry);
      });
      pick.dataset.shelf = entry.id;
      pick.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !event.isPrimary || busy) return;
        shelfDrag = { entry: { ...entry, scene: state.current }, pointer: event.pointerId,
          x: event.clientX, y: event.clientY, active: false };
        pick.setPointerCapture(event.pointerId);
      });
      pick.addEventListener('pointermove', (event) => {
        if (shelfDrag?.pointer !== event.pointerId) return;
        if (!shelfDrag.active) {
          if (Math.hypot(event.clientX - shelfDrag.x, event.clientY - shelfDrag.y) < 7) return;
          shelfDrag.active = true;
          setShelfPick(null);
          if (!editMode) setEdit(true);
        }
        const ghost = $('shelf-ghost');
        ghost.hidden = false;
        ghost.textContent = entry.name;
        ghost.style.transform = 'translate(' + (event.clientX + 12) + 'px,' + (event.clientY - 26) + 'px)';
      });
      const finish = (event) => {
        if (shelfDrag?.pointer !== event.pointerId) return;
        const { entry: dropped, active } = shelfDrag;
        shelfDrag = null;
        $('shelf-ghost').hidden = true;
        if (!active) return;
        shelfSkipClickUntil = Date.now() + 400;
        if (event.type !== 'pointerup') return;
        const stage = stageGeometry();
        if (event.clientX >= stage.rect.left && event.clientX <= stage.rect.right
          && event.clientY >= stage.rect.top && event.clientY <= stage.rect.bottom) {
          placeShelf(dropped, event, stage);
        }
      };
      pick.addEventListener('pointerup', finish);
      pick.addEventListener('pointercancel', finish);
      pick.addEventListener('lostpointercapture', finish);
      const remove = elementButton('Убрать', 'quiet', () => {
        removeTarget = { scene: state.current, item: entry, shelf: true };
        $('remove-title').textContent = 'Убрать заготовку с полки?';
        $('remove-name').textContent = entry.name;
        $('remove-error').hidden = true;
        $('remove-dialog').showModal();
      });
      remove.setAttribute('aria-label', 'Убрать с полки ' + entry.name);
      row.append(pick, remove);
      return row;
    });
    list.replaceChildren(...rows);
    if (shelfPick && !entries.some((entry) => entry.id === shelfPick.id)) shelfPick = null;
    shelfKey = key;
  }
  for (const button of list.querySelectorAll('button')) {
    button.disabled = busy;
    if (button.dataset.shelf) button.setAttribute('aria-pressed', Number(button.dataset.shelf) === shelfPick?.id);
  }
  $('shelf-help').textContent = entries.length
    ? 'Перетащи заготовку на поле или выбери её и коснись нужного места.'
    : 'Выбери слой и нажми «На полку».';
}

function renderTracks() {
  const parent = $('tracks');
  if (parent.querySelector('input:active')) return;
  const key = JSON.stringify([state.current, state.tracks.map(({ cursor, duration, ...track }) => track), busy]);
  if (key === trackKey) return;
  trackKey = key;
  const rows = state.tracks.map((track) => {
    const pane = document.createElement('article');
    pane.className = 'track';
    const title = document.createElement('h4');
    title.textContent = track.title;
    const row = document.createElement('div');
    row.className = 'track-actions';
    const run = (operation, value) => layerCommand(track, 'track', { operation, value });
    const play = elementButton(track.playing ? 'Пауза' : 'Играть', 'quiet', () => run(track.playing ? 'pause' : 'play'));
    const stop = elementButton('Стоп', 'quiet', () => run('stop'));
    const repeat = elementButton('Повтор', 'quiet', () => run('loop', !track.loop));
    repeat.setAttribute('aria-pressed', track.loop);
    stop.disabled = busy || !(track.playing || track.paused);
    play.disabled = repeat.disabled = busy;
    row.append(play, stop, repeat);
    const label = document.createElement('label');
    label.textContent = 'Громкость';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.value = Math.min(100, track.volume);
    volume.disabled = busy;
    const value = document.createElement('output');
    value.textContent = volume.value + '%';
    volume.addEventListener('input', () => { value.textContent = volume.value + '%'; });
    volume.addEventListener('change', () => run('volume', volume.valueAsNumber));
    label.append(volume, value);
    pane.append(title, row, label);
    return pane;
  });
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'caption';
    empty.textContent = 'Добавь трек, чтобы запустить его в OBS.';
    rows.push(empty);
  }
  parent.replaceChildren(...rows);
}

function renderSpotify() {
  const audio = state?.spotifyAudio;
  const title = $('spotify-title');
  const status = $('spotify-artist');
  title.textContent = spotify?.title || (spotify?.running ? 'Выбери трек в Spotify'
    : spotify ? 'Spotify закрыт' : 'Подключение…');
  status.textContent = spotify?.artist || (spotify?.running && !spotify.available ? 'В приложении или через Spotify Connect' : '');
  $('spotify-open').disabled = busy;
  $('spotify-play').textContent = spotify?.playing ? 'Пауза' : 'Играть';
  $('spotify-play').disabled = busy || !(spotify?.playing ? spotify.pause : spotify?.play);
  $('spotify-previous').disabled = busy || !spotify?.previous;
  $('spotify-next').disabled = busy || !spotify?.next;
  $('spotify-route').hidden = !audio;
  if (audio) {
    const level = $('spotify-volume');
    const available = Number.isInteger(spotify?.volume);
    level.disabled = !available || busy;
    if (available && !level.matches(':active')) level.value = spotify.volume;
    $('spotify-level').textContent = available ? level.value + '%' : '—';
    level.title = available ? 'Громкость приложения Spotify в Windows' : 'Запусти трек в Spotify';
    $('spotify-mute').setAttribute('aria-pressed', !audio.muted);
    $('spotify-mute').textContent = audio.muted ? 'В OBS выключен' : 'В OBS включён';
    $('spotify-mute').disabled = busy;
  }
}

async function refreshSpotify(force = false) {
  if (!code || spotifyPending || document.hidden ||
    (!force && (!['studio', 'mixer'].includes(tab) || Date.now() - spotifyUpdated < 3400))) return;
  spotifyPending = true;
  try { spotify = await api('/api/spotify').then((res) => res.json()); }
  catch { spotify = { available: false, running: false, title: 'Spotify недоступен' }; }
  finally {
    spotifyPending = false;
    spotifyUpdated = Date.now();
    renderSpotify();
  }
}

function spotifyControl(action, link) {
  return perform(async () => {
    await api('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'spotify-player', action, link }) });
    spotifyUpdated = 0;
    await refreshSpotify(true);
  }, 'Передаю команду Spotify…');
}

function renderLayers() {
  const selected = getSelected();
  const list = $('layers');
  const inspector = $('inspector');
  const key = JSON.stringify([state.current, selected?.id,
    state.items.map(({ id, name, enabled, kind }) => [id, name, enabled, kind])]);
  if (layerKey !== key) {
    const previousFocus = document.activeElement;
    const focusKey = previousFocus?.dataset.layerControl;
    const inspectorFocused = inspector.contains(previousFocus);
    if (list.contains(inspector)) list.after(inspector);
    const rows = state.items.map((item) => {
      const open = item.id === selected?.id;
      const row = document.createElement('li');
      row.dataset.enabled = item.enabled;
      const controls = document.createElement('div');
      controls.className = 'layer-row';
      const choose = elementButton(item.name, 'layer-name', () => {
        if (getSelected()?.id === item.id) {
          selection = undefined;
          renderLayers();
        } else selectItem(item);
      });
      const identity = document.createElement('span');
      identity.className = 'layer-identity';
      const name = document.createElement('span');
      name.textContent = item.name;
      const type = document.createElement('small');
      type.textContent = sourceKinds[item.kind] || 'Источник OBS';
      const caret = document.createElement('span');
      caret.className = 'layer-caret';
      caret.setAttribute('aria-hidden', 'true');
      identity.append(name, type);
      choose.replaceChildren(identity, caret);
      choose.dataset.layerControl = 'pick-' + item.id;
      choose.setAttribute('aria-expanded', open);
      if (open) choose.setAttribute('aria-controls', 'inspector');
      const audio = state.sounds.some((sound) => sound.id === item.name);
      const toggle = elementButton('', 'layer-toggle',
        () => layerCommand(item, 'visibility', { enabled: !item.enabled }));
      const icon = document.createElement('span');
      icon.className = audio ? 'layer-state-icon is-audio' : 'layer-state-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.append(document.createElement('i'));
      toggle.append(icon);
      toggle.dataset.layerControl = 'show-' + item.id;
      toggle.setAttribute('aria-pressed', item.enabled);
      toggle.setAttribute('aria-label', (audio ? 'Включён в сцене · ' : 'Видимость · ') + item.name);
      toggle.title = audio ? (item.enabled ? 'Выключить источник звука' : 'Включить источник звука')
        : (item.enabled ? 'Скрыть источник' : 'Показать источник');
      controls.append(choose, toggle);
      row.append(controls);
      if (open) {
        row.classList.add('layer-open');
        row.append(inspector);
      }
      return row;
    });
    list.replaceChildren(...rows);
    if (inspectorFocused && selected) previousFocus.focus({ preventScroll: true });
    else if (focusKey) Array.from(list.querySelectorAll('[data-layer-control]'))
      .find((button) => button.dataset.layerControl === focusKey)?.focus({ preventScroll: true });
    layerKey = key;
  }
  for (const button of list.querySelectorAll('[data-layer-control]')) {
    button.disabled = false;
    if (button.classList.contains('layer-toggle')) button.setAttribute('aria-disabled', busy);
  }
  inspector.hidden = !selected;
  if (selected) {
    const t = selected.transform;
    const geometry = t && EditorGeometry.box(t);
    const editable = !selected.locked && !!geometry;
    $('selected-name').textContent = selected.name;
    $('lock').textContent = selected.locked ? 'Разблокировать' : 'Заблокировать';
    $('lock').disabled = busy;
    $('edit-text').hidden = !selected.text;
    $('edit-text').disabled = busy;
    $('edit-window').hidden = selected.kind !== 'window_capture';
    $('edit-window').disabled = busy || selected.locked;
    $('edit-media').hidden = selected.kind !== 'ffmpeg_source';
    $('edit-media').disabled = busy;
    $('remove-source').disabled = busy || selected.locked;
    $('save-shelf').disabled = busy || state.current === 'Заготовки · Пульт OBS'
      || !t?.sourceWidth || !t.sourceHeight || selected.kind === 'group';
    $('save-shelf').textContent = state.shelf.some((entry) => entry.name === selected.name)
      ? 'Обновить на полке' : 'На полку';
    $('park-source').hidden = !editable || !selected.enabled;
    $('park-source').disabled = busy;
    if (editable && selected.enabled) {
      const parked = isOffCanvas(sceneBounds(selected));
      $('park-source').textContent = parked ? 'Вернуть в кадр' : 'За кадр';
      $('park-source').classList.toggle('primary-lite', parked);
    }
    $('up').disabled = busy || selected.locked || selected.index >= state.items.length - 1;
    $('down').disabled = busy || selected.locked || selected.index <= 0;
    $('transform').hidden = !editable;
    $('transform-hint').textContent = selected.locked ? 'Источник заблокирован.' : editable
      ? (selected.enabled ? (editMode ? 'Потяни за угол рамки, чтобы изменить размер.' : 'Открой «Монтаж», чтобы двигать слой и менять размер пальцем.')
        : 'Покажи источник, чтобы перетащить его в кадре.')
      : 'У источника нет видимой области.';
    const newFormKey = JSON.stringify([state.current, selected.id, t?.positionX, t?.positionY, t?.rotation,
      geometry?.w, geometry?.h]);
    if (editable && formKey !== newFormKey) {
      $('position-x').value = rounded(t.positionX);
      $('position-y').value = rounded(t.positionY);
      $('rotation').value = rounded(t.rotation);
      $('source-width').value = rounded(geometry.w);
      $('source-height').value = rounded(geometry.h);
      formKey = newFormKey;
    }
    for (const input of $('transform').elements) input.disabled = busy;
  } else formKey = undefined;
  renderShelf();
  drawPlacement();
}

const rounded = (value) => Math.round(value * 10) / 10;
const placement = $('placement');
const pen = placement.getContext('2d');
let hit;
const frameCache = new Map();
let frameScene;
let sourceRequests = 0;

function stageGeometry() {
  const rect = $('workbench').getBoundingClientRect();
  const frame = document.querySelector('.picture').getBoundingClientRect();
  return {
    rect, frame, ox: frame.left - rect.left, oy: frame.top - rect.top,
    sx: frame.width / state.canvas.width, sy: frame.height / state.canvas.height,
  };
}

function projected(item, stage) {
  if (!item?.enabled || !item.transform) return null;
  let t = item.transform;
  if (drag?.item.id === item.id && drag.scene === state.current) {
    t = { ...t, positionX: drag.x, positionY: drag.y };
    if (drag.factorX !== undefined) {
      if (t.boundsType === 'OBS_BOUNDS_NONE') {
        t.scaleX *= drag.factorX;
        t.scaleY *= drag.factorY;
      } else {
        t.boundsWidth *= drag.factorX;
        t.boundsHeight *= drag.factorY;
      }
    }
  }
  const box = EditorGeometry.box(t);
  return box && { ...box, t, sx: stage.sx, sy: stage.sy, ox: stage.ox, oy: stage.oy };
}

function originCorners(box) {
  return EditorGeometry.corners(box).map(([a, b]) => EditorGeometry.rotate(a, b, box.angle));
}

function sceneBounds(item) {
  const box = projected(item, {});
  const corners = originCorners(box);
  const x = corners.map(([value]) => value + box.x);
  const y = corners.map(([, value]) => value + box.y);
  return { left: Math.min(...x), right: Math.max(...x), top: Math.min(...y), bottom: Math.max(...y) };
}

function isOffCanvas(bounds) {
  return bounds.left >= state.canvas.width || bounds.top >= state.canvas.height || bounds.right <= 0 || bounds.bottom <= 0;
}

function drawPlacement() {
  const item = getSelected();
  const image = live.active ? $('live') : $('preview');
  placement.hidden = !editMode || !state || image.hidden || (!live.active && image.dataset.scene !== state.current);
  hit = undefined;
  if (placement.hidden) return;
  const stage = stageGeometry();
  const { width, height } = stage.rect;
  if (!width || !height) return;
  if (frameScene !== state.current) {
    frameScene = state.current;
    frameCache.clear();
  }
  const pixelRatio = Math.min(devicePixelRatio, 2);
  const targetWidth = Math.round(width * pixelRatio);
  const targetHeight = Math.round(height * pixelRatio);
  if (placement.width !== targetWidth) placement.width = targetWidth;
  if (placement.height !== targetHeight) placement.height = targetHeight;
  pen.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  pen.clearRect(0, 0, width + 1, height + 1);
  pen.save();
  pen.beginPath();
  pen.rect(0, 0, width, height);
  pen.rect(stage.ox, stage.oy, stage.frame.width, stage.frame.height);
  pen.clip('evenodd');
  for (const candidate of state.items.toReversed()) {
    const box = projected(candidate, stage);
    if (!box || !visibleOutside(box, stage)) continue;
    const bitmap = sourceFrame(candidate);
    if (bitmap) paintSource(box, bitmap);
    else if (candidate.id !== item?.id) drawOutline(box, candidate, false);
  }
  pen.restore();
  hit = projected(item, stage);
  if (hit) drawOutline(hit, item, true);
}

function visibleOutside(box, stage) {
  const v = box.visual;
  const area = v.clip ? box : { ...box, left: v.left, top: v.top, w: v.w, h: v.h };
  const corners = screenCorners(area);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const [left, right] = [Math.min(...xs), Math.max(...xs)];
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  return right > 0 && bottom > 0 && left < stage.rect.width && top < stage.rect.height &&
    (left < stage.ox || top < stage.oy || right > stage.ox + stage.frame.width || bottom > stage.oy + stage.frame.height);
}

function sourceFrame(item) {
  const key = item.id + ':' + item.name;
  const scene = state.current;
  let entry = frameCache.get(key);
  if (!entry?.pending && !(entry?.next > Date.now()) && sourceRequests < 2) {
    entry ??= {};
    if (!frameCache.has(key) && frameCache.size >= 18) frameCache.delete(frameCache.keys().next().value);
    frameCache.set(key, entry);
    entry.pending = true;
    sourceRequests++;
    api('/api/source-frame?' + new URLSearchParams({ scene, id: item.id }))
      .then((response) => response.blob()).then(async (blob) => {
        const url = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          entry.image = image;
          entry.next = Date.now() + (item.kind === 'image_source' ? 12000 : 1700);
        } finally { URL.revokeObjectURL(url); }
      }).catch(() => { entry.next = Date.now() + 2500; })
      .finally(() => {
        entry.pending = false;
        sourceRequests--;
        if (entry.image && frameScene === scene && !document.hidden) drawPlacement();
      });
  }
  return entry?.image;
}

function paintSource(box, image) {
  const { visual: v, t } = box;
  const rx = image.naturalWidth / t.sourceWidth;
  const ry = image.naturalHeight / t.sourceHeight;
  pen.save();
  pen.translate(box.ox + box.x * box.sx, box.oy + box.y * box.sy);
  pen.scale(box.sx, box.sy);
  pen.rotate(box.angle);
  if (v.clip) {
    pen.beginPath();
    pen.rect(box.left, box.top, box.w, box.h);
    pen.clip();
  }
  pen.translate(v.left + (v.flippedX ? v.w : 0), v.top + (v.flippedY ? v.h : 0));
  pen.scale(v.flippedX ? -1 : 1, v.flippedY ? -1 : 1);
  pen.drawImage(image, t.cropLeft * rx, t.cropTop * ry, v.sourceW * rx, v.sourceH * ry, 0, 0, v.w, v.h);
  pen.restore();
}

function screenCorners(box) {
  return originCorners(box).map(([a, b]) => [box.ox + (box.x + a) * box.sx, box.oy + (box.y + b) * box.sy]);
}

function drawOutline(box, item, active) {
  const corners = screenCorners(box);
  pen.beginPath();
  corners.forEach(([vx, vy], i) => i ? pen.lineTo(vx, vy) : pen.moveTo(vx, vy));
  pen.closePath();
  if (active) {
    pen.lineWidth = 4;
    pen.strokeStyle = '#121316';
    pen.stroke();
  } else {
    pen.fillStyle = '#27363a88';
    pen.fill();
  }
  pen.lineWidth = active ? 2 : 1;
  pen.strokeStyle = active && !item.locked ? '#ace0c3' : '#78908b';
  pen.stroke();
  if (active && !item.locked) {
    for (const [x, y] of corners) {
      pen.fillStyle = '#141a1d';
      pen.fillRect(x - 5, y - 5, 10, 10);
      pen.fillStyle = '#ace0c3';
      pen.fillRect(x - 3, y - 3, 6, 6);
    }
  }
  if (!active) {
    const lx = Math.min(...corners.map(([px]) => px));
    const ly = Math.min(...corners.map(([, py]) => py));
    pen.font = '11px system-ui';
    pen.textBaseline = 'top';
    pen.fillStyle = '#d6e4e1';
    pen.fillText(item.name, lx + 5, ly + 5, 130);
  }
}

function nearestHandle(box, event, rect) {
  if (!box) return -1;
  const xx = event.clientX - rect.left;
  const yy = event.clientY - rect.top;
  let best = Math.min(event.pointerType === 'touch' ? 22 : 12,
    Math.max(7, Math.min(box.w * box.sx, box.h * box.sy) * 0.4));
  let selected = -1;
  screenCorners(box).forEach(([x, y], index) => {
    const distance = Math.hypot(x - xx, y - yy);
    if (distance <= best) { best = distance; selected = index; }
  });
  return selected;
}

function containsPointer(box, event, rect) {
  if (!box) return false;
  const { left, top, w, h, angle, x, y, sx, sy, ox, oy } = box;
  const px = (event.clientX - rect.left - ox) / sx - x;
  const py = (event.clientY - rect.top - oy) / sy - y;
  const ax = px * Math.cos(angle) + py * Math.sin(angle);
  const ay = -px * Math.sin(angle) + py * Math.cos(angle);
  return ax >= Math.min(left, left + w) - 8 / sx && ax <= Math.max(left, left + w) + 8 / sx
      && ay >= Math.min(top, top + h) - 8 / sy && ay <= Math.max(top, top + h) + 8 / sy;
}

placement.addEventListener('pointerdown', (event) => {
  let item = getSelected();
  if (!event.isPrimary || busy || drag || event.button !== 0 || !state) return;
  const stage = stageGeometry();
  const { rect } = stage;
  if (shelfPick) {
    const entry = shelfPick;
    setShelfPick(null);
    placeShelf(entry, event, stage);
    return;
  }
  const handle = item && !item.locked ? nearestHandle(hit, event, rect) : -1;
  if (handle < 0 && (!item || item.locked || !containsPointer(hit, event, rect))) {
    item = state.items.find((candidate) => !candidate.locked
      && containsPointer(projected(candidate, stage), event, rect));
    if (!item) return;
    selectItem(item);
  }
  if (!hit) return;
  const { x, y, sx, sy } = hit;
  placement.setPointerCapture(event.pointerId);
  drag = { item, scene: state.current, pointer: event.pointerId, startX: x, startY: y,
    x, y, clientX: event.clientX, clientY: event.clientY, sx, sy, box: hit, handle,
    linked: $('aspect-lock').checked };
});
placement.addEventListener('pointermove', (event) => {
  if (drag?.pointer !== event.pointerId) {
    if (event.pointerType === 'mouse') {
      const handle = !getSelected()?.locked && nearestHandle(hit, event, placement.getBoundingClientRect()) >= 0;
      placement.style.cursor = handle ? 'nwse-resize' : '';
    }
    return;
  }
  const dx = (event.clientX - drag.clientX) / drag.sx;
  const dy = (event.clientY - drag.clientY) / drag.sy;
  if (drag.handle >= 0) Object.assign(drag, EditorGeometry.resize(drag.box, drag.handle, dx, dy, drag.linked));
  else {
    drag.x = rounded(drag.startX + dx);
    drag.y = rounded(drag.startY + dy);
  }
  drawPlacement();
});
function finishDrag(event) {
  if (drag?.pointer !== event.pointerId) return;
  const { item, scene, x, y, startX, startY, factorX = 1, factorY = 1 } = drag;
  drag = undefined;
  if (event.type === 'pointerup' && scene === state.current && (x !== startX || y !== startY || factorX !== 1 || factorY !== 1)) {
    layerCommand(item, 'transform', { x, y, factorX, factorY, from: { ...item.transform, x: startX, y: startY } });
  }
  drawPlacement();
}
placement.addEventListener('pointerup', finishDrag);
placement.addEventListener('pointercancel', finishDrag);
placement.addEventListener('lostpointercapture', finishDrag);
new ResizeObserver(drawPlacement).observe(document.querySelector('.picture'));

const live = new LivePreview($('live'), $('freshness'), api, (active) => {
  if (active) {
    $('preview').hidden = true;
    $('placeholder').hidden = true;
  }
  drawPlacement();
});

function disconnected(error) {
  lastControlsKey = undefined;
  if (error.status === 401) {
    code = '';
    sessionStorage.removeItem('obs-remote-code');
    pair(hosted ? 'Проверь код подключения сервера.' : 'Код недействителен. Открой свежий код на ПК.');
    return;
  }
  live.stop();
  $('connection').dataset.state = 'offline';
  $('connection').lastElementChild.textContent = 'Связь потеряна';
  $('freshness').textContent = 'Кадр не обновляется';
  $('notice').textContent = error.status === 503 ? error.message : 'Переподключаюсь к пульту…';
  for (const button of $('remote').querySelectorAll('button')) button.disabled = true;
}

async function refresh() {
  if (!code || pending || busy || document.hidden) return;
  pending = true;
  const version = generation;
  const image = live.active ? null : api('/api/preview').then(async (res) => ({
    blob: await res.blob(), scene: decodeURIComponent(res.headers.get('X-OBS-Scene') || ''),
  })).catch(() => null);
  try {
    const next = await api('/api/state').then((res) => res.json());
    if (version !== generation) return;
    state = next;
    if (shelfPick && shelfPick.scene !== state.current) setShelfPick(null);
    if (state.desktopFeatures !== false) {
      live.ensure();
      refreshSpotify();
    }
    if (!live.active && $('preview').dataset.scene !== state.current) {
      $('preview').hidden = true;
      $('placeholder').hidden = false;
    }
    document.querySelector('.picture').style.aspectRatio = state.canvas.width + ' / ' + state.canvas.height;
    sessionStorage.setItem('obs-remote-code', code);
    if ($('notice').dataset.error !== '1') $('notice').textContent = '';
    render();
    const frame = await image;
    if (version !== generation) return;
    if (!live.active && frame?.scene === state.current) {
      const old = pictureURL;
      pictureURL = URL.createObjectURL(frame.blob);
      $('preview').dataset.scene = frame.scene;
      $('preview').src = pictureURL;
      $('preview').hidden = false;
      $('placeholder').hidden = true;
      if (old) URL.revokeObjectURL(old);
      lastFrame = Date.now();
    }
    drawPlacement();
    if (!live.active) $('freshness').textContent = Date.now() - lastFrame < 2500
      ? (state.desktopFeatures === false ? 'Снимки OBS · 1 кадр/с' : 'Резервный снимок · 1 кадр/с')
      : 'Ожидание кадра OBS…';
  } catch (error) {
    if (version === generation) {
      disconnected(error);
      if ($('remote').hidden && error.status !== 401) pair('OBS пока недоступен. Проверяю подключение.');
    }
  } finally {
    pending = false;
  }
}

async function perform(action, label) {
  if (!state || busy) return;
  busy = true;
  ++generation;
  $('notice').dataset.error = '0';
  $('notice').textContent = label;
  for (const id of ['text', 'choose', 'remove', 'media']) $(id + '-error').hidden = true;
  render();
  try {
    await action();
  } catch (error) {
    if (error.status === 401) disconnected(error);
    else {
      $('notice').dataset.error = '1';
      $('notice').textContent = error.message;
      for (const id of ['text', 'choose', 'remove', 'media']) {
        if ($(id + '-dialog').open) {
          $(id + '-error').textContent = error.message;
          $(id + '-error').hidden = false;
        }
      }
    }
  } finally {
    busy = false;
    if (code) render();
    refresh();
  }
}

function send(data, scene = state.current) {
  return api('/api/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, scene }),
  });
}

function command(data) {
  return perform(() => send(data), 'Применяю…');
}

function selectTab(name, updateHistory = true) {
  const changed = name !== $('remote').dataset.view;
  if (tab !== name && updateHistory) {
    const url = new URL(location.href);
    if (name === 'scenes') url.searchParams.delete('view');
    else url.searchParams.set('view', name);
    if (url.href !== location.href) history.pushState(null, '', url);
  }
  tab = name;
  $('remote').dataset.view = name;
  $('studio-jumps').hidden = name !== 'studio';
  if (changed && ['studio', 'mixer'].includes(name)) $('spotify-panel').open = name === 'mixer';
  const scenes = document.querySelector('[data-pane="scenes"]');
  const studioSlot = $('studio-scenes-slot');
  if (name === 'studio' && scenes.parentElement !== studioSlot) studioSlot.append(scenes);
  else if (name !== 'studio' && scenes.parentElement === studioSlot) document.querySelector('.operator').prepend(scenes);
  for (const button of document.querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === tab) {
      button.setAttribute('aria-current', 'page');
      $('workspace-title').textContent = button.textContent.trim();
    } else button.removeAttribute('aria-current');
  }
  for (const pane of document.querySelectorAll('[data-pane]')) pane.hidden = tab !== 'studio' && pane.dataset.pane !== tab;
  if (['mixer', 'studio'].includes(tab)) refreshSpotify(true);
  drawPlacement();
}
function setEdit(enabled) {
  editMode = enabled;
  $('edit').setAttribute('aria-pressed', enabled);
  $('edit').textContent = enabled ? 'Выйти из монтажа' : 'Монтаж';
  document.querySelector('.dashboard').dataset.editing = enabled;
  const bench = $('workbench');
  if (enabled) {
    bench.dataset.workspace = workspace;
    for (const choice of document.querySelectorAll('.scale-choices button')) {
      choice.setAttribute('aria-pressed', choice.dataset.workspace === workspace);
    }
  }
  else {
    delete bench.dataset.workspace;
    if (shelfPick) setShelfPick(null);
  }
  $('workbench-tools').hidden = !enabled;
  if (enabled && tab !== 'studio') selectTab('layers');
  if (state) renderLayers();
}

function selectStagedSource(source) {
  selection = source;
  workspace = 'wide';
  setEdit(true);
  $('workbench').scrollIntoView({ block: 'nearest' });
}
for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => {
    if (!['layers', 'studio'].includes(button.dataset.tab) && editMode) setEdit(false);
    selectTab(button.dataset.tab);
  });
}
window.addEventListener('popstate', () => {
  const name = tabFromURL();
  if (!['layers', 'studio'].includes(name) && editMode) setEdit(false);
  selectTab(name, false);
});
for (const button of document.querySelectorAll('[data-studio-jump]')) {
  button.addEventListener('click', () => {
    if (button.dataset.studioJump !== 'layers' && editMode) setEdit(false);
    const pane = document.querySelector('[data-pane="' + button.dataset.studioJump + '"]');
    pane.scrollIntoView({ block: 'start' });
  });
}
$('edit').addEventListener('click', () => setEdit(!editMode));
for (const button of document.querySelectorAll('[data-workspace]')) {
  button.addEventListener('click', () => {
    workspace = button.dataset.workspace;
    $('workbench').dataset.workspace = workspace;
    for (const choice of document.querySelectorAll('.scale-choices button')) {
      choice.setAttribute('aria-pressed', choice === button);
    }
    drawPlacement();
  });
}
$('expand-preview').addEventListener('click', async () => {
  const picture = document.querySelector('.picture');
  try {
    if (picture.requestFullscreen) await picture.requestFullscreen();
    else if (live.active && $('live').webkitEnterFullscreen) $('live').webkitEnterFullscreen();
  } catch {
    $('notice').textContent = 'Браузер не смог развернуть кадр.';
  }
});
$('lock').addEventListener('click', () => {
  const item = getSelected();
  if (item) layerCommand(item, 'lock', { enabled: !item.locked });
});
$('up').addEventListener('click', () => layerCommand(getSelected(), 'order', { step: 1 }));
$('down').addEventListener('click', () => layerCommand(getSelected(), 'order', { step: -1 }));
$('transform').addEventListener('submit', (event) => {
  event.preventDefault();
  const item = getSelected();
  const box = item?.transform && EditorGeometry.box(item.transform);
  if (!box) return;
  layerCommand(item, 'transform', {
    x: $('position-x').valueAsNumber, y: $('position-y').valueAsNumber,
    rotation: $('rotation').valueAsNumber,
    factorX: $('source-width').valueAsNumber / box.w, factorY: $('source-height').valueAsNumber / box.h,
  });
});
for (const [own, other, side, opposite] of [
  ['source-width', 'source-height', 'w', 'h'], ['source-height', 'source-width', 'h', 'w'],
]) {
  $(own).addEventListener('input', () => {
    const value = $(own).valueAsNumber;
    if (!$('aspect-lock').checked || !(value > 0)) return;
    const item = getSelected();
    const box = item?.transform && EditorGeometry.box(item.transform);
    if (box) $(other).value = rounded(value * box[opposite] / box[side]);
  });
}

async function prepareImage(file) {
  const bitmap = await (globalThis.createImageBitmap?.(file).catch(() => null) ?? null);
  const fallback = bitmap ? null : URL.createObjectURL(file);
  try {
    const source = bitmap || new Image();
    if (fallback) {
      source.src = fallback;
      await source.decode().catch(() => {
        throw new Error('Формат не удалось открыть. Попробуй PNG, JPEG или WebP.');
      });
    }
    const width = bitmap ? source.width : source.naturalWidth;
    const height = bitmap ? source.height : source.naturalHeight;
    const size = Math.min(1, 2048 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * size));
    canvas.height = Math.max(1, Math.round(height * size));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Картинку не удалось подготовить.');
    return png;
  } finally {
    bitmap?.close();
    if (fallback) URL.revokeObjectURL(fallback);
  }
}

$('upload').addEventListener('click', () => {
  $('add-dialog').close();
  $('image-file').click();
});
$('image-file').addEventListener('change', () => {
  const file = $('image-file').files[0];
  $('image-file').value = '';
  if (!file || !state) return;
  const scene = state.current;
  perform(async () => {
    if (file.size > 32 * 1024 * 1024) throw new Error('Выбери изображение до 32 МБ.');
    const body = await prepareImage(file);
    const query = new URLSearchParams({ scene, name: file.name });
    const response = await api('/api/image?' + query, {
      method: 'POST', headers: { 'Content-Type': 'image/png' },
      signal: AbortSignal.timeout(25000), body,
    });
    selectStagedSource(await response.json());
  }, 'Загружаю картинку…');
});

function openText(values, target) {
  textTarget = target;
  $('text-title').textContent = target.item ? 'Изменить текст' : 'Добавить текст';
  $('text-value').value = values.text || '';
  $('text-size').value = values.size || 64;
  $('text-color').value = values.color || '#ffffff';
  $('text-error').hidden = true;
  $('text-dialog').showModal();
}

$('add-text').addEventListener('click', () => {
  $('add-dialog').close();
  openText({}, { scene: state.current });
});
$('edit-text').addEventListener('click', () => {
  const item = getSelected();
  if (!item?.text) return;
  const scene = state.current;
  const query = new URLSearchParams({ scene, id: item.id });
  perform(async () => {
    const values = await api('/api/text?' + query).then((response) => response.json());
    openText(values, { scene, item });
  }, 'Открываю текст…');
});
$('cancel-text').addEventListener('click', () => $('text-dialog').close());
$('text-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const { scene, item } = textTarget;
  const data = { text: $('text-value').value, size: $('text-size').valueAsNumber, color: $('text-color').value };
  perform(async () => {
    if (item) await send({ kind: 'edit-text', id: item.id, name: item.name, ...data }, scene);
    else selectStagedSource(await send({ kind: 'add-text', ...data }, scene).then((response) => response.json()));
    $('text-dialog').close();
  }, 'Применяю текст…');
});

$('add-music').addEventListener('click', () => $('music-file').click());
function sendAsset(input, video) {
  const file = input.files[0];
  input.value = '';
  if (!file || !state) return;
  const query = new URLSearchParams({ scene: state.current, name: file.name });
  perform(async () => {
    const limit = video ? 64 : 32;
    if (file.size > limit * 1024 * 1024) throw new Error('Размер файла должен быть до ' + limit + ' МБ.');
    const response = await api((video ? '/api/media-file?' : '/api/music?') + query, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
      signal: AbortSignal.timeout(45000), body: file,
    });
    if (video) {
      selection = await response.json();
      if (tab !== 'studio') selectTab('layers');
    }
  }, video ? 'Загружаю видео…' : 'Загружаю музыку…');
}
$('music-file').addEventListener('change', (event) => sendAsset(event.currentTarget, false));
$('video-file').addEventListener('change', (event) => sendAsset(event.currentTarget, true));

for (const button of document.querySelectorAll('[data-dismiss]')) {
  button.addEventListener('click', () => $(button.dataset.dismiss).close());
}
$('add-source').addEventListener('click', () => $('add-dialog').showModal());
$('add-video').addEventListener('click', () => {
  $('add-dialog').close();
  $('video-file').click();
});

function sourceOptions(kind, { scene, item }) {
  const query = new URLSearchParams({ scene, kind });
  if (item) query.set('id', item.id);
  return api('/api/source-options?' + query).then((response) => response.json());
}

async function fillChoices() {
  const target = choiceTarget;
  const { choices, active } = await sourceOptions(target.kind, target);
  const select = $('choose-option');
  const look = select.value;
  const placeholder = new Option(choices.length ? 'Выбери вариант' : 'Список пуст', '', true, true);
  placeholder.disabled = true;
  select.replaceChildren(placeholder, ...choices.map(({ label, value }) => new Option(label, value)));
  const preferred = look || active;
  if (choices.some((choice) => choice.value === preferred)) select.value = preferred;
  $('choose-apply').disabled = !choices.length;
}

function openChoices(kind, item) {
  if (!state) return;
  if ($('add-dialog').open) $('add-dialog').close();
  choiceTarget = { kind, scene: state.current, item };
  $('choose-title').textContent = kind === 'window' ? 'Выбрать окно приложения' : 'Добавить источник из OBS';
  $('choose-option').replaceChildren(new Option('Загрузка…', '', true, true));
  $('choose-apply').disabled = true;
  $('choose-dialog').showModal();
  perform(fillChoices, 'Получаю список из OBS…');
}
$('add-window').addEventListener('click', () => openChoices('window'));
$('add-existing').addEventListener('click', () => openChoices('existing'));
$('edit-window').addEventListener('click', () => openChoices('window', getSelected()));
$('refresh-choices').addEventListener('click', () => perform(fillChoices, 'Обновляю список…'));
$('choose-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const { kind, scene, item } = choiceTarget;
  const value = $('choose-option').value;
  const data = item ? { kind: 'window', id: item.id, name: item.name, value }
    : { kind: kind === 'window' ? 'add-window' : 'add-existing', value };
  perform(async () => {
    const response = await send(data, scene);
    if (!item) selection = await response.json();
    $('choose-dialog').close();
  }, 'Обновляю источник…');
});

$('remove-source').addEventListener('click', () => {
  const item = getSelected();
  if (!item) return;
  removeTarget = { scene: state.current, item };
  $('remove-title').textContent = 'Удалить источник из сцены?';
  $('remove-error').hidden = true;
  $('remove-name').textContent = item.name;
  $('remove-dialog').showModal();
});
$('remove-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const { scene, item, shelf } = removeTarget;
  perform(async () => {
    await send({ kind: shelf ? 'shelf-remove' : 'remove', id: item.id, name: item.name, confirmed: true }, scene);
    if (!shelf) selection = undefined;
    if (shelf && shelfPick?.id === item.id) setShelfPick(null);
    $('remove-dialog').close();
  }, 'Удаляю источник…');
});
$('save-shelf').addEventListener('click', () => {
  $('shelf-panel').open = true;
  layerCommand(getSelected(), 'shelf-save');
});
$('park-source').addEventListener('click', () => {
  const item = getSelected();
  if (!item?.enabled) return;
  const bounds = sceneBounds(item);
  const { positionX, positionY } = item.transform;
  const { width, height } = state.canvas;
  const restore = isOffCanvas(bounds);
  const x = positionX + (restore ? width / 2 - (bounds.left + bounds.right) / 2 : width + 30 - bounds.left);
  const y = positionY + (restore ? height / 2 - (bounds.top + bounds.bottom) / 2 : 0);
  if (!editMode) setEdit(true);
  layerCommand(item, 'transform', { x, y, from: { x: positionX, y: positionY } });
});

function mediaOperation(operation, value) {
  const target = mediaTarget;
  return perform(async () => {
    await send({ kind: 'track', id: target.item.id, name: target.item.name, operation, value }, target.scene);
    if ($('media-dialog').open) await fillMedia();
  }, 'Управляю воспроизведением…');
}

async function fillMedia() {
  const media = await sourceOptions('media', mediaTarget);
  const row = document.createElement('div');
  row.className = 'track-actions';
  for (const [name, operation, value] of [
    [media.playing ? 'Пауза' : 'Играть', media.playing ? 'pause' : 'play'],
    ['Стоп', 'stop'], ['С начала', 'restart'], ['Повтор', 'loop', !media.loop],
  ]) {
    const button = elementButton(name, 'quiet', () => mediaOperation(operation, value));
    if (operation === 'loop') button.setAttribute('aria-pressed', media.loop);
    row.append(button);
  }
  const body = $('media-player');
  body.replaceChildren(row);
  for (const [label, max, value, operation] of [
    ['Позиция', media.duration, media.cursor, 'seek'], ['Громкость', 100, media.volume, 'volume'],
  ]) {
    if (!max) continue;
    const container = document.createElement('label');
    container.textContent = label;
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', max, min: 0, value: Math.min(max, value) });
    input.addEventListener('change', () => mediaOperation(operation, input.valueAsNumber));
    container.append(input);
    body.append(container);
  }
}
$('edit-media').addEventListener('click', () => {
  mediaTarget = { scene: state.current, item: getSelected() };
  $('media-title').textContent = mediaTarget.item.name;
  $('media-player').replaceChildren();
  $('media-dialog').showModal();
  perform(fillMedia, 'Открываю свойства медиа…');
});

$('spotify-open').addEventListener('click', () => spotifyControl('open'));
$('spotify-play').addEventListener('click', () => spotifyControl(spotify?.playing ? 'pause' : 'play'));
$('spotify-next').addEventListener('click', () => spotifyControl('next'));
$('spotify-previous').addEventListener('click', () => spotifyControl('previous'));
$('spotify-link-form').addEventListener('submit', (event) => {
  event.preventDefault();
  spotifyControl('open', $('spotify-link').value);
});
$('spotify-mute').addEventListener('click', () => command({ kind: 'spotify-mix', enabled: state.spotifyAudio.muted }));
$('spotify-volume').addEventListener('input', (event) => {
  $('spotify-level').textContent = event.currentTarget.value + '%';
});
$('spotify-volume').addEventListener('change', (event) => {
  const volume = event.currentTarget.valueAsNumber;
  if (spotify) spotify.volume = volume;
  perform(async () => {
    const result = await send({ kind: 'spotify-mix', volume }).then((response) => response.json());
    if (spotify) spotify.volume = result.volume;
    spotifyUpdated = 0;
    await refreshSpotify(true);
  }, 'Меняю громкость Spotify…');
});

$('pair-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const entered = cleanCode($('code').value);
  if (entered.length !== 12) return pair('Код состоит из 12 символов.');
  code = entered;
  ++generation;
  $('pair-error').textContent = '';
  refresh();
});
$('pause').addEventListener('click', () => command({ kind: 'scene', name: 'Пауза' }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) live.stop();
  else refresh();
});
selectTab(tab, false);
setInterval(refresh, 980);
if (code) refresh();
else pair();


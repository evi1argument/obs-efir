import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const exec = promisify(execFile);
const clients = new Set();
let ffmpeg;
let child;
let starting;
let stopping;
let idle;
let headers;
let segment;
let failure = 'Предпросмотр ещё не запущен.';
const maxBox = 4 * 1024 * 1024;

async function resolveFfmpeg() {
  if (process.env.OBS_REMOTE_FFMPEG) return process.env.OBS_REMOTE_FFMPEG;
  const options = { windowsHide: true, timeout: 4000 };
  try {
    await exec('ffmpeg.exe', ['-version'], options);
    return 'ffmpeg.exe';
  } catch {
    const located = await exec('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], options)
      .catch(() => null);
    if (located?.stdout.trim()) return located.stdout.trim();
    throw new Error('Установи FFmpeg или задай OBS_REMOTE_FFMPEG для видео.');
  }
}

async function start(obs) {
  const current = await obs.call('GetVideoSettings');
  if (!(await obs.call('GetVirtualCamStatus')).outputActive) {
    await obs.call('StartVirtualCam');
    for (let n = 0; n < 20; n++) {
      if ((await obs.call('GetVirtualCamStatus')).outputActive) break;
      await sleep(100);
    }
  }
  const executable = await resolveFfmpeg();
  return new Promise((resolve, reject) => {
    const process = spawn(executable, [
      '-hide_banner', '-loglevel', 'warning', '-f', 'dshow', '-rtbufsize', '64M',
      '-pixel_format', 'nv12', '-i', 'video=OBS Virtual Camera',
      '-vf', 'scale=-2:540:flags=fast_bilinear', '-an', '-c:v', 'libx264',
      '-threads', '4', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-profile:v', 'baseline', '-level:v', '3.2', '-b:v', '4M', '-maxrate', '6M',
      '-bufsize', '2M', '-g', '12', '-sc_threshold', '0', '-fps_mode', 'passthrough',
      '-movflags', 'empty_moov+default_base_moof+frag_keyframe', '-flush_packets', '1',
      '-f', 'mp4', 'pipe:1',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child = process;
    let pending = Buffer.alloc(0);
    let init;
    let moof;
    let log = '';
    let timer;
    const stop = () => {
      clearTimeout(timer);
      headers = segment = ffmpeg = undefined;
      if (child === process) child = undefined;
      for (const res of clients) res.destroy();
      clients.clear();
    };
    let ready = false;
    function watch() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        failure = 'Видеопоток OBS перестал отвечать.';
        if (!ready) reject(new Error(failure));
        process.kill();
      }, 6500);
    }
    watch();
    process.stderr.on('data', (chunk) => { log = (log + chunk).slice(-1400); });
    process.once('error', (error) => { stop(); reject(error); });
    process.once('exit', (code) => {
      stop();
      if (code) console.error('OBS preview FFmpeg:', log);
      if (!ready) reject(new Error('OBS Virtual Camera не передаёт видео.'));
    });
    process.stdout.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 8) {
        const size = pending.readUInt32BE(0);
        if (size < 8 || size > maxBox) { process.kill(); return; }
        if (pending.length < size) break;
        const type = pending.toString('ascii', 4, 8);
        const box = pending.subarray(0, size);
        pending = pending.subarray(size);
        if (type === 'ftyp') init = box;
        else if (type === 'moov' && init) {
          headers = Buffer.concat([init, box]);
          const avc = box.indexOf('avcC');
          if (avc < 0 || avc + 8 > box.length) { process.kill(); return; }
          ffmpeg = {
            codec: 'avc1.' + box.subarray(avc + 5, avc + 8).toString('hex'),
            fps: current.fpsNumerator / current.fpsDenominator,
          };
        } else if (type === 'moof') moof = box;
        else if (type === 'mdat' && moof && headers) {
          segment = Buffer.concat([moof, box]);
          moof = undefined;
          watch();
          if (!ready) { ready = true; resolve(ffmpeg); }
          for (const res of clients) {
            if (res.writableLength > 750000) res.destroy();
            else res.write(segment);
          }
        }
      }
    });
  });
}

export async function attachVideo(obs, res, commonHeaders) {
  clearTimeout(idle);
  if (stopping) await stopping;
  if (!child || !segment) {
    starting ??= start(obs).catch((error) => {
      failure = error.message;
      throw error;
    }).finally(() => { starting = undefined; });
    await starting;
  }
  if (res.destroyed) { scheduleIdle(); return; }
  if (!child || !ffmpeg || !headers || !segment) throw new Error('Видеопоток OBS перезапускается.');
  res.writeHead(200, {
    ...commonHeaders, 'Content-Type': 'video/mp4', 'X-OBS-Codec': ffmpeg.codec,
    'X-OBS-FPS': String(ffmpeg.fps),
  });
  res.write(headers);
  res.write(segment);
  clients.add(res);
  res.on('close', () => { clients.delete(res); scheduleIdle(); });
}

function scheduleIdle() {
  if (clients.size) return;
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (clients.size || !child) return;
    const running = child;
    stopping = new Promise((resolve) => running.once('exit', resolve))
      .finally(() => { stopping = undefined; });
    running.kill();
  }, 5500);
}


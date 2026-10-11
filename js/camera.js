// In-app camera: take a photo or record a video, then hand the file to the post screen.
import { icon } from './icons.js';

function pickRecordMime() {
  const options = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find(t => window.MediaRecorder?.isTypeSupported(t)) || '';
}

// Once a browser has blocked the camera for a site it never shows the popup again,
// so explain the quick way to undo it.
export async function cameraBlockedHelp() {
  let state = 'prompt';
  try { state = (await navigator.permissions.query({ name: 'camera' })).state; } catch { /* Safari < 16 */ }
  if (state !== 'denied') return 'Camera access was not allowed. Tap the button to be asked again.';
  return 'Your browser is blocking the camera for PetPost. Click the camera or lock icon next to the web address at the top, choose Allow for Camera, then tap Try again.';
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * @param {{ modes: ('photo'|'video')[], maxSeconds: number }} opts
 * @returns {Promise<File|null>} the captured file, or null if closed
 */
export function openCamera({ modes = ['photo', 'video'], maxSeconds = 60 } = {}) {
  return new Promise(resolve => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('This browser does not allow camera access. Try choosing a file instead.');
      return resolve(null);
    }
    let mode = modes[0];
    let facing = 'environment';
    let stream = null, recorder = null, chunks = [], timer = 0, startedAt = 0, finished = false;

    const el = document.createElement('div');
    el.className = 'camera';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Camera');
    el.innerHTML = `
      <div class="cam-inner">
        <video class="cam-live" playsinline muted autoplay></video>
        <div class="cam-status" hidden></div>
        <header class="cam-top">
          <button class="icon-btn light" data-cam="close" aria-label="Close camera">${icon('close')}</button>
          <span class="cam-timer" hidden>0:00</span>
          <button class="icon-btn light" data-cam="flip" aria-label="Switch camera">${icon('flip')}</button>
        </header>
        <footer class="cam-bottom">
          ${modes.length > 1 ? `<div class="cam-modes">${modes.map(m => `<button data-cam-mode="${m}">${m === 'photo' ? 'Photo' : 'Video'}</button>`).join('')}</div>` : ''}
          <button class="shutter" data-cam="shutter" aria-label="Take photo"><span></span></button>
          <p class="cam-hint"></p>
        </footer>
      </div>`;
    document.body.append(el);
    const live = el.querySelector('.cam-live');
    const shutter = el.querySelector('.shutter');
    const timerEl = el.querySelector('.cam-timer');
    const status = el.querySelector('.cam-status');
    const hint = el.querySelector('.cam-hint');

    function updateUI() {
      el.querySelectorAll('[data-cam-mode]').forEach(b => b.classList.toggle('on', b.dataset.camMode === mode));
      shutter.classList.toggle('video', mode === 'video');
      shutter.classList.toggle('recording', !!recorder);
      shutter.setAttribute('aria-label', mode === 'photo' ? 'Take photo' : recorder ? 'Stop recording' : 'Start recording');
      hint.textContent = mode === 'photo' ? 'Tap to take a photo' : recorder ? 'Tap to stop' : `Tap to record, up to ${maxSeconds} seconds`;
      timerEl.hidden = !recorder;
      live.classList.toggle('mirror', facing === 'user');
      el.querySelector('.cam-modes')?.classList.toggle('locked', !!recorder);
    }

    function stopStream() {
      stream?.getTracks().forEach(t => t.stop());
      stream = null;
    }

    async function start() {
      stopStream();
      status.hidden = false;
      status.textContent = 'Starting camera...';
      const video = { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } };
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: mode === 'video' });
        } catch (err) {
          if (mode !== 'video') throw err;
          // Retry without the microphone; sound gets removed by default anyway.
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        }
        if (finished) return stopStream();
        live.srcObject = stream;
        await live.play().catch(() => {});
        status.hidden = true;
      } catch (err) {
        const msg = err.name === 'NotAllowedError'
          ? await cameraBlockedHelp()
          : err.name === 'NotFoundError' ? 'No camera was found on this device.' : `The camera could not start (${err.message}).`;
        status.innerHTML = `<div class="cam-ask"><p></p>${err.name === 'NotFoundError' ? '' : '<button class="btn primary" data-cam="retry">Try again</button>'}</div>`;
        status.querySelector('p').textContent = msg;
      }
    }

    function close(file = null) {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
      stopStream();
      el.remove();
      document.removeEventListener('keydown', onKey);
      resolve(file);
    }

    function takePhoto() {
      if (!live.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = live.videoWidth; c.height = live.videoHeight;
      const ctx = c.getContext('2d');
      if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); } // save selfies the way they looked
      ctx.drawImage(live, 0, 0);
      el.classList.add('flash');
      c.toBlob(blob => close(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.92);
    }

    function startRecording() {
      if (!stream || !window.MediaRecorder) return;
      const mimeType = pickRecordMime();
      chunks = [];
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        const type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        close(new File(chunks, `camera-${Date.now()}.${ext}`, { type }));
      };
      recorder.start(250);
      startedAt = performance.now();
      timerEl.textContent = '0:00';
      timer = setInterval(() => {
        const s = (performance.now() - startedAt) / 1000;
        timerEl.textContent = fmt(s);
        if (s >= maxSeconds) stopRecording();
      }, 250);
      updateUI();
    }

    function stopRecording() {
      clearInterval(timer);
      if (recorder?.state === 'recording') recorder.stop();
    }

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    addEventListener('hashchange', () => close(), { once: true });

    el.addEventListener('click', e => {
      const b = e.target.closest('[data-cam], [data-cam-mode]');
      if (!b) return;
      if (b.dataset.camMode) {
        if (recorder || b.dataset.camMode === mode) return;
        mode = b.dataset.camMode;
        updateUI();
        start(); // re-open with or without the microphone
        return;
      }
      const what = b.dataset.cam;
      if (what === 'close') close();
      if (what === 'retry') start();
      if (what === 'flip' && !recorder) { facing = facing === 'user' ? 'environment' : 'user'; updateUI(); start(); }
      if (what === 'shutter') {
        if (mode === 'photo') takePhoto();
        else if (recorder) stopRecording();
        else startRecording();
      }
    });

    updateUI();
    start();
  });
}

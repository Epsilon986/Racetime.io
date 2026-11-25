'use strict';

const { tracks, frames, cars, tiles, objects, engineSamples, particles } = window.raceTimeAssets;
const $ = (id) => document.getElementById(id);
const canvas = $('race');
const ctx = canvas.getContext('2d');
const sheets = {};
const spriteCache = new Map();
const recordings = {};
const loops = new Map();
const controls = new Set();
const replayInterval = 5;
const replayStep = racePhysics.step * replayInterval;
const totalLaps = 2;
const tileSize = 64;
// Android's race map uses a 640 × 960 reference panel and a uniform 1.3× zoom.
const raceView = { width: 640, height: 960, zoom: 1.3 };
const startCues = [0.6, 1.4, 2.2];
const raceStart = 2.3;
const raceIntroDuration = 1.6;
const rad = Math.PI / 180;
const loop = (n, length) => ((n % length) + length) % length;
const color = (value) => '#' + ((value ?? 0x25313b) & 0xffffff).toString(16).padStart(6, '0');
const clock = (seconds) => {
  const centiseconds = Math.round(seconds * 100);
  return Math.floor(centiseconds / 6000) + ':' + String(Math.floor(centiseconds / 100) % 60).padStart(2, '0') +
    '.' + String(centiseconds % 100).padStart(2, '0');
};
const load = (key) => {
  try { return localStorage.getItem('race-time:' + key); } catch { return null; }
};
const save = (key, value) => {
  try { localStorage.setItem('race-time:' + key, value); } catch { /* Storage may be disabled. */ }
};
let mode = 'loading';
let course, scene, player, ghost, personalGhost, replay;
let startTime = 0;
let litSignals = 0;
let elapsed = 0;
let physicsTicks = 0;
let physicsRemainder = 0;
let previousPose;
let muted = load('muted') === 'true';
let wallVolume = 0;
let thrustVolume = 0;
let soundContext, engineVoice;
const engineBuffers = new Map();
let priorFrame = 0;
let retryResult = false;

function recording(name) {
  return recordings[name] ??= new Audio('assets/' + name + '.ogg');
}

function play(name, volume = 0.5) {
  if (muted) return;
  const audio = recording(name);
  audio.volume = volume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function setLoop(name, volume) {
  if (volume <= 0) {
    const audio = loops.get(name);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      loops.delete(name);
    }
    return;
  }
  const audio = recording(name);
  audio.volume = volume;
  if (loops.has(name)) return;
  loops.set(name, audio);
  audio.loop = true;
  audio.play().catch(() => {});
}

function prepareSustain(buffer) {
  const { sampleRate, length } = buffer;
  const channel = buffer.getChannelData(0);
  const windowSize = Math.max(1, Math.round(sampleRate * 0.025));
  const levels = [];
  for (let start = 0; start + windowSize <= length; start += windowSize) {
    let energy = 0;
    for (let i = start; i < start + windowSize; i++) energy += channel[i] ** 2;
    levels.push(energy / windowSize);
  }
  const floor = Math.max(...levels) * 0.07;
  const lastAudible = levels.findLastIndex((level) => level >= floor);
  const end = Math.min(length, Math.max(Math.round(sampleRate * 0.12), (lastAudible + 1) * windowSize));
  const start = end - Math.min(Math.round(end * 0.55), Math.round(sampleRate * 0.65));
  const overlap = Math.min(start, Math.round(sampleRate * 0.025), (end - start) >> 2);
  for (let index = 0; index < buffer.numberOfChannels; index++) {
    const samples = buffer.getChannelData(index);
    for (let i = 0; i < overlap; i++) {
      const mix = (i + 1) / overlap;
      samples[end - overlap + i] = samples[end - overlap + i] * (1 - mix) + samples[start - overlap + i] * mix;
    }
  }
  return { buffer, loopStart: start / sampleRate, loopEnd: end / sampleRate };
}

function loadEngine(name) {
  if (!soundContext) return null;
  if (!engineBuffers.has(name)) {
    const bytes = Uint8Array.from(atob(engineSamples[name]), (letter) => letter.charCodeAt(0));
    engineBuffers.set(name, soundContext.decodeAudioData(bytes.buffer).then(prepareSustain).catch(() => null));
  }
  return engineBuffers.get(name);
}

function enableEngineAudio() {
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (muted || !AudioEngine) return;
  soundContext ??= new AudioEngine();
  if (soundContext.state !== 'running') soundContext.resume().catch(() => {});
  loadEngine(player.car.thrustSound);
}

function setEngineVolume(name, volume) {
  if (volume <= 0) {
    const voice = engineVoice;
    engineVoice = null;
    if (voice?.source) {
      voice.source.stop();
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    return;
  }
  const sample = loadEngine(name);
  if (!sample) return;
  if (!engineVoice) {
    const voice = engineVoice = { volume };
    sample.then((sustain) => {
      if (!sustain || engineVoice !== voice) return;
      const source = voice.source = soundContext.createBufferSource();
      const gain = voice.gain = soundContext.createGain();
      source.buffer = sustain.buffer;
      source.loop = true;
      source.loopStart = sustain.loopStart;
      source.loopEnd = sustain.loopEnd;
      gain.gain.value = voice.volume;
      source.connect(gain).connect(soundContext.destination);
      source.start();
    });
  }
  engineVoice.volume = volume;
  engineVoice.gain?.gain.setTargetAtTime(volume, soundContext.currentTime, 0.012);
}

function stopRaceAudio() {
  setEngineVolume(null, 0);
  for (const name of loops.keys()) setLoop(name, 0);
  for (const audio of Object.values(recordings)) audio.pause();
  wallVolume = 0;
  thrustVolume = 0;
}

function updateRaceAudio(powered) {
  if (muted) return;
  // A short release bridges brief gaps between adjacent wall-contact ticks.
  wallVolume = player.wallContact ? Math.min(0.42, wallVolume + 0.21) : Math.max(0, wallVolume - 0.105);
  thrustVolume = powered ? Math.min(0.34, thrustVolume + 0.0136) : Math.max(0, thrustVolume - 0.0136);
  setLoop('car_grind', wallVolume);
  setEngineVolume(player.car.thrustSound, thrustVolume);
  setLoop(course.ambience, 0.25);
}

function setSoundLabel() {
  const label = muted ? 'Son coupé' : 'Son activé';
  $('race-sound-label').textContent = label;
  $('home-sound-label').textContent = label;
  for (const id of ['sound', 'home-sound']) $(id).setAttribute('aria-pressed', String(!muted));
}

function spriteImage(name, tint = 0xffffff) {
  const key = name + '/' + tint;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const { frame, sheet } = frames[name];
  const image = document.createElement('canvas');
  image.width = frame.w;
  image.height = frame.h;
  const layer = image.getContext('2d');
  layer.drawImage(sheets[sheet], frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  if (tint !== 0xffffff) {
    layer.globalCompositeOperation = 'multiply';
    layer.fillStyle = color(tint);
    layer.fillRect(0, 0, frame.w, frame.h);
    layer.globalCompositeOperation = 'destination-in';
    layer.drawImage(sheets[sheet], frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  }
  spriteCache.set(key, image);
  return image;
}

function sprite(context, name, width, height, tint = 0xffffff, frameIndex = 0, frameCount = 1) {
  const data = frames[name];
  if (!data) return;
  const f = data.frame;
  const source = data.sourceSize;
  const trim = data.spriteSourceSize;
  const image = tint === 0xffffff ? sheets[data.sheet] : spriteImage(name, tint);
  const sx = tint === 0xffffff ? f.x : 0;
  const sy = tint === 0xffffff ? f.y : 0;
  context.drawImage(image, sx + (f.w / frameCount) * frameIndex, sy, f.w / frameCount, f.h,
    (trim.x / source.w - 0.5) * width, (trim.y / source.h - 0.5) * height,
    f.w / source.w * width, f.h / source.h * height);
}

function tileAt(x, y) {
  return color(tileColor(x, y));
}

function tileColor(x, y) {
  const chunk = course.quads[Math.floor(x / 16)]?.[Math.floor(y / 16)]?.tiles;
  const slot = chunk?.charCodeAt(loop(y, 16) * 16 + loop(x, 16)) - 64;
  return tiles[slot] ?? course.background;
}

function drawDecoration(context, decoration) {
  const object = objects[decoration.name];
  if (!object?.visuals) return;
  const angle = -(decoration.r || 0) * rad;
  const scale = (decoration.s ?? 1) * (object.scale ?? 1);
  const visuals = Object.values(object.visuals).sort((a, b) => (a.layer || 0) - (b.layer || 0));
  context.save();
  context.translate(decoration.x * tileSize, decoration.y * tileSize);
  context.scale(scale, scale);
  for (const visual of visuals) {
    if (!frames[visual.fileName] || visual.type > 1) continue;
    context.save();
    context.rotate(angle);
    context.translate(visual.x || 0, visual.y || 0);
    context.rotate((visual.noRotate ? -angle : 0) - (visual.angle || 0) * rad);
    context.globalAlpha = visual.alpha ?? 1;
    context.scale(visual.flip & 1 ? -1 : 1, visual.flip & 2 ? -1 : 1);
    const tint = visual.useTileColor ? tileColor(Math.floor(decoration.x), Math.floor(decoration.y)) : visual.color;
    sprite(context, visual.fileName, visual.width || 64, visual.height || 64, (tint ?? 0xffffff) & 0xffffff);
    context.restore();
  }
  context.restore();
}

// Fit the original road texture to the position and UV coordinates of each triangle.
function textureTriangle(context, texture, [x, y, u, v], [bx, by, bu, bv], [cx, cy, cu, cv]) {
  const du1 = bu - u;
  const dv1 = bv - v;
  const du2 = cu - u;
  const dv2 = cv - v;
  const determinant = du1 * dv2 - du2 * dv1;
  if (Math.abs(determinant) < 0.000001) return;
  const a = ((bx - x) * dv2 - (cx - x) * dv1) / determinant;
  const b = ((by - y) * dv2 - (cy - y) * dv1) / determinant;
  const c = ((cx - x) * du1 - (bx - x) * du2) / determinant;
  const d = ((cy - y) * du1 - (by - y) * du2) / determinant;
  context.save();
  context.beginPath();
  // Slightly overlap neighboring triangles to hide Canvas antialias seams.
  const centerX = (x + bx + cx) / 3;
  const centerY = (y + by + cy) / 3;
  for (const [px, py] of [[x, y], [bx, by], [cx, cy]]) {
    const distance = Math.hypot(px - centerX, py - centerY) || 1;
    context.lineTo(px + (px - centerX) / distance, py + (py - centerY) / distance);
  }
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, x - a * u - c * v, y - b * u - d * v);
  context.drawImage(texture, 0, 0);
  context.restore();
}

function paintRoad(context, texture, regions) {
  for (const { x, y, coords } of course.roads) {
    if (regions && !regions.some((region) => Math.hypot(x - region.x, y - region.y) < 4)) continue;
    const vertices = [];
    for (let i = 0; i < coords.length; i += 4) {
      vertices.push([x * tileSize + coords[i], y * tileSize + coords[i + 1],
        texture.width * coords[i + 2], texture.height * coords[i + 3]]);
    }
    const [a, b, c, d] = vertices;
    textureTriangle(context, texture, a, b, c);
    textureTriangle(context, texture, a, c, d);
  }
}

function paintCrossingMarkings(context, texture, regions) {
  if (!regions.length) return;
  const markings = document.createElement('canvas');
  markings.width = texture.width;
  markings.height = texture.height;
  const lines = markings.getContext('2d');
  // Preserve only the two lane dividers from the original road atlas.
  for (const y of [81, 143]) {
    lines.drawImage(texture, 0, y, texture.width, 3, 0, y, texture.width, 3);
  }
  const clip = new Path2D();
  for (const { name, x, y, r = 0, s = 1 } of regions) {
    const object = objects[name];
    const { width, height } = object.visuals.base;
    const scale = s * (object.scale ?? 1);
    const angle = -r * rad;
    const transform = new DOMMatrix().translate(x * tileSize, y * tileSize)
      .rotate(angle / rad).scale(scale);
    const patch = new Path2D();
    patch.rect(-width / 2 - 2, -height / 2 - 2, width + 4, height + 4);
    clip.addPath(patch, transform);
  }
  context.save();
  context.clip(clip);
  paintRoad(context, markings, regions);
  context.restore();
}

function buildScene() {
  const points = course.lanes.flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const padding = 640;
  const x = Math.floor(Math.min(...xs) - padding);
  const y = Math.floor(Math.min(...ys) - padding);
  const w = Math.ceil(Math.max(...xs) + padding - x);
  const h = Math.ceil(Math.max(...ys) + padding - y);
  const image = document.createElement('canvas');
  image.width = w;
  image.height = h;
  const map = image.getContext('2d');
  map.translate(-x, -y);
  for (let ty = Math.floor(y / tileSize); ty * tileSize < y + h; ty++) {
    for (let tx = Math.floor(x / tileSize); tx * tileSize < x + w; tx++) {
      map.fillStyle = tileAt(tx, ty);
      map.fillRect(tx * tileSize, ty * tileSize, tileSize, tileSize);
    }
  }
  const layers = course.decorations.slice().sort((a, b) =>
    (objects[a.name]?.zOrder || 0) - (objects[b.name]?.zOrder || 0) || a.y - b.y);
  for (const decoration of layers) {
    if ((objects[decoration.name]?.zOrder || 0) < 0) drawDecoration(map, decoration);
  }
  const texture = spriteImage(course.roadTexture);
  paintRoad(map, texture);
  const patches = layers.filter(({ name }) =>
    /^road_(dark|light|white)_intersect$/.test(name) || /^road_(?:(?:light|white)_)?fade$/.test(name));
  const foreground = [];
  for (const decoration of layers) {
    const z = objects[decoration.name]?.zOrder || 0;
    if (z > 5) foreground.push(decoration);
    else if (z === 0) drawDecoration(map, decoration);
  }
  paintCrossingMarkings(map, texture, patches);
  for (const decoration of layers) {
    const z = objects[decoration.name]?.zOrder || 0;
    if (z > 0 && z <= 5) drawDecoration(map, decoration);
  }
  return { image, x, y, foreground };
}

function setupPlayer() {
  const selected = cars.find(({ id }) => id === $('car').value) || cars[0];
  player = racePhysics.create(course.paths, selected);
  player.effects = createVehicleEffects(selected, particles);
  previousPose = racePhysics.pose(player);
  replay = [previousPose];
}

function readGhost() {
  try {
    const recording = JSON.parse(load('ghost-v2/' + course.id));
    const car = cars.find(({ id }) => id === recording?.car);
    if (car && Number.isFinite(recording.time) && recording.time > 0 &&
        Array.isArray(recording.points) && recording.points.length === Math.ceil(Math.round(recording.time / racePhysics.step) / replayInterval) + 1 &&
        recording.points.every((point) => point && [point.x, point.y, point.angle].every(Number.isFinite))) {
      return { ...recording, car };
    }
  } catch { /* A missing or unreadable replay leaves the track without a ghost. */ }
  return null;
}

function updateHud() {
  $('lap').textContent = Math.min(totalLaps, player.lap) + ' / ' + totalLaps;
  $('time').textContent = activeTournament ? tournamentScore(elapsed) : clock(elapsed);
  $('ghost').textContent = ghost?.name ?? (ghost?.reference ? 'Référence' : ghost ? 'Actif' : 'À créer');
  const dailyBest = activeTournament && tournamentBest(activeTournament);
  $('best-label').textContent = activeTournament ? 'RECORD DU JOUR' : 'RECORD LOCAL';
  $('best').textContent = dailyBest ? tournamentScore(dailyBest.time / 100) :
    personalGhost ? clock(personalGhost.time) : '–';
}

function selectTrack(trackId = $('track').value) {
  course = tracks.find(({ id }) => id === trackId) || tracks[0];
  course.paths ??= racePhysics.build(course.lanes);
  scene = buildScene();
  reset();
}

function reset() {
  stopRaceAudio();
  $('race-intro').hidden = true;
  mode = 'ready';
  controls.clear();
  elapsed = 0;
  physicsTicks = 0;
  physicsRemainder = 0;
  startTime = 0;
  litSignals = 0;
  $('track').disabled = false;
  $('car').disabled = false;
  $('notice').hidden = true;
  setupPlayer();
  personalGhost = activeTournament ? null : readGhost();
  const reference = referenceGhost(course);
  const referenceCar = reference && cars.find(({ id }) => id === reference.car);
  ghost = activeTournament?.opponent ?? (referenceCar && $('reference-ghost').checked
    ? { ...reference, car: referenceCar, reference: true }
    : personalGhost);
  updateHud();
}

function startRace({ intro = false } = {}) {
  if (mode !== 'ready') reset();
  mode = 'countdown';
  if (intro) {
    startTime = -raceIntroDuration;
    $('race-intro-track').textContent = course.name;
    $('race-intro').hidden = false;
    play('vs_whoosh', 0.8);
  }
  $('track').disabled = true;
  $('car').disabled = true;
  $('notice').hidden = true;
  if (!muted) {
    enableEngineAudio();
    for (const name of ['car_grind', course.ambience, 'start_beep_1', 'start_beep_2', 'start_beep_3']) {
      recording(name).preload = 'auto';
    }
  }
}

function updatePlayer() {
  previousPose = racePhysics.pose(player);
  const lastLap = player.lap;
  const powered = controls.size > 0;
  racePhysics.advance(player, powered);
  physicsTicks++;
  elapsed = physicsTicks * racePhysics.step;
  const finished = player.lap > totalLaps;
  const pose = racePhysics.pose(player);
  if (physicsTicks % replayInterval === 0 || finished) replay.push(pose);
  updateRaceAudio(powered);
  updateVehicleEffects(player, pose, elapsed, racePhysics.step, powered);
  if (lastLap === 1 && player.lap === 2) play('2nd_lap');
  return finished;
}

function interpolatePose(a, b, fraction) {
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
    angle: a.angle + (b.angle - a.angle) * fraction,
  };
}

function paintResultCar(id, car) {
  const icon = $(id);
  const context = icon.getContext('2d');
  context.clearRect(0, 0, icon.width, icon.height);
  context.save();
  context.translate(icon.width / 2, icon.height / 2);
  drawVehicle(context, car, { x: 0, y: 0, angle: 0 }, { icon: true });
  context.restore();
}

function finish() {
  mode = 'finished';
  physicsRemainder = 0;
  controls.clear();
  stopRaceAudio();
  const opponent = ghost;
  const margin = opponent ? Math.round((elapsed - opponent.time) * 100) : 0;
  retryResult = Boolean(opponent && margin > 0);
  const isSprint = !activeTournament && course.id.startsWith('short_');
  const alreadyQualified = isSprint && hasQualifiedForPro(course);
  const unlocksTournamentPro = activeTournament?.category === 'sprint' &&
    (tournamentBest(activeTournament)?.time ?? Infinity) > activeTournament.pro &&
    Math.round(elapsed * 100) <= activeTournament.pro;
  if (!activeTournament) {
    if (personalGhost) recordLocalResult(course, personalGhost.car, personalGhost.time);
    recordLocalResult(course, player.car, elapsed);
  }
  recordTournamentResult(elapsed);
  const unlock = $('pro-track-unlocked');
  const unlocksSoloPro = isSprint && !alreadyQualified && hasQualifiedForPro(course);
  unlock.hidden = !unlocksTournamentPro && !unlocksSoloPro;
  if (!unlock.hidden) unlock.textContent = unlocksTournamentPro
    ? 'Pro débloqué dans le tournoi du jour'
    : 'Circuit Pro débloqué · ' + course.name;
  const record = !activeTournament && (!personalGhost || elapsed < personalGhost.time);
  if (record) {
    save('ghost-v2/' + course.id, JSON.stringify({ time: elapsed, car: player.car.id, points: replay }));
    personalGhost = { time: elapsed, car: player.car, points: replay };
  }
  updateHud();
  $('track').disabled = false;
  $('car').disabled = false;
  play('finish_race');
  if (opponent) {
    $('result-ghost-label').textContent = opponent.name ?? (opponent.reference ? 'Référence' : 'Fantôme');
    if (!retryResult) play('win_crowd_cheer', 0.6);
    else if (margin < 25) play('lose_crowd_ooh', 0.6);
    play(retryResult ? 'music_lose' : 'music_win', 0.4);
  }
  $('result-title').textContent = opponent
    ? (margin < 0 ? 'Victoire !' : margin > 0 ? 'Défaite' : 'Égalité')
    : 'Course terminée';
  const formatScore = activeTournament ? tournamentScore : clock;
  $('result-time').textContent = formatScore(elapsed);
  paintResultCar('result-car', player.car);
  $('result-opponent').hidden = !opponent;
  if (opponent) {
    $('result-ghost-time').textContent = formatScore(opponent.time);
    paintResultCar('result-ghost-car', opponent.car);
  }
  $('result-action').textContent = retryResult ? 'Rejouer' : 'Continuer';
  $('notice').hidden = false;
  $('result-action').focus({ preventScroll: true });
}

function tick(dt) {
  if (mode === 'finished') {
    physicsRemainder += dt;
    while (player.speed > 0 && physicsRemainder >= racePhysics.step) {
      physicsRemainder -= racePhysics.step;
      racePhysics.advance(player, false);
    }
    return;
  }
  if (mode !== 'countdown' && mode !== 'running') return;
  const before = startTime;
  startTime = Math.min(2.7, startTime + dt);
  if (before < 0) {
    for (const [cue, sound] of [[-1.28, 'vs_impact'], [-0.38, 'vs_whoosh_out']]) {
      if (before < cue && startTime >= cue) play(sound, 0.8);
    }
    if (before < -0.38 && startTime >= -0.38) showRaceScreen();
    if (startTime >= 0) $('race-intro').hidden = true;
  }
  if (mode === 'countdown') {
    while (litSignals < startCues.length && startTime >= startCues[litSignals]) {
      litSignals++;
      play('start_beep_' + litSignals, 1);
    }
    if (startTime < raceStart) return;
    mode = 'running';
    dt -= raceStart - before;
  }
  if (dt <= 0) return;
  physicsRemainder += dt;
  while (physicsRemainder >= racePhysics.step && mode === 'running') {
    physicsRemainder -= racePhysics.step;
    if (updatePlayer()) finish();
  }
  if (mode === 'running') updateHud();
}

function drawVehicle(context, car, { x, y, angle }, options = {}) {
  const { icon = false, opacity = 1, powered = false } = options;
  const bodyAngle = car.rotateMode === 2 ? 0 : angle;
  const offsetAngle = car.rotateMode === 0 ? bodyAngle : 0;
  const hasIconShadow = icon && car.images.some((visual) => visual.shadowIcon && visual.alpha !== 0);
  for (const visual of car.images) {
    const alpha = (visual.alpha ?? 1) * opacity;
    if (!alpha || !effectEnabled(visual, options, powered)) continue;
    if (hasIconShadow ? visual.shadow && !visual.shadowIcon : visual.shadowIcon && !visual.shadow) continue;
    const offsetX = visual.x + (icon ? car.displayX : 0);
    const offsetY = visual.y + (icon ? car.displayY : 0);
    const origin = shiftPoint({ x, y, angle: offsetAngle }, offsetX, offsetY);
    const light = (visual.parallaxAngle ?? -45) * rad;
    context.save();
    context.translate(origin.x + Math.sin(light) * visual.parallax, origin.y - Math.cos(light) * visual.parallax);
    context.rotate((visual.noRotate ? 0 : bodyAngle) - (visual.angle ?? 0) * rad);
    context.scale(visual.flip & 1 ? -1 : 1, visual.flip & 2 ? -1 : 1);
    context.globalAlpha = alpha;
    sprite(context, visual.fileName, visual.width, visual.height, (visual.color ?? 0xffffff) & 0xffffff);
    context.restore();
  }
}

function drawGhost(playerPose) {
  if (!ghost || !elapsed || elapsed > ghost.time + 0.65 || mode === 'finished') return;
  const i = Math.min(Math.floor(elapsed / replayStep), ghost.points.length - 2);
  const end = Math.min((i + 1) * replayStep, ghost.time);
  const fraction = Math.min(1, (elapsed - i * replayStep) / (end - i * replayStep || 1));
  const pose = interpolatePose(ghost.points[i], ghost.points[i + 1], fraction);
  const opacity = 0.53 * Math.max(0, 1 - (Math.max(0, elapsed - ghost.time) / 0.65));
  drawVehicle(ctx, ghost.car, pose, { opacity });
  const { x, y } = pose;
  if (Math.hypot(x - playerPose.x, y - playerPose.y) > 28) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px system-ui';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#111822';
    const label = ghost.name ?? 'FANTÔME';
    ctx.strokeText(label, x, y - 35);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x, y - 35);
    ctx.restore();
  }
}

function drawPlayer(pose) {
  drawVehicleEffects(ctx, player.effects, elapsed, false, frames, sprite, color);
  drawVehicle(ctx, player.car, pose, {
    powered: controls.size > 0, drift: player.drift, wallSide: player.wallSide,
  });
  drawVehicleEffects(ctx, player.effects, elapsed, true, frames, sprite, color);
}

function drawStartSignal(width, height) {
  if ((mode !== 'countdown' && mode !== 'running') || startTime < 0 || startTime >= 2.7) return;
  const scale = Math.min(width / raceView.width, height / raceView.height);
  // Android uses the lb_balloon sprite behind three solid-color lights.
  const unlit = ['#610106', '#553d03', '#065206'];
  const lit = ['#fd0501', '#ffb500', '#06bd0c'];
  ctx.save();
  ctx.translate(width / 2, height / 2 - 217 * scale);
  ctx.scale(scale, scale);
  ctx.globalAlpha = Math.min(1, (2.7 - startTime) / 0.2);
  ctx.translate(0, 3);
  sprite(ctx, 'lb_balloon', 220, 80, 0x0160ab);
  ctx.translate(0, -3);
  for (let i = 0; i < lit.length; i++) {
    ctx.fillStyle = i < litSignals ? lit[i] : unlit[i];
    ctx.beginPath();
    ctx.arc(-70 + i * 70, 0, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function render() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = color(course.background);
  ctx.fillRect(0, 0, width, height);
  const current = racePhysics.pose(player);
  const pose = mode === 'running'
    ? interpolatePose(previousPose, current, physicsRemainder / racePhysics.step)
    : current;
  const scale = raceView.zoom * Math.min(width / raceView.width, height / raceView.height);
  ctx.translate(width / 2 - pose.x * scale, height / 2 - pose.y * scale);
  ctx.scale(scale, scale);
  ctx.drawImage(scene.image, scene.x, scene.y);
  drawGhost(pose);
  drawPlayer(pose);
  for (const decoration of scene.foreground) {
    if (Math.abs(decoration.x * tileSize - pose.x) < width / (2 * scale) + 400 &&
        Math.abs(decoration.y * tileSize - pose.y) < height / (2 * scale) + 400) {
      drawDecoration(ctx, decoration);
    }
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawStartSignal(width, height);
}

function frame(now) {
  const dt = priorFrame ? Math.min((now - priorFrame) / 1000, 0.045) : 0;
  priorFrame = now;
  if (!$('race-intro').hidden || !$('race-screen').hidden) tick(dt);
  if (!$('race-screen').hidden) {
    render();
  } else if (!$('home').hidden) {
    paintHomeRoad(dt);
  }
  if (!$('tournament').hidden) paintTournamentRoad(dt);
  requestAnimationFrame(frame);
}

function bindPointer(element) {
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !['running', 'countdown'].includes(mode)) return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    controls.add(event.pointerId);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    element.addEventListener(name, (event) => controls.delete(event.pointerId));
  }
  element.addEventListener('contextmenu', (event) => event.preventDefault());
}

function bindControls() {
  const toggleSound = () => {
    muted = !muted;
    save('muted', muted);
    if (muted) stopRaceAudio();
    else if (mode === 'running' || mode === 'countdown') enableEngineAudio();
    setSoundLabel();
  };
  $('sound').addEventListener('click', toggleSound);
  $('home-sound').addEventListener('click', toggleSound);
  $('result-action').addEventListener('click', () => {
    if (mode !== 'finished') return;
    if (retryResult) {
      startRace();
      canvas.focus({ preventScroll: true });
    } else {
      returnHome();
    }
  });
  bindPointer(canvas);
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape' && !event.repeat) {
      if ($('race-screen').hidden && $('race-intro').hidden) return;
      event.preventDefault();
      returnHome();
      return;
    }
    if ($('race-screen').hidden) return;
    if (event.code === 'KeyR' && !event.repeat) {
      event.preventDefault();
      startRace();
      return;
    }
    if (mode === 'finished' && ['Space', 'Enter'].includes(event.code) &&
        (event.target === $('result-action') || !event.target.closest?.('button, select, input, a'))) {
      event.preventDefault();
      if (!event.repeat) $('result-action').click();
      return;
    }
    if (!['Space', 'ArrowUp', 'KeyW', 'KeyZ'].includes(event.code)) return;
    if (!['running', 'countdown'].includes(mode)) return;
    event.preventDefault();
    controls.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    controls.delete(event.code);
    if (event.code === 'Space' && event.target === $('result-action')) event.preventDefault();
  });
  window.addEventListener('blur', () => controls.clear());
}

async function init() {
  for (const { id, name } of cars) $('car').append(new Option(name, id));
  setSoundLabel();
  const atlasNames = [...new Set(Object.values(frames).map(({ sheet }) => sheet))];
  const roadNames = [...new Set(tracks.map(({ menuRoad }) => 'road_ui_straight_' + menuRoad))];
  await Promise.all([...atlasNames, ...roadNames].map((name) => new Promise((resolve, reject) => {
    const img = sheets[name] = new Image();
    img.onload = resolve;
    img.onerror = () => reject(new Error('Atlas indisponible : ' + name));
    img.src = 'assets/' + name + '.png';
  })));
  bindControls();
  initializeHome();
  requestAnimationFrame(frame);
}

init().catch((error) => {
  $('home-status').hidden = false;
  $('home-status').textContent = 'Impossible de charger les ressources de Race Time.';
  console.error(error);
});

'use strict';

function parseSave(key, fallback) {
  try { return JSON.parse(load(key)) ?? fallback; } catch { return fallback; }
}

function recordLocalResult(track, car, time) {
  const key = 'ranking/' + track.id;
  const times = parseSave(key, {});
  if (!Number.isFinite(times[car.id]) || time < times[car.id]) {
    save(key, JSON.stringify({ ...times, [car.id]: time }));
  }
}

function showRanking() {
  const times = { ...parseSave('ranking/' + course.id, {}) };
  const previous = readGhost();
  if (previous) times[previous.car.id] = Math.min(times[previous.car.id] ?? Infinity, previous.time);
  const results = cars.filter(({ id }) => Number.isFinite(times[id]) && times[id] > 0)
    .sort((a, b) => times[a.id] - times[b.id] || a.name.localeCompare(b.name, 'fr'));
  const rows = results.map(({ id, name }, index) => {
    const row = document.createElement('tr');
    for (const value of [index + 1, name, clock(times[id])]) {
      const cell = row.insertCell();
      cell.textContent = value;
    }
    return row;
  });
  $('ranking-rows').replaceChildren(...rows);
  $('ranking-empty').hidden = rows.length > 0;
}

function drawHomeIcon(canvas, name, scale = 1, angle = 0) {
  const dc = canvas.getContext('2d');
  dc.clearRect(0, 0, canvas.width, canvas.height);
  dc.save();
  dc.translate(canvas.width / 2, canvas.height / 2);
  dc.rotate(angle);
  sprite(dc, name, canvas.width * scale, canvas.height * scale);
  dc.restore();
}

const homeMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let roadTravel = 0;

function paintHomeRoad(dt) {
  const board = $('home-road');
  const width = board.clientWidth;
  const height = board.clientHeight;
  if (!course || !width || !height) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (board.width !== Math.round(width * ratio) || board.height !== Math.round(height * ratio)) {
    board.width = Math.round(width * ratio);
    board.height = Math.round(height * ratio);
  }
  const dc = board.getContext('2d');
  const car = player.car;
  const center = width * (width > 750 ? 0.56 : 0.5);
  const scale = Math.max(0.88, Math.min(1.7, width / (width > 750 ? 810 : 385)));
  const tileHeight = 256 * scale;
  const terrain = course.menuTerrain;
  const road = sheets['road_ui_straight_' + course.menuRoad];
  const sceneryPeriod = 8;
  const scenerySpacing = 205;
  const speed = homeMotion.matches ? 0 : 300;
  roadTravel += dt * speed;

  dc.setTransform(ratio, 0, 0, ratio, 0, 0);
  dc.fillStyle = color(terrain[0].color ?? course.background);
  dc.fillRect(0, 0, center + 1, height);
  dc.fillStyle = color(terrain[1].color ?? course.background);
  dc.fillRect(center, 0, width - center, height);

  for (let y = loop(roadTravel * scale, tileHeight) - tileHeight; y < height; y += tileHeight) {
    dc.drawImage(road, center - 256 * scale, Math.floor(y), 512 * scale, Math.ceil(tileHeight));
  }

  for (const [side, area] of terrain.entries()) {
    if (!area.objects.length) continue;
    for (let row = -1; row <= Math.ceil(height / (scenerySpacing * scale)); row++) {
      const index = loop(row - Math.floor(roadTravel / scenerySpacing), sceneryPeriod);
      const y = (row * scenerySpacing + loop(roadTravel, scenerySpacing)) * scale;
      const distance = 152 + loop(index * 91 + side * 75, 148);
      const x = center + (side === 0 ? -1 : 1) * distance * scale;
      dc.save();
      dc.translate(x, y);
      dc.scale(scale, scale);
      drawDecoration(dc, { name: area.objects[index % area.objects.length], x: 0, y: 0,
        s: 0.76 + loop(index * 37, 23) / 100 });
      dc.restore();
    }
  }

  const carX = center + Math.sin(roadTravel / 270) * 12 * scale;
  const carY = height * (width > 750 ? 0.55 : 0.51) + Math.sin(roadTravel / 140) * 12 * scale;
  dc.save();
  dc.translate(carX, carY);
  dc.scale(scale, scale);
  drawVehicle(dc, car, { x: 0, y: 0, angle: Math.cos(roadTravel / 270) * 0.07 }, { powered: true });
  dc.restore();
}

function refreshHome() {
  if ($('home').hidden || !course) return;
  $('home-track-name').textContent = course.name;
  $('home-race-type').textContent = (course.id.startsWith('short_') ? 'Sprint' : 'Pro') + ' · 2 tours';
  showRanking();
  paintCircuitPreview();
  paintHomeRoad(0);
  refreshGift();
}

function paintCircuitPreview() {
  const board = $('circuit-preview');
  const dc = board.getContext('2d');
  const points = course.lanes[1];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const height = Math.max(...ys) - minY;
  const scale = Math.min((board.width - 38) / width, (board.height - 38) / height);
  const x = (board.width - width * scale) / 2 - minX * scale;
  const y = (board.height - height * scale) / 2 - minY * scale;
  dc.clearRect(0, 0, board.width, board.height);
  dc.beginPath();
  for (const [px, py] of points) dc.lineTo(x + px * scale, y + py * scale);
  dc.closePath();
  dc.lineJoin = 'round';
  dc.strokeStyle = '#0c1820';
  dc.lineWidth = 18;
  dc.stroke();
  dc.strokeStyle = '#ecf7ec';
  dc.lineWidth = 8;
  dc.stroke();
  dc.beginPath();
  dc.arc(x + points[0][0] * scale, y + points[0][1] * scale, 10, 0, Math.PI * 2);
  dc.fillStyle = '#d9ff47';
  dc.fill();
  dc.strokeStyle = '#0c1820';
  dc.lineWidth = 3;
  dc.stroke();
  board.setAttribute('aria-label', 'Aperçu du circuit ' + course.name);
}

function chooseCategory(category, preferredTrack) {
  for (const button of document.querySelectorAll('[data-category]')) {
    button.setAttribute('aria-pressed', String(button.dataset.category === category));
  }
  const options = tracks.filter((track) => track.id.startsWith('short_') === (category === 'sprint'));
  $('track').replaceChildren(...options.map(({ id, name }) => new Option(name, id)));
  if (options.some(({ id }) => id === preferredTrack)) $('track').value = preferredTrack;
  chooseTrack();
}

function chooseTrack() {
  save('selected-track', $('track').value);
  selectTrack();
  refreshHome();
}

function openGarage() {
  $('garage').showModal();
  $('garage-cars').querySelector('[aria-pressed="true"]')?.focus();
}

function initializeGarage() {
  $('garage-count').textContent = cars.length + ' véhicules disponibles';
  const buttons = cars.map((car) => {
    const button = document.createElement('button');
    const icon = document.createElement('canvas');
    button.type = 'button';
    button.className = 'garage-car';
    button.dataset.car = car.id;
    button.setAttribute('aria-pressed', String(car.id === $('car').value));
    icon.width = 56;
    icon.height = 56;
    icon.setAttribute('aria-hidden', 'true');
    const dc = icon.getContext('2d');
    dc.translate(28, 26);
    dc.scale(0.56, 0.56);
    drawVehicle(dc, car, { x: 0, y: 0, angle: 0 }, { icon: true });
    button.append(icon, car.name);
    button.addEventListener('click', () => {
      const previous = $('garage-cars').querySelector('[aria-pressed="true"]');
      previous?.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      $('car').value = car.id;
      save('selected-car', car.id);
      reset();
      refreshHome();
      $('garage').close();
    });
    return button;
  });
  $('garage-cars').replaceChildren(...buttons);
}

function giftDay() {
  const date = new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
}

function refreshGift(justClaimed = false) {
  const gift = parseSave('daily-gift', {});
  const available = gift.day !== giftDay();
  const amount = Number.isSafeInteger(gift.coins) ? gift.coins : 0;
  $('gift-dot').hidden = !available;
  $('gift-claim').disabled = !available;
  $('gift-status').textContent = justClaimed ? '+50 pièces !' : available ?
    'Ton cadeau est prêt.' : 'Cadeau ouvert. Reviens demain.';
  $('gift-balance').textContent = amount + ' pièces';
  drawHomeIcon($('gift-art'), available ? 'button_gift' : 'coin', 0.82);
}

function enterRace() {
  $('home').hidden = true;
  $('race-screen').hidden = false;
  startRace();
  $('race').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function returnHome() {
  reset();
  $('race-screen').hidden = true;
  $('home').hidden = false;
  refreshHome();
  $('home-road').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function initializeHome() {
  for (const icon of document.querySelectorAll('[data-icon]')) drawHomeIcon(icon, icon.dataset.icon);
  const storedCar = load('selected-car');
  if (cars.some(({ id }) => id === storedCar)) $('car').value = storedCar;
  const storedTrack = load('selected-track');
  chooseCategory(storedTrack?.startsWith('track_') ? 'pro' : 'sprint', storedTrack);
  initializeGarage();
  for (const button of document.querySelectorAll('[data-category]')) {
    button.disabled = false;
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      const current = $('track').value;
      const paired = button.dataset.category === 'pro' ? current.replace(/^short_track_0?/, 'track_') :
        current.replace(/^track_(\d+)$/, (_, number) => 'short_track_' + number.padStart(2, '0'));
      chooseCategory(button.dataset.category, paired);
    });
  }
  $('track').addEventListener('change', chooseTrack);
  $('garage-open').addEventListener('click', openGarage);
  $('gift-open').addEventListener('click', () => {
    refreshGift();
    $('gifts').showModal();
  });
  $('gift-claim').addEventListener('click', () => {
    const current = parseSave('daily-gift', {});
    const day = giftDay();
    if (current.day === day) return;
    const balance = Number.isSafeInteger(current.coins) ? current.coins : 0;
    save('daily-gift', JSON.stringify({ day, coins: balance + 50 }));
    refreshGift(parseSave('daily-gift', {}).day === day);
  });
  $('home-road').setAttribute('aria-disabled', 'false');
  $('home-road').addEventListener('click', enterRace);
  window.addEventListener('keydown', (event) => {
    if ($('home').hidden || $('garage').open || $('gifts').open || event.repeat ||
        event.ctrlKey || event.metaKey || event.altKey ||
        !['Space', 'Enter'].includes(event.code) || event.target.closest?.('button, select, a, input')) return;
    event.preventDefault();
    enterRace();
    if (event.code === 'Space') controls.add(event.code);
  });
  $('back-home').addEventListener('click', returnHome);
  for (const id of ['track', 'garage-open', 'gift-open', 'home-sound']) $(id).disabled = false;
}

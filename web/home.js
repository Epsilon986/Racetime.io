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

function paintHomeTrack() {
  const board = $('track-preview');
  const width = board.clientWidth;
  const height = board.clientHeight;
  if (!scene || !width || !height) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  board.width = Math.round(width * ratio);
  board.height = Math.round(height * ratio);
  const dc = board.getContext('2d');
  const [x, y] = course.lanes[1][7];
  const [aheadX, aheadY] = course.lanes[1][19];
  const scale = Math.max(width / 1300, height / 860);
  dc.setTransform(ratio, 0, 0, ratio, 0, 0);
  dc.fillStyle = color(course.background);
  dc.fillRect(0, 0, width, height);
  dc.translate(width * 0.5, height * 0.46);
  dc.scale(scale, scale);
  dc.translate(-x, -y);
  dc.drawImage(scene.image, scene.x, scene.y);
  dc.save();
  dc.translate(x, y);
  const car = player.car;
  dc.rotate(Math.atan2(aheadY - y, aheadX - x) + Math.PI / 2 + car.angle * rad);
  sprite(dc, car.frame, 58, 58);
  dc.restore();
  for (const decoration of scene.foreground) drawDecoration(dc, decoration);
}

function refreshHome() {
  if ($('home').hidden || !course) return;
  $('home-track-name').textContent = course.name;
  $('home-race-type').textContent = (course.id.startsWith('short_') ? 'Sprint' : 'Pro') + ' · 2 tours';
  $('selected-car').textContent = player.car.name;
  showRanking();
  paintHomeTrack();
  refreshGift();
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
    icon.width = 48;
    icon.height = 48;
    icon.setAttribute('aria-hidden', 'true');
    drawHomeIcon(icon, car.frame, 0.87, car.angle * rad);
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
  $('race-track-name').textContent = course.name;
  startRace();
  $('pause').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function returnHome() {
  reset();
  $('race-screen').hidden = true;
  $('home').hidden = false;
  refreshHome();
  $('play-race').focus({ preventScroll: true });
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
  $('vehicle-shortcut').addEventListener('click', openGarage);
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
  $('play-race').addEventListener('click', enterRace);
  $('back-home').addEventListener('click', returnHome);
  for (const id of ['track', 'garage-open', 'vehicle-shortcut', 'gift-open', 'play-race', 'home-sound']) $(id).disabled = false;
  new ResizeObserver(paintHomeTrack).observe($('track-preview'));
}

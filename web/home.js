'use strict';

let activeTournament = null;
let displayedTournament = null;
let tournamentMode = 'sprint';
let lastTournamentClock = '';
const tournamentScroll = new Map();
const tournamentFields = new Map();
const tournamentScore = (seconds) => seconds.toFixed(2).replace('.', ',') + ' s';
let tournamentRows = [];
let selectedTournamentRow = null;
let tournamentVehicleScale = 0;
let finishTournamentOvertake;
let tournamentDemo = false;
let tournamentRoadWiden = 1;
let tournamentRoadPan = 0;

function tournamentPasses(rows, progress) {
  return rows.filter(({ entry }) => {
    if (!entry.ai) return false;
    const time = Math.round(entry.time * 100);
    return progress.time < time && (progress.previous === null || progress.previous >= time);
  });
}

function tournamentLaneProgress(position, lane) {
  const entering = (lane.start - position) / Math.max(1, lane.start - lane.first);
  const merging = (position - lane.end) / Math.max(1, lane.last - lane.end);
  const progress = Math.max(0, Math.min(1, entering, merging));
  return progress ** 3 * (10 - 15 * progress + 6 * progress ** 2);
}

function tournamentTravelProgress(time) {
  const ramp = 0.12;
  if (time < ramp) return time ** 2 / (2 * ramp * (1 - ramp));
  if (time > 1 - ramp) return 1 - (1 - time) ** 2 / (2 * ramp * (1 - ramp));
  return (time - ramp / 2) / (1 - ramp);
}

function animateTournamentOvertake(progress, best = tournamentBest(displayedTournament)) {
  const count = tournamentPasses(tournamentOpponents(displayedTournament.track).map((entry) => ({ entry })), progress).length;
  if (!count) return;
  const label = $('tournament-overtake');
  label.textContent = tournamentDemo ? 'Aperçu · 121e → 5e' :
    count === 1 ? '1 pilote dépassé' : count + ' pilotes dépassés';
  label.hidden = false;
  if (homeMotion.matches) return;

  const road = $('tournament-road-scroll');
  showTournamentRacers(displayedTournament, best, progress);
  paintTournamentRoad();
  centerTournamentRow($('tournament-self'));
  updateTournamentSelection();
  const self = tournamentRows.find(({ entry }) => !entry.ai);
  const passed = tournamentPasses(tournamentRows, progress);
  const target = road.scrollTop;
  const selfCenter = self.element.getBoundingClientRect().top + self.element.offsetHeight / 2;
  const playerBounds = tournamentVehicleBounds(self.entry.car);
  const crossings = passed.map(({ element, entry }) => {
    const bounds = tournamentVehicleBounds(entry.car);
    const position = target + element.getBoundingClientRect().top + element.offsetHeight / 2 - selfCenter;
    const clearance = (playerBounds.radius + bounds.radius) * tournamentVehicleScale + 12;
    return { position, clearance, width: bounds.width };
  });
  const first = Math.max(...crossings.map(({ position, clearance }) => position + clearance));
  const last = Math.min(...crossings.map(({ position, clearance }) => position - clearance));
  const requestedStart = first + 120;
  road.classList.add('tournament-overtaking');
  road.style.setProperty('--overtake-runout', Math.ceil(requestedStart - crossings.at(-1).position) + 'px');
  const start = Math.min(road.scrollHeight - road.clientHeight, requestedStart);
  const laneChange = playerBounds.width + Math.max(...crossings.map(({ width }) => width)) + 10;
  const roadWiden = Math.max(1, (laneChange + playerBounds.width + 8) / 90);
  const pan = Math.max(0, (laneChange + playerBounds.width) * tournamentVehicleScale + 8 -
    $('tournament-road').clientWidth / 2);
  const lane = {
    start, first, last, end: target,
  };
  self.element.classList.add('tournament-overtake-player');
  let frame;
  finishTournamentOvertake = () => {
    cancelAnimationFrame(frame);
    finishTournamentOvertake = undefined;
    tournamentRoadWiden = 1;
    tournamentRoadPan = 0;
    self.button.style.translate = '';
    self.icon.style.translate = '';
    self.button.style.removeProperty('--tournament-player-shift');
    self.element.classList.remove('tournament-overtake-player');
    road.classList.remove('tournament-overtaking');
    road.style.removeProperty('--overtake-runout');
    road.style.translate = '';
    showTournamentRacers(displayedTournament, best);
    paintTournamentRoad();
    centerTournamentRow($('tournament-self'));
    updateTournamentSelection();
  };
  const duration = Math.max(2700, 1350 + passed.length * 155);
  let started;
  function moveTo(position) {
    road.scrollTop = position;
    self.button.style.translate = '0 ' + (road.scrollTop - target) + 'px';
    const rank = self.entry.rank + crossings.filter(({ position }) => road.scrollTop > position).length;
    $('tournament-selected-rank').textContent = '#' + rank;
    const laneProgress = tournamentLaneProgress(road.scrollTop, lane);
    const playerShift = -laneChange * tournamentVehicleScale * laneProgress + 'px';
    self.icon.style.translate = playerShift + ' 0';
    self.button.style.setProperty('--tournament-player-shift', playerShift);
    tournamentRoadWiden = 1 + (roadWiden - 1) * laneProgress;
    tournamentRoadPan = pan * laneProgress;
    road.style.translate = tournamentRoadPan + 'px 0';
  }
  function advance(now) {
    started ??= now;
    const fraction = Math.min(1, (now - started) / duration);
    const eased = tournamentTravelProgress(fraction);
    moveTo(target + (start - target) * (1 - eased));
    if (fraction < 1) frame = requestAnimationFrame(advance);
    else finishTournamentOvertake();
  }
  moveTo(start);
  frame = requestAnimationFrame(advance);
}

function centerTournamentRow(row, behavior = 'instant') {
  const road = $('tournament-road-scroll');
  const distance = row.getBoundingClientRect().top - road.getBoundingClientRect().top +
    (row.offsetHeight - road.clientHeight) / 2;
  road.scrollTo({ top: road.scrollTop + distance, behavior });
}

function updateTournamentSelection() {
  if (finishTournamentOvertake) return;
  const road = $('tournament-road-scroll');
  if (!$('tournament').hidden && road.clientHeight && tournamentRows.length) {
    const center = road.getBoundingClientRect().top + road.clientHeight / 2;
    let nearest = null;
    let distance = Infinity;
    for (const row of tournamentRows) {
      const offset = Math.abs(row.element.getBoundingClientRect().top + row.element.offsetHeight / 2 - center);
      if (offset < distance) {
        nearest = row;
        distance = offset;
      }
    }
    if (nearest === selectedTournamentRow) return;
    selectedTournamentRow?.button.setAttribute('aria-pressed', 'false');
    selectedTournamentRow = nearest;
    nearest.button.setAttribute('aria-pressed', 'true');
    const { entry } = nearest;
    $('tournament-selected-name').textContent = entry.name;
    $('tournament-selected-rank').textContent = entry.rank === null ? 'Non classé' : '#' + entry.rank;
    $('tournament-selected-car').textContent = entry.car.name;
    $('tournament-selected-time').textContent = entry.time === null ? 'Aucun chrono' : tournamentScore(entry.time);
    const badge = $('tournament-selected-division');
    badge.hidden = entry.time === null;
    if (!badge.hidden) {
      const division = tournamentDivision(displayedTournament, Math.round(entry.time * 100));
      badge.textContent = division;
      badge.dataset.division = division.toLowerCase();
    }
    $('tournament-enter').textContent = entry.ai ? 'Affronter' : 'Participer';
  }
}

function tournamentReferenceOpponent(track) {
  const reference = referenceGhost(track);
  return { ...reference, name: 'Référence', car: cars.find(({ id }) => id === reference.car) };
}

function simulateTournamentOpponent(track, driver, capture = false) {
  track.paths ??= racePhysics.build(track.lanes);
  const racer = racePhysics.create(track.paths, driver.car);
  const points = capture ? [racePhysics.pose(racer)] : null;
  const burst = 75 + driver.ai % 9 * 13;
  const rest = driver.ai % 14 * 3;
  const delay = driver.ai * 2;
  let ticks = 0;
  while (racer.lap <= totalLaps && ticks < 30000) {
    const powered = ticks >= delay && (driver.fullThrottle || (ticks - delay) % (burst + rest) < burst);
    racePhysics.advance(racer, powered);
    ticks++;
    if (capture && (ticks % replayInterval === 0 || racer.lap > totalLaps)) points.push(racePhysics.pose(racer));
  }
  return racer.lap > totalLaps ? { time: ticks * racePhysics.step, points } : null;
}

function tournamentOpponents(track) {
  if (tournamentFields.has(track.id)) return tournamentFields.get(track.id);
  const opponents = Array.from({ length: 120 }, (_, index) => {
    const driver = { ai: index + 1, name: 'Pilote IA ' + (index + 1), car: cars[index % cars.length] };
    let run = simulateTournamentOpponent(track, driver);
    if (!run) {
      driver.fullThrottle = true;
      run = simulateTournamentOpponent(track, driver);
    }
    return run ? { ...driver, time: run.time } : null;
  }).filter(Boolean);
  tournamentFields.set(track.id, opponents);
  return opponents;
}

function tournamentLeaderboard(opponents, self, progress = null) {
  const ranked = (self.time === null ? [...opponents] : [...opponents, self])
    .sort((a, b) => Math.round(a.time * 100) - Math.round(b.time * 100));
  const visible = ranked.map((entry, index) => ({ ...entry, rank: index + 1 })).filter((entry, index) =>
    index < 100 || (progress && (ranked[index] === self ||
      (progress.time < Math.round(entry.time * 100) &&
        (progress.previous === null || progress.previous >= Math.round(entry.time * 100))))));
  const index = ranked.indexOf(self);
  if (index < 0 || (!progress && index >= 100)) visible.push({ ...self, rank: index < 0 ? null : index + 1 });
  return visible;
}

function startTournament(opponent) {
  if (tournamentDemo || !$('race-intro').hidden) return;
  finishTournamentOvertake?.();
  const today = dailyTournament(new Date(), tournamentMode);
  if (today.day !== displayedTournament?.day) {
    openTournamentPage();
    return;
  }
  tournamentScroll.set(tournamentMode, $('tournament-road-scroll').scrollTop);
  const replay = opponent.ai ? simulateTournamentOpponent(today.track, opponent, true) : null;
  activeTournament = { ...today, opponent: replay ? { ...opponent, ...replay } : opponent };
  selectTrack(today.track.id);
  enterRace();
}

function showTournamentRacers(tournament, best, progress = null) {
  tournamentRows = [];
  tournamentVehicleScale = 0;
  selectedTournamentRow = null;
  const opponents = tournamentOpponents(tournament.track);
  const selectedCar = cars.find(({ id }) => id === $('car').value) ?? cars[0];
  const self = { name: 'Toi', time: best ? best.time / 100 : null, car: selectedCar };
  const visible = tournamentLeaderboard(opponents, self, progress);
  const unlisted = !progress && visible.length > 100 ? visible.pop() : null;
  const entries = [...visible, ...['Master', 'Pro'].map((name) => ({
    name, marker: true, time: tournament[name.toLowerCase()] / 100,
  })), { name: 'Novice', marker: true, time: (tournament.pro + 1) / 100 }];
  const times = entries.map(({ time }) => time).filter(Number.isFinite);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const interval = Math.max(5, Math.ceil((max - min) / 40) * 5);
  for (let time = Math.ceil(min / interval) * interval; time < max; time += interval) {
    if (times.every((existing) => Math.abs(existing - time) >= 1)) entries.push({ tick: true, time });
  }
  entries.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  if (unlisted) entries.push(unlisted);
  let previousTime = null;
  $('tournament-racers').replaceChildren(...entries.map((entry) => {
    const row = document.createElement('li');
    if (previousTime !== null && entry.time !== null) {
      row.style.marginTop = Math.min(112, Math.round((entry.time - previousTime) * 7)) + 'px';
    }
    previousTime = entry.time;
    if (entry.tick) {
      row.className = 'tournament-time-tick';
      row.textContent = tournamentScore(entry.time);
      return row;
    }
    if (entry.marker) {
      row.className = 'tournament-marker';
      row.dataset.division = entry.name.toLowerCase();
      const badge = document.createElement('span');
      badge.className = 'tournament-division-badge';
      badge.textContent = entry.name;
      const time = document.createElement('strong');
      time.textContent = tournamentScore(entry.time);
      row.append(badge, time);
      return row;
    }
    if (!entry.ai) row.id = 'tournament-self';
    const card = document.createElement('button');
    card.className = 'tournament-racer';
    const icon = document.createElement('canvas');
    icon.width = icon.height = 320;
    icon.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.className = 'tournament-racer-caption';
    const label = document.createElement('span');
    label.textContent = entry.rank === null ? entry.name : '#' + entry.rank + ' ' + entry.name;
    caption.append(label);
    if (entry.time !== null) {
      const time = document.createElement('strong');
      time.textContent = tournamentScore(entry.time);
      caption.append(time);
    }
    card.append(icon, caption);
    card.type = 'button';
    card.setAttribute('aria-label', label.textContent + (entry.time === null ? '' : ' · ' + tournamentScore(entry.time)));
    card.setAttribute('aria-pressed', 'false');
    card.addEventListener('click', () => centerTournamentRow(row, homeMotion.matches ? 'instant' : 'smooth'));
    tournamentRows.push({ element: row, button: card, icon, entry });
    row.append(card);
    return row;
  }));
}
function referenceGhost(track) {
  return window.referenceGhosts?.[track.id] ?? null;
}

function dailyTournament(date = new Date(), category = 'sprint') {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  const sprintTracks = tracks.filter(({ id }) => id.startsWith('short_'));
  const sprint = sprintTracks[((day % sprintTracks.length) + sprintTracks.length) % sprintTracks.length];
  const track = category === 'pro'
    ? tracks.find(({ id }) => id === sprint.id.replace(/^short_track_0?/, 'track_'))
    : sprint;
  const pro = proTarget(track);
  const endsAt = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return { day, track, category, endsAt, master: Math.round(pro * 0.95), pro };
}

function tournamentHistoryKey(tournament) {
  return tournament.category === 'pro' ? 'tournament-results-pro' : 'tournament-results';
}

function tournamentBest(tournament) {
  return parseSave(tournamentHistoryKey(tournament), {})[tournament.day];
}

function tournamentProUnlocked() {
  const sprint = dailyTournament();
  return (tournamentBest(sprint)?.time ?? Infinity) <= sprint.pro;
}

function tournamentDivision(tournament, time) {
  if (time <= tournament.master) return 'Master';
  if (time <= tournament.pro) return 'Pro';
  return 'Novice';
}

function pairedSprint(track) {
  const number = /^track_(\d+)$/.exec(track.id)?.[1];
  return number ? tracks.find(({ id }) => id === 'short_track_' + number.padStart(2, '0')) : undefined;
}

function proTarget(sprint) {
  return Math.round(referenceGhost(sprint).time * 100);
}

function hasQualifiedForPro(sprint) {
  const results = Object.values(parseSave('ranking/' + sprint.id, {}));
  const ghostTime = parseSave('ghost-v2/' + sprint.id, {})?.time;
  return [...results, ghostTime].some((time) =>
    Number.isFinite(time) && time > 0 && Math.round(time * 100) <= proTarget(sprint));
}

function refreshProTrack() {
  const sprint = pairedSprint(course);
  const locked = Boolean(sprint && !hasQualifiedForPro(sprint));
  const target = $('pro-track-target');
  target.hidden = !locked;
  $('pro-track-sprint').hidden = !locked;
  $('start-hint').hidden = locked;
  $('home-road').setAttribute('aria-disabled', String(locked));
  if (locked) target.textContent = 'Circuit Pro verrouillé · ' + clock(proTarget(sprint) / 100) + ' ou mieux sur le Sprint.';
}

function showTournament(tournament) {
  const history = parseSave(tournamentHistoryKey(tournament), {});
  const best = history[tournament.day];
  $('tournament-title').textContent = tournament.track.name;
  $('tournament-track').textContent = totalLaps + ' tours';
  paintCircuitPreview($('tournament-preview'), tournament.track);
  showTournamentRacers(tournament, best);
  $('tournament-best').textContent = best
    ? 'Ton record · ' + tournamentScore(best.time / 100)
    : 'Premier chrono à établir';
  $('tournament-first-help').hidden = Boolean(best);
  const proUnlocked = tournamentProUnlocked();
  $('tournament-pro-tab').textContent = proUnlocked ? 'Pro' : 'Pro 🔒';
  $('tournament-sprint-tab').setAttribute('aria-pressed', String(tournament.category === 'sprint'));
  $('tournament-pro-tab').setAttribute('aria-pressed', String(tournament.category === 'pro'));
  $('tournament-pro-lock').hidden = true;
  const previousDay = Object.keys(history).map(Number).filter((day) => day < tournament.day).sort((a, b) => b - a)[0];
  const previous = history[previousDay];
  $('tournament-previous').hidden = !previous;
  if (previous) {
    $('tournament-previous').textContent = 'Dernier résultat · ' + previous.track + ' · ' +
      tournamentScore(previous.time / 100) + ' · ' + previous.division;
  }
}

function recordTournamentResult(seconds) {
  const label = $('tournament-result');
  label.hidden = !activeTournament;
  const firstResult = $('tournament-first-result');
  firstResult.hidden = true;
  if (!activeTournament) return;
  const { day, track } = activeTournament;
  const key = tournamentHistoryKey(activeTournament);
  const history = parseSave(key, {});
  const time = Math.round(seconds * 100);
  firstResult.hidden = Boolean(history[day]);
  if (!history[day] || time < history[day].time) {
    activeTournament.improved = true;
    const previous = activeTournament.progress ? activeTournament.progress.previous : history[day]?.time ?? null;
    activeTournament.progress = { previous, time };
    history[day] = { time, track: track.name, division: tournamentDivision(activeTournament, time), car: player.car.id };
    const days = Object.keys(history).sort((a, b) => Number(b) - Number(a)).slice(0, 30);
    save(key, JSON.stringify(Object.fromEntries(days.map((entry) => [entry, history[entry]]))));
  }
  label.textContent = 'Tournoi du jour · Division ' + tournamentDivision(activeTournament, history[day].time);
}

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
let tournamentRoadTravel = 0;

function homeRoadScale(width, tournament) {
  const base = Math.max(0.88, Math.min(1.7, width / (width > 750 ? 810 : 385)));
  return base * (tournament ? (width > 750 ? 1.55 : 1.3) : 1);
}

function tournamentVehicleBounds(car) {
  let radius = 0;
  let width = 0;
  for (const visual of car.images) {
    if (visual.alpha === 0 || (visual.shadowIcon && !visual.shadow) ||
        !effectEnabled(visual, { powered: true }, true)) continue;
    const offset = Math.hypot(visual.x, visual.y) + Math.abs(visual.parallax ?? 0);
    radius = Math.max(radius, offset + Math.hypot(visual.width, visual.height) / 2);
    const angle = (visual.angle ?? 0) * Math.PI / 180;
    const halfWidth = (Math.abs(Math.cos(angle)) * visual.width + Math.abs(Math.sin(angle)) * visual.height) / 2;
    width = Math.max(width, Math.abs(visual.x) + Math.abs(visual.parallax ?? 0) + halfWidth);
  }
  return { radius, width: width + radius * Math.sin(2 * Math.PI / 180) };
}

function paintTournamentVehicles(scale) {
  if (scale === tournamentVehicleScale) return;
  tournamentVehicleScale = scale;
  for (const { icon, button, entry } of tournamentRows) {
    const extent = tournamentVehicleBounds(entry.car).radius * scale;
    button.style.minHeight = Math.max(160, Math.ceil(extent * 2 + 24)) + 'px';
    const dc = icon.getContext('2d');
    dc.resetTransform();
    dc.clearRect(0, 0, icon.width, icon.height);
    dc.translate(icon.width / 2, icon.height / 2);
    const drawingScale = scale * icon.width / icon.clientWidth;
    dc.scale(drawingScale, drawingScale);
    drawVehicle(dc, entry.car, { x: 0, y: 0, angle: 0 }, { powered: true });
  }
}

function paintHomeRoad(dt, board = $('home-road'), roadCourse = course, tournamentScroll = null) {
  const width = board.clientWidth;
  const height = board.clientHeight;
  if (!roadCourse || !width || !height) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const tournament = tournamentScroll !== null;
  const axis = tournament || width <= 750 ? 0.5 : 0.56;
  if (board.width !== Math.round(width * ratio) || board.height !== Math.round(height * ratio)) {
    board.width = Math.round(width * ratio);
    board.height = Math.round(height * ratio);
  }
  if (!tournament && board.parentElement.dataset.roadAxis !== String(axis)) {
    board.parentElement.dataset.roadAxis = String(axis);
    board.parentElement.style.setProperty('--road-axis', axis * 100 + '%');
  }
  const dc = board.getContext('2d');
  const car = player.car;
  const center = width * axis + (tournament ? tournamentRoadPan : 0);
  const scale = homeRoadScale(width, tournament);
  const tileHeight = 256 * scale;
  const terrain = roadCourse.menuTerrain;
  const road = sheets['road_ui_straight_' + roadCourse.menuRoad];
  const sceneryPeriod = 8;
  const scenerySpacing = 205;
  const speed = homeMotion.matches ? 0 : 300;
  if (tournamentScroll === null) roadTravel += dt * speed;
  else tournamentRoadTravel += dt * speed;
  const travel = tournamentScroll === null ? roadTravel : tournamentRoadTravel - tournamentScroll / scale;

  dc.setTransform(ratio, 0, 0, ratio, 0, 0);
  dc.fillStyle = color(terrain[0].color ?? roadCourse.background);
  dc.fillRect(0, 0, center + 1, height);
  dc.fillStyle = color(terrain[1].color ?? roadCourse.background);
  dc.fillRect(center, 0, width - center, height);

  const roadScaleX = scale * (tournament ? tournamentRoadWiden : 1);
  for (let y = loop(travel * scale, tileHeight) - tileHeight; y < height; y += tileHeight) {
    dc.drawImage(road, center - 256 * roadScaleX, Math.floor(y), 512 * roadScaleX, Math.ceil(tileHeight));
  }

  for (const [side, area] of terrain.entries()) {
    if (!area.objects.length) continue;
    for (let row = -1; row <= Math.ceil(height / (scenerySpacing * scale)); row++) {
      const index = loop(row - Math.floor(travel / scenerySpacing), sceneryPeriod);
      const y = (row * scenerySpacing + loop(travel, scenerySpacing)) * scale;
      const distance = 152 + loop(index * 91 + side * 75, 148) + (tournament ? 90 * (tournamentRoadWiden - 1) : 0);
      const x = center + (side === 0 ? -1 : 1) * distance * scale;
      dc.save();
      dc.translate(x, y);
      dc.scale(scale, scale);
      drawDecoration(dc, { name: area.objects[index % area.objects.length], x: 0, y: 0,
        s: 0.76 + loop(index * 37, 23) / 100 });
      dc.restore();
    }
  }

  if (tournament) {
    paintTournamentVehicles(scale);
    return;
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
  refreshProTrack();
  const reference = referenceGhost(course);
  $('reference-ghost-option').hidden = !reference;
  if (reference) $('reference-ghost-time').textContent = '· ' + clock(reference.time);
  showRanking();
  paintCircuitPreview();
  paintHomeRoad(0);
  refreshGift();
}

function paintCircuitPreview(board = $('circuit-preview'), track = course) {
  const dc = board.getContext('2d');
  const points = track.lanes[1];
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
  board.setAttribute('aria-label', 'Aperçu du circuit ' + track.name);
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
  if (!$('race-intro').hidden || (!activeTournament && $('home-road').getAttribute('aria-disabled') === 'true')) return;
  $(activeTournament ? 'tournament' : 'home').inert = true;
  startRace({ intro: true });
}

function showRaceScreen() {
  $('home').hidden = true;
  $('home').inert = false;
  $('tournament').hidden = true;
  $('tournament').inert = false;
  $('race-screen').hidden = false;
  $('back-home-label').textContent = activeTournament ? 'Tournoi' : 'Accueil';
  $('race').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function returnHome() {
  const fromTournament = Boolean(activeTournament);
  const progress = activeTournament?.progress;
  const completedDay = activeTournament?.day;
  const completedCategory = activeTournament?.category;
  if (activeTournament?.improved) tournamentScroll.delete(activeTournament.category);
  activeTournament = null;
  if (fromTournament) selectTrack();
  else reset();
  $('home').inert = false;
  $('tournament').inert = false;
  $('race-screen').hidden = true;
  syncMenuAudio();
  if (fromTournament) {
    openTournamentPage();
    if (progress && displayedTournament.day === completedDay && displayedTournament.category === completedCategory) {
      animateTournamentOvertake(progress);
    }
    return;
  }
  $('home').hidden = false;
  refreshHome();
  $('home-road').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

let finishModeSlide;

function showModePage(id, slide) {
  finishModeSlide?.();
  const incoming = $(id);
  const outgoing = $(id === 'tournament' ? 'home' : 'tournament');
  const animate = slide && !outgoing.hidden && !homeMotion.matches;
  incoming.hidden = false;
  if (!animate) {
    outgoing.hidden = true;
    return;
  }
  const direction = id === 'tournament' ? -100 : 100;
  outgoing.inert = true;
  outgoing.classList.add('mode-leaving');
  const options = { duration: 320, easing: 'ease-in-out' };
  const leave = outgoing.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + -direction + '%)' }], options);
  const enter = incoming.animate([{ transform: 'translateX(' + direction + '%)' }, { transform: 'translateX(0)' }], options);
  finishModeSlide = () => {
    finishModeSlide = undefined;
    outgoing.hidden = true;
    outgoing.inert = false;
    outgoing.classList.remove('mode-leaving');
    leave.cancel();
    enter.cancel();
  };
  leave.onfinish = finishModeSlide;
}

function openTournamentPage(slide = false) {
  finishTournamentOvertake?.();
  $('tournament-overtake').hidden = true;
  const wasDemo = tournamentDemo;
  tournamentDemo = false;
  $('tournament-demo').textContent = 'Aperçu 121e → 5e';
  $('tournament-enter').disabled = false;
  const road = $('tournament-road-scroll');
  if (!wasDemo && displayedTournament && !$('tournament').hidden) tournamentScroll.set(displayedTournament.category, road.scrollTop);
  const today = dailyTournament();
  if (displayedTournament?.day !== today.day) tournamentScroll.clear();
  if (tournamentMode === 'pro' && !tournamentProUnlocked()) tournamentMode = 'sprint';
  displayedTournament = tournamentMode === 'sprint' ? today : dailyTournament(new Date(), 'pro');
  showTournament(displayedTournament);
  showModePage('tournament', slide);
  paintTournamentRoad();
  if (tournamentScroll.has(tournamentMode)) road.scrollTop = tournamentScroll.get(tournamentMode);
  else centerTournamentRow($('tournament-self'));
  updateTournamentSelection();
  window.scrollTo(0, 0);
  $('tournament-title').focus({ preventScroll: true });
}

function toggleTournamentDemo() {
  if (tournamentDemo) {
    openTournamentPage();
    return;
  }
  const tournament = displayedTournament;
  const opponents = tournamentOpponents(tournament.track).slice().sort((a, b) => a.time - b.time);
  const time = Math.round(opponents[3].time * 100);
  const previous = Math.round(opponents.at(-1).time * 100) + 1;
  const road = $('tournament-road-scroll');
  tournamentScroll.set(tournamentMode, road.scrollTop);
  tournamentDemo = true;
  $('tournament-demo').textContent = 'Quitter l’aperçu';
  $('tournament-enter').disabled = true;
  showTournamentRacers(tournament, { time });
  paintTournamentRoad();
  centerTournamentRow($('tournament-self'));
  updateTournamentSelection();
  animateTournamentOvertake({ previous, time }, { time });
}

function paintTournamentRoad(dt = 0) {
  if ($('tournament').hidden || !displayedTournament) return;
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const remaining = Math.ceil((midnight - now) / 1000);
  const timer = [Math.floor(remaining / 3600), Math.floor(remaining / 60) % 60, remaining % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
  if (timer !== lastTournamentClock) {
    $('tournament-clock').textContent = timer;
    lastTournamentClock = timer;
  }
  if (!activeTournament && midnight.getTime() !== displayedTournament.endsAt) {
    openTournamentPage();
    return;
  }
  paintHomeRoad(dt, $('tournament-road'), displayedTournament.track, $('tournament-road-scroll').scrollTop);
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
      play('switch_to_' + button.dataset.category + '_track', 0.65);
    });
  }
  $('track').addEventListener('change', chooseTrack);
  $('reference-ghost').addEventListener('change', reset);
  $('pro-track-sprint').addEventListener('click', () => {
    const sprint = pairedSprint(course);
    if (!sprint) return;
    chooseCategory('sprint', sprint.id);
    enterRace();
  });
  $('garage-open').addEventListener('click', openGarage);
  $('tournament-open').addEventListener('click', () => openTournamentPage(true));
  $('solo-open').addEventListener('click', () => {
    finishTournamentOvertake?.();
    if (!tournamentDemo) tournamentScroll.set(tournamentMode, $('tournament-road-scroll').scrollTop);
    showModePage('home', true);
    refreshHome();
    window.scrollTo(0, 0);
    $('tournament-open').focus({ preventScroll: true });
  });
  $('tournament-enter').addEventListener('click', () => {
    const entry = selectedTournamentRow?.entry;
    startTournament(entry?.ai ? entry : tournamentReferenceOpponent(displayedTournament.track));
  });
  $('tournament-demo').addEventListener('click', toggleTournamentDemo);
  $('tournament-road-scroll').addEventListener('scroll', updateTournamentSelection, { passive: true });
  for (const event of ['wheel', 'pointerdown']) {
    $('tournament-road-scroll').addEventListener(event, () => finishTournamentOvertake?.(), { passive: true });
  }
  $('tournament-road-scroll').addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !selectedTournamentRow) return;
    finishTournamentOvertake?.();
    event.preventDefault();
    const index = tournamentRows.indexOf(selectedTournamentRow) + (event.key === 'ArrowUp' ? -1 : 1);
    const next = tournamentRows[index];
    if (next) {
      if (event.target !== $('tournament-road-scroll')) next.button.focus({ preventScroll: true });
      centerTournamentRow(next.element);
    }
  });
  window.addEventListener('resize', updateTournamentSelection);
  $('tournament-sprint-tab').addEventListener('click', () => {
    if (tournamentMode === 'sprint') return;
    tournamentMode = 'sprint';
    openTournamentPage();
    play('switch_to_sprint_track', 0.65);
    $('tournament-sprint-tab').focus();
  });
  $('tournament-pro-tab').addEventListener('click', () => {
    if (!tournamentProUnlocked()) {
      const lock = $('tournament-pro-lock');
      lock.textContent = 'Pour ouvrir le Pro, réalise ' + tournamentScore(dailyTournament().pro / 100) + ' ou mieux dans le Sprint du jour.';
      lock.hidden = false;
      return;
    }
    if (tournamentMode === 'pro') return;
    tournamentMode = 'pro';
    openTournamentPage();
    play('switch_to_pro_track', 0.65);
    $('tournament-pro-tab').focus();
  });
  $('tournament-locate').addEventListener('click', () => {
    centerTournamentRow($('tournament-self'), homeMotion.matches ? 'instant' : 'smooth');
  });
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
  $('home-road').addEventListener('click', enterRace);
  window.addEventListener('keydown', (event) => {
    if (!$('tournament').hidden || $('home').hidden || $('garage').open || $('gifts').open || event.repeat ||
        event.ctrlKey || event.metaKey || event.altKey ||
        !['Space', 'Enter'].includes(event.code) || event.target.closest?.('button, select, a, input')) return;
    event.preventDefault();
    enterRace();
    if (event.code === 'Space' && !$('race-intro').hidden) controls.add(event.code);
  });
  $('back-home').addEventListener('click', returnHome);
  for (const id of ['track', 'garage-open', 'gift-open', 'home-sound', 'tournament-open']) $(id).disabled = false;
  openTournamentPage();
}

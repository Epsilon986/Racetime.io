import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const output = new URL('assets/reference-ghosts.js', import.meta.url);
const window = {};
new Function('window', read('assets/data.js'))(window);
const physics = new Function('window', read('physics.js') + '\nreturn racePhysics;')(window);
if (existsSync(output)) new Function('window', read('assets/reference-ghosts.js'))(window);

const { tracks, cars } = window.raceTimeAssets;
const car = cars[0];
const attempts = 2500;
const tickLimit = 24000;
let seed = 237193;

function random(limit) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return Math.floor(seed / 4294967296 * limit);
}

function run(paths, releases, limit, capture = false) {
  const racer = physics.create(paths, car);
  const points = capture ? [physics.pose(racer)] : null;
  const walls = [];
  let ticks = 0;
  let contacts = 0;
  while (racer.lap <= 2 && ticks < limit) {
    physics.advance(racer, !releases[ticks]);
    ticks++;
    if (racer.wallContact) {
      contacts++;
      if (!walls.length || ticks - walls.at(-1) > 15) walls.push(ticks);
    }
    if (capture && (ticks % 5 === 0 || racer.lap > 2)) points.push(physics.pose(racer));
  }
  return { ticks: racer.lap > 2 ? ticks : Infinity, contacts, walls, points };
}

function generate(track) {
  const paths = physics.build(track.lanes);
  let releases = new Uint8Array(tickLimit);
  let best = run(paths, releases, tickLimit);
  if (!Number.isFinite(best.ticks)) throw new Error('Reference did not finish: ' + track.id);
  const baseline = best.ticks;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const trial = releases.slice();
    const wall = attempt % 3 === 0 && best.walls.length ? best.walls[random(best.walls.length)] : null;
    const start = wall === null ? random(best.ticks) : Math.max(0, wall - random(115));
    const end = Math.min(trial.length, start + 2 + random(attempt < 1000 ? 95 : 45));
    if (attempt % 5 === 0) {
      for (let tick = start; tick < end; tick++) trial[tick] ^= 1;
    } else {
      trial.fill(attempt % 4 === 0 ? 0 : 1, start, end);
    }
    const result = run(paths, trial, best.ticks);
    if (result.ticks < best.ticks || (result.ticks === best.ticks && result.contacts < best.contacts)) {
      best = result;
      releases = trial;
    }
  }
  const final = run(paths, releases, best.ticks, true);
  const time = final.ticks * physics.step;
  const points = final.points.map(({ x, y, angle }) => ({ x, y, angle: Number(angle.toFixed(6)) }));
  console.log(track.id, (baseline * physics.step).toFixed(2), '→', time.toFixed(2), '| wall ticks:', final.contacts);
  return { track: track.id, car: car.id, time, points };
}

const references = Object.fromEntries(tracks.map((track) => {
  const existing = window.referenceGhosts?.[track.id];
  if (track.id === 'short_track_17' && existing) return [track.id, existing];
  const generated = generate(track);
  return [track.id, existing && existing.time <= generated.time ? existing : generated];
}));
const entries = Object.entries(references).map(([id, replay]) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(replay));
writeFileSync(output, 'window.referenceGhosts = {\n' + entries.join(',\n') + '\n};\n');

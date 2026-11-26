import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
const assets = new URL('../race-time-1-0-6/resources/assets/monkey/', import.meta.url);
const output = new URL('./assets/', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path + '.json', assets), 'utf8'));
mkdirSync(output, { recursive: true });
const tracks = readdirSync(new URL('data/', assets))
  .filter((file) => /^(short_track_\d+|track_(\d+|thanksgiving))_info\.json$/.test(file))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  .map((file) => {
    const id = file.replace('_info.json', '');
    const info = read('data/' + id + '_info');
    const level = read('data/' + id);
    return {
      id, name: info.displayName.trim(), roadTexture: info.trackImage, background: info.rightColor,
      menuRoad: info.image, menuTerrain: [
        { color: info.leftColor, objects: Object.values(info.leftTerrain ?? {}).map(({ object }) => object) },
        { color: info.rightColor, objects: Object.values(info.rightTerrain ?? {}).map(({ object }) => object) },
      ],
      ambience: info.ambientSound || 'ambience_track_generic',
      lanes: level.laneData.lanes.map(({ path }) => path.map(({ x, y, l, r }) => [x / 100, y / 100, l ?? null, r ?? null])),
      roads: level.roads,
      decorations: level.decorations,
      quads: read('data/' + id + '_quads'),
    };
  });
const frames = {};
const copy = (from, to) => copyFileSync(new URL(from, assets), new URL(to, output));
for (const road of new Set(tracks.map(({ menuRoad }) => menuRoad))) {
  const file = 'road_ui_straight_' + road + '.png';
  copy('art/' + file, file);
}
for (const sheet of ['world_v2', 'world2', 'cars', 'main3_v2']) {
  for (const frame of read('spritesheet/' + sheet).frames) {
    frames[frame.filename] = { ...frame, sheet };
  }
  copy('spritesheet/' + sheet + '.png', sheet + '.png');
}
const startPanel = read('spritesheet/main2_v5').frames.find(({ filename }) => filename === 'lb_balloon');
frames.lb_balloon = { ...startPanel, sheet: 'main2_v5' };
copy('spritesheet/main2_v5.png', 'main2_v5.png');
const homeIcons = new Set(['button_garage', 'button_gift', 'settings_icon', 'trophy_gold', 'coin']);
for (const frame of read('spritesheet/main_v5').frames) {
  if (homeIcons.has(frame.filename)) frames[frame.filename] = { ...frame, sheet: 'main_v5' };
}
copy('spritesheet/main_v5.png', 'main_v5.png');
const moon = readFileSync(new URL('art/particle_star_moon.png', assets));
const moonSize = { w: moon.readUInt32BE(16), h: moon.readUInt32BE(20) };
frames.particle_star_moon = {
  frame: { x: 0, y: 0, ...moonSize }, sourceSize: moonSize,
  spriteSourceSize: { x: 0, y: 0, ...moonSize }, sheet: 'particle_star_moon',
};
copy('art/particle_star_moon.png', 'particle_star_moon.png');
const cars = Object.entries(read('data/cars')).flatMap(([id, car]) => {
  const body = car.visuals?.body;
  const frame = body?.fileName || car.image;
  const scale = car.scale ?? 1;
  const visuals = Object.values(car.visuals ?? {})
    .map((visual) => ({
      ...visual, x: (visual.x ?? 0) * scale, y: (visual.y ?? 0) * scale,
      width: (visual.width ?? 30) * scale, height: (visual.height ?? 50) * scale,
      scale: (visual.scale ?? 1) * scale, parallax: (visual.parallax ?? 0) * scale,
      duration: (visual.duration ?? 1) * scale,
    }))
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
  const effects = visuals.filter(({ type }) => type === 2 || type === 4);
  const images = visuals.filter(({ type, fileName }) => (type ?? 1) === 1 && frames[fileName]);
  return car.displayName && frames[frame] && body?.type !== 3
    ? [{ id, name: car.displayName, images, rotateMode: car.rotateMode ?? 0,
        displayX: Math.trunc((car.displayX ?? 0) * scale), displayY: Math.trunc((car.displayY ?? 0) * scale),
        smoothing: car.smoothing ?? 0.3, capSmoothing: car.capSmoothing ?? true,
        drifts: car.drifts ?? false, startingLineY: (car.startingLineY ?? 0) * (car.scale ?? 1),
        thrustSound: car.thrustSound || 'thrust',
        effects }]
    : [];
});
const particleNames = new Set(cars.flatMap(({ effects }) =>
  effects.filter(({ type }) => type === 2).map(({ fileName }) => fileName || 'racer_thrust')));
const particles = Object.fromEntries([...particleNames]
  .filter((name) => existsSync(new URL('particles/' + name + '.json', assets)))
  .map((name) => [name, read('particles/' + name)]));
const sounds = new Set([
  'vs_whoosh', 'vs_impact', 'vs_whoosh_out',
  'music_menu', 'switch_to_pro_track', 'switch_to_sprint_track', 'announcer_racetime',
  'win_crowd_cheer', 'lose_crowd_ooh', 'music_win', 'music_lose',
  'click', 'unlock_pro_track', 'open_free_gift_a', 'open_free_gift_b', 'collect_coin',
  'whoosh_pass_01', 'whoosh_pass_02', 'whoosh_pass_03', 'whoosh_pass_04', 'whoosh_pass_05',
  'win_prize', 'tournament_results',
  'start_beep_1', 'start_beep_2', 'start_beep_3', '2nd_lap', 'finish_race', 'car_grind',
  ...tracks.map(({ ambience }) => ambience),
  ...cars.map(({ thrustSound }) => thrustSound),
]);
for (const name of sounds) {
  copy('sound/' + name + '.ogg', name + '.ogg');
}
// Inline the compressed samples so Web Audio can decode them from file:// as well.
const engineSamples = Object.fromEntries([...new Set(cars.map(({ thrustSound }) => thrustSound))]
  .map((name) => [name, readFileSync(new URL('sound/' + name + '.ogg', assets)).toString('base64')]));
copy('art/logo.png', 'logo.png');
copy('data/attribution.txt', 'attribution.txt');
const tiles = Object.fromEntries(Object.values(read('data/tiles')).map(({ slot, color }) => [slot, color]));
const objects = read('data/mapobjs');
const math = {
  sin: read('data/math_sin'), cos: read('data/math_cos'), atan: read('data/math_atan'),
};
writeFileSync(new URL('data.js', output), 'window.raceTimeAssets = ' +
  JSON.stringify({ tracks, frames, cars, tiles, objects, math, engineSamples, particles }) + ';\n');
console.log(tracks.length + ' circuits et ' + cars.length + ' véhicules');

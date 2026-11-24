'use strict';

function createVehicleEffects(car, definitions) {
  return car.effects.filter((effect) => effect.alpha !== 0).map((effect) => ({
    effect,
    marks: [],
    emitters: effect.type === 2 ? (definitions[effect.fileName || 'racer_thrust']?.emitters ?? [])
      .filter((emitter) => emitter.image)
      .map((config) => ({ config, amount: 0, age: 0 })) : [],
  }));
}

function effectEnabled(effect, player, powered) {
  return (!effect.onThrust || powered) && (!effect.onCoast || !powered) &&
    (!effect.onDrift || Math.abs(player.drift) > 500) &&
    (!(effect.onCrashLeft || effect.onCrashRight) ||
      (effect.onCrashLeft && player.wallSide === 'left') || (effect.onCrashRight && player.wallSide === 'right'));
}

function shiftPoint(pose, x, y) {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  return { x: pose.x + x * cos - y * sin, y: pose.y + x * sin + y * cos };
}

function randomAround(value = 0, spread = 0) {
  return value + (Math.random() - 0.5) * spread;
}

function particleTint(config, tint = 0xffffff) {
  const channels = ['r', 'g', 'b'].map((key, index) => {
    const from = config['s' + key + '_mn'];
    const to = config['s' + key + '_mx'];
    const value = config['s' + key] ?? (from == null ? config[key] ?? 255 : (from + (to ?? from)) / 2);
    return Math.round(value * ((tint >> (16 - 8 * index)) & 255) / 255);
  });
  return (channels[0] << 16) | (channels[1] << 8) | channels[2];
}

function emitParticles(state, pose, origin, time, dt) {
  const { effect, marks, emitters } = state;
  const angle = pose.angle - (effect.angle ?? 0) * Math.PI / 180;
  for (const emitter of emitters) {
    const { config } = emitter;
    emitter.age += dt;
    if (emitter.age < (config.delay ?? 0) || marks.length >= 240) continue;
    emitter.amount += (config.rate ?? 10) * dt;
    while (emitter.amount >= 1) {
      emitter.amount--;
      const scale = effect.scale;
      const offset = { ...origin, angle };
      const position = shiftPoint(offset,
        randomAround(config.x, config.spwn_xs) * scale, randomAround(config.y, config.spwn_ys) * scale);
      const velocity = shiftPoint({ x: 0, y: 0, angle },
        randomAround(config.vx, config.vx_r) * scale, randomAround(config.vy, config.vy_r) * scale);
      const baseScale = config.scale ?? 1;
      const size = Math.max(0, randomAround(config.sscale ?? baseScale, config.sscale_r)) * scale;
      marks.push({
        ...position, vx: velocity.x, vy: velocity.y, time,
        lifetime: Math.max(0.01, randomAround(config.life ?? 1, config.life_r)),
        angle: angle - randomAround(config.rot, config.rot_r) * Math.PI / 180,
        spin: -randomAround(config.rots, config.rots_r) * Math.PI / 180,
        image: config.image.replace(/^art\//, ''), frames: config.fr_x ?? 1, fps: config.anim ?? 0,
        tint: particleTint(config, effect.color), size,
        endSize: config.ss === false ? size : Math.max(0, randomAround(config.escale ?? baseScale, config.escale_r)) * scale,
        alpha: (effect.alpha ?? 1) * (config.sa ?? config.a ?? 1),
        endAlpha: (effect.alpha ?? 1) * (config.se === false ? config.sa ?? config.a ?? 1 : config.ea ?? 0),
      });
    }
  }
}

function updateRibbon(state, origin, time) {
  const previous = state.anchor;
  if (!previous) {
    state.anchor = { ...origin, time };
    return;
  }
  const dx = origin.x - previous.x;
  const dy = origin.y - previous.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 8) return;
  const halfWidth = state.effect.width / 2;
  const nx = -dy * halfWidth / distance;
  const ny = dx * halfWidth / distance;
  const next = { ...origin, nx, ny, time };
  state.marks.push({ from: { nx, ny, ...previous }, to: next, time });
  state.anchor = next;
}

function updateVehicleEffects(player, pose, time, dt, powered) {
  for (const state of player.effects) {
    const { effect } = state;
    state.marks = state.marks.filter((mark) => time - mark.time < (mark.lifetime ?? effect.duration));
    if (!effectEnabled(effect, player, powered)) {
      state.anchor = null;
      for (const emitter of state.emitters) {
        emitter.amount = 0;
        emitter.age = 0;
      }
      continue;
    }
    const origin = shiftPoint(pose, effect.x, effect.y);
    if (effect.type === 4) {
      if (player.speed > 0) updateRibbon(state, origin, time);
    } else {
      emitParticles(state, pose, origin, time, dt);
    }
  }
}

function mixTrailColor(start, end, fraction) {
  return [16, 8, 0].reduce((color, shift) => {
    const a = start >> shift & 255;
    const b = end >> shift & 255;
    return color | (Math.round(a + (b - a) * fraction) << shift);
  }, 0);
}

function drawRibbon(context, state, time, formatColor) {
  const { effect, marks } = state;
  const start = effect.color ?? 0xffffff;
  const end = effect.endColor ?? 0xffffff;
  for (const { from, to, time: born } of marks) {
    const age = Math.min(1, Math.max(0, (time - born) / effect.duration));
    context.fillStyle = formatColor(mixTrailColor(start, end, age));
    context.globalAlpha = (effect.alpha ?? 1) * (1 - age);
    context.beginPath();
    context.moveTo(from.x + from.nx, from.y + from.ny);
    context.lineTo(to.x + to.nx, to.y + to.ny);
    context.lineTo(to.x - to.nx, to.y - to.ny);
    context.lineTo(from.x - from.nx, from.y - from.ny);
    context.closePath();
    context.fill();
  }
}

function drawVehicleEffects(context, states, time, foreground, frames, sprite, formatColor) {
  for (const state of states) {
    if (((state.effect.layer ?? 0) > 0) !== foreground) continue;
    if (state.effect.type === 4) {
      drawRibbon(context, state, time, formatColor);
      continue;
    }
    for (const mark of state.marks) {
      const frame = frames[mark.image];
      if (!frame) continue;
      const dt = Math.max(0, time - mark.time);
      const age = Math.min(1, dt / mark.lifetime);
      const size = mark.size + (mark.endSize - mark.size) * age;
      if (size <= 0) continue;
      const index = Math.floor(dt * mark.fps) % mark.frames;
      context.save();
      context.translate(mark.x + mark.vx * dt, mark.y + mark.vy * dt);
      context.rotate(mark.angle + mark.spin * dt);
      context.globalAlpha = mark.alpha + (mark.endAlpha - mark.alpha) * age;
      sprite(context, mark.image, frame.sourceSize.w / mark.frames * size, frame.sourceSize.h * size,
        mark.tint, index, mark.frames);
      context.restore();
    }
  }
  context.globalAlpha = 1;
}

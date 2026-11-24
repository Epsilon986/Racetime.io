'use strict';

// Android qk, qg, ut and aag use centipixels and centidegrees at 100 Hz.
const racePhysics = (() => {
  const { sin, cos, atan } = window.raceTimeAssets.math;
  const step = 0.01;
  const topSpeed = 10000;
  const laneThreshold = 3000;
  const lookAhead = 2500;
  const trunc = Math.trunc;
  const wrap = (value, size) => ((value % size) + size) % size;
  const diff = (target, current) => wrap(target - current + 18000, 36000) - 18000;
  const length = (x, y) => trunc(Math.hypot(x, y));
  const distance = (a, b) => length(a.x - b.x, a.y - b.y);

  function heading(x, y) {
    const magnitude = length(x, y);
    if (!magnitude) return 0;
    const angle = atan[Math.min(3999, trunc(Math.abs(x) * 3999 / magnitude))];
    return wrap(x < 0 ? (y < 0 ? angle - 18000 : -angle) :
      (y < 0 ? 18000 - angle : angle), 36000);
  }

  function build(lanes) {
    const nodes = lanes.map((lane, laneIndex) => lane.map(([x, y], index) => ({
      x: Math.round(x * 100), y: Math.round(y * 100), lane: laneIndex, index,
    })));
    nodes.forEach((lane, laneIndex) => lane.forEach((node, index) => {
      const [, , left, right] = lanes[laneIndex][index];
      node.next = lane[(index + 1) % lane.length];
      node.previous = lane[wrap(index - 1, lane.length)];
      node.left = left === null ? null : nodes[laneIndex - 1]?.[left];
      node.right = right === null ? null : nodes[laneIndex + 1]?.[right];
    }));
    return nodes;
  }

  function aim(player, node) {
    if (node === player.target) return;
    if (player.target?.index === 0 && node.index === 1 && player.nodesSinceLap > 10) {
      player.lap++;
      player.nodesSinceLap = 0;
    }
    player.nodesSinceLap++;
    player.target = node;
    player.targetDistance = trunc(distance(player, node) * 0.95);
    player.travelled = 0;
  }

  function create(paths, car) {
    const start = paths[0][0];
    const angle = heading(start.next.x - start.x, start.next.y - start.y);
    const trig = trunc(angle / 10);
    const shift = car.startingLineY / 10;
    const player = {
      x: start.x - trunc(sin[trig] * shift), y: start.y - trunc(cos[trig] * shift),
      angle, visualAngle: 18000 + angle, drift: 0, driftTimer: 0, turnRate: 0,
      speed: 0, lap: 1, nodesSinceLap: 0, car, wallContact: false,
    };
    aim(player, start.next);
    return player;
  }

  function isAhead(player, node) {
    const x = node.x - player.x;
    const y = node.y - player.y;
    return (x !== 0 || y !== 0) && Math.abs(diff(heading(x, y), player.angle)) < 9000;
  }

  function nearest(player, start) {
    let best = start;
    let bestDistance = distance(player, start);
    for (const direction of ['next', 'previous']) {
      for (let node = start[direction]; node !== start; node = node[direction]) {
        const candidate = distance(player, node);
        if (candidate >= bestDistance) break;
        best = node;
        bestDistance = candidate;
      }
    }
    return best;
  }

  function checkLane(player, powered) {
    const { previous, left, right } = player.target;
    const dx = player.target.x - previous.x;
    const dy = player.target.y - previous.y;
    const segment = length(dx, dy);
    const alongX = segment ? trunc(dx * 1000 / segment) : 0;
    const alongY = segment ? trunc(dy * 1000 / segment) : 0;
    const projection = Math.max(0, Math.min(segment, trunc(
      ((player.x - previous.x) * alongX + (player.y - previous.y) * alongY) / 1000)));
    const cx = previous.x + trunc(alongX * projection / 1000);
    const cy = previous.y + trunc(alongY * projection / 1000);
    const offsetX = player.x - cx;
    const offsetY = player.y - cy;
    const offset = length(offsetX, offsetY);
    player.wallContact = false;
    player.wallSide = null;
    if (offset < laneThreshold) return;

    const side = alongX * offsetY - alongY * offsetX < 0 ? 'left' : 'right';
    const neighbor = side === 'left' ? left : right;
    if (neighbor) {
      const node = nearest(player, neighbor);
      aim(player, isAhead(player, node) ? node : node.next);
      return;
    }
    const node = nearest(player, player.target);
    player.wallContact = player.speed > 0;
    player.wallSide = player.wallContact ? side : null;
    aim(player, isAhead(player, node) ? node : node.next);
    player.x = cx + trunc(trunc(offsetX * 1000 / offset) * laneThreshold / 1000);
    player.y = cy + trunc(trunc(offsetY * 1000 / offset) * laneThreshold / 1000);
    if (player.speed > 1000) {
      player.speed = trunc(player.speed * (powered ? 0.5 : 0.8));
    }
    if (powered) player.turnRate = 1800;
  }

  function turn(player, powered) {
    let target = player.target;
    let ahead = distance(player, target);
    for (let count = 0; ahead < lookAhead && count < 32; count++) {
      ahead += distance(target, target.next);
      target = target.next;
    }
    const delta = diff(heading(target.x - player.x, target.y - player.y), player.angle);
    if (powered) {
      const thrustTurnRate = 17000;
      if (!delta) {
        player.turnRate = Math.max(0, player.turnRate - (player.turnRate > thrustTurnRate ? 1700 : 340));
      } else if (player.turnRate > thrustTurnRate) {
        player.turnRate = Math.max(thrustTurnRate, player.turnRate - 1700);
      } else {
        player.turnRate = Math.min(thrustTurnRate, player.turnRate + 340);
      }
    } else {
      player.turnRate = Math.max(0, Math.min(32000, player.turnRate + (delta ? 3200 : -3200)));
    }
    const limit = trunc(player.turnRate / 100);
    player.angle = wrap(player.angle + Math.max(-limit, Math.min(limit, delta)), 36000);
    return Math.max(-limit, Math.min(limit, delta));
  }

  function advance(player, powered) {
    checkLane(player, powered);
    const turnDelta = turn(player, powered);
    if (player.car.drifts) {
      player.drift = Math.max(-4500, Math.min(4500, trunc(player.drift + turnDelta * 0.25)));
      const decay = trunc(Math.abs(player.drift) / 90) + 150 - player.driftTimer * 10;
      player.drift -= Math.sign(player.drift) * Math.min(Math.abs(player.drift), decay);
      player.driftTimer = Math.abs(turnDelta) > 150 ? 15 : Math.max(0, player.driftTimer - 1);
    }
    const visualDelta = diff(player.angle + player.drift + 18000, player.visualAngle);
    const smoothing = player.car.smoothing;
    const capped = smoothing <= 0.1 && player.car.capSmoothing && Math.abs(visualDelta) >= 6000;
    player.visualAngle += visualDelta * (capped ? 0.1 : smoothing) * player.speed / topSpeed;
    if (powered) {
      player.speed += trunc(8000 * (topSpeed - player.speed) / (topSpeed * 100));
    } else {
      player.speed = Math.max(0, player.speed - trunc((player.speed + 400) * 50 / 10000));
    }
    const trig = trunc(player.angle / 10);
    const dx = trunc(sin[trig] * player.speed / 10000);
    const dy = trunc(cos[trig] * player.speed / 10000);
    player.x += dx;
    player.y += dy;
    player.travelled += length(dx, dy);
    if (player.travelled >= player.targetDistance && !isAhead(player, player.target)) {
      aim(player, player.target.next);
    }
  }

  function pose(player) {
    return { x: player.x / 100, y: player.y / 100, angle: -player.visualAngle * Math.PI / 18000 };
  }

  return { step, build, create, advance, pose };
})();

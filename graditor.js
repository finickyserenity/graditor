(() => {
    'use strict';

    const canvas = document.getElementById('game');
    const context = canvas.getContext('2d');
    const ui = {
        level: document.getElementById('levelValue'), score: document.getElementById('scoreValue'),
        hostiles: document.getElementById('hostileValue'), fuel: document.getElementById('fuelValue'),
        hull: document.getElementById('hullValue'), fuelMeter: document.getElementById('fuelMeter'),
        hullMeter: document.getElementById('hullMeter'), speed: document.getElementById('speedValue'),
        altitude: document.getElementById('altitudeValue'), message: document.getElementById('messagePanel'),
        start: document.getElementById('startButton'), startLabel: document.getElementById('startButtonLabel'),
        settings: document.getElementById('settingsDialog')
    };

    const controls = { left: false, right: false, thrust: false, fire: false };
    const config = { gravity: 0.03, maxFuel: 1000, thrust: 0.09, enemyRate: 1, baseHits: 2 };
    const world = { width: 8200, height: 2300, floor: [], ceiling: [], pads: [], stars: [], turrets: [], particles: [], bullets: [], enemyBullets: [] };
    const camera = { x: 0, y: 0 };
    const ship = { x: 180, y: 0, vx: 0, vy: 0, angle: 0, radius: 13, fuel: 1000, hull: 100, cooldown: 0, invulnerable: 0 };
    let level = 1;
    let score = 0;
    let state = 'briefing';
    let lastTime = 0;
    let shake = 0;

    function random(seed) {
        let value = seed % 2147483647;
        return () => ((value = value * 16807 % 2147483647) - 1) / 2147483646;
    }

    function terrainY(points, x) {
        const index = Math.max(0, Math.min(points.length - 2, Math.floor(x / 80)));
        const fraction = (x - index * 80) / 80;
        return points[index] + (points[index + 1] - points[index]) * fraction;
    }

    function buildLevel() {
        const rng = random(1103 + level * 991);
        world.floor = [];
        world.ceiling = [];
        world.pads = [];
        world.turrets = [];
        world.bullets = [];
        world.enemyBullets = [];
        world.particles = [];
        world.stars = Array.from({ length: 280 }, () => ({ x: rng() * world.width, y: rng() * world.height, size: rng() * 1.7 + .3, depth: rng() * .55 + .15 }));

        const launchY = 1670;
        const extractionY = 1510;
        let floorY = launchY;
        for (let x = 0; x <= world.width; x += 80) {
            floorY += (rng() - .5) * (95 + level * 8);
            floorY = Math.max(1120, Math.min(2030, floorY));
            if (x < 400) floorY = launchY;
            if (x > world.width - 520) floorY = extractionY;
            world.floor.push(floorY);
            const cavern = x > world.width * .2 && x < world.width * .43 || level > 1 && x > world.width * .59 && x < world.width * .77;
            world.ceiling.push(cavern ? 470 + Math.sin(x * .008) * 150 + rng() * 120 : -300);
        }

        world.pads.push({ x: 100, width: 180, y: launchY, extraction: false });
        world.pads.push({ x: world.width - 440, width: 260, y: extractionY, extraction: true });
        const turretCount = 5 + level * 2;
        for (let index = 0; index < turretCount; index++) {
            const x = 700 + index * ((world.width - 1450) / Math.max(1, turretCount - 1)) + (rng() - .5) * 180;
            world.turrets.push({ x, y: terrainY(world.floor, x) - 15, health: config.baseHits, cooldown: rng() * 100, angle: -Math.PI / 2 });
        }

        resetShip();
        ui.level.textContent = String(level).padStart(2, '0');
        updateHud();
    }

    function resetShip() {
        ship.x = 190;
        ship.y = world.pads[0].y - ship.radius;
        ship.vx = 0;
        ship.vy = 0;
        ship.angle = 0;
        ship.fuel = config.maxFuel;
        ship.hull = 100;
        ship.cooldown = 0;
        ship.invulnerable = 0;
        camera.x = 0;
        camera.y = Math.max(0, ship.y - canvas.height * .65);
    }

    function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(innerWidth * ratio);
        canvas.height = Math.floor(innerHeight * ratio);
        canvas.style.width = `${innerWidth}px`;
        canvas.style.height = `${innerHeight}px`;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function emit(x, y, color, count, speed = 2) {
        for (let index = 0; index < count; index++) {
            const angle = Math.random() * Math.PI * 2;
            const velocity = Math.random() * speed;
            world.particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 24 + Math.random() * 30, color, size: 1 + Math.random() * 3 });
        }
    }

    function fire() {
        if (ship.cooldown > 0) return;
        const directionX = Math.sin(ship.angle);
        const directionY = -Math.cos(ship.angle);
        world.bullets.push({ x: ship.x + directionX * 18, y: ship.y + directionY * 18, vx: ship.vx + directionX * 8, vy: ship.vy + directionY * 8, life: 90 });
        ship.cooldown = 11;
    }

    /**
     * Reports whether a projectile has entered solid terrain or a landing pad.
     * @param {{x: number, y: number}} projectile The projectile to test.
     * @returns {boolean} Whether the projectile is blocked by the landscape.
     */
    function projectileHitsTerrain(projectile) {
        const pad = world.pads.find(item => projectile.x >= item.x && projectile.x <= item.x + item.width);
        const floor = pad ? pad.y : terrainY(world.floor, projectile.x);
        return projectile.x < 0 || projectile.x > world.width || projectile.y >= floor || projectile.y <= terrainY(world.ceiling, projectile.x);
    }

    function damage(amount) {
        if (ship.invulnerable > 0 || state !== 'playing') return;
        ship.hull = Math.max(0, ship.hull - amount);
        ship.invulnerable = 36;
        shake = 10;
        emit(ship.x, ship.y, '#ff5f4d', 16, 3);
        if (ship.hull <= 0) endRun('SHIP LOST', 'Hull integrity lost.', 'The ridge claimed another pilot. Your mission can be restarted from this sector.', 'RETRY SECTOR');
    }

    function update(dt) {
        world.particles.forEach(particle => { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += .012 * dt; particle.life -= dt; });
        world.particles = world.particles.filter(particle => particle.life > 0);
        shake *= Math.pow(.96, dt);
        if (shake < .05) shake = 0;
        if (state !== 'playing') return;

        if (controls.left) ship.angle -= .052 * dt;
        if (controls.right) ship.angle += .052 * dt;
        if (controls.thrust && ship.fuel > 0) {
            ship.vx += Math.sin(ship.angle) * config.thrust * dt;
            ship.vy -= Math.cos(ship.angle) * config.thrust * dt;
            ship.fuel = Math.max(0, ship.fuel - .85 * dt);
            const nozzleX = ship.x - Math.sin(ship.angle) * 14;
            const nozzleY = ship.y + Math.cos(ship.angle) * 14;
            emit(nozzleX, nozzleY, Math.random() > .4 ? '#ffb547' : '#c7f36a', 1, 1.2);
        }
        if (controls.fire) fire();
        ship.vy += config.gravity * dt;
        ship.vx *= Math.pow(.9994, dt);
        ship.x += ship.vx * dt;
        ship.y += ship.vy * dt;
        ship.cooldown -= dt;
        ship.invulnerable -= dt;

        world.bullets.forEach(bullet => {
            bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
            if (projectileHitsTerrain(bullet)) { bullet.life = 0; emit(bullet.x, bullet.y, '#c7f36a', 3, .7); }
        });
        world.enemyBullets.forEach(bullet => {
            bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
            if (projectileHitsTerrain(bullet)) { bullet.life = 0; emit(bullet.x, bullet.y, '#ff5f4d', 3, .7); return; }
            if (Math.hypot(bullet.x - ship.x, bullet.y - ship.y) < ship.radius + 4) { bullet.life = 0; damage(18); }
        });

        world.turrets.forEach(turret => {
            if (turret.health <= 0) return;
            const distance = Math.hypot(ship.x - turret.x, ship.y - turret.y);
            turret.angle = Math.atan2(ship.y - turret.y, ship.x - turret.x);
            turret.cooldown -= dt * config.enemyRate;
            if (distance < 720 && turret.cooldown <= 0) {
                const speed = 3.2 + level * .25;
                world.enemyBullets.push({ x: turret.x, y: turret.y - 9, vx: Math.cos(turret.angle) * speed, vy: Math.sin(turret.angle) * speed, life: 220 });
                turret.cooldown = Math.max(55, 130 - level * 9) + Math.random() * 60;
            }
            world.bullets.forEach(bullet => {
                if (bullet.life > 0 && Math.hypot(bullet.x - turret.x, bullet.y - turret.y) < 23) {
                    bullet.life = 0;
                    turret.health--;
                    emit(turret.x, turret.y, turret.health > 0 ? '#ffb547' : '#c7f36a', turret.health > 0 ? 8 : 28, 3);
                    if (turret.health <= 0) score += 750 * level;
                }
            });
        });
        world.bullets = world.bullets.filter(bullet => bullet.life > 0);
        world.enemyBullets = world.enemyBullets.filter(bullet => bullet.life > 0);

        const pad = world.pads.find(item => ship.x >= item.x + ship.radius && ship.x <= item.x + item.width - ship.radius);
        const floor = pad ? pad.y : terrainY(world.floor, ship.x);
        const ceiling = terrainY(world.ceiling, ship.x);
        const hitFloor = ship.y + ship.radius >= floor;
        const hitCeiling = ship.y - ship.radius <= ceiling;
        if (hitFloor) {
            if (pad) {
                const impactSpeed = Math.hypot(ship.vx, ship.vy);
                const verticalSpeed = Math.abs(ship.vy);
                const lateralSpeed = Math.abs(ship.vx);
                const tilt = Math.abs(Math.atan2(Math.sin(ship.angle), Math.cos(ship.angle)));
                const safeLanding = verticalSpeed <= 2.2 && lateralSpeed <= 2 && tilt <= .5;
                ship.y = floor - ship.radius;
                if (safeLanding) {
                    ship.vx *= .72; ship.vy = 0; ship.angle *= .72;
                    if (pad.extraction && world.turrets.every(turret => turret.health <= 0)) completeLevel();
                } else {
                    ship.vx *= .55; ship.vy = -verticalSpeed * .35;
                    const fatalImpact = verticalSpeed >= 5.5 || impactSpeed >= 7 || tilt >= 1.2;
                    damage(fatalImpact ? 100 : Math.max(12, (impactSpeed - 1.5) * 16 + tilt * 18));
                }
            } else {
                ship.y = floor - ship.radius;
                ship.vy = -Math.abs(ship.vy) * .35;
                ship.vx *= .72;
                damage(Math.max(8, Math.hypot(ship.vx, ship.vy) * 9));
            }
        }
        if (hitCeiling) { ship.y = ceiling + ship.radius; ship.vy = Math.abs(ship.vy) * .5; damage(15); }
        if (ship.x < 0 || ship.x > world.width || ship.y > world.height + 200) damage(100);

        const screenX = ship.x - camera.x;
        const screenY = ship.y - camera.y;
        const leftEdge = innerWidth * .3;
        const rightEdge = innerWidth * .7;
        const topEdge = innerHeight * .28;
        const bottomEdge = innerHeight * .72;
        if (screenX < leftEdge) camera.x += (screenX - leftEdge) * .08 * dt;
        if (screenX > rightEdge) camera.x += (screenX - rightEdge) * .08 * dt;
        if (screenY < topEdge) camera.y += (screenY - topEdge) * .08 * dt;
        if (screenY > bottomEdge) camera.y += (screenY - bottomEdge) * .08 * dt;
        camera.x = Math.max(0, Math.min(world.width - innerWidth, camera.x));
        camera.y = Math.max(0, Math.min(world.height - innerHeight, camera.y));
        updateHud();
    }

    function completeLevel() {
        state = 'complete';
        score += Math.round(ship.fuel * 2 + ship.hull * 25);
        showMessage('SECTOR SECURED', `Level ${level} complete`, `Fuel and hull bonuses logged. The next sector has stronger emplacements and tighter terrain.`, 'ENTER NEXT SECTOR');
    }

    function endRun(eyebrow, title, copy, button) {
        state = 'dead';
        showMessage(eyebrow, title, copy, button);
    }

    function showMessage(eyebrow, title, copy, button) {
        ui.message.querySelector('.eyebrow').textContent = eyebrow;
        ui.message.querySelector('h1').innerHTML = title;
        ui.message.querySelector('p:not(.eyebrow)').textContent = copy;
        ui.startLabel.textContent = button;
        ui.message.classList.add('visible');
    }

    function updateHud() {
        const live = world.turrets.filter(turret => turret.health > 0).length;
        const fuelPercent = ship.fuel / config.maxFuel * 100;
        ui.score.textContent = String(score).padStart(6, '0');
        ui.hostiles.textContent = live;
        ui.fuel.textContent = Math.ceil(fuelPercent);
        ui.hull.textContent = Math.ceil(ship.hull);
        ui.fuelMeter.value = fuelPercent;
        ui.hullMeter.value = ship.hull;
        ui.speed.textContent = `${Math.hypot(ship.vx, ship.vy).toFixed(1)} M/S`;
        ui.altitude.textContent = `ALT ${Math.max(0, Math.round(terrainY(world.floor, ship.x) - ship.y))}`;
    }

    function drawTerrain(points, fill, stroke, invert = false) {
        context.beginPath();
        context.moveTo(-camera.x, invert ? -camera.y - 400 : world.height - camera.y);
        points.forEach((point, index) => context.lineTo(index * 80 - camera.x, point - camera.y));
        context.lineTo(world.width - camera.x, invert ? -camera.y - 400 : world.height - camera.y);
        context.closePath();
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = stroke;
        context.lineWidth = 2;
        context.stroke();
    }

    function render() {
        context.clearRect(0, 0, innerWidth, innerHeight);
        const gradient = context.createLinearGradient(0, 0, 0, innerHeight);
        gradient.addColorStop(0, '#080c0c'); gradient.addColorStop(1, '#151b16');
        context.fillStyle = gradient; context.fillRect(0, 0, innerWidth, innerHeight);
        context.save();
        context.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);

        world.stars.forEach(star => {
            const x = star.x - camera.x * star.depth;
            const y = star.y - camera.y * star.depth;
            if (x > 0 && x < innerWidth && y > 0 && y < innerHeight) {
                context.globalAlpha = .25 + star.depth;
                context.fillStyle = '#d8e3d5'; context.fillRect(x, y, star.size, star.size);
            }
        });
        context.globalAlpha = 1;

        drawTerrain(world.floor, '#252d27', '#7f927e');
        drawTerrain(world.ceiling, '#202722', '#657667', true);
        context.strokeStyle = 'rgba(199,243,106,.055)'; context.lineWidth = 1;
        for (let x = -(camera.x % 80); x < innerWidth; x += 80) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, innerHeight); context.stroke(); }
        for (let y = -(camera.y % 80); y < innerHeight; y += 80) { context.beginPath(); context.moveTo(0, y); context.lineTo(innerWidth, y); context.stroke(); }

        world.pads.forEach(pad => {
            const x = pad.x - camera.x, y = pad.y - camera.y;
            context.fillStyle = pad.extraction ? '#c7f36a' : '#77837b'; context.fillRect(x, y - 4, pad.width, 5);
            context.fillStyle = '#111612'; context.font = '11px Monaco, monospace'; context.textAlign = 'center';
            context.fillText(pad.extraction ? 'EXTRACTION' : 'LAUNCH', x + pad.width / 2, y + 18);
            for (let dot = 8; dot < pad.width; dot += 24) { context.fillStyle = '#ffb547'; context.fillRect(x + dot, y - 8, 3, 3); }
        });

        world.turrets.forEach(turret => {
            if (turret.health <= 0) return;
            const x = turret.x - camera.x, y = turret.y - camera.y;
            context.save(); context.translate(x, y);
            context.fillStyle = '#b7c1b9'; context.fillRect(-15, -7, 30, 14);
            context.strokeStyle = '#ff5f4d'; context.lineWidth = 5; context.beginPath(); context.moveTo(0, -6); context.lineTo(Math.cos(turret.angle) * 20, -6 + Math.sin(turret.angle) * 20); context.stroke();
            context.fillStyle = '#ff5f4d'; context.fillRect(-turret.health * 4, -19, turret.health * 8, 2);
            context.restore();
        });

        world.bullets.forEach(bullet => { context.fillStyle = '#c7f36a'; context.fillRect(bullet.x - camera.x - 2, bullet.y - camera.y - 2, 5, 5); });
        world.enemyBullets.forEach(bullet => { context.fillStyle = '#ff5f4d'; context.beginPath(); context.arc(bullet.x - camera.x, bullet.y - camera.y, 4, 0, Math.PI * 2); context.fill(); });
        world.particles.forEach(particle => { context.globalAlpha = Math.min(1, particle.life / 15); context.fillStyle = particle.color; context.fillRect(particle.x - camera.x, particle.y - camera.y, particle.size, particle.size); });
        context.globalAlpha = 1;

        if (ship.hull > 0) {
            context.save(); context.translate(ship.x - camera.x, ship.y - camera.y); context.rotate(ship.angle);
            if (ship.invulnerable > 0 && Math.floor(ship.invulnerable / 4) % 2) context.globalAlpha = .35;
            context.beginPath(); context.moveTo(0, -17); context.lineTo(12, 12); context.lineTo(4, 8); context.lineTo(0, 13); context.lineTo(-4, 8); context.lineTo(-12, 12); context.closePath();
            context.fillStyle = '#e7eee4'; context.fill(); context.strokeStyle = '#c7f36a'; context.lineWidth = 2; context.stroke();
            context.fillStyle = '#101612'; context.fillRect(-3, -6, 6, 9);
            context.restore();
        }
        context.restore();
    }

    function loop(time) {
        const dt = Math.min(2, (time - lastTime) / 16.667 || 1);
        lastTime = time;
        update(dt);
        render();
        requestAnimationFrame(loop);
    }

    const keyMap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'thrust', KeyW: 'thrust', Space: 'fire' };
    addEventListener('keydown', event => { if (keyMap[event.code]) { controls[keyMap[event.code]] = true; event.preventDefault(); } });
    addEventListener('keyup', event => { if (keyMap[event.code]) controls[keyMap[event.code]] = false; });
    document.querySelectorAll('[data-control]').forEach(button => {
        const control = button.dataset.control;
        const set = value => event => { event.preventDefault(); controls[control] = value; };
        button.addEventListener('pointerdown', set(true)); button.addEventListener('pointerup', set(false)); button.addEventListener('pointercancel', set(false)); button.addEventListener('pointerleave', set(false));
    });

    ui.start.addEventListener('click', () => {
        if (state === 'complete') level++;
        buildLevel();
        state = 'playing';
        ui.message.classList.remove('visible');
    });
    document.getElementById('settingsButton').addEventListener('click', () => ui.settings.showModal());
    [['gravity', 'gravitySetting', 'gravityOutput', value => Number(value).toFixed(3)], ['maxFuel', 'fuelSetting', 'fuelOutput', Math.round], ['thrust', 'thrustSetting', 'thrustOutput', value => Number(value).toFixed(3)], ['enemyRate', 'enemySetting', 'enemyOutput', value => `${Number(value).toFixed(1)}×`], ['baseHits', 'baseHitsSetting', 'baseHitsOutput', Math.round]].forEach(([key, inputId, outputId, format]) => {
        const input = document.getElementById(inputId), output = document.getElementById(outputId);
        input.addEventListener('input', () => { config[key] = Number(input.value); output.value = format(input.value); });
    });
    ui.settings.addEventListener('close', () => { ship.fuel = Math.min(ship.fuel, config.maxFuel); updateHud(); });
    addEventListener('resize', resize);
    resize();
    buildLevel();
    requestAnimationFrame(loop);
})();
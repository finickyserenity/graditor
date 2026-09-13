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
        settings: document.getElementById('settingsDialog'), leaderboard: document.getElementById('leaderboardDialog'),
        leaderboardList: document.getElementById('leaderboardList'), callsign: document.getElementById('callsignInput'),
        radiationOverlay: document.getElementById('radiationOverlay'), radiationWarning: document.getElementById('radiationWarning'),
        radiationStatus: document.getElementById('radiationStatus')
    };

    const controls = { left: false, right: false, thrust: false, fire: false };
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    document.documentElement.classList.toggle('standalone', standalone);
    document.documentElement.classList.toggle('ios-browser', iosDevice);
    const difficultyPresets = {
        easy: { gravity: .018, maxFuel: 2600, fuelPerLevel: 180, thrust: .115, enemyRate: .45, baseHits: 1, turretBase: 2, turretGrowth: .7, damageMultiplier: .65, terrainScale: .55, passageBonus: 120 },
        medium: { gravity: .022, maxFuel: 2300, fuelPerLevel: 160, thrust: .11, enemyRate: .65, baseHits: 1, turretBase: 3, turretGrowth: .9, damageMultiplier: .8, terrainScale: .7, passageBonus: 80 },
        hard: { gravity: .026, maxFuel: 2100, fuelPerLevel: 140, thrust: .105, enemyRate: .85, baseHits: 2, turretBase: 4, turretGrowth: 1.1, damageMultiplier: 1, terrainScale: .85, passageBonus: 40 },
        expert: { gravity: .03, maxFuel: 1900, fuelPerLevel: 120, thrust: .1, enemyRate: 1.05, baseHits: 3, turretBase: 5, turretGrowth: 1.3, damageMultiplier: 1.1, terrainScale: 1, passageBonus: 0 }
    };
    const config = { mode: 'easy', ...difficultyPresets.easy };
    const world = { width: 8200, height: 2300, floor: [], ceiling: [], pads: [], stars: [], turrets: [], particles: [], bullets: [], enemyBullets: [] };
    const camera = { x: 0, y: 0 };
    const viewport = { width: innerWidth, height: innerHeight, scale: 1 };
    const ship = { x: 180, y: 0, vx: 0, vy: 0, angle: 0, radius: 13, fuel: 1000, hull: 100, cooldown: 0, invulnerable: 0, damageEvents: 0, tipped: false };
    let level = 1;
    let score = 0;
    let state = 'briefing';
    let lastTime = 0;
    let shake = 0;
    let radiationExposure = 0;
    let runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const leaderboardKey = 'graditorLeaderboard';
    const callsignKey = 'graditorCallsign';
    const audioKey = 'graditorAudioEnabled';
    const audio = {
        context: null, master: null, effects: null, music: null, thrust: null,
        noise: null, enabled: localStorage.getItem(audioKey) !== 'false'
    };

    /** Initializes the procedural soundtrack after a user gesture unlocks audio. */
    function ensureAudio() {
        if (!audio.enabled) return null;
        if (audio.context) {
            if (audio.context.state === 'suspended') audio.context.resume();
            return audio.context;
        }
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return null;
        audio.context = new AudioContext();
        audio.master = audio.context.createGain();
        audio.effects = audio.context.createGain();
        audio.music = audio.context.createGain();
        audio.master.gain.value = .58;
        audio.effects.gain.value = .7;
        audio.music.gain.value = .15;
        audio.effects.connect(audio.master);
        audio.music.connect(audio.master);
        audio.master.connect(audio.context.destination);
        buildAmbientMusic();
        buildThrustSound();
        return audio.context;
    }

    /** Creates a slowly modulated, spacey chord that runs without external media. */
    function buildAmbientMusic() {
        const now = audio.context.currentTime;
        const filter = audio.context.createBiquadFilter();
        const swell = audio.context.createGain();
        filter.type = 'lowpass';
        filter.frequency.value = 620;
        filter.Q.value = 5;
        swell.gain.value = .7;
        filter.connect(swell);
        swell.connect(audio.music);
        [55, 82.41, 110, 164.81].forEach((frequency, index) => {
            const oscillator = audio.context.createOscillator();
            const gain = audio.context.createGain();
            oscillator.type = index % 2 ? 'sine' : 'triangle';
            oscillator.frequency.value = frequency;
            oscillator.detune.value = index * 3 - 4;
            gain.gain.value = index === 0 ? .3 : .12;
            oscillator.connect(gain);
            gain.connect(filter);
            oscillator.start(now);
        });
        const lfo = audio.context.createOscillator();
        const lfoGain = audio.context.createGain();
        lfo.frequency.value = .075;
        lfoGain.gain.value = .22;
        lfo.connect(lfoGain);
        lfoGain.connect(swell.gain);
        lfo.start(now);
    }

    /** Creates the continuous filtered-noise engine voice. */
    function buildThrustSound() {
        const length = audio.context.sampleRate * 2;
        audio.noise = audio.context.createBuffer(1, length, audio.context.sampleRate);
        const data = audio.noise.getChannelData(0);
        for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
        const source = audio.context.createBufferSource();
        const filter = audio.context.createBiquadFilter();
        audio.thrust = audio.context.createGain();
        source.buffer = audio.noise;
        source.loop = true;
        filter.type = 'bandpass';
        filter.frequency.value = 170;
        filter.Q.value = .7;
        audio.thrust.gain.value = 0;
        source.connect(filter);
        filter.connect(audio.thrust);
        audio.thrust.connect(audio.effects);
        source.start();
    }

    /** Plays a short oscillator sweep for weapons and collision feedback. */
    function playTone(startFrequency, endFrequency, duration, volume, wave = 'square') {
        const audioContext = ensureAudio();
        if (!audioContext) return;
        const now = audioContext.currentTime;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = wave;
        oscillator.frequency.setValueAtTime(startFrequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(.001, now + duration);
        oscillator.connect(gain);
        gain.connect(audio.effects);
        oscillator.start(now);
        oscillator.stop(now + duration);
    }

    /** Plays a compact burst of filtered noise. */
    function playNoise(duration, volume, frequency) {
        const audioContext = ensureAudio();
        if (!audioContext || !audio.noise) return;
        const now = audioContext.currentTime;
        const source = audioContext.createBufferSource();
        const filter = audioContext.createBiquadFilter();
        const gain = audioContext.createGain();
        source.buffer = audio.noise;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(frequency, now);
        filter.frequency.exponentialRampToValueAtTime(80, now + duration);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(.001, now + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(audio.effects);
        source.start(now);
        source.stop(now + duration);
    }

    /** Smoothly follows the current thrust control state. */
    function updateThrustSound() {
        if (!audio.context || !audio.thrust) return;
        const thrustAmount = Number(controls.thrust);
        const active = audio.enabled && state === 'playing' && thrustAmount > 0 && ship.fuel > 0;
        const unobstructed = state === 'playing' && !ui.settings.open && !ui.leaderboard.open;
        audio.thrust.gain.setTargetAtTime(active ? .12 + thrustAmount * .2 : 0, audio.context.currentTime, active ? .035 : .08);
        audio.music.gain.setTargetAtTime(audio.enabled ? (unobstructed ? .15 : .045) : 0, audio.context.currentTime, .15);
    }

    /** Updates the audio control to reflect the current preference. */
    function updateAudioButton() {
        const button = document.getElementById('audioButton');
        button.textContent = audio.enabled ? '🔊' : '🔇';
        button.classList.toggle('muted', !audio.enabled);
        button.setAttribute('aria-label', audio.enabled ? 'Mute audio' : 'Enable audio');
        button.title = audio.enabled ? 'Mute audio' : 'Enable audio';
    }

    /** Updates and persists the global audio state. */
    function setAudioEnabled(enabled) {
        audio.enabled = enabled;
        localStorage.setItem(audioKey, String(enabled));
        updateAudioButton();
        if (audio.enabled) {
            ensureAudio();
            if (audio.master) audio.master.gain.setTargetAtTime(.58, audio.context.currentTime, .04);
        } else if (audio.master) {
            audio.master.gain.setTargetAtTime(0, audio.context.currentTime, .04);
        }
    }

    function random(seed) {
        let value = seed % 2147483647;
        return () => ((value = value * 16807 % 2147483647) - 1) / 2147483646;
    }

    function terrainY(points, x) {
        if (x <= 0) return points[0];
        if (x >= (points.length - 1) * 80) return points[points.length - 1];
        const index = Math.max(0, Math.min(points.length - 2, Math.floor(x / 80)));
        const fraction = (x - index * 80) / 80;
        return points[index] + (points[index + 1] - points[index]) * fraction;
    }

    function ceilingY(x) {
        if (x < 0 || x > world.width) return null;
        const index = Math.max(0, Math.min(world.ceiling.length - 2, Math.floor(x / 80)));
        if (world.ceiling[index] <= -250 && world.ceiling[index + 1] <= -250) return null;
        return terrainY(world.ceiling, x);
    }

    /** Shapes the terrain into a series of increasingly narrow flight passages. */
    function buildPassages() {
        if (level < 5) return;
        const passageCount = Math.min(5, Math.floor((level - 3) / 2));
        const aperture = Math.max(240 + config.passageBonus, 500 + config.passageBonus - (level - 5) * 20);
        const passageWidth = 400;
        for (let passage = 0; passage < passageCount; passage++) {
            const centerX = 1500 + passage * ((world.width - 3000) / Math.max(1, passageCount - 1));
            const centerY = 1250 + Math.sin((passage + level) * 1.7) * 180;
            for (let index = 0; index < world.floor.length; index++) {
                const x = index * 80;
                const distance = Math.abs(x - centerX);
                if (distance > passageWidth) continue;
                const strength = Math.pow(1 - distance / passageWidth, .55);
                const targetFloor = centerY + aperture / 2;
                const targetCeiling = centerY - aperture / 2;
                world.floor[index] += (targetFloor - world.floor[index]) * strength;
                world.ceiling[index] += (targetCeiling - world.ceiling[index]) * strength;
            }
        }
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
            floorY += (rng() - .5) * (70 + level * 5) * config.terrainScale;
            floorY = Math.max(1120, Math.min(2030, floorY));
            if (x < 400) floorY = launchY;
            if (x > world.width - 520) floorY = extractionY;
            world.floor.push(floorY);
            const cavern = x > world.width * .2 && x < world.width * .43 || level > 1 && x > world.width * .59 && x < world.width * .77;
            world.ceiling.push(cavern ? 470 + Math.sin(x * .008) * 150 + rng() * 120 : -300);
        }

        buildPassages();

        world.pads.push({ x: 100, width: 180, y: launchY, extraction: false });
        world.pads.push({ x: world.width - 440, width: 260, y: extractionY, extraction: true });
        const turretCount = config.turretBase + Math.ceil(level * config.turretGrowth);
        for (let index = 0; index < turretCount; index++) {
            const x = 700 + index * ((world.width - 1450) / Math.max(1, turretCount - 1)) + (rng() - .5) * 180;
            world.turrets.push({ x, y: terrainY(world.floor, x) - 15, health: config.baseHits, cooldown: rng() * 100, angle: -Math.PI / 2, mount: 'floor' });
        }
        if (level >= 3) {
            const ceilingTurretCount = Math.min(5, 1 + Math.floor((level - 3) / 2));
            for (let index = 0; index < ceilingTurretCount; index++) {
                const sectionStart = index % 2 ? world.width * .59 : world.width * .2;
                const sectionWidth = index % 2 ? world.width * .18 : world.width * .23;
                const x = sectionStart + sectionWidth * ((Math.floor(index / 2) + 1) / (Math.ceil(ceilingTurretCount / 2) + 1));
                world.turrets.push({ x, y: terrainY(world.ceiling, x) + 15, health: config.baseHits, cooldown: rng() * 100, angle: Math.PI / 2, mount: 'ceiling' });
            }
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
        ship.fuel = getLevelFuel();
        ship.hull = 100;
        ship.cooldown = 0;
        ship.invulnerable = 0;
        ship.damageEvents = 0;
        ship.tipped = false;
        radiationExposure = 0;
        ui.radiationOverlay.style.opacity = 0;
        ui.radiationWarning.hidden = true;
        camera.x = 0;
        camera.y = Math.max(0, ship.y - viewport.height * .65);
    }

    function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const compactLandscape = innerWidth > innerHeight && innerHeight <= 530;
        const mobileViewport = innerWidth <= 720 || compactLandscape || window.matchMedia('(pointer: coarse)').matches;
        viewport.scale = mobileViewport ? (innerWidth > innerHeight ? .55 : .75) : 1;
        viewport.width = innerWidth / viewport.scale;
        viewport.height = innerHeight / viewport.scale;
        canvas.width = Math.floor(innerWidth * ratio);
        canvas.height = Math.floor(innerHeight * ratio);
        canvas.style.width = `${innerWidth}px`;
        canvas.style.height = `${innerHeight}px`;
        context.setTransform(ratio * viewport.scale, 0, 0, ratio * viewport.scale, 0, 0);
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
        playTone(920, 210, .11, .16, 'sawtooth');
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
        ship.damageEvents++;
        ship.invulnerable = 36;
        shake = 10;
        playTone(130, 48, .42, .3, 'sawtooth');
        playNoise(.35, .22, 900);
        emit(ship.x, ship.y, '#ff5f4d', 16, 3);
        if (ship.hull <= 0) {
            saveLeaderboardEntry();
            endRun('SHIP LOST', 'Hull integrity lost.', 'The ridge claimed another pilot. Your mission can be restarted from this sector.', 'RETRY SECTOR');
        }
    }

    function updateRadiation(dt) {
        const boundaryDistance = Math.max(0, -ship.x, ship.x - world.width, -ship.y, ship.y - world.height);
        if (boundaryDistance <= 0) {
            radiationExposure = Math.max(0, radiationExposure - dt / 30);
        } else {
            const distanceFactor = Math.min(2.5, boundaryDistance / 500);
            radiationExposure += dt / 60 * (1 + distanceFactor);
        }

        const active = radiationExposure > .05;
        const intensity = active ? Math.min(.78, .06 + boundaryDistance / 1000 * .42 + radiationExposure / 12) : 0;
        ui.radiationOverlay.style.opacity = intensity;
        ui.radiationWarning.hidden = !active;
        if (!active) return;

        const graceRemaining = Math.max(0, 3 - radiationExposure);
        ui.radiationStatus.textContent = graceRemaining > 0
            ? `HULL DAMAGE IN ${Math.ceil(graceRemaining)}`
            : 'HULL INTEGRITY FAILING';
        if (graceRemaining > 0) return;

        ship.hull = Math.max(0, ship.hull - (1.5 + boundaryDistance / 180) * dt / 60);
        shake = Math.max(shake, intensity * 2.5);
        if (ship.hull <= 0) {
            saveLeaderboardEntry();
            endRun('SHIP LOST', 'Radiation breach.', 'The ship remained outside the protected flight zone for too long.', 'RETRY SECTOR');
        }
    }

    function update(dt) {
        world.particles.forEach(particle => { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += .012 * dt; particle.life -= dt; });
        world.particles = world.particles.filter(particle => particle.life > 0);
        shake *= Math.pow(.96, dt);
        if (shake < .05) shake = 0;
        updateThrustSound();
        if (state !== 'playing') return;

        if (controls.left) ship.angle -= .052 * Number(controls.left) * dt;
        if (controls.right) ship.angle += .052 * Number(controls.right) * dt;
        if (controls.thrust && ship.fuel > 0) {
            const thrustAmount = Number(controls.thrust);
            ship.vx += Math.sin(ship.angle) * config.thrust * thrustAmount * dt;
            ship.vy -= Math.cos(ship.angle) * config.thrust * thrustAmount * dt;
            ship.fuel = Math.max(0, ship.fuel - .85 * thrustAmount * dt);
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
            if (Math.hypot(bullet.x - ship.x, bullet.y - ship.y) < ship.radius + 4) { bullet.life = 0; damage(18 * config.damageMultiplier); }
        });

        world.turrets.forEach(turret => {
            if (turret.health <= 0) return;
            const distance = Math.hypot(ship.x - turret.x, ship.y - turret.y);
            turret.angle = Math.atan2(ship.y - turret.y, ship.x - turret.x);
            turret.cooldown -= dt * config.enemyRate;
            if (distance < 720 && turret.cooldown <= 0) {
                const speed = 3.2 + level * .25;
                world.enemyBullets.push({ x: turret.x + Math.cos(turret.angle) * 20, y: turret.y + Math.sin(turret.angle) * 20, vx: Math.cos(turret.angle) * speed, vy: Math.sin(turret.angle) * speed, life: 220 });
                playTone(380, 115, .16, .075, 'square');
                turret.cooldown = Math.max(55, 130 - level * 9) + Math.random() * 60;
            }
            world.bullets.forEach(bullet => {
                if (bullet.life > 0 && Math.hypot(bullet.x - turret.x, bullet.y - turret.y) < 23) {
                    bullet.life = 0;
                    turret.health--;
                    playTone(180, 70, .13, .12, 'triangle');
                    emit(turret.x, turret.y, turret.health > 0 ? '#ffb547' : '#c7f36a', turret.health > 0 ? 8 : 28, 3);
                    if (turret.health <= 0) {
                        score += 750 * level;
                        playNoise(.55, .3, 1400);
                        playTone(90, 28, .58, .28, 'sawtooth');
                    }
                }
            });
        });
        world.bullets = world.bullets.filter(bullet => bullet.life > 0);
        world.enemyBullets = world.enemyBullets.filter(bullet => bullet.life > 0);

        const pad = world.pads.find(item => ship.x >= item.x + ship.radius && ship.x <= item.x + item.width - ship.radius);
        const floor = pad ? pad.y : terrainY(world.floor, ship.x);
        const ceiling = ceilingY(ship.x);
        const withinHorizontalBounds = ship.x >= 0 && ship.x <= world.width;
        const hitFloor = withinHorizontalBounds && ship.y + ship.radius >= floor;
        const hitCeiling = ceiling !== null && ship.y - ship.radius <= ceiling;
        if (pad && ship.y + ship.radius < floor - 30) ship.tipped = false;
        if (hitFloor) {
            if (pad) {
                const impactSpeed = Math.hypot(ship.vx, ship.vy);
                const verticalSpeed = Math.abs(ship.vy);
                const lateralSpeed = Math.abs(ship.vx);
                const safeLanding = verticalSpeed <= 2.2 && lateralSpeed <= 2;
                ship.y = floor - ship.radius;
                if (ship.tipped) {
                    ship.vx = 0; ship.vy = 0;
                } else if (safeLanding) {
                    ship.vx = 0; ship.vy = 0; ship.angle = 0;
                    if (pad.extraction && world.turrets.every(turret => turret.health <= 0)) completeLevel();
                } else {
                    ship.vx *= .55; ship.vy = -verticalSpeed * .35;
                    const tipDirection = Math.sign(ship.angle || ship.vx || 1);
                    ship.angle = tipDirection * Math.min(Math.PI * .48, .55 + impactSpeed * .12);
                    ship.tipped = true;
                    const fatalImpact = verticalSpeed >= 5.5 || impactSpeed >= 7;
                    damage(fatalImpact ? 100 : Math.max(12, (impactSpeed - 1.5) * 16));
                }
            } else {
                ship.y = floor - ship.radius;
                ship.vy = -Math.abs(ship.vy) * .35;
                ship.vx *= .72;
                damage(Math.max(8, Math.hypot(ship.vx, ship.vy) * 9));
            }
        }
        if (hitCeiling) { ship.y = ceiling + ship.radius; ship.vy = Math.abs(ship.vy) * .5; damage(15); }
        updateRadiation(dt);

        const screenX = ship.x - camera.x;
        const screenY = ship.y - camera.y;
        const leftEdge = viewport.width * .3;
        const rightEdge = viewport.width * .7;
        const topEdge = viewport.height * .28;
        const bottomEdge = viewport.height * .72;
        if (screenX < leftEdge) camera.x += (screenX - leftEdge) * .08 * dt;
        if (screenX > rightEdge) camera.x += (screenX - rightEdge) * .08 * dt;
        if (screenY < topEdge) camera.y += (screenY - topEdge) * .08 * dt;
        if (screenY > bottomEdge) camera.y += (screenY - bottomEdge) * .08 * dt;
        const visibilityMargin = ship.radius + 12;
        camera.x = Math.max(ship.x + visibilityMargin - viewport.width, Math.min(ship.x - visibilityMargin, camera.x));
        camera.y = Math.max(ship.y + visibilityMargin - viewport.height, Math.min(ship.y - visibilityMargin, camera.y));
        updateHud();
    }

    function completeLevel() {
        state = 'complete';
        playTone(220, 880, .8, .2, 'sine');
        score += Math.round(ship.fuel * 2 + ship.hull * 25);
        saveLeaderboardEntry();
        showMessage('SECTOR SECURED', `Level ${level} complete`, `Next sector fuel allocation: ${getLevelFuel(level + 1)}. Expect stronger emplacements and tighter terrain.`, 'ENTER NEXT SECTOR');
    }

    function endRun(eyebrow, title, copy, button) {
        state = 'dead';
        radiationExposure = 0;
        ui.radiationOverlay.style.opacity = 0;
        ui.radiationWarning.hidden = true;
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
        const fuelPercent = ship.fuel / getLevelFuel() * 100;
        ui.score.textContent = String(score).padStart(6, '0');
        ui.hostiles.textContent = live;
        ui.fuel.textContent = Math.ceil(fuelPercent);
        ui.hull.textContent = Math.ceil(ship.hull);
        ui.fuelMeter.value = fuelPercent;
        ui.hullMeter.value = ship.hull;
        ui.speed.textContent = `${Math.hypot(ship.vx, ship.vy).toFixed(1)} M/S`;
        ui.altitude.textContent = `ALT ${Math.max(0, Math.round(terrainY(world.floor, ship.x) - ship.y))}`;
    }

    /** Returns the fuel allocation for a sector under the selected mode. */
    function getLevelFuel(targetLevel = level) {
        return config.maxFuel + Math.max(0, targetLevel - 1) * config.fuelPerLevel;
    }

    /** Updates the difficulty summary for the currently selected test sector. */
    function updateDifficultySummary() {
        const selectedLevel = Number.parseInt(document.getElementById('levelSetting').value, 10) || 1;
        const allocation = getLevelFuel(Math.max(1, Math.min(30, selectedLevel)));
        document.getElementById('difficultySummary').textContent = `${config.maxFuel} base +${config.fuelPerLevel}/sector · ${allocation} fuel at sector ${selectedLevel} · ${config.turretBase + 1} starting defenses`;
    }

    /** Applies a balanced difficulty preset and synchronizes its advanced controls. */
    function applyDifficultyPreset(mode) {
        config.mode = mode;
        Object.assign(config, difficultyPresets[mode]);
        const controlsByKey = { gravity: 'gravitySetting', maxFuel: 'fuelSetting', thrust: 'thrustSetting', enemyRate: 'enemySetting', baseHits: 'baseHitsSetting' };
        const outputsByKey = { gravity: ['gravityOutput', value => value.toFixed(3)], maxFuel: ['fuelOutput', Math.round], thrust: ['thrustOutput', value => value.toFixed(3)], enemyRate: ['enemyOutput', value => `${value.toFixed(2)}×`], baseHits: ['baseHitsOutput', Math.round] };
        Object.entries(controlsByKey).forEach(([key, id]) => { document.getElementById(id).value = config[key]; });
        Object.entries(outputsByKey).forEach(([key, [id, format]]) => { document.getElementById(id).value = format(config[key]); });
        updateDifficultySummary();
    }

    /**
     * Loads locally stored flight records, discarding malformed values.
     * @returns {Array<{id: string, callsign: string, score: number, level: number}>} Stored records.
     */
    function loadLeaderboard() {
        try {
            const entries = JSON.parse(localStorage.getItem(leaderboardKey) || '[]');
            return Array.isArray(entries) ? entries : [];
        } catch (error) {
            return [];
        }
    }

    /** Saves or updates this run among the ten highest local scores. */
    function saveLeaderboardEntry() {
        const callsign = (ui.callsign.value.trim() || 'PILOT').toUpperCase().slice(0, 12);
        const entries = loadLeaderboard().filter(entry => entry.id !== runId);
        entries.push({ id: runId, callsign, score: Math.round(score), level, savedAt: Date.now() });
        entries.sort((first, second) => second.score - first.score || second.level - first.level);
        localStorage.setItem(leaderboardKey, JSON.stringify(entries.slice(0, 10)));
        renderLeaderboard();
    }

    /** Renders the current local flight records into the leaderboard dialog. */
    function renderLeaderboard() {
        const entries = loadLeaderboard();
        ui.leaderboardList.replaceChildren();
        if (!entries.length) {
            const empty = document.createElement('li');
            empty.className = 'leaderboard-empty';
            empty.textContent = 'NO RECORDED FLIGHTS';
            ui.leaderboardList.append(empty);
            return;
        }
        entries.forEach(entry => {
            const item = document.createElement('li');
            const callsign = document.createElement('span');
            const entryScore = document.createElement('span');
            const entryLevel = document.createElement('span');
            callsign.textContent = entry.callsign;
            entryScore.className = 'leader-score';
            entryScore.textContent = String(entry.score).padStart(6, '0');
            entryLevel.className = 'leader-level';
            entryLevel.textContent = `SECTOR ${entry.level}`;
            item.append(callsign, entryScore, entryLevel);
            ui.leaderboardList.append(item);
        });
    }

    function drawTerrain(points, fill, stroke) {
        const visibleStart = Math.max(0, camera.x);
        const visibleEnd = Math.min(world.width, camera.x + viewport.width);
        if (visibleStart >= visibleEnd) return;
        const closureY = viewport.height + 400;
        const firstVisibleIndex = Math.max(0, Math.floor(visibleStart / 80) + 1);
        const lastVisibleIndex = Math.min(points.length - 1, Math.ceil(visibleEnd / 80) - 1);
        context.beginPath();
        context.moveTo(visibleStart - camera.x, closureY);
        context.lineTo(visibleStart - camera.x, terrainY(points, visibleStart) - camera.y);
        for (let index = firstVisibleIndex; index <= lastVisibleIndex; index++) {
            context.lineTo(index * 80 - camera.x, points[index] - camera.y);
        }
        context.lineTo(visibleEnd - camera.x, terrainY(points, visibleEnd) - camera.y);
        context.lineTo(visibleEnd - camera.x, closureY);
        context.closePath();
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = stroke;
        context.lineWidth = 2;
        context.stroke();
    }

    function drawCeilingTerrain() {
        let segmentStart = null;
        for (let index = 0; index < world.ceiling.length; index++) {
            const solid = world.ceiling[index] > -250;
            if (solid && segmentStart === null) segmentStart = index;
            if ((!solid || index === world.ceiling.length - 1) && segmentStart !== null) {
                const segmentEnd = solid ? index : index - 1;
                context.beginPath();
                context.moveTo(segmentStart * 80 - camera.x, -camera.y - 400);
                for (let point = segmentStart; point <= segmentEnd; point++) {
                    context.lineTo(point * 80 - camera.x, world.ceiling[point] - camera.y);
                }
                context.lineTo(segmentEnd * 80 - camera.x, -camera.y - 400);
                context.closePath();
                context.fillStyle = '#202722';
                context.fill();
                context.strokeStyle = '#657667';
                context.lineWidth = 2;
                context.stroke();
                segmentStart = null;
            }
        }
    }

    function render() {
        context.clearRect(0, 0, viewport.width, viewport.height);
        const gradient = context.createLinearGradient(0, 0, 0, viewport.height);
        gradient.addColorStop(0, '#080c0c'); gradient.addColorStop(1, '#151b16');
        context.fillStyle = gradient; context.fillRect(0, 0, viewport.width, viewport.height);
        context.save();
        context.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);

        world.stars.forEach(star => {
            const x = star.x - camera.x * star.depth;
            const y = star.y - camera.y * star.depth;
            if (x > 0 && x < viewport.width && y > 0 && y < viewport.height) {
                context.globalAlpha = .25 + star.depth;
                context.fillStyle = '#d8e3d5'; context.fillRect(x, y, star.size, star.size);
            }
        });
        context.globalAlpha = 1;

        drawTerrain(world.floor, '#252d27', '#7f927e');
        drawCeilingTerrain();
        context.strokeStyle = 'rgba(199,243,106,.055)'; context.lineWidth = 1;
        for (let x = -(camera.x % 80); x < viewport.width; x += 80) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, viewport.height); context.stroke(); }
        for (let y = -(camera.y % 80); y < viewport.height; y += 80) { context.beginPath(); context.moveTo(0, y); context.lineTo(viewport.width, y); context.stroke(); }

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
            context.fillRect(-8, turret.mount === 'ceiling' ? -15 : 7, 16, 8);
            context.strokeStyle = '#ff5f4d'; context.lineWidth = 5; context.beginPath(); context.moveTo(0, 0); context.lineTo(Math.cos(turret.angle) * 20, Math.sin(turret.angle) * 20); context.stroke();
            context.fillStyle = '#ff5f4d'; context.fillRect(-turret.health * 4, turret.mount === 'ceiling' ? 17 : -19, turret.health * 8, 2);
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
            const scarPatterns = [[-8, -7, -2, -1, -7, 5], [7, -5, 1, 1, 7, 7], [-4, -12, 2, -5, -1, 2], [4, 4, -2, 8, 3, 12], [-10, 3, -4, 0, -8, -5]];
            context.strokeStyle = '#6f2d24'; context.lineWidth = 1.5;
            scarPatterns.slice(0, Math.min(ship.damageEvents, scarPatterns.length)).forEach(scar => {
                context.beginPath(); context.moveTo(scar[0], scar[1]); context.lineTo(scar[2], scar[3]); context.lineTo(scar[4], scar[5]); context.stroke();
            });
            if (ship.hull < 65) {
                context.fillStyle = '#151b17'; context.beginPath(); context.moveTo(8, 3); context.lineTo(12, 12); context.lineTo(4, 8); context.closePath(); context.fill();
                context.strokeStyle = '#ffb547'; context.beginPath(); context.moveTo(7, 1); context.lineTo(11, 7); context.stroke();
            }
            if (ship.hull < 35) {
                context.fillStyle = '#090d0c'; context.beginPath(); context.arc(-4, 1, 4, 0, Math.PI * 2); context.fill();
                if (Math.random() > .55) emit(ship.x - 7, ship.y + 4, '#626b63', 1, .35);
            }
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
    const touchControls = document.querySelector('.touch-controls');
    ['touchstart', 'touchmove', 'touchend'].forEach(type => {
        touchControls.addEventListener(type, event => event.preventDefault(), { passive: false });
    });
    ['contextmenu', 'dragstart', 'selectstart'].forEach(type => {
        touchControls.addEventListener(type, event => event.preventDefault());
    });
    document.querySelectorAll('[data-control]').forEach(button => {
        const control = button.dataset.control;
        const release = event => {
            if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
            controls[control] = false;
        };
        button.addEventListener('pointerdown', event => {
            event.preventDefault();
            controls[control] = true;
            try { button.setPointerCapture(event.pointerId); } catch (error) { /* Pointer capture is optional input hardening. */ }
        });
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
    });
    const flightStick = document.getElementById('flightStick');
    const flightStickKnob = flightStick.querySelector('.flight-stick-knob');
    const updateFlightStick = event => {
        const bounds = flightStick.getBoundingClientRect();
        const offsetX = event.clientX - bounds.left - bounds.width / 2;
        const radius = bounds.width * .32;
        const x = Math.max(-radius, Math.min(radius, offsetX));
        const deadZone = bounds.width * .09;
        flightStickKnob.style.transform = `translate(calc(-50% + ${x}px), -50%)`;
        controls.left = x < -deadZone ? Math.min(1, (-x - deadZone) / (radius - deadZone)) : 0;
        controls.right = x > deadZone ? Math.min(1, (x - deadZone) / (radius - deadZone)) : 0;
    };
    const releaseFlightStick = event => {
        if (event.pointerId !== undefined && flightStick.hasPointerCapture(event.pointerId)) flightStick.releasePointerCapture(event.pointerId);
        flightStick.classList.remove('active');
        flightStickKnob.style.transform = '';
        controls.left = false;
        controls.right = false;
    };
    flightStick.addEventListener('pointerdown', event => {
        event.preventDefault();
        flightStick.classList.add('active');
        updateFlightStick(event);
        try { flightStick.setPointerCapture(event.pointerId); } catch (error) { /* Pointer capture is optional input hardening. */ }
    });
    flightStick.addEventListener('pointermove', event => {
        if (flightStick.hasPointerCapture(event.pointerId)) updateFlightStick(event);
    });
    flightStick.addEventListener('pointerup', releaseFlightStick);
    flightStick.addEventListener('pointercancel', releaseFlightStick);

    let previousCenterTap = null;
    canvas.addEventListener('pointerup', event => {
        if (event.pointerType !== 'touch' || state !== 'playing') return;
        const inCenter = event.clientX > innerWidth * .25 && event.clientX < innerWidth * .75
            && event.clientY > innerHeight * .22 && event.clientY < innerHeight * .72;
        if (!inCenter) {
            previousCenterTap = null;
            return;
        }
        const tap = { time: performance.now(), x: event.clientX, y: event.clientY };
        if (previousCenterTap && tap.time - previousCenterTap.time < 350
            && Math.hypot(tap.x - previousCenterTap.x, tap.y - previousCenterTap.y) < 60) {
            previousCenterTap = null;
            Object.keys(controls).forEach(control => { controls[control] = false; });
            releaseFlightStick({});
            state = 'paused';
            showMessage('FLIGHT PAUSED', 'Systems on hold.', 'Your current position and mission progress are preserved.', 'RESUME FLIGHT');
            return;
        }
        previousCenterTap = tap;
    });

    ui.start.addEventListener('click', () => {
        ensureAudio();
        if (state === 'paused') {
            state = 'playing';
            ui.message.classList.remove('visible');
            return;
        }
        if (state === 'complete') level++;
        buildLevel();
        state = 'playing';
        ui.message.classList.remove('visible');
    });
    document.getElementById('settingsButton').addEventListener('click', () => ui.settings.showModal());
    document.getElementById('audioButton').addEventListener('click', () => setAudioEnabled(!audio.enabled));
    document.getElementById('leaderboardButton').addEventListener('click', () => { renderLeaderboard(); ui.leaderboard.showModal(); });
    ui.callsign.value = localStorage.getItem(callsignKey) || 'PILOT';
    ui.callsign.addEventListener('input', () => localStorage.setItem(callsignKey, ui.callsign.value.toUpperCase().slice(0, 12)));
    document.getElementById('clearLeaderboardButton').addEventListener('click', () => { localStorage.removeItem(leaderboardKey); renderLeaderboard(); });
    const installHint = document.getElementById('installHint');
    if (sessionStorage.getItem('graditorInstallHintDismissed') === 'true') installHint.hidden = true;
    document.getElementById('dismissInstallHint').addEventListener('click', () => {
        installHint.hidden = true;
        sessionStorage.setItem('graditorInstallHintDismissed', 'true');
    });
    document.querySelectorAll('input[name="difficulty"]').forEach(input => {
        input.addEventListener('change', () => applyDifficultyPreset(input.value));
    });
    document.getElementById('levelSetting').addEventListener('input', updateDifficultySummary);
    [['gravity', 'gravitySetting', 'gravityOutput', value => Number(value).toFixed(3)], ['maxFuel', 'fuelSetting', 'fuelOutput', Math.round], ['thrust', 'thrustSetting', 'thrustOutput', value => Number(value).toFixed(3)], ['enemyRate', 'enemySetting', 'enemyOutput', value => `${Number(value).toFixed(2)}×`], ['baseHits', 'baseHitsSetting', 'baseHitsOutput', Math.round]].forEach(([key, inputId, outputId, format]) => {
        const input = document.getElementById(inputId), output = document.getElementById(outputId);
        input.addEventListener('input', () => { config[key] = Number(input.value); output.value = format(input.value); updateDifficultySummary(); });
    });
    ui.settings.addEventListener('close', () => {
        if (ui.settings.returnValue !== 'default') return;
        const requestedLevel = Number.parseInt(document.getElementById('levelSetting').value, 10) || 1;
        level = Math.max(1, Math.min(30, requestedLevel));
        document.getElementById('levelSetting').value = level;
        score = 0;
        runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        buildLevel();
        state = 'playing';
        ui.message.classList.remove('visible');
    });
    updateAudioButton();
    addEventListener('resize', resize);
    resize();
    applyDifficultyPreset('easy');
    buildLevel();
    if ('serviceWorker' in navigator) {
        const updateHint = document.getElementById('updateHint');
        const applyUpdateButton = document.getElementById('applyUpdateButton');
        let waitingWorker = null;
        let reloading = false;
        const offerUpdate = worker => {
            waitingWorker = worker;
            updateHint.hidden = false;
        };
        applyUpdateButton.addEventListener('click', () => {
            applyUpdateButton.disabled = true;
            applyUpdateButton.textContent = 'UPDATING';
            waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
        });
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloading) return;
            reloading = true;
            location.reload();
        });
        navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).then(registration => {
            if (registration.waiting) offerUpdate(registration.waiting);
            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
                });
            });
            registration.update();
        });
    }
    requestAnimationFrame(loop);
})();
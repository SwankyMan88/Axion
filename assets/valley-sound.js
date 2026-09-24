/*
 * Pine Valley sound for Axion. Everything is made live with Web Audio, so this
 * one small script is the whole sound pack: wind, birds by day, crickets at
 * night, water on the shore, the campfire, footsteps and splashes.
 *
 * The page calls ValleySound.start() after a click (browsers only allow audio
 * to begin after one), then ValleySound.update(state) every frame. See
 * examples/khan-academy-valley.html for the state it reads.
 */
(function () {
    var S = window.ValleySound = {
        ctx: null,
        on: false,
        volume: 0.8
    };

    var ctx, master, noiseBuf;
    var wind, water, fire, crickets;
    var birdTimer = 2, cricketPhase = 0, crackleTimer = 0;
    var last = { x: 0, z: 0, yaw: 0 };

    // A few seconds of white noise, looped by every noisy sound
    function makeNoise() {
        var len = ctx.sampleRate * 3;
        var b = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = b.getChannelData(0);
        for (var i = 0; i < len; i++) {
            d[i] = Math.random() * 2 - 1;
        }
        return b;
    }

    function noiseSource() {
        var s = ctx.createBufferSource();
        s.buffer = noiseBuf;
        s.loop = true;
        s.loopStart = Math.random();
        s.start(0, Math.random() * 2);
        return s;
    }

    function filter(type, freq, q) {
        var f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q || 0.7;
        return f;
    }

    function gain(v) {
        var g = ctx.createGain();
        g.gain.value = v;
        return g;
    }

    function panner() {
        return ctx.createStereoPanner ? ctx.createStereoPanner() : gain(1);
    }

    // Moves an audio value smoothly toward a target
    function ease(param, v, time) {
        param.setTargetAtTime(v, ctx.currentTime, time || 0.3);
    }

    // Left / right placement of a world point for a listener facing `yaw`
    function panFor(x, z) {
        var dx = x - last.x, dz = z - last.z;
        var d = Math.sqrt(dx * dx + dz * dz) || 1;
        // Right vector of the camera is (cos yaw, -sin yaw)
        var p = (dx * Math.cos(last.yaw) - dz * Math.sin(last.yaw)) / d;
        return Math.max(-1, Math.min(1, p));
    }

    function setPan(node, v) {
        if (node.pan) {
            ease(node.pan, v, 0.1);
        }
    }

    function buildWind() {
        // Two bands of noise: a low rush and a thin whistle, each swelling slowly
        var low = noiseSource();
        var lf = filter("lowpass", 400, 0.5);
        var lg = gain(0);
        low.connect(lf);
        lf.connect(lg);
        lg.connect(master);

        var high = noiseSource();
        var hf = filter("bandpass", 1400, 1.2);
        var hg = gain(0);
        high.connect(hf);
        hf.connect(hg);
        hg.connect(master);
        return { low: lg, high: hg, hf: hf, t: 0 };
    }

    function buildWater() {
        var src = noiseSource();
        var f = filter("lowpass", 700, 0.6);
        var g = gain(0);
        var p = panner();
        src.connect(f);
        f.connect(g);
        g.connect(p);
        p.connect(master);
        return { g: g, f: f, p: p, t: 0 };
    }

    function buildFire() {
        // The steady roar; crackles are separate one-shots
        var src = noiseSource();
        var f = filter("lowpass", 300, 0.5);
        var g = gain(0);
        var p = panner();
        src.connect(f);
        f.connect(g);
        g.connect(p);
        p.connect(master);
        return { g: g, p: p, level: 0, pan: 0 };
    }

    function buildCrickets() {
        var osc = ctx.createOscillator();
        osc.frequency.value = 4400;
        var am = gain(0);
        var g = gain(0);
        osc.connect(am);
        am.connect(g);
        g.connect(master);
        osc.start();
        return { am: am, g: g };
    }

    // One short burst of filtered noise: steps, crackles, splashes
    function burst(freq, q, level, length, pan, type) {
        var t = ctx.currentTime;
        var src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        var f = filter(type || "bandpass", freq, q);
        var g = gain(0);
        var p = panner();
        src.connect(f);
        f.connect(g);
        g.connect(p);
        p.connect(master);
        if (p.pan) {
            p.pan.value = pan || 0;
        }
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0005, t + length);
        src.start(t, Math.random() * 2, length + 0.05);
    }

    // A thud with some body, for wood underfoot and landings
    function knock(freq, level, length) {
        var t = ctx.currentTime;
        var osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + length);
        var g = gain(0);
        osc.connect(g);
        g.connect(master);
        g.gain.setValueAtTime(level, t);
        g.gain.exponentialRampToValueAtTime(0.0005, t + length);
        osc.start(t);
        osc.stop(t + length + 0.05);
    }

    // A bird: a few quick whistled notes with sliding pitch
    function bird(pan, far) {
        var t = ctx.currentTime;
        var base = 2200 + Math.random() * 2600;
        var notes = 2 + Math.floor(Math.random() * 5);
        var kind = Math.random();
        var p = panner();
        var out = gain(0.07 * (1 - far * 0.7));
        var f = filter("lowpass", 9000 - far * 5000, 0.5);
        p.connect(out);
        out.connect(f);
        f.connect(master);
        if (p.pan) {
            p.pan.value = pan;
        }
        for (var i = 0; i < notes; i++) {
            var osc = ctx.createOscillator();
            var g = gain(0);
            osc.connect(g);
            g.connect(p);
            var start = t + i * (0.09 + Math.random() * 0.08);
            var len = 0.05 + Math.random() * 0.08;
            var f0 = base * (0.85 + Math.random() * 0.3);
            var f1 = kind < 0.5 ? f0 * 1.35 : f0 * 0.7;
            osc.frequency.setValueAtTime(f0, start);
            osc.frequency.exponentialRampToValueAtTime(f1, start + len);
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(1, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, start + len);
            osc.start(start);
            osc.stop(start + len + 0.02);
        }
    }

    S.start = function () {
        if (S.ctx) {
            if (S.ctx.state === "suspended") {
                S.ctx.resume();
            }
            return;
        }
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
            return;
        }
        ctx = S.ctx = new AC();
        master = gain(S.volume);
        var comp = ctx.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ctx.destination);
        noiseBuf = makeNoise();
        wind = buildWind();
        water = buildWater();
        fire = buildFire();
        crickets = buildCrickets();
        S.on = true;
    };

    S.setVolume = function (v) {
        S.volume = v;
        if (master) {
            ease(master.gain, v, 0.05);
        }
    };

    /*
     * state: {
     *   dt, x, y, z, yaw,          listener (eye) position and heading
     *   daylight,                  0 night .. 1 day
     *   height,                    metres above the valley floor
     *   forest,                    0 open .. 1 deep forest (for birds)
     *   water,                     0 .. 1, how close the shore is
     *   waterX, waterZ,            where the nearest water is
     *   fires: [[x, y, z], ...],   burning fires
     *   step, surface,             a footstep this frame: "grass", "wood", "water"
     *   land,                      landed after a fall this frame (0..1 how hard)
     *   wind                       0 .. 1+, strength
     * }
     */
    S.update = function (st) {
        if (!S.on || ctx.state !== "running") {
            return;
        }
        var dt = Math.min(st.dt, 0.1);
        last.x = st.x;
        last.z = st.z;
        last.yaw = st.yaw;

        // Wind: stronger up high and in the open, gusting slowly
        wind.t += dt;
        var gust = 0.6 + 0.4 * Math.sin(wind.t * 0.23) * Math.sin(wind.t * 0.071 + 1.3);
        var up = Math.min(1, Math.max(0, st.height / 120));
        var w = (st.wind || 1) * gust * (0.35 + up * 0.9) * (1 - st.forest * 0.35);
        ease(wind.low.gain, 0.12 * w, 0.8);
        ease(wind.high.gain, 0.025 * w * (0.4 + up), 0.8);
        ease(wind.hf.frequency, 900 + 900 * gust + up * 600, 1);

        // Water lapping: swells every few seconds
        water.t += dt;
        var lap = 0.55 + 0.45 * Math.sin(water.t * 1.7) * Math.sin(water.t * 0.53 + 2.1);
        ease(water.g.gain, 0.16 * st.water * lap, 0.25);
        ease(water.f.frequency, 400 + 500 * lap, 0.25);
        setPan(water.p, panFor(st.waterX, st.waterZ) * 0.8);

        // The campfire: the nearest one, falling off with distance
        var best = 0, pan = 0;
        for (var i = 0; i < st.fires.length; i++) {
            var f = st.fires[i];
            var dx = f[0] - st.x, dy = f[1] - st.y, dz = f[2] - st.z;
            var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            var k = Math.max(0, 1 - d / 28);
            k = k * k;
            if (k > best) {
                best = k;
                pan = panFor(f[0], f[2]);
            }
        }
        ease(fire.g.gain, 0.22 * best, 0.2);
        setPan(fire.p, pan * 0.7);
        crackleTimer -= dt;
        if (best > 0.01 && crackleTimer <= 0) {
            crackleTimer = 0.04 + Math.random() * 0.35;
            var pop = Math.random();
            burst(pop < 0.2 ? 900 : 2500 + Math.random() * 3000, 2, best * (pop < 0.2 ? 0.5 : 0.25), 0.02 + Math.random() * 0.05, pan * 0.7);
        }

        // Birds by day, more in the woods; crickets at night
        var day = st.daylight;
        birdTimer -= dt;
        if (birdTimer <= 0) {
            birdTimer = (1.2 + Math.random() * 5) / (0.4 + st.forest);
            if (day > 0.3 && Math.random() < day) {
                bird(Math.random() * 1.6 - 0.8, Math.random());
            }
        }
        cricketPhase += dt;
        var night = Math.max(0, 1 - day * 1.6) * (1 - up * 0.8);
        var chirp = Math.sin(cricketPhase * 2 * Math.PI * 2.2) > 0.2 ? 1 : 0;
        var trill = 0.5 + 0.5 * Math.sin(cricketPhase * 2 * Math.PI * 38);
        ease(crickets.am.gain, chirp * trill, 0.004);
        ease(crickets.g.gain, 0.012 * night, 1);

        // Footsteps and landings
        if (st.step) {
            if (st.surface === "wood") {
                knock(110 + Math.random() * 30, 0.35, 0.12);
                burst(1800, 1, 0.08, 0.05);
            } else if (st.surface === "water") {
                burst(900 + Math.random() * 500, 0.8, 0.3, 0.35, 0, "lowpass");
                burst(3000, 1.5, 0.06, 0.25);
            } else {
                burst(2600 + Math.random() * 1500, 0.6, 0.18, 0.09);
                burst(600, 0.8, 0.12, 0.07, 0, "lowpass");
            }
        }
        if (st.land > 0) {
            knock(70, 0.4 * st.land, 0.2);
            burst(900, 0.6, 0.25 * st.land, 0.15, 0, "lowpass");
        }
    };
})();

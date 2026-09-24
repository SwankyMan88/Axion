/*
 * Pine Valley sound for Axion: field recordings from Freesound (all CC0, see
 * assets/NOTICE.md), carried inside this script as MP3 and played with Web
 * Audio. Loops: water lapping on the shore, forest birds, wind, leaves
 * rustling in the distance, a campfire, crickets. One-shots: footsteps on
 * grass, dirt, gravel, stone, fallen leaves, wood and in shallow water, and
 * bushes brushing past.
 *
 * The page calls ValleySound.start() after a click (browsers only allow audio
 * to begin after one), then ValleySound.update(state) every frame.
 */
(function () {
    var S = window.ValleySound = {
        ctx: null,
        on: false,
        volume: 0.8,
        clips: /*CLIPS*/null
    };

    var ctx, master, buffers = {};
    var loops = {};
    var t = 0;
    var lastStep = -1;

    function gain(v) {
        var g = ctx.createGain();
        g.gain.value = v;
        return g;
    }

    function ease(param, v, time) {
        param.setTargetAtTime(v, ctx.currentTime, time || 0.3);
    }

    function setPos(p, x, y, z) {
        if (p.positionX) {
            ease(p.positionX, x, 0.2);
            ease(p.positionY, y, 0.2);
            ease(p.positionZ, z, 0.2);
        } else {
            p.setPosition(x, y, z);
        }
    }

    // A sound placed in the world, heard from its direction
    function spot(ref) {
        var p = ctx.createPanner();
        p.panningModel = "HRTF";
        p.distanceModel = "inverse";
        p.refDistance = ref;
        p.rolloffFactor = 1;
        p.connect(master);
        return p;
    }

    function placeListener(x, y, z, yaw) {
        var L = ctx.listener;
        var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        if (L.positionX) {
            L.positionX.value = x;
            L.positionY.value = y;
            L.positionZ.value = z;
            L.forwardX.value = fx;
            L.forwardY.value = 0;
            L.forwardZ.value = fz;
            L.upX.value = 0;
            L.upY.value = 1;
            L.upZ.value = 0;
        } else {
            L.setPosition(x, y, z);
            L.setOrientation(fx, 0, fz, 0, 1, 0);
        }
    }

    function decode(name) {
        var c = S.clips[name];
        var bin = atob(c.data);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
        }
        return new Promise(function (ok, fail) {
            ctx.decodeAudioData(bytes.buffer, ok, fail);
        }).then(function (b) {
            buffers[name] = b;
        });
    }

    // A recording that plays forever through `out`, starting somewhere random
    function loop(name, out) {
        var c = S.clips[name];
        var src = ctx.createBufferSource();
        src.buffer = buffers[name];
        src.loop = true;
        src.loopStart = c.loop[0];
        src.loopEnd = c.loop[1];
        var g = gain(0);
        src.connect(g);
        g.connect(out);
        src.start(0, c.loop[0] + Math.random() * (c.loop[1] - c.loop[0]));
        return g;
    }

    // One sound from a set of takes, never the same one twice running
    function step(surface, level, rate) {
        var name = surface === "rustle" ? "rustle" : "step_" + surface;
        var c = S.clips[name];
        if (!buffers[name]) {
            return;
        }
        var k = Math.floor(Math.random() * c.count);
        if (k === lastStep) {
            k = (k + 1) % c.count;
        }
        lastStep = k;
        var src = ctx.createBufferSource();
        src.buffer = buffers[name];
        src.playbackRate.value = (rate || 1) * (0.92 + Math.random() * 0.16);
        var g = gain(level * (0.8 + Math.random() * 0.3));
        src.connect(g);
        g.connect(master);
        src.start(0, k * c.slot, c.slot);
    }

    S.start = function () {
        if (S.ctx) {
            if (S.ctx.state === "suspended") {
                S.ctx.resume();
            }
            return;
        }
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !S.clips) {
            return;
        }
        ctx = S.ctx = new AC();
        master = gain(S.volume);
        master.connect(ctx.destination);

        var jobs = [];
        for (var name in S.clips) {
            jobs.push(decode(name));
        }
        Promise.all(jobs).then(function () {
            // Birds come from two trees at once; water and fire from where they are
            loops.birdsA = { p: spot(8) };
            loops.birdsB = { p: spot(8) };
            loops.birdsA.g = loop("birds", loops.birdsA.p);
            loops.birdsB.g = loop("birds", loops.birdsB.p);
            loops.water = { p: spot(6) };
            loops.water.g = loop("water", loops.water.p);
            loops.fire = { p: spot(3) };
            loops.fire.g = loop("fire", loops.fire.p);
            loops.wind = { g: loop("wind", master) };
            // Leaves far off: softened, as if through the trees in between
            var far = ctx.createBiquadFilter();
            far.type = "lowpass";
            far.frequency.value = 2500;
            far.connect(master);
            loops.leaves = { g: loop("leaves", far) };
            loops.crickets = { g: loop("crickets", master) };
            S.on = true;
        });
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
     *   forest,                    0 open .. 1 deep forest
     *   trees: [[x, y, z], ...],   tree crowns nearby, where birds sing from
     *   water,                     0 .. 1, how close the shore is
     *   waterX, waterZ,            where the nearest water is
     *   fires: [[x, y, z], ...],   burning fires
     *   above,                     metres above the ground right below
 *   step, surface,             a footstep this frame: "grass", "dirt", "gravel",
 *                              "stone", "leaves", "wood" or "water"
 *   brush,                     walked into a bush this frame (0..1 how fast)
     *   land,                      landed after a fall this frame (0..1 how hard)
     *   wind                       0 .. 1+, strength
     * }
     */
    S.update = function (st) {
        if (!S.on || ctx.state !== "running") {
            return;
        }
        var dt = Math.min(st.dt, 0.1);
        t += dt;
        placeListener(st.x, st.y, st.z, st.yaw);

        // High above the ground the forest's small sounds are gone
        var air = Math.max(0, st.above || 0);
        var low = 1 - Math.min(1, Math.max(0, (air - 12) / 30));

        // Wind: louder up high, swelling and easing slowly
        var gust = 0.75 + 0.25 * Math.sin(t * 0.21) * Math.sin(t * 0.083 + 1.3);
        var up = Math.min(1, Math.max(0, Math.max(st.height, air) / 120));
        ease(loops.wind.g.gain, (st.wind || 1) * gust * (0.3 + 0.15 * st.forest + 0.7 * up), 1);

        // Leaves rustling somewhere in the trees around, with the gusts
        var woods = Math.min(1, (st.trees || []).length / 10);
        ease(loops.leaves.g.gain, (st.wind || 1) * (0.5 + 0.5 * gust) * (0.25 + 0.75 * woods) * 0.8 * low, 1.2);

        // Birds by day, from two of the nearest trees
        var day = st.daylight;
        var trees = st.trees || [];
        var birds = trees.length ? day * day * (0.35 + 0.65 * Math.min(1, trees.length / 8)) * low : 0;
        var ta = trees.length ? trees[0] : [st.x + 20, st.y, st.z];
        var tb = trees.length > 3 ? trees[3] : (trees.length > 1 ? trees[1] : ta);
        setPos(loops.birdsA.p, ta[0], ta[1], ta[2]);
        setPos(loops.birdsB.p, tb[0], tb[1], tb[2]);
        ease(loops.birdsA.g.gain, birds * 0.9, 1.5);
        ease(loops.birdsB.g.gain, birds * 0.7, 1.5);

        // Crickets at night, down in the grass
        var night = Math.max(0, 1 - day * 1.6) * low;
        ease(loops.crickets.g.gain, night * 0.8, 1.5);

        // The lake, heard from the nearest bit of shore
        setPos(loops.water.p, st.waterX, 0.3, st.waterZ);
        ease(loops.water.g.gain, Math.min(1, st.water * 1.4) * 1.3, 0.5);

        // The nearest fire
        var best = null, bd = 1e9;
        for (var i = 0; i < st.fires.length; i++) {
            var f = st.fires[i];
            var dx = f[0] - st.x, dz = f[2] - st.z;
            var d = dx * dx + dz * dz;
            if (d < bd) {
                bd = d;
                best = f;
            }
        }
        if (best) {
            setPos(loops.fire.p, best[0], best[1], best[2]);
            var near = Math.max(0, 1 - Math.sqrt(bd) / 45);
            ease(loops.fire.g.gain, near * 1.2, 0.4);
        }

        // Footsteps, landings, and bushes pushed aside
        var sets = { grass: "grass", dirt: "dirt", gravel: "gravel", stone: "stone", leaves: "leaves", wood: "wood", water: "wade" };
        var set = sets[st.surface] || "grass";
        if (st.step) {
            step(set, set === "wood" || set === "stone" ? 0.65 : 0.8);
        }
        if (st.land > 0) {
            step(set, 0.6 + st.land * 0.6, 0.8);
        }
        if (st.brush > 0) {
            step("rustle", 0.35 + 0.65 * st.brush);
        }
    };
})();

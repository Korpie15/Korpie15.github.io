/*
 * Robot cell: the scroll-driven 3D scene for korpie15.github.io.
 *
 * A six-axis robot (analytic inverse kinematics, spherical wrist) picks
 * boards from a floor rack and a shelf tower, presents them to the camera
 * and puts them away. Each board face carries an HTML card that is mapped
 * onto the board with a CSS homography, so the text stays real, crisp and
 * clickable while it rides on the 3D board.
 *
 * Everything is a pure function of the timeline position `t`, which follows
 * the scroll position, so scrubbing forwards and backwards always agrees.
 */
(() => {
    'use strict';

    const root = document.documentElement;
    const canvas = document.getElementById('cell');
    const stage = document.getElementById('stage');
    const track = document.getElementById('track');
    if (!window.THREE || !canvas || !stage || !track) return;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        if (!renderer.getContext()) throw new Error('no context');
    } catch (err) {
        root.classList.add('no-webgl');
        return;
    }
    root.classList.add('cell-on');

    const PI = Math.PI;
    const D2R = PI / 180;
    const V3 = THREE.Vector3;
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const lerp = (a, b, u) => a + (b - a) * u;
    const ease = u => u * u * u * (u * (u * 6 - 15) + 10);
    const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
    const wrapNear = (a, ref) => a + 2 * PI * Math.round((ref - a) / (2 * PI));
    const col = hex => new THREE.Color(hex).convertSRGBToLinear();

    const coarse = matchMedia('(pointer: coarse)').matches;

    renderer.setClearColor(0xffffff, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
    const TAN = Math.tan(camera.fov * D2R / 2);

    /* ------------------------------------------------------------------ */
    /* Lighting: a soft white studio                                       */
    /* ------------------------------------------------------------------ */

    function studioEnvironment() {
        const env = new THREE.Scene();
        const room = new THREE.Mesh(
            new THREE.BoxGeometry(24, 12, 24),
            new THREE.MeshBasicMaterial({ color: col('#dcdce2'), side: THREE.BackSide })
        );
        room.position.y = 5;
        env.add(room);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: col('#8d8e95') }));
        floor.rotation.x = -PI / 2;
        floor.position.y = -0.9;
        env.add(floor);
        const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5) });
        const soft = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.3) });
        [
            [glow, [0, 10.8, 0], [9, 0.1, 6]],
            [soft, [-11.8, 5, 2], [0.1, 5, 9]],
            [soft, [11.8, 4, -3], [0.1, 3, 6]],
            [glow, [2, 5, 11.8], [6, 4, 0.1]],
            [soft, [-3, 4, -11.8], [8, 3, 0.1]]
        ].forEach(([m, p, s]) => {
            const panel = new THREE.Mesh(new THREE.BoxGeometry(...s), m);
            panel.position.set(...p);
            env.add(panel);
        });
        const pmrem = new THREE.PMREMGenerator(renderer);
        const tex = pmrem.fromScene(env, 0.035).texture;
        pmrem.dispose();
        return tex;
    }
    scene.environment = studioEnvironment();

    scene.add(new THREE.HemisphereLight(0xffffff, 0xe6e6ea, 0.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-2.6, 7.5, 4.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    sun.shadow.camera.left = -4.2;
    sun.shadow.camera.right = 4.2;
    sun.shadow.camera.top = 4.2;
    sun.shadow.camera.bottom = -4.2;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 16;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 5;
    scene.add(sun);
    scene.add(sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.13 }));
    ground.rotation.x = -PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Soft contact shadows keep things grounded on the white floor.
    const blobTex = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(0,0,0,0.55)');
        grad.addColorStop(0.55, 'rgba(0,0,0,0.18)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
    })();
    function contactShadow(parent, x, z, sx, sz, opacity = 0.5) {
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false, toneMapped: false })
        );
        m.rotation.x = -PI / 2;
        m.position.set(x, 0.002, z);
        m.scale.set(sx, sz, 1);
        m.renderOrder = -1;
        m.userData.noShadow = true;
        parent.add(m);
        return m;
    }

    /* ------------------------------------------------------------------ */
    /* Materials and geometry helpers                                      */
    /* ------------------------------------------------------------------ */

    const MAT = {
        yellow: new THREE.MeshStandardMaterial({ color: col('#f3b50b'), roughness: 0.3, metalness: 0.05 }),
        dark: new THREE.MeshStandardMaterial({ color: col('#2b2c31'), roughness: 0.5, metalness: 0.25 }),
        graphite: new THREE.MeshStandardMaterial({ color: col('#45474e'), roughness: 0.42, metalness: 0.4 }),
        steel: new THREE.MeshStandardMaterial({ color: col('#c4c7cd'), roughness: 0.22, metalness: 0.9 }),
        alu: new THREE.MeshStandardMaterial({ color: col('#d9dbe0'), roughness: 0.38, metalness: 0.55 }),
        white: new THREE.MeshStandardMaterial({ color: col('#fbfbfc'), roughness: 0.62, metalness: 0 }),
        offwhite: new THREE.MeshStandardMaterial({ color: col('#eeeff2'), roughness: 0.55, metalness: 0 }),
        slot: new THREE.MeshStandardMaterial({ color: col('#9a9ca4'), roughness: 0.6 }),
        boardFace: new THREE.MeshStandardMaterial({ color: col('#ffffff'), roughness: 0.75, metalness: 0, emissive: col('#ffffff'), emissiveIntensity: 0.32 }),
        boardEdge: new THREE.MeshStandardMaterial({ color: col('#c9ccd3'), roughness: 0.35, metalness: 0.5 }),
        pad: new THREE.MeshStandardMaterial({ color: col('#1d1e22'), roughness: 0.85 })
    };

    function mesh(geo, mat, parent, pos, rot) {
        const m = new THREE.Mesh(geo, mat);
        if (pos) m.position.set(pos[0], pos[1], pos[2]);
        if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
    }
    const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
    const cylY = (r1, r2, h, s = 40) => new THREE.CylinderGeometry(r1, r2, h, s);
    const cylZ = (r, h, s = 40) => new THREE.CylinderGeometry(r, r, h, s).rotateX(PI / 2);
    // Tapered cylinder along +X: radius r0 at x=0, r1 at x=len.
    const cylX = (r0, r1, len, s = 40) => new THREE.CylinderGeometry(r1, r0, len, s).rotateZ(-PI / 2).translate(len / 2, 0, 0);

    // Rounded "capsule" outline between two circles, extruded along Z.
    function capsule(c1, r1, c2, r2, depth, bevel = 0.018) {
        const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
        const L = Math.hypot(dx, dy);
        const phi = Math.asin(clamp((r1 - r2) / L, -1, 1));
        const s = new THREE.Shape();
        s.moveTo(r1 * Math.cos(phi), r1 * Math.sin(phi));
        s.lineTo(r2 * Math.cos(phi), L + r2 * Math.sin(phi));
        s.absarc(0, L, r2, phi, PI - phi, false);
        s.lineTo(r1 * Math.cos(PI - phi), r1 * Math.sin(PI - phi));
        s.absarc(0, 0, r1, PI - phi, 2 * PI + phi, false);
        const geo = new THREE.ExtrudeGeometry(s, {
            depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
            bevelSegments: 4, curveSegments: 40
        });
        geo.translate(0, 0, -(depth - 2 * bevel) / 2);
        geo.rotateZ(Math.atan2(dy, dx) - PI / 2);
        geo.translate(c1[0], c1[1], 0);
        geo.computeVertexNormals();
        return geo;
    }

    function roundedSlab(w, d, h, r) {
        const s = new THREE.Shape();
        const x = -w / 2, y = -d / 2;
        s.moveTo(x + r, y);
        s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
        s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
        s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
        s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
        const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 12 });
        geo.rotateX(-PI / 2);
        return geo;
    }

    /* ------------------------------------------------------------------ */
    /* The robot                                                           */
    /* ------------------------------------------------------------------ */

    // Kinematic constants (metres). The arm works in the XY plane of joint 1.
    const R = {
        j1y: 0.36,   // top of base / J1 frame height
        a1: 0.15,    // shoulder forward offset
        j2y: 0.44,   // shoulder height above J1 frame
        L2: 1.0,     // upper arm
        j4x: 0.28,   // elbow to start of the rolling forearm
        L3: 1.05,    // elbow to wrist centre
        j6x: 0.1,    // wrist centre to flange
        tool: 0.2    // flange to finger tips (tool point)
    };
    const D6 = R.j6x + R.tool;
    const SHOULDER_Y = R.j1y + R.j2y;
    const GRIP = 0.05;          // how far the fingers overlap the board's top edge
    const BOARD_T = 0.03;

    const robot = new THREE.Group();
    scene.add(robot);

    const J = [];
    // Pedestal and base
    mesh(cylY(0.62, 0.64, 0.05, 72), MAT.white, robot, [0, 0.025, 0]);
    mesh(roundedSlab(0.74, 0.74, 0.06, 0.08), MAT.dark, robot, [0, 0.05, 0]);
    mesh(cylY(0.3, 0.33, 0.25, 56), MAT.dark, robot, [0, 0.11 + 0.125, 0]);
    mesh(cylY(0.305, 0.305, 0.02, 56), MAT.steel, robot, [0, 0.35, 0]);
    contactShadow(robot, 0, 0, 1.9, 1.9, 0.45);

    J[1] = new THREE.Group();
    J[1].position.y = R.j1y;
    robot.add(J[1]);
    mesh(cylY(0.29, 0.3, 0.16, 56), MAT.yellow, J[1], [0, 0.08, 0]);
    mesh(capsule([-0.04, 0.12], 0.25, [R.a1, R.j2y], 0.215, 0.36), MAT.yellow, J[1]);
    mesh(cylZ(0.13, 0.5), MAT.dark, J[1], [R.a1, R.j2y, 0]);
    mesh(cylZ(0.105, 0.14), MAT.graphite, J[1], [R.a1, R.j2y, -0.3]);
    mesh(cylX(0.1, 0.1, 0.16), MAT.dark, J[1], [-0.42, 0.2, 0]).rotation.z = 0;

    J[2] = new THREE.Group();
    J[2].position.set(R.a1, R.j2y, 0);
    J[1].add(J[2]);
    mesh(capsule([0, 0], 0.175, [0, R.L2], 0.14, 0.24), MAT.yellow, J[2], [0, 0, 0.2]);
    mesh(cylZ(0.16, 0.06), MAT.steel, J[2], [0, 0, 0.33]);
    mesh(cylZ(0.12, 0.08), MAT.dark, J[2], [0, R.L2, 0.33]);
    const decal = (() => {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = '#1d1d1f';
        g.font = '700 84px -apple-system, "SF Pro Display", Inter, "Segoe UI", Roboto, sans-serif';
        g.textBaseline = 'middle';
        g.fillText('AK-6', 20, 68);
        const tex = new THREE.CanvasTexture(c);
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    })();
    const decalMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1),
        new THREE.MeshBasicMaterial({ map: decal, transparent: true, depthWrite: false }));
    decalMesh.position.set(0.0, R.L2 * 0.5, 0.321);
    decalMesh.rotation.z = PI / 2;
    J[2].add(decalMesh);

    J[3] = new THREE.Group();
    J[3].position.set(0, R.L2, 0);
    J[2].add(J[3]);
    mesh(capsule([-0.2, 0.04], 0.165, [0.22, 0.0], 0.13, 0.3), MAT.yellow, J[3]);
    mesh(cylZ(0.11, 0.36), MAT.dark, J[3], [0, 0, 0.02]);
    mesh(cylX(0.085, 0.085, 0.14), MAT.dark, J[3], [-0.5, 0.05, 0]);
    mesh(cylX(0.1, 0.1, 0.04), MAT.steel, J[3], [-0.39, 0.05, 0]);

    J[4] = new THREE.Group();
    J[4].position.set(R.j4x, 0, 0);
    J[3].add(J[4]);
    const wristX = R.L3 - R.j4x;
    mesh(cylX(0.118, 0.118, 0.03), MAT.steel, J[4], [-0.005, 0, 0]);
    mesh(cylX(0.112, 0.088, wristX - 0.1), MAT.yellow, J[4], [0.02, 0, 0]);
    mesh(capsule([wristX - 0.16, 0], 0.088, [wristX, 0], 0.092, 0.13, 0.014), MAT.yellow, J[4], [0, 0, 0.065]);
    mesh(capsule([wristX - 0.16, 0], 0.088, [wristX, 0], 0.092, 0.13, 0.014), MAT.yellow, J[4], [0, 0, -0.065]);

    J[5] = new THREE.Group();
    J[5].position.set(wristX, 0, 0);
    J[4].add(J[5]);
    mesh(cylZ(0.072, 0.27), MAT.dark, J[5]);
    mesh(cylX(0.07, 0.066, 0.085), MAT.yellow, J[5], [0, 0, 0]);

    J[6] = new THREE.Group();
    J[6].position.set(R.j6x, 0, 0);
    J[5].add(J[6]);
    mesh(cylX(0.062, 0.062, 0.02), MAT.steel, J[6], [-0.015, 0, 0]);
    // Parallel-jaw gripper. Jaws close along local Z, the board's normal.
    mesh(cylX(0.05, 0.05, 0.03), MAT.graphite, J[6], [0.005, 0, 0]);
    mesh(box(0.085, 0.11, 0.3), MAT.dark, J[6], [0.0775, 0, 0]);
    mesh(box(0.01, 0.07, 0.31), MAT.steel, J[6], [0.125, 0, 0]);
    const fingers = [-1, 1].map(s => {
        const f = new THREE.Group();
        J[6].add(f);
        mesh(box(0.09, 0.13, 0.022), MAT.alu, f, [0.165, 0, s * 0.011]);
        mesh(box(0.05, 0.11, 0.004), MAT.pad, f, [0.175, 0, -s * 0.002]);
        f.userData.side = s;
        return f;
    });
    function setJaw(open) {
        const gap = BOARD_T / 2 + 0.001 + open * 0.065;
        fingers.forEach(f => { f.position.z = f.userData.side * gap; });
    }
    const boardMount = new THREE.Group();
    J[6].add(boardMount);
    boardMount.rotation.z = PI / 2;

    robot.traverse(o => { if (o.isMesh) o.castShadow = !o.userData.noShadow && o !== decalMesh; });

    function applyJoints(q) {
        J[1].rotation.y = q[0];
        J[2].rotation.z = q[1];
        J[3].rotation.z = q[2];
        J[4].rotation.x = q[3];
        J[5].rotation.z = q[4];
        J[6].rotation.x = q[5];
    }

    /* Analytic IK. Tool always points straight down; psi is the yaw of the
       board normal (psi = 0 faces +Z, the camera side). */
    const _m03 = new THREE.Matrix4(), _mt = new THREE.Matrix4(), _mw = new THREE.Matrix4(), _ma = new THREE.Matrix4();
    const _x = new V3(), _y = new V3(), _z = new V3();
    function solveIK(P, psi, prev, q1Ref) {
        const Wx = P.x, Wy = P.y + D6, Wz = P.z;
        const q1 = wrapNear(Math.atan2(-Wz, Wx), q1Ref !== undefined ? q1Ref : prev[0]);
        const r = Math.hypot(Wx, Wz) - R.a1;
        const h = Wy - SHOULDER_Y;
        const D = clamp((r * r + h * h - R.L2 * R.L2 - R.L3 * R.L3) / (2 * R.L2 * R.L3), -1, 1);
        const gam = -Math.acos(D);
        const alpha = Math.atan2(h, r) - Math.atan2(R.L3 * Math.sin(gam), R.L2 + R.L3 * Math.cos(gam));
        const q2 = alpha - PI / 2;
        const q3 = alpha + gam - q2;

        _m03.makeRotationY(q1).multiply(_ma.makeRotationZ(q2 + q3));
        _x.set(0, -1, 0);
        _z.set(Math.sin(psi), 0, Math.cos(psi));
        _y.crossVectors(_z, _x);
        _mt.makeBasis(_x, _y, _z);
        _mw.copy(_m03).transpose().multiply(_mt);
        const e = _mw.elements; // column-major: (row i, col j) = e[j * 4 + i]
        const r00 = e[0], r10 = e[1], r20 = e[2];
        const s5 = Math.hypot(r10, r20);
        const sols = [];
        const base4 = s5 > 1e-6 ? Math.atan2(r20, r10) : prev[3];
        [[base4, Math.atan2(s5, r00)], [base4 + PI, -Math.atan2(s5, r00)]].forEach(([q4, q5]) => {
            _ma.makeRotationX(-q4);
            const m = new THREE.Matrix4().makeRotationZ(-q5).multiply(_ma).multiply(_mw).elements;
            const q6 = Math.atan2(m[6], m[5]); // (2,1) and (1,1)
            const a = wrapNear(q4, prev[3]);
            const c = wrapNear(q6, prev[5]);
            sols.push([a, q5, c, Math.abs(a - prev[3]) + Math.abs(c - prev[5]) + Math.abs(q5 - prev[4])]);
        });
        sols.sort((a, b) => a[3] - b[3]);
        const s = sols[0];
        return [q1, q2, q3, s[0], s[1], s[2]];
    }

    /* ------------------------------------------------------------------ */
    /* Boards                                                              */
    /* ------------------------------------------------------------------ */

    const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

    // A "printed" face for a board, shown whenever the live HTML card is not.
    function faceTexture(W, H, info) {
        const cw = 1024, ch = Math.round(1024 * H / W);
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const g = c.getContext('2d');
        const u = Math.min(cw, ch) / 100;
        if (info.title) {
            const pad = 8 * u;
            g.fillStyle = '#86868b';
            g.font = `600 ${3.6 * u}px ${FONT}`;
            g.fillText(info.num + '  —  ' + info.label.toUpperCase(), pad, pad + 4 * u);
            g.fillStyle = '#1d1d1f';
            g.font = `700 ${10 * u}px ${FONT}`;
            g.fillText(info.title, pad, pad + 17 * u);
            g.fillStyle = '#f3b50b';
            g.fillRect(pad, pad + 22 * u, 10 * u, 1.1 * u);
            g.fillStyle = '#e8e8ed';
            const rows = Math.floor((ch - pad * 2 - 34 * u) / (6 * u));
            for (let i = 0; i < rows; i++) {
                const w = (cw - pad * 2) * (i % 4 === 3 ? 0.55 : 0.92 - (i % 3) * 0.07);
                roundRect(g, pad, pad + 32 * u + i * 6 * u, w, 2.6 * u, 1.3 * u);
            }
        } else {
            g.fillStyle = '#e9e9ee';
            roundRect(g, cw * 0.08, ch * 0.1, cw * 0.32, 2.2 * u, 1.1 * u);
            roundRect(g, cw * 0.08, ch * 0.1 + 5 * u, cw * 0.2, 2.2 * u, 1.1 * u);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        return tex;
    }
    function roundRect(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.fill();
    }

    function makeBoard(W, H, faces) {
        const group = new THREE.Group();
        const mats = [MAT.boardEdge, MAT.boardEdge, MAT.boardEdge, MAT.boardEdge, MAT.boardFace, MAT.boardFace];
        const slab = mesh(box(W, H, BOARD_T), mats, group);
        slab.castShadow = true;
        const labels = faces.map((info, i) => {
            const m = new THREE.Mesh(
                new THREE.PlaneGeometry(W * 0.995, H * 0.995),
                new THREE.MeshBasicMaterial({ map: faceTexture(W, H, info), transparent: true, depthWrite: false })
            );
            m.position.z = (i === 0 ? 1 : -1) * (BOARD_T / 2 + 0.0015);
            if (i === 1) m.rotation.y = PI;
            group.add(m);
            return m;
        });
        group.userData.labels = labels;
        return group;
    }

    /* ------------------------------------------------------------------ */
    /* Cell layout, props and timeline (rebuilt when the board shape flips) */
    /* ------------------------------------------------------------------ */

    let B = null;          // board dimensions { W, H, portrait }
    let L = null;          // layout
    let props = null;      // THREE.Group with racks and shelves
    let boards = [];       // the two story boards
    let TL = null;         // timeline

    const STORY = [
        [{ num: '01', label: 'About', title: 'Hi, I’m Aidan.' }, { num: '02', label: 'Experience', title: 'Where I’ve worked.' }],
        [{ num: '03', label: 'Projects', title: 'Things I’ve built.' }, { num: '04', label: 'Leadership', title: 'Leading people.' }]
    ];

    function boardDims() {
        const portrait = stage.clientWidth / stage.clientHeight < 1;
        return portrait ? { W: 0.72, H: 1.12, portrait } : { W: 1.25, H: 0.82, portrait };
    }

    function buildCell() {
        if (props) {
            scene.remove(props);
            props.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material && o.material.map && o.material.map !== blobTex) o.material.map.dispose();
            });
        }
        boards.forEach(b => scene.remove(b.group));

        const { W, H } = B;
        props = new THREE.Group();
        scene.add(props);

        L = {
            rack: { x0: -1.4, dx: -0.15, n: 4, z: 0.25, floor: 0.1 },
            shelf: { z: -1.25, top: 0.6, sunk: 0.04, x: [-0.78, 0.78] },
            tower: { front: 1.2, x: 1.44, floor: 0.62, z: 0, pitch: W + 0.24 },
            present: { x: 0, cy: 1.3, z: 1.05 }
        };

        // Floor rack, left: boards stand on edge, faces towards the robot.
        const rk = L.rack;
        const rx0 = rk.x0 + 0.11, rx1 = rk.x0 + rk.dx * (rk.n - 1) - 0.11;
        const rcx = (rx0 + rx1) / 2, rlen = rx0 - rx1;
        mesh(box(rlen, rk.floor, W + 0.16), MAT.offwhite, props, [rcx, rk.floor / 2, rk.z]);
        [-1, 1].forEach(s => {
            mesh(box(rlen, 0.34, 0.03), MAT.alu, props, [rcx, rk.floor + 0.17, rk.z + s * (W / 2 + 0.035)]);
        });
        for (let i = 0; i < rk.n; i++) {
            mesh(box(0.05, 0.006, W + 0.04), MAT.slot, props, [rk.x0 + rk.dx * i, rk.floor + 0.003, rk.z]);
        }
        contactShadow(props, rcx, rk.z, rlen + 0.7, W + 0.8, 0.35);

        // Long low cabinet at the back with slotted top.
        const sh = L.shelf;
        const shW = Math.max(3.2, 2 * (Math.abs(sh.x[0]) + W / 2 + 0.25));
        mesh(box(shW, sh.top - 0.04, 0.46), MAT.white, props, [0, (sh.top - 0.04) / 2, sh.z]);
        mesh(box(shW + 0.02, 0.04, 0.48), MAT.offwhite, props, [0, sh.top - 0.02, sh.z]);
        for (let i = -1; i <= 1; i += 2) {
            mesh(box(0.006, sh.top - 0.16, 0.002), MAT.slot, props, [i * shW / 6, (sh.top - 0.04) / 2, sh.z + 0.231]);
        }
        sh.x.forEach(x => mesh(box(W + 0.05, 0.004, 0.05), MAT.slot, props, [x, sh.top + 0.002, sh.z]));
        contactShadow(props, 0, sh.z, shW + 0.8, 1.1, 0.35);

        // Shelf tower, right: open to the robot (-X), boards face the robot.
        const tw = L.tower;
        const depth = 0.5;
        const roof = tw.floor + H + 0.58;
        const cols = [0, -1];
        const zMin = tw.z - tw.pitch - tw.pitch / 2, zMax = tw.z + tw.pitch / 2;
        const tcx = tw.front + depth / 2;
        const tz = (zMin + zMax) / 2, tlen = zMax - zMin;
        mesh(box(depth, tw.floor, tlen), MAT.white, props, [tcx, tw.floor / 2, tz]);
        mesh(box(depth + 0.02, 0.035, tlen + 0.02), MAT.offwhite, props, [tcx, roof + 0.0175, tz]);
        mesh(box(0.025, roof - tw.floor, tlen), MAT.offwhite, props, [tw.front + depth - 0.0125, (roof + tw.floor) / 2, tz]);
        [zMin, zMin + tw.pitch].forEach(z => {
            mesh(box(depth, roof - tw.floor, 0.025), MAT.white, props, [tcx, (roof + tw.floor) / 2, z]);
        });
        cols.forEach(c => mesh(box(0.05, 0.004, W + 0.05), MAT.slot, props, [tw.x, tw.floor + 0.002, tw.z + c * tw.pitch]));
        contactShadow(props, tcx, tz, 1.3, tlen + 0.8, 0.35);

        // Spare boards for a lived-in cell.
        const blank = [{}, {}];
        for (let i = 1; i < rk.n; i++) {
            const b = makeBoard(W, H, blank);
            b.position.set(rk.x0 + rk.dx * i, rk.floor + H / 2, rk.z);
            b.rotation.y = PI / 2;
            props.add(b);
        }
        const spareShelf = makeBoard(W, H, blank);
        spareShelf.position.set(sh.x[1], sh.top - sh.sunk + H / 2, sh.z);
        props.add(spareShelf);
        const spareTower = makeBoard(W, H, blank);
        spareTower.position.set(tw.x, tw.floor + H / 2, tw.z - tw.pitch);
        spareTower.rotation.y = -PI / 2;
        props.add(spareTower);

        props.traverse(o => { if (o.isMesh && !o.userData.noShadow && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

        boards = STORY.map(faces => {
            const group = makeBoard(W, H, faces);
            scene.add(group);
            return { group, attached: false };
        });
        boardMount.position.set(R.tool - GRIP + H / 2, 0, 0);

        TL = buildTimeline();
        layoutTrack();
    }

    function buildTimeline() {
        const { W, H } = B;
        const keys = [];
        const jaws = [{ t: -1, open: 1 }];
        const status = [];
        const marks = {};
        let t = 0;
        const v = a => new V3(a[0], a[1], a[2]);
        const add = (dur, P, psiDeg, move = 'J', extra = {}) => {
            t += dur;
            keys.push(Object.assign({ t, P: v(P), psi: psiDeg * D2R, move }, extra));
            return t;
        };
        const hold = dur => { const k = keys[keys.length - 1]; t += dur; keys.push(Object.assign({}, k, { t, move: 'J', Q: k.P ? null : k.Q })); return t; };
        const say = text => status.push({ t, text });

        const HOME_Q = [-58 * D2R, 0.12, -0.12, 0, -PI / 2, 0];
        keys.push({ t: 0, Q: HOME_Q.slice(), move: 'J' });
        say('Idle · Home');
        hold(0.55);

        // Board 1: lift from the floor rack.
        const rk = L.rack;
        const rTop = rk.floor + H - GRIP;
        say('Pick · Board 01');
        add(1.0, [rk.x0, rTop + 0.42, rk.z], 90);
        marks.rackAbove = t;
        add(0.5, [rk.x0, rTop, rk.z], 90, 'L');
        jaws.push({ t, open: 0 });
        const grip1 = keys[keys.length - 1];
        hold(0.25);
        const attach1 = t - 0.12;
        add(0.6, [rk.x0, rTop + 0.52, rk.z], 90, 'L');
        marks.rackLift = t;

        const pr = L.present;
        const pTop = pr.cy + H / 2 - GRIP;
        say('Present · About');
        add(1.15, [pr.x, pTop, pr.z], 0);
        marks.about = t;
        hold(1.25);
        say('Rotate · Experience');
        const flip1 = t;
        add(0.8, [pr.x, pTop, pr.z], 180);
        marks.experience = t;
        hold(1.25);
        const leave1 = t;

        // Put board 1 away on the back cabinet.
        const sh = L.shelf;
        const sTop = sh.top - sh.sunk + H - GRIP;
        say('Place · Shelf A');
        add(0.6, [-0.55, pTop + 0.2, 0.55], 180);
        add(1.0, [sh.x[0], sTop + 0.3, sh.z], 180);
        marks.shelfAbove = t;
        add(0.45, [sh.x[0], sTop, sh.z], 180, 'L');
        jaws.push({ t, open: 1 });
        const place1 = keys[keys.length - 1];
        const release1 = t + 0.1;
        hold(0.25);
        add(0.35, [sh.x[0], sTop + 0.3, sh.z], 180, 'L');

        // Board 2: pull it out of the tower.
        const tw = L.tower;
        const tTop = tw.floor + H - GRIP;
        const out = tw.front - 0.25;
        say('Retrieve · Board 02');
        add(1.05, [out, tTop + 0.14, tw.z], -90);
        marks.towerIn = t;
        add(0.45, [tw.x, tTop + 0.14, tw.z], -90, 'L');
        add(0.3, [tw.x, tTop, tw.z], -90, 'L');
        jaws.push({ t, open: 0 });
        const grip2 = keys[keys.length - 1];
        hold(0.25);
        const attach2 = t - 0.12;
        add(0.2, [tw.x, tTop + 0.06, tw.z], -90, 'L');
        add(0.6, [out - 0.12, tTop + 0.06, tw.z], -90, 'L');
        marks.towerOut = t;

        say('Present · Projects');
        add(1.15, [pr.x, pTop, pr.z], 0);
        marks.projects = t;
        hold(1.5);
        say('Rotate · Leadership');
        const flip2 = t;
        add(0.8, [pr.x, pTop, pr.z], 180);
        marks.leadership = t;
        hold(1.3);
        const leave2 = t;

        say('Return · Board 02');
        add(1.15, [out - 0.12, tTop + 0.06, tw.z], 270);
        marks.towerBack = t;
        add(0.55, [tw.x, tTop + 0.06, tw.z], 270, 'L');
        add(0.2, [tw.x, tTop, tw.z], 270, 'L');
        jaws.push({ t, open: 1 });
        const release2 = t + 0.1;
        hold(0.25);
        add(0.3, [tw.x, tTop + 0.14, tw.z], 270, 'L');
        add(0.45, [out, tTop + 0.14, tw.z], 270, 'L');
        marks.towerLeft = t;
        say('Idle · Home');
        t += 1.2;
        keys.push({ t, Q: 'home', move: 'J' });
        marks.end = t;
        hold(0.9);
        const total = t;

        // Solve every key in order so the wrist stays continuous.
        let prev = HOME_Q.slice();
        keys.forEach(k => {
            if (k.Q === 'home') {
                k.Q = HOME_Q.slice();
                k.Q[0] = wrapNear(HOME_Q[0], prev[0]);
                k.Q[3] = wrapNear(HOME_Q[3], prev[3]);
                k.Q[5] = wrapNear(HOME_Q[5], prev[5]);
            } else if (!k.Q) {
                k.Q = solveIK(k.P, k.psi, prev, k.q1Ref);
            }
            prev = k.Q;
        });

        // Board rest poses come straight from the tool pose at grip/release.
        const restOf = k => ({ pos: new V3(k.P.x, k.P.y + GRIP - H / 2, k.P.z), yaw: k.psi });
        const boardsTL = [
            { rest: [restOf(grip1), restOf(place1)], attach: attach1, release: release1,
              faces: [[marks.about - 0.9, flip1 + 0.45], [flip1 + 0.35, leave1 + 0.5]] },
            { rest: [restOf(grip2), restOf(grip2)], attach: attach2, release: release2,
              faces: [[marks.projects - 0.9, flip2 + 0.45], [flip2 + 0.35, leave2 + 0.5]] }
        ];

        // Camera: framed views and the face-on "present" shot.
        const views = {
            hero: { tgt: [0.1, B.portrait ? 1.85 : 1.75, 0.2], dir: [-0.55, 0.16, 1], fit: B.portrait ? [2.3, 4.8] : [5.2, 4.3] },
            rack: { tgt: [-1.25, 0.85, 0.35], dir: [0.5, 0.32, 1], fit: B.portrait ? [1.5, 2.2] : [2.3, 1.9] },
            shelf: { tgt: [-0.75, 1.0, -1.05], dir: [-0.95, 0.55, 0.75], fit: B.portrait ? [1.9, 2.6] : [3.0, 2.2] },
            tower: { tgt: [1.2, 1.15, -0.1], dir: [-0.12, 0.42, 1], fit: B.portrait ? [1.9, 3.0] : [3.1, 2.6] },
            wide: { tgt: [0.1, B.portrait ? 1.35 : 1.05, -0.35], dir: [0.2, 0.3, 1], fit: B.portrait ? [3.2, 5] : [5.0, 3.2] }
        };
        const cams = [
            [0, 'hero'], [0.45, 'hero'], [marks.rackAbove + 0.2, 'rack'], [marks.rackLift, 'rack'],
            [marks.about, 'present'], [leave1, 'present'], [marks.shelfAbove, 'shelf'], [release1 + 0.6, 'shelf'],
            [marks.towerIn + 0.3, 'tower'], [marks.towerOut, 'tower'], [marks.projects, 'present'], [leave2, 'present'],
            [marks.towerBack + 0.2, 'tower'], [marks.towerLeft, 'tower'], [marks.end, 'wide'], [total, 'wide']
        ].map(([ct, name]) => ({ t: ct, view: views[name] || 'present' }));

        return { keys, jaws, status, marks, total, boards: boardsTL, cams, pTop };
    }

    /* ------------------------------------------------------------------ */
    /* Sampling the timeline                                               */
    /* ------------------------------------------------------------------ */

    const _P = new V3();
    function robotAt(t) {
        const ks = TL.keys;
        if (t <= ks[0].t) return ks[0].Q;
        for (let i = 1; i < ks.length; i++) {
            const a = ks[i - 1], b = ks[i];
            if (t <= b.t) {
                const u = ease((t - a.t) / Math.max(1e-6, b.t - a.t));
                if (b.move === 'L' && a.P && b.P) {
                    _P.lerpVectors(a.P, b.P, u);
                    const q = a.Q.map((x, j) => lerp(x, b.Q[j], u));
                    return solveIK(_P, lerp(a.psi, b.psi, u), q, q[0]);
                }
                return a.Q.map((x, j) => lerp(x, b.Q[j], u));
            }
        }
        return ks[ks.length - 1].Q;
    }

    function jawAt(t) {
        let open = 1;
        for (const j of TL.jaws) {
            if (t < j.t) break;
            const u = sstep(j.t, j.t + 0.18, t);
            open = lerp(open, j.open, u);
            if (u < 1) break;
            open = j.open;
        }
        return open;
    }

    function statusAt(t) {
        let s = TL.status[0].text;
        for (const x of TL.status) if (t >= x.t - 0.05) s = x.text;
        return s;
    }

    function fitDistance(fw, fh) {
        const aspect = camera.aspect;
        return Math.max(fh / 2 / TAN, fw / 2 / (TAN * aspect));
    }
    function presentDistance() {
        const fw = B.portrait ? 0.9 : 0.86, fh = B.portrait ? 0.78 : 0.74;
        return fitDistance(B.W / fw, B.H / fh);
    }

    const _cp = new V3(), _ct = new V3(), _dir = new V3();
    function viewPose(view, outPos, outTgt) {
        if (view === 'present') {
            const p = L.present;
            outTgt.set(p.x, p.cy, p.z);
            outPos.set(p.x, p.cy, p.z + presentDistance());
            return;
        }
        outTgt.set(view.tgt[0], view.tgt[1], view.tgt[2]);
        _dir.set(view.dir[0], view.dir[1], view.dir[2]).normalize();
        outPos.copy(outTgt).addScaledVector(_dir, fitDistance(view.fit[0], view.fit[1]));
    }
    const _ap = new V3(), _at = new V3(), _bp = new V3(), _bt = new V3();
    function cameraAt(t) {
        const cs = TL.cams;
        let i = 1;
        while (i < cs.length - 1 && t > cs[i].t) i++;
        const a = cs[i - 1], b = cs[i];
        const u = ease(clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1));
        viewPose(a.view, _ap, _at);
        viewPose(b.view, _bp, _bt);
        _cp.lerpVectors(_ap, _bp, u);
        _ct.lerpVectors(_at, _bt, u);
        // Arc the move outwards a little so the camera glides rather than slides.
        if (a.view !== b.view) {
            const lift = Math.sin(u * PI) * 0.12 * _ap.distanceTo(_bp);
            _cp.y += lift * 0.35;
        }
        camera.position.copy(_cp);
        camera.lookAt(_ct);
    }

    /* ------------------------------------------------------------------ */
    /* HTML cards mapped onto the board faces                              */
    /* ------------------------------------------------------------------ */

    const cardEls = [[null, null], [null, null]];
    document.querySelectorAll('.card[data-board]').forEach(el => {
        cardEls[+el.dataset.board - 1][el.dataset.side === 'B' ? 1 : 0] = el;
    });
    let cardW = 0, cardH = 0;
    const statusEl = document.getElementById('cell-status');
    const heroEl = document.getElementById('hero-copy');
    const hintEl = document.getElementById('scroll-hint');
    const progressEl = document.getElementById('progress-bar');

    function sizeCards() {
        const d = presentDistance();
        const vh = stage.clientHeight;
        cardH = B.H / (2 * d * TAN) * vh;
        cardW = cardH * B.W / B.H;
        const fs = cardH * (B.portrait ? 0.0262 : 0.0242);
        cardEls.flat().forEach(el => {
            if (!el) return;
            el.style.width = cardW + 'px';
            el.style.height = cardH + 'px';
            el.style.fontSize = fs + 'px';
        });
        root.classList.toggle('portrait', B.portrait);
        root.classList.toggle('landscape', !B.portrait);
    }

    const _c = [new V3(), new V3(), new V3(), new V3()];
    const _n = new V3(), _toCam = new V3(), _center = new V3(), _q = new THREE.Quaternion();
    function projectCard(el, board, side, opacity) {
        if (opacity <= 0.001) {
            if (el.style.opacity !== '0') { el.style.opacity = '0'; el.style.visibility = 'hidden'; }
            return;
        }
        const { W, H } = B;
        const z = (side === 0 ? 1 : -1) * (BOARD_T / 2 + 0.002);
        const sx = side === 0 ? 1 : -1;
        _c[0].set(-W / 2 * sx, H / 2, z);
        _c[1].set(W / 2 * sx, H / 2, z);
        _c[2].set(W / 2 * sx, -H / 2, z);
        _c[3].set(-W / 2 * sx, -H / 2, z);
        const w = stage.clientWidth, h = stage.clientHeight;
        const pts = [];
        for (const c of _c) {
            c.applyMatrix4(board.matrixWorld);
            const camSpace = c.clone().applyMatrix4(camera.matrixWorldInverse);
            if (camSpace.z > -0.05) { el.style.opacity = '0'; el.style.visibility = 'hidden'; return; }
            c.project(camera);
            pts.push([(c.x + 1) / 2 * w, (1 - c.y) / 2 * h]);
        }
        el.style.transform = homography(cardW, cardH, pts);
        el.style.opacity = opacity.toFixed(3);
        el.style.visibility = 'visible';
    }

    // Maps the card rectangle (0,0)-(w,h) onto a screen-space quad.
    function homography(w, h, p) {
        const [x0, y0] = p[0], [x1, y1] = p[1], [x2, y2] = p[2], [x3, y3] = p[3];
        const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
        const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
        const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
        const g = (sx * dy2 - dx2 * sy) / det;
        const k = (dx1 * sy - sx * dy1) / det;
        const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, c = x0;
        const d = y1 - y0 + g * y1, e = y3 - y0 + k * y3, f = y0;
        const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, c, f, 0, 1];
        return 'matrix3d(' + m.map(x => +x.toFixed(9)).join(',') + ')';
    }

    /* ------------------------------------------------------------------ */
    /* Scroll                                                              */
    /* ------------------------------------------------------------------ */

    let beatPx = 400;
    function layoutTrack() {
        const vh = stage.clientHeight;
        beatPx = Math.round(vh * (B.portrait ? 0.62 : 0.55));
        track.style.height = (TL.total * beatPx + vh) + 'px';
    }
    function targetT() {
        const y = window.scrollY - track.offsetTop;
        return clamp(y / beatPx, 0, TL.total);
    }

    window.CELL = {
        scrollToMark(name) {
            if (!TL || TL.marks[name] === undefined) return false;
            const y = track.offsetTop + TL.marks[name] * beatPx + 2;
            window.scrollTo({ top: y, behavior: 'smooth' });
            return true;
        },
        get marks() { return TL ? TL.marks : {}; },
        debugSet(t) { cur = t; forceT = t; dirty = true; }
    };

    /* ------------------------------------------------------------------ */
    /* Frame                                                               */
    /* ------------------------------------------------------------------ */

    let lastW = 0, lastH = 0;
    function resize(force) {
        const w = stage.clientWidth, h = stage.clientHeight;
        if (!force && w === lastW && Math.abs(h - lastH) < 2) return;
        lastW = w; lastH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const dims = boardDims();
        if (!B || dims.portrait !== B.portrait) {
            const keep = TL ? cur / TL.total : 0;
            B = dims;
            buildCell();
            cur = keep * TL.total;
        }
        layoutTrack();
        sizeCards();
        dirty = true;
    }

    let cur = 0, forceT = null, dirty = true, lastFrame = performance.now(), lastStatus = '';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    function frame(now) {
        requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;
        resize(false);
        const tgt = forceT !== null ? forceT : targetT();
        const k = reduce ? 1 : 1 - Math.exp(-dt * 5.5);
        const next = Math.abs(tgt - cur) < 0.0005 ? tgt : lerp(cur, tgt, k);
        if (next === cur && !dirty) return;
        cur = next;
        dirty = false;
        render(cur, Math.abs(tgt - cur) < 0.03);
    }

    function render(t, settled) {
        applyJoints(robotAt(t));
        setJaw(jawAt(t));
        cameraAt(t);
        robot.updateMatrixWorld(true);

        TL.boards.forEach((bt, i) => {
            const b = boards[i];
            const attached = t >= bt.attach && t < bt.release;
            if (attached !== b.attached || !b.placed) {
                b.attached = attached;
                b.placed = true;
                if (attached) {
                    boardMount.add(b.group);
                    b.group.position.set(0, 0, 0);
                    b.group.rotation.set(0, 0, 0);
                } else {
                    scene.add(b.group);
                }
            }
            if (!attached) {
                const rest = t < bt.attach ? bt.rest[0] : bt.rest[1];
                b.group.position.copy(rest.pos);
                b.group.rotation.set(0, rest.yaw, 0);
            }
        });
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);

        TL.boards.forEach((bt, i) => {
            const b = boards[i].group;
            b.getWorldPosition(_center);
            b.getWorldQuaternion(_q);
            _toCam.copy(camera.position).sub(_center).normalize();
            [0, 1].forEach(side => {
                _n.set(0, 0, side === 0 ? 1 : -1).applyQuaternion(_q);
                const facing = _n.dot(_toCam);
                const [a, z] = bt.faces[side];
                const win = sstep(a, a + 0.35, t) * (1 - sstep(z - 0.35, z, t));
                const op = win * sstep(0.55, 0.9, facing);
                const el = cardEls[i][side];
                const cardOp = sstep(0.4, 1, op);
                if (el) {
                    projectCard(el, b, side, cardOp);
                    el.classList.toggle('live', cardOp > 0.97 && settled);
                }
                b.userData.labels[side].material.opacity = 1 - sstep(0, 0.4, op);
            });
        });

        const heroOp = 1 - sstep(0.05, 0.45, t);
        heroEl.style.opacity = heroOp.toFixed(3);
        heroEl.style.transform = `translate3d(0, ${(-t * 60).toFixed(1)}px, 0)`;
        heroEl.style.visibility = heroOp < 0.01 ? 'hidden' : 'visible';
        if (hintEl) hintEl.style.opacity = (1 - sstep(0.02, 0.2, t)).toFixed(3);
        if (progressEl) progressEl.style.transform = `scaleX(${(t / TL.total).toFixed(4)})`;
        const s = statusAt(t);
        if (statusEl && s !== lastStatus) {
            lastStatus = s;
            statusEl.querySelector('span').textContent = s;
        }
        if (statusEl) statusEl.style.opacity = (sstep(0.3, 0.6, t) * (1 - sstep(TL.total - 0.5, TL.total, t))).toFixed(3);
        root.style.setProperty('--end-fade', sstep(TL.marks.end - 0.4, TL.marks.end + 0.4, t).toFixed(3));

        renderer.render(scene, camera);
    }

    resize(true);
    // Jump straight to where the page already is (reload mid-scroll).
    cur = targetT();
    render(cur, true);
    requestAnimationFrame(frame);
    root.classList.add('cell-ready');
})();

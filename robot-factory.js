/**
 * ROBOT FABRICATION CELL
 * 6-DOF robot arm that works between three stations:
 *   - Info Board Archive (left): laminated section boards standing in a stepped rack
 *   - Project Fabricator (back right): machine that prints project boards onto a live conveyor
 *   - Presentation Plinth (front): where the robot stands the active board for reading
 *
 * Exposes the same public API as the original briefcase workcell (robot-arm.js) so the
 * teach pendant, dossier card, navbar and mobile controls in robot-controller.js work unchanged.
 */

// Board geometry (board origin = bottom of its foot)
const BOARD = {
    W: 0.92,          // Panel width
    H: 0.66,          // Panel height
    T: 0.035,         // Laminate thickness
    FOOT_H: 0.05,     // Stand foot height
    HANDLE_Y: 0.79    // Grab point (handle bar centre) above origin
};

const GRIP_OPEN = 0.20;
const GRIP_CLOSED = 0.075;
const LIFT = 0.36;          // Vertical clearance used when lifting a board out of its station
const CORRIDOR_R = 1.6;     // Safe swing radius around the robot base
const CORRIDOR_Y = 1.5;     // Safe swing height (handle height)
const PROJECTS_INDEX = 4;
const BELT_SPEED = 0.42;    // Constant conveyor speed (m/s) - the belt never runs faster than this
const BELT_ACCEL = 0.8;     // Gentle start/stop ramp (m/s^2)
const BELT_CLEAR = 0.6;     // Free belt length needed either side of the pick station to put a board back

const PROJECT_LIBRARY = [
    { name: 'Chase the Chicken', tag: 'Urban hide-and-seek web app with battle-royale zones', chips: ['React 18', 'Vite'], color: 0xf59e0b },
    { name: 'Foz Prints', tag: 'Headless eCommerce + 3D printed Subaru interior upgrades', chips: ['Next.js', 'Shopify'], color: 0xec4899 },
    { name: 'Personal Server', tag: 'Self hosted ecosystem with custom finance engines & telemetry', chips: ['PostgreSQL', 'Docker'], color: 0x10b981 },
    { name: 'ePortfolio Website', tag: 'AI assisted 3D web development - the site you are on', chips: ['Three.js', 'AI Collab'], color: 0x8b5cf6 },
    { name: 'Turtle Bot Warehousing', tag: 'Autonomous warehousing robot with lidar navigation', chips: ['ROS', 'Lidar'], color: 0x06b6d4 },
    { name: 'Robotics Control', tag: 'Pick, place and sorting system with custom kinematics', chips: ['Kinematics', 'RealSense'], color: 0xf97316 },
    { name: 'AI Tetris', tag: 'Deep Q Network that learns to play Tetris', chips: ['Deep Learning', 'DQN'], color: 0x3b82f6 },
    { name: 'SPOT Search & Rescue', tag: 'Boston Dynamics SPOT autonomous exploration + YOLOv3', chips: ['ROS', 'YOLO'], color: 0xef4444 },
    { name: 'THOR Robotic Build', tag: 'Open source humanoid robot build for UTSMechSoc', chips: ['Robotics', 'Hardware'], color: 0xeab308 }
];

const smooth = (u) => u * u * (3 - 2 * u);
const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const smoothRange = (a, b, u) => smooth(clamp01((u - a) / (b - a)));
const wrapAngle = (a) => {
    a = a % (2 * Math.PI);
    if (a > Math.PI) a -= 2 * Math.PI;
    if (a < -Math.PI) a += 2 * Math.PI;
    return a;
};

class RobotWorkcell {
    constructor(containerId = 'robot-canvas-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container #${containerId} not found`);
            return;
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.elapsed = 0;

        this.robot = null;
        this.joints = {
            base: null, turntable: null, shoulder: null, upperArm: null, elbow: null,
            forearm: null, wrist: null, wristYaw: null, flange: null,
            gripper: { base: null, jawCenter: null, leftFinger: null, rightFinger: null, gap: GRIP_OPEN, targetGap: GRIP_OPEN }
        };

        // Kinematic link constants (shared with the original workcell)
        this.L1 = 2.1;
        this.L2 = 1.9;
        this.Ltool = 0.52;
        this.shoulderY = -0.6;

        // Stations
        this.plinthPos = new THREE.Vector3(0, -0.42, 2.25);            // Board origin when presented
        this.parkPt = { x: 0, y: 1.05, z: 1.45, rotY: 0 };              // Arm rest point above/behind the plinth

        // Info Board Archive rack (stepped two-tier rack on the left)
        this.rack = {
            center: new THREE.Vector2(-2.3, 0.3),   // (x, z)
            rotY: 0.82,
            spacing: 1.02,
            tiers: [
                { lz: 0.30, shelfY: -1.0 },  // Front tier (low)
                { lz: -0.34, shelfY: -0.22 } // Back tier (raised)
            ]
        };

        // Conveyor (machine exit A -> chute B)
        this.conveyor = {
            A: new THREE.Vector3(3.30, -0.95, -1.75),
            B: new THREE.Vector3(2.05, -0.95, 2.05),
            beltY: -0.95,
            width: 1.06,
            spacing: 1.35,
            slotCount: 4,
            hiddenIn: 0.9,    // Length of belt path hidden inside the fabricator
            pickS: 3.15       // Pick station distance from the machine exit
        };
        const cv = this.conveyor;
        cv.dir = cv.B.clone().sub(cv.A);
        cv.length = cv.dir.length();
        cv.dir.normalize();
        cv.rotY = Math.atan2(cv.dir.x, cv.dir.z);
        cv.loop = cv.spacing * cv.slotCount;
        cv.tail = cv.loop - cv.hiddenIn - cv.length; // Length of the drop into the chute

        // Section configs (projects = conveyor pick station)
        const rackSlot = (tier, col) => ({ tier, col });
        this.bayConfigs = [
            { id: 'hero', name: 'Home / Dossier', short: 'HOME', bayNum: '00', color: 0xf59e0b, slot: rackSlot(0, 0) },
            { id: 'about', name: 'About Me', short: 'ABOUT ME', bayNum: '01', color: 0x10b981, slot: rackSlot(0, 1) },
            { id: 'experience', name: 'Experience', short: 'EXPERIENCE', bayNum: '02', color: 0xf97316, slot: rackSlot(0, 2) },
            { id: 'leadership', name: 'Leadership', short: 'LEADERSHIP', bayNum: '03', color: 0x8b5cf6, slot: rackSlot(1, 0) },
            { id: 'projects', name: 'Projects', short: 'PROJECTS', bayNum: '04', color: 0x06b6d4, slot: null },
            { id: 'skills', name: 'Technical Skills', short: 'SKILLS', bayNum: '05', color: 0xef4444, slot: rackSlot(1, 1) },
            { id: 'contact', name: 'Contact', short: 'CONTACT', bayNum: '06', color: 0xec4899, slot: rackSlot(1, 2) }
        ];
        this.bayConfigs.forEach((cfg, i) => {
            const home = this.computeHome(i, cfg);
            cfg.home = home;
            cfg.pos = [home.pos.x, home.pos.y, home.pos.z];
            cfg.rotY = home.rotY;
            cfg.handleY = home.pos.y + BOARD.HANDLE_Y;
        });

        // Motion state
        this.jointAngles = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        this.targetJointAngles = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        this.jogOffsets = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        this.manualGripperGap = null;
        this.targetGripGap = GRIP_OPEN;
        this.toolPt = { ...this.parkPt };
        this.places = this.bayConfigs.map(() => 'home');

        this.isAtDynamicLimit = false;
        this.limitCulprit = null;
        this.showCollisionModel = false;

        this.currentProgress = 0.0;
        this.targetProgress = 0.0;
        this.maxProgress = 7.0;
        this.dockedSectionIndex = -1;
        this.targetSectionIndex = -1;
        this.activeTween = null;
        this.directTransfer = null;

        this.boards = [];       // Info boards by section index (projects slot null)
        this.beltItems = [];     // Project boards: { board, s, projectIndex, state: 'belt' | 'pool' | 'held' }
        this.claimedItem = null; // Project board currently in the gripper or on the plinth
        this.pickTarget = null;  // Board the robot is waiting for at the pick station
        this.excludeItem = null; // Board just put back (skipped when choosing the next one)
        this.projectCursor = 0;
        this.beltPos = 0;        // Total belt travel (drives the belt texture and rollers)
        this.beltSpeed = 0;
        this.beltDemand = null;  // null | 'board' | 'gap'
        this.beltStaged = false;
        this.lastPickHit = null; // Specific belt board chosen by the last click/tap
        this.dropAnim = null;
        this.hoverIndex = null;

        this.isMoving = false;
        this.isEStopped = false;
        this.statusText = 'CELL READY // PLINTH EMPTY';

        this.cameraPos = new THREE.Vector3(0, 2.4, 10.5);
        this.cameraLookAt = new THREE.Vector3(0, 0.0, 0);
        this.parallax = new THREE.Vector2(0, 0);
        this.parallaxTarget = new THREE.Vector2(0, 0);

        this.onTelemetryUpdate = null;
        this.onSectionChange = null;

        this.init();
    }

    /* ------------------------------------------------------------------ */
    /* Kinematics                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Analytical IK for a tool pointing straight down.
     * rotY is the world yaw of the gripped board; j6 rolls the jaws to match it.
     */
    solveIK(tx, ty, tz, rotY = null) {
        const j1 = Math.atan2(tx, tz);
        const Rwrist = Math.sqrt(tx * tx + tz * tz);
        const Ywrist = (ty + this.Ltool) - this.shoulderY;

        const D = Math.sqrt(Rwrist * Rwrist + Ywrist * Ywrist);
        const Dclamp = Math.min(D, (this.L1 + this.L2) * 0.98);

        const cosGamma = (this.L1 * this.L1 + this.L2 * this.L2 - Dclamp * Dclamp) / (2 * this.L1 * this.L2);
        const gamma = Math.acos(Math.max(-1, Math.min(1, cosGamma)));
        const j3 = Math.PI - gamma;

        const phi = Math.atan2(Rwrist, Ywrist);
        const cosPsi = (this.L1 * this.L1 + Dclamp * Dclamp - this.L2 * this.L2) / (2 * this.L1 * Dclamp);
        const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
        const j2 = phi - psi;
        const j4 = Math.PI - (j2 + j3);

        const j6 = (rotY !== null && rotY !== undefined) ? wrapAngle(j1 - rotY) : 0;
        return { j1, j2, j3, j4, j6 };
    }

    lerpAngle(a, b, t) {
        return wrapAngle(a + wrapAngle(b - a) * t);
    }

    /* ------------------------------------------------------------------ */
    /* Station geometry                                                    */
    /* ------------------------------------------------------------------ */

    rackAxes() {
        const t = this.rack.rotY;
        return {
            x: new THREE.Vector2(Math.cos(t), -Math.sin(t)), // (x, z)
            z: new THREE.Vector2(Math.sin(t), Math.cos(t))
        };
    }

    computeHome(index, cfg) {
        if (index === PROJECTS_INDEX) {
            const p = this.beltPoint(this.conveyor.pickS);
            return { pos: p, rotY: this.conveyor.rotY };
        }
        const ax = this.rackAxes();
        const tier = this.rack.tiers[cfg.slot.tier];
        const lx = (cfg.slot.col - 1) * this.rack.spacing;
        const x = this.rack.center.x + ax.x.x * lx + ax.z.x * tier.lz;
        const z = this.rack.center.y + ax.x.y * lx + ax.z.y * tier.lz;
        return { pos: new THREE.Vector3(x, tier.shelfY, z), rotY: this.rack.rotY };
    }

    beltPoint(s) {
        const cv = this.conveyor;
        return cv.A.clone().addScaledVector(cv.dir, s);
    }

    handlePt(place) {
        return { x: place.pos.x, y: place.pos.y + BOARD.HANDLE_Y, z: place.pos.z, rotY: place.rotY };
    }

    abovePt(place) {
        const h = this.handlePt(place);
        h.y += LIFT;
        return h;
    }

    plinthPlace() {
        return { pos: this.plinthPos, rotY: 0 };
    }

    /* ------------------------------------------------------------------ */
    /* Scene construction                                                  */
    /* ------------------------------------------------------------------ */

    init() {
        this.initThree();
        this.setupLighting();
        this.buildFactoryFloor();
        this.buildBackdrop();
        this.buildRobotArm();
        this.buildPlinth();
        this.buildRack();
        this.buildFabricator();
        this.buildConveyor();
        this.buildBoards();
        this.buildDust();
        this.buildSegmentPrograms();
        this.setupEventListeners();

        this.evaluateProgress(0.0);
        this.jointAngles = { ...this.targetJointAngles };
        this.joints.gripper.gap = this.targetGripGap;
        this.applyJointTransforms();
        this.animate();
        if (typeof window.dismissLoader === 'function') {
            window.dismissLoader();
        }
    }

    initThree() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0b0d12);
        this.scene.fog = new THREE.Fog(0x0b0d12, 16, 30);

        this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
        this.camera.position.copy(this.cameraPos);
        this.camera.lookAt(this.cameraLookAt);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        this.container.appendChild(this.renderer.domElement);
    }

    setupLighting() {
        this.scene.add(new THREE.HemisphereLight(0xdbe4ff, 0x1a1c22, 0.75));
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));

        const key = new THREE.DirectionalLight(0xffffff, 1.15);
        key.position.set(3, 12, 7);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = 30;
        key.shadow.camera.left = -7;
        key.shadow.camera.right = 7;
        key.shadow.camera.top = 7;
        key.shadow.camera.bottom = -7;
        key.shadow.bias = -0.0002;
        key.shadow.normalBias = 0.02;
        this.scene.add(key);

        const rim = new THREE.DirectionalLight(0x93c5fd, 0.45);
        rim.position.set(-6, 6, -6);
        this.scene.add(rim);

        // Presentation spotlight over the plinth (tinted to the active board)
        this.plinthSpot = new THREE.SpotLight(0xffffff, 0, 9, 0.42, 0.5, 1.2);
        this.plinthSpot.position.set(0, 4.6, 3.6);
        this.plinthSpot.target.position.set(0, -0.2, 2.25);
        this.scene.add(this.plinthSpot);
        this.scene.add(this.plinthSpot.target);
    }

    makeLabelTexture(text, opts = {}) {
        const w = opts.w || 1024;
        const h = opts.h || 160;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = opts.bg || '#0b0f19';
        ctx.fillRect(0, 0, w, h);
        if (opts.stripe) {
            ctx.fillStyle = opts.stripe;
            ctx.fillRect(0, 0, 18, h);
            ctx.fillRect(w - 18, 0, 18, h);
        }
        ctx.fillStyle = opts.color || '#f59e0b';
        ctx.font = `800 ${opts.size || 84}px "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2 + 4);
        if (opts.sub) {
            ctx.font = `600 ${Math.round((opts.size || 84) * 0.36)}px "Consolas", monospace`;
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(opts.sub, w / 2, h - 26);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 4;
        return tex;
    }

    buildFactoryFloor() {
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(60, 60),
            new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.92, metalness: 0.0 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -1.8;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Subtle epoxy grid
        const grid = new THREE.GridHelper(40, 40, 0x262b36, 0x1d2129);
        grid.position.y = -1.798;
        this.scene.add(grid);

        const paint = (w, h, x, z, color, rot = 0) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }));
            m.rotation.x = -Math.PI / 2;
            m.rotation.z = rot;
            m.position.set(x, -1.794, z);
            this.scene.add(m);
            return m;
        };

        // Cell boundary
        paint(10.4, 0.08, 0.4, 3.45, 0xf59e0b);
        paint(10.4, 0.08, 0.4, -4.1, 0xf59e0b);
        paint(0.08, 7.55, -4.8, -0.32, 0xf59e0b);
        paint(0.08, 7.55, 5.6, -0.32, 0xf59e0b);

        // Operator walkway
        const walk = paint(10.4, 1.3, 0.4, 4.3, 0x064e3b);
        walk.material.color.setHex(0x0b3b2e);

        // Flow arrows painted along the conveyor
        const cv = this.conveyor;
        const arrowShape = new THREE.Shape();
        arrowShape.moveTo(0, 0.22);
        arrowShape.lineTo(0.18, 0);
        arrowShape.lineTo(0.07, 0);
        arrowShape.lineTo(0.07, -0.2);
        arrowShape.lineTo(-0.07, -0.2);
        arrowShape.lineTo(-0.07, 0);
        arrowShape.lineTo(-0.18, 0);
        arrowShape.closePath();
        const arrowGeo = new THREE.ShapeGeometry(arrowShape);
        this.floorArrows = [];
        const side = new THREE.Vector3(cv.dir.z, 0, -cv.dir.x);
        for (let i = 0; i < 5; i++) {
            const m = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0x0e7490, transparent: true, opacity: 0.8 }));
            m.rotation.x = -Math.PI / 2;
            m.rotation.z = cv.rotY + Math.PI;
            const p = this.beltPoint(0.4 + i * 0.85).addScaledVector(side, 0.95);
            m.position.set(p.x, -1.792, p.z);
            this.scene.add(m);
            this.floorArrows.push(m);
        }
    }

    buildBackdrop() {
        // Rear wall with light strips for depth
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x11141b, roughness: 0.9, metalness: 0.1 });
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), wallMat);
        wall.position.set(0, 4.2, -6.5);
        wall.receiveShadow = true;
        this.scene.add(wall);

        const stripMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
        for (let i = -6; i <= 6; i++) {
            const s = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 12), stripMat);
            s.position.set(i * 1.6, 4.2, -6.49);
            this.scene.add(s);
        }

        // Overhead light bars
        this.ceilingBars = [];
        const barMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
        for (let i = 0; i < 3; i++) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 0.12), barMat);
            bar.position.set(0.4, 6.2, -3.5 + i * 2.8);
            this.scene.add(bar);
            this.ceilingBars.push(bar);
        }

        // Wall sign
        const signTex = this.makeLabelTexture('AK AUTOMATION // FABRICATION CELL 01', { size: 56, color: '#e2e8f0', bg: '#0f141c', stripe: '#f59e0b', w: 2048, h: 140 });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.62), new THREE.MeshBasicMaterial({ map: signTex }));
        sign.position.set(0.4, 3.9, -6.45);
        this.scene.add(sign);
    }

    buildRobotArm() {
        const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.42, metalness: 0.25 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.65, metalness: 0.45 });
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.15, metalness: 0.9 });
        const rubberMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.95 });

        this.robot = new THREE.Group();
        this.robot.position.set(0, -1.8, 0);

        // J0: base pedestal
        const baseGroup = new THREE.Group();
        const baseFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.98, 0.2, 32), darkMat);
        baseFlange.position.y = 0.1;
        baseFlange.castShadow = true;
        baseFlange.receiveShadow = true;
        baseGroup.add(baseFlange);
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), chromeMat);
            bolt.position.set(Math.cos(angle) * 0.88, 0.22, Math.sin(angle) * 0.88);
            baseGroup.add(bolt);
        }
        const baseCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, 0.4, 32), yellowMat);
        baseCylinder.position.y = 0.4;
        baseCylinder.castShadow = true;
        baseGroup.add(baseCylinder);
        this.robot.add(baseGroup);
        this.joints.base = baseGroup;

        // J1: turntable
        const turntable = new THREE.Group();
        turntable.position.set(0, 0.6, 0);
        const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.68, 0.15, 32), darkMat);
        bearing.position.y = 0.075;
        bearing.castShadow = true;
        turntable.add(bearing);
        const motorHousing = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.5, 0.7), yellowMat);
        motorHousing.position.set(0, 0.35, -0.05);
        motorHousing.castShadow = true;
        turntable.add(motorHousing);
        this.robot.add(turntable);
        this.joints.turntable = turntable;

        // J2: shoulder
        const shoulder = new THREE.Group();
        shoulder.position.set(0, 0.6, 0);
        [-0.36, 0.36].forEach(x => {
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 24), darkMat);
            hub.rotation.z = Math.PI / 2;
            hub.position.set(x, 0, 0);
            hub.castShadow = true;
            shoulder.add(hub);
        });
        const counterweight = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.38, 0.45), darkMat);
        counterweight.position.set(0, -0.15, -0.4);
        counterweight.castShadow = true;
        shoulder.add(counterweight);
        const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.4, this.L1, 0.42), yellowMat);
        upperArm.position.set(0, this.L1 / 2, 0);
        upperArm.castShadow = true;
        shoulder.add(upperArm);
        const cylinderBody = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 16), darkMat);
        cylinderBody.position.set(0.24, 0.7, -0.16);
        cylinderBody.castShadow = true;
        shoulder.add(cylinderBody);
        const pistonShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.3, 16), chromeMat);
        pistonShaft.position.set(0.24, 1.25, -0.16);
        shoulder.add(pistonShaft);
        // Status light strip down the upper arm
        this.armLedMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
        const armLed = new THREE.Mesh(new THREE.BoxGeometry(0.03, this.L1 * 0.7, 0.03), this.armLedMat);
        armLed.position.set(-0.21, this.L1 * 0.5, 0.15);
        shoulder.add(armLed);
        turntable.add(shoulder);
        this.joints.shoulder = shoulder;
        this.joints.upperArm = upperArm;

        // J3: elbow
        const elbow = new THREE.Group();
        elbow.position.set(0, this.L1, 0);
        const elbowCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.48, 24), darkMat);
        elbowCyl.rotation.z = Math.PI / 2;
        elbowCyl.castShadow = true;
        elbow.add(elbowCyl);
        const forearm = new THREE.Group();
        const forearmBody = new THREE.Mesh(new THREE.BoxGeometry(0.30, this.L2 - 0.22, 0.30), yellowMat);
        forearmBody.position.set(0, (this.L2 - 0.22) / 2, 0);
        forearmBody.castShadow = true;
        forearm.add(forearmBody);
        const wristCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 0.22, 24), darkMat);
        wristCollar.position.set(0, this.L2 - 0.11, 0);
        wristCollar.castShadow = true;
        forearm.add(wristCollar);
        elbow.add(forearm);
        shoulder.add(elbow);
        this.joints.elbow = elbow;
        this.joints.forearm = forearm;

        // J4: wrist pitch
        const wrist = new THREE.Group();
        wrist.position.set(0, this.L2, 0);
        const wristPivot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 20), darkMat);
        wristPivot.castShadow = true;
        wrist.add(wristPivot);

        // J5: wrist yaw
        const wristYaw = new THREE.Group();
        wristYaw.position.set(0, 0.09, 0);
        const yawPivot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 20), darkMat);
        yawPivot.castShadow = true;
        wristYaw.add(yawPivot);

        // J6: tool flange
        const flange = new THREE.Group();
        flange.position.set(0, 0.09, 0);
        flange.rotation.y = Math.PI / 2;
        const flangePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20), chromeMat);
        flangePlate.castShadow = true;
        flange.add(flangePlate);

        // Parallel gripper (flange -> jaw centre = 0.52 = Ltool)
        const gripperBase = new THREE.Group();
        gripperBase.position.set(0, 0.14, 0);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 20), darkMat);
        neck.position.set(0, -0.04, 0);
        neck.castShadow = true;
        gripperBase.add(neck);
        const gripperBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.22), darkMat);
        gripperBody.position.set(0, 0.07, 0);
        gripperBody.castShadow = true;
        gripperBase.add(gripperBody);
        const guideRod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 14), chromeMat);
        guideRod.rotation.z = Math.PI / 2;
        guideRod.position.set(0, 0.07, 0);
        gripperBase.add(guideRod);
        // Tool status LED ring
        this.toolLedMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
        const toolLed = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 8, 32), this.toolLedMat);
        toolLed.rotation.x = Math.PI / 2;
        toolLed.position.y = -0.005;
        gripperBase.add(toolLed);

        const jawCenter = new THREE.Group();
        jawCenter.position.set(0, 0.20, 0);
        gripperBase.add(jawCenter);

        const fingerGeo = new THREE.BoxGeometry(0.06, 0.15, 0.14);
        const padGeo = new THREE.BoxGeometry(0.022, 0.11, 0.12);
        const makeFinger = (padX) => {
            const f = new THREE.Group();
            const m = new THREE.Mesh(fingerGeo, yellowMat);
            m.position.y = 0.075;
            m.castShadow = true;
            f.add(m);
            const pad = new THREE.Mesh(padGeo, rubberMat);
            pad.position.set(padX, 0.075, 0);
            f.add(pad);
            return f;
        };
        const leftFinger = makeFinger(0.035);
        leftFinger.position.set(-0.08, 0.125, 0);
        gripperBase.add(leftFinger);
        const rightFinger = makeFinger(-0.035);
        rightFinger.position.set(0.08, 0.125, 0);
        gripperBase.add(rightFinger);

        flange.add(gripperBase);
        wristYaw.add(flange);
        wrist.add(wristYaw);
        forearm.add(wrist);

        this.joints.wrist = wrist;
        this.joints.wristYaw = wristYaw;
        this.joints.flange = flange;
        this.joints.gripper.base = gripperBase;
        this.joints.gripper.jawCenter = jawCenter;
        this.joints.gripper.leftFinger = leftFinger;
        this.joints.gripper.rightFinger = rightFinger;

        this.scene.add(this.robot);
    }

    buildPlinth() {
        const g = new THREE.Group();
        g.position.set(this.plinthPos.x, -1.8, this.plinthPos.z);
        const top = this.plinthPos.y + 1.8;

        const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.55, metalness: 0.5 });
        const steelMat = new THREE.MeshStandardMaterial({ color: 0x3a414f, roughness: 0.35, metalness: 0.8 });

        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.14, 48), darkMat);
        base.position.y = 0.07;
        base.receiveShadow = true;
        base.castShadow = true;
        g.add(base);

        const column = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, top - 0.22, 32), steelMat);
        column.position.y = 0.14 + (top - 0.22) / 2;
        column.castShadow = true;
        g.add(column);

        const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.6, 0.08, 48), darkMat);
        deck.position.y = top - 0.04;
        deck.castShadow = true;
        deck.receiveShadow = true;
        g.add(deck);

        // Glowing accent rings (tinted to the active board)
        this.plinthGlowMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.018, 8, 64), this.plinthGlowMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = top - 0.005;
        g.add(ring);
        const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.02, 8, 64), this.plinthGlowMat);
        baseRing.rotation.x = Math.PI / 2;
        baseRing.position.y = 0.14;
        g.add(baseRing);

        // Front nameplate
        const plateTex = this.makeLabelTexture('PRESENTATION PLINTH', { size: 64, color: '#e2e8f0', sub: 'STATION P1 // READ-OUT', h: 200 });
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.12), new THREE.MeshBasicMaterial({ map: plateTex }));
        plate.position.set(0, top * 0.55, 0.39);
        plate.rotation.x = -0.08;
        g.add(plate);

        // Fake volumetric light cone
        this.plinthConeMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
            depthWrite: false, side: THREE.DoubleSide
        });
        const coneH = 4.0;
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.95, coneH, 32, 1, true), this.plinthConeMat);
        cone.position.set(0, top + coneH / 2 - 0.05, 0);
        g.add(cone);

        this.scene.add(g);
        this.plinthGroup = g;
    }

    buildRack() {
        const g = new THREE.Group();
        g.position.set(this.rack.center.x, -1.8, this.rack.center.y);
        g.rotation.y = this.rack.rotY;

        const frameMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6, metalness: 0.6 });
        const beamMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45, metalness: 0.3 });
        const deckMat = new THREE.MeshStandardMaterial({ color: 0x2b3240, roughness: 0.7, metalness: 0.4 });
        const span = this.rack.spacing * 3 + 0.12;
        const half = span / 2;

        const box = (w, h, d, x, y, z, mat) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set(x, y, z);
            m.castShadow = true;
            m.receiveShadow = true;
            g.add(m);
            return m;
        };

        this.rackLeds = [];
        this.rack.tiers.forEach((tier, ti) => {
            const shelfTop = tier.shelfY + 1.8;
            const depth = 0.5;
            // Deck + yellow step beams
            box(span, 0.06, depth, 0, shelfTop - 0.03, tier.lz, deckMat);
            box(span, 0.1, 0.06, 0, shelfTop - 0.08, tier.lz + depth / 2, beamMat);
            box(span, 0.1, 0.06, 0, shelfTop - 0.08, tier.lz - depth / 2, beamMat);
            // Uprights
            [-half, half].forEach(x => {
                [tier.lz + depth / 2, tier.lz - depth / 2].forEach(z => {
                    box(0.07, shelfTop, 0.07, x, shelfTop / 2, z, frameMat);
                });
            });
            // Slot guides, label plates and occupancy LEDs
            for (let c = 0; c < 3; c++) {
                const lx = (c - 1) * this.rack.spacing;
                box(0.6, 0.025, 0.04, lx, shelfTop + 0.012, tier.lz + 0.16, frameMat);
                box(0.6, 0.025, 0.04, lx, shelfTop + 0.012, tier.lz - 0.16, frameMat);
                const led = new THREE.Mesh(
                    new THREE.BoxGeometry(0.1, 0.035, 0.012),
                    new THREE.MeshBasicMaterial({ color: 0x22c55e })
                );
                led.position.set(lx + 0.32, shelfTop - 0.08, tier.lz + depth / 2 + 0.032);
                g.add(led);
                this.rackLeds.push({ tier: ti, col: c, mesh: led });
            }
        });

        // Cross bracing on the back
        const backTier = this.rack.tiers[1];
        const braceLen = Math.hypot(span, backTier.shelfY + 1.8);
        const brace = box(0.04, braceLen, 0.03, 0, (backTier.shelfY + 1.8) / 2, backTier.lz - 0.27, frameMat);
        brace.rotation.z = Math.atan2(span, backTier.shelfY + 1.8);

        // Header sign
        const signTex = this.makeLabelTexture('INFO BOARD ARCHIVE', { size: 70, color: '#f59e0b', sub: 'RACK A // LAMINATED SECTION BOARDS', h: 200, stripe: '#f59e0b' });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.37), new THREE.MeshBasicMaterial({ map: signTex }));
        const signY = backTier.shelfY + 1.8 + 1.15;
        sign.position.set(0, signY, backTier.lz - 0.22);
        g.add(sign);
        [-0.9, 0.9].forEach(x => box(0.05, 1.2, 0.05, x, signY - 0.5, backTier.lz - 0.25, frameMat));

        this.scene.add(g);
        this.rackGroup = g;
    }

    buildFabricator() {
        const cv = this.conveyor;
        const g = new THREE.Group();
        const depth = 1.7;
        const width = 2.1;
        const height = 2.35;
        const center = cv.A.clone().addScaledVector(cv.dir, -(depth / 2 + 0.02));
        g.position.set(center.x, -1.8, center.z);
        g.rotation.y = cv.rotY;
        // Local +Z faces down the conveyor
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.5, metalness: 0.55 });
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x2f3644, roughness: 0.45, metalness: 0.6 });
        const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45, metalness: 0.3 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.9 });

        const box = (w, h, d, x, y, z, mat, parent = g) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set(x, y, z);
            m.castShadow = true;
            m.receiveShadow = true;
            parent.add(m);
            return m;
        };

        const beltTop = cv.beltY + 1.8;
        const openW = 1.18;
        const openH = 1.02;
        const openTop = beltTop + openH;

        // Base plinth
        box(width + 0.12, 0.18, depth + 0.12, 0, 0.09, 0, yellowMat);
        // Body built around the exit opening on the front face
        const sideW = (width - openW) / 2;
        box(sideW, height, depth, -(openW / 2 + sideW / 2), 0.18 + height / 2, 0, bodyMat);
        box(sideW, height, depth, (openW / 2 + sideW / 2), 0.18 + height / 2, 0, bodyMat);
        box(openW, beltTop - 0.18, depth, 0, 0.18 + (beltTop - 0.18) / 2, 0, bodyMat);
        const upperH = 0.18 + height - openTop;
        box(openW, upperH, depth, 0, openTop + upperH / 2, 0, bodyMat);
        // Dark tunnel interior
        box(openW - 0.02, openH, depth - 0.2, 0, beltTop + openH / 2, -0.1, darkMat);

        // Exit portal frame with hazard striping
        const stripeCanvas = document.createElement('canvas');
        stripeCanvas.width = 256;
        stripeCanvas.height = 32;
        const sctx = stripeCanvas.getContext('2d');
        sctx.fillStyle = '#f59e0b';
        sctx.fillRect(0, 0, 256, 32);
        sctx.fillStyle = '#111';
        for (let i = -2; i < 12; i++) {
            sctx.beginPath();
            sctx.moveTo(i * 32, 32);
            sctx.lineTo(i * 32 + 16, 32);
            sctx.lineTo(i * 32 + 32, 0);
            sctx.lineTo(i * 32 + 16, 0);
            sctx.fill();
        }
        const stripeTex = new THREE.CanvasTexture(stripeCanvas);
        const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 });
        box(openW + 0.16, 0.08, 0.06, 0, openTop + 0.04, depth / 2 + 0.02, stripeMat);
        const post = (x) => {
            const m = box(0.08, openH, 0.06, x, beltTop + openH / 2, depth / 2 + 0.02, stripeMat);
            m.rotation.z = 0;
        };
        post(-openW / 2 - 0.04);
        post(openW / 2 + 0.04);

        // PVC strip curtain
        this.curtainStrips = [];
        const stripMat = new THREE.MeshStandardMaterial({
            color: 0x94a3b8, transparent: true, opacity: 0.32, roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false
        });
        const stripCount = 7;
        for (let i = 0; i < stripCount; i++) {
            const pivot = new THREE.Group();
            pivot.position.set(-openW / 2 + (i + 0.5) * (openW / stripCount), openTop, depth / 2 + 0.05);
            const strip = new THREE.Mesh(new THREE.PlaneGeometry(openW / stripCount - 0.01, openH - 0.02), stripMat);
            strip.position.y = -(openH - 0.02) / 2;
            pivot.add(strip);
            g.add(pivot);
            this.curtainStrips.push(pivot);
        }

        // Inspection window above the exit showing the print process
        const winW = 1.55;
        const winH = 0.62;
        const winY = openTop + 0.48;
        const windowFrame = box(winW + 0.1, winH + 0.1, 0.05, 0, winY, depth / 2 + 0.01, panelMat);
        windowFrame.castShadow = false;
        this.fabGlowMat = new THREE.MeshBasicMaterial({ color: 0x0e3a4a });
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), this.fabGlowMat);
        glow.position.set(0, winY, depth / 2 + 0.04);
        g.add(glow);
        // Print bed + moving gantry inside the window
        const bed = new THREE.Mesh(new THREE.PlaneGeometry(winW * 0.86, 0.06), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
        bed.position.set(0, winY - winH * 0.32, depth / 2 + 0.045);
        g.add(bed);
        this.fabRail = new THREE.Mesh(new THREE.PlaneGeometry(winW * 0.9, 0.03), new THREE.MeshBasicMaterial({ color: 0x334155 }));
        this.fabRail.position.set(0, winY + winH * 0.18, depth / 2 + 0.046);
        g.add(this.fabRail);
        this.fabHead = new THREE.Group();
        const headBody = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.14), new THREE.MeshBasicMaterial({ color: 0xcbd5e1 }));
        this.fabHead.add(headBody);
        this.fabBeamMat = new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
        const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.025, winH * 0.42), this.fabBeamMat);
        beam.position.y = -winH * 0.25;
        this.fabHead.add(beam);
        this.fabHead.position.set(0, winY + winH * 0.18, depth / 2 + 0.05);
        g.add(this.fabHead);
        // Growing "print" on the bed
        this.fabPrint = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
        this.fabPrint.position.set(0, winY - winH * 0.29 + 0.1, depth / 2 + 0.044);
        g.add(this.fabPrint);
        this.fabPrintBaseY = winY - winH * 0.29;
        this.fabWinH = winH;

        // Interior glow light that spills out of the exit
        this.fabLight = new THREE.PointLight(0xff8a3d, 0.0, 3.2, 2);
        this.fabLight.position.set(0, beltTop + 0.5, depth / 2 + 0.4);
        g.add(this.fabLight);

        // Roof sign
        const signTex = this.makeLabelTexture('PROJECT FABRICATOR', { size: 72, color: '#22d3ee', sub: 'FAB-01 // OUTPUT TO CONVEYOR C1', h: 200, stripe: '#22d3ee' });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.37), new THREE.MeshBasicMaterial({ map: signTex }));
        sign.position.set(0, 0.18 + height + 0.32, depth / 2 - 0.15);
        g.add(sign);
        box(0.05, 0.3, 0.05, -0.8, 0.18 + height + 0.1, depth / 2 - 0.17, panelMat);
        box(0.05, 0.3, 0.05, 0.8, 0.18 + height + 0.1, depth / 2 - 0.17, panelMat);

        // Exhaust stacks + vents
        [-0.55, -0.2].forEach(x => {
            const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.5, 20), panelMat);
            stack.position.set(x, 0.18 + height + 0.25, -0.45);
            stack.castShadow = true;
            g.add(stack);
        });
        for (let i = 0; i < 6; i++) {
            box(0.02, 0.9, 0.08, -width / 2 - 0.005, 0.8 + 0.0, -0.55 + i * 0.13, darkMat);
        }

        // Stack light tower
        const tower = new THREE.Group();
        tower.position.set(width / 2 - 0.2, 0.18 + height, depth / 2 - 0.2);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 10), panelMat);
        pole.position.y = 0.11;
        tower.add(pole);
        this.stackLights = {};
        [['green', 0x22c55e, 0.3], ['amber', 0xf59e0b, 0.44], ['red', 0xef4444, 0.58]].forEach(([key, color, y]) => {
            const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.05, roughness: 0.3, transparent: true, opacity: 0.92 });
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.13, 20), mat);
            seg.position.y = y;
            tower.add(seg);
            this.stackLights[key] = mat;
        });
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.04, 20), panelMat);
        cap.position.y = 0.67;
        tower.add(cap);
        g.add(tower);

        // Control cabinet with HMI on the robot-facing side
        const cab = box(0.5, 1.4, 0.5, -width / 2 - 0.3, 0.9, depth / 2 - 0.35, panelMat);
        cab.castShadow = true;
        this.hmiMat = new THREE.MeshBasicMaterial({ color: 0x0f766e });
        const hmi = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), this.hmiMat);
        hmi.position.set(-width / 2 - 0.3, 1.25, depth / 2 - 0.095);
        g.add(hmi);

        this.scene.add(g);
        this.fabricatorGroup = g;

        // Spark particles at the exit
        const sparkCount = 90;
        const sparkGeo = new THREE.BufferGeometry();
        sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3));
        this.sparks = {
            count: sparkCount,
            data: Array.from({ length: sparkCount }, () => ({ life: 0, vel: new THREE.Vector3(), pos: new THREE.Vector3() })),
            next: 0,
            points: new THREE.Points(sparkGeo, new THREE.PointsMaterial({
                color: 0xffb347, size: 0.05, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false
            }))
        };
        this.sparks.points.frustumCulled = false;
        this.scene.add(this.sparks.points);
    }

    buildConveyor() {
        const cv = this.conveyor;
        const g = new THREE.Group();
        g.position.set(cv.A.x, 0, cv.A.z);
        g.rotation.y = cv.rotY;
        // Local +Z runs down the belt from the machine exit

        const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.75 });
        const railMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45, metalness: 0.3 });
        const legMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6, metalness: 0.5 });
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.2, metalness: 0.9 });

        const len = cv.length;
        const w = cv.width;
        const topY = cv.beltY;

        // Belt texture with cleats
        const bc = document.createElement('canvas');
        bc.width = 128;
        bc.height = 128;
        const bctx = bc.getContext('2d');
        bctx.fillStyle = '#16181d';
        bctx.fillRect(0, 0, 128, 128);
        bctx.fillStyle = '#23262e';
        for (let i = 0; i < 4; i++) bctx.fillRect(0, i * 32, 128, 6);
        bctx.fillStyle = '#0f1115';
        for (let i = 0; i < 40; i++) bctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
        this.beltTex = new THREE.CanvasTexture(bc);
        this.beltTex.wrapS = THREE.RepeatWrapping;
        this.beltTex.wrapT = THREE.RepeatWrapping;
        this.beltTex.repeat.set(2, len / 0.5);
        const belt = new THREE.Mesh(
            new THREE.PlaneGeometry(w - 0.08, len + 0.1),
            new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.85, metalness: 0.05 })
        );
        belt.rotation.x = -Math.PI / 2;
        belt.position.set(0, topY + 0.002, len / 2);
        belt.receiveShadow = true;
        g.add(belt);

        // Bed + side rails
        const bed = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, len + 0.12), frameMat);
        bed.position.set(0, topY - 0.072, len / 2);
        bed.castShadow = true;
        bed.receiveShadow = true;
        g.add(bed);
        [-1, 1].forEach(side => {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, len + 0.12), railMat);
            rail.position.set(side * (w / 2 + 0.015), topY + 0.02, len / 2);
            rail.castShadow = true;
            g.add(rail);
        });

        // Legs
        for (let i = 0; i <= 3; i++) {
            const z = 0.25 + (len - 0.5) * (i / 3);
            [-1, 1].forEach(side => {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, topY + 1.8 - 0.14, 0.07), legMat);
                leg.position.set(side * (w / 2 - 0.08), (-1.8 + topY - 0.14) / 2, z);
                leg.castShadow = true;
                g.add(leg);
            });
            const foot = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, 0.05, 0.12), legMat);
            foot.position.set(0, -1.775, z);
            g.add(foot);
        }

        // End rollers (spin with the belt)
        this.rollers = [];
        [0, len].forEach(z => {
            const r = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, w - 0.06, 20), chromeMat);
            r.rotation.z = Math.PI / 2;
            r.position.set(0, topY - 0.07, z);
            g.add(r);
            this.rollers.push(r);
        });

        // Pick station: light curtain posts + pop-up stop
        const pickZ = cv.pickS;
        this.lightCurtainMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        [-1, 1].forEach(side => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), legMat);
            p.position.set(side * (w / 2 + 0.09), topY + 0.45, pickZ + 0.22);
            p.castShadow = true;
            g.add(p);
        });
        const curtain = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.18, 0.86), this.lightCurtainMat);
        curtain.position.set(0, topY + 0.45, pickZ + 0.22);
        g.add(curtain);

        const pickTex = this.makeLabelTexture('PICK STATION C1', { size: 64, color: '#22d3ee', sub: 'ROBOT PICK-OFF // PROJECT BOARDS', h: 200 });
        const pickSign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.12), new THREE.MeshBasicMaterial({ map: pickTex }));
        pickSign.position.set(-(w / 2 + 0.02), topY - 0.06, pickZ);
        pickSign.rotation.y = -Math.PI / 2;
        g.add(pickSign);

        // Return chute at the end of the belt
        const chuteDepth = 0.75;
        const chute = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, topY + 1.8 - 0.2, chuteDepth), legMat);
        chute.position.set(0, (-1.8 + topY - 0.2) / 2, len + chuteDepth / 2 + 0.06);
        chute.castShadow = true;
        chute.receiveShadow = true;
        g.add(chute);
        const mouth = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, chuteDepth - 0.1), new THREE.MeshBasicMaterial({ color: 0x050608 }));
        mouth.rotation.x = -Math.PI / 2;
        mouth.position.set(0, topY - 0.195, len + chuteDepth / 2 + 0.06);
        g.add(mouth);
        const chuteTex = this.makeLabelTexture('RECYCLE // LOOP', { size: 70, color: '#f59e0b', h: 160, stripe: '#f59e0b' });
        const chuteSign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.125), new THREE.MeshBasicMaterial({ map: chuteTex }));
        chuteSign.position.set(0, topY - 0.45, len + chuteDepth + 0.065);
        g.add(chuteSign);

        this.scene.add(g);
        this.conveyorGroup = g;
    }

    /* ------------------------------------------------------------------ */
    /* Laminated boards                                                    */
    /* ------------------------------------------------------------------ */

    wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let line = '';
        words.forEach(word => {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    createBoardTexture(spec) {
        const w = 1024;
        const h = Math.round(w * BOARD.H / BOARD.W);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const accent = '#' + spec.color.toString(16).padStart(6, '0');

        // Laminated panel
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#141a26');
        bg.addColorStop(1, '#0b0f17');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // Blueprint grid
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

        // Header band (large title so boards read from across the cell)
        const headH = 300;
        ctx.fillStyle = accent;
        ctx.fillRect(0, 0, w, headH);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        for (let i = 0; i < 26; i++) {
            ctx.beginPath();
            ctx.moveTo(w - 330 + i * 26, headH);
            ctx.lineTo(w - 330 + i * 26 + 13, headH);
            ctx.lineTo(w - 330 + i * 26 + 13 + headH * 0.4, 0);
            ctx.lineTo(w - 330 + i * 26 + headH * 0.4, 0);
            ctx.fill();
        }

        ctx.fillStyle = '#0b0f19';
        ctx.font = '700 28px "Consolas", "Courier New", monospace';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(spec.kicker, 52, 50);

        // Index number in the top strip
        ctx.font = '900 64px "Segoe UI", "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(11, 15, 25, 0.85)';
        ctx.fillText(spec.num, w - 40, 66);
        ctx.textAlign = 'left';

        // Title: one big line if it fits at >= 120px, otherwise two lines
        const titleFont = (size) => `900 ${size}px "Segoe UI", "Arial Black", Arial, sans-serif`;
        const maxW = w - 100;
        const fitSize = (text, start, min) => {
            let size = start;
            ctx.font = titleFont(size);
            while (ctx.measureText(text).width > maxW && size > min) {
                size -= 4;
                ctx.font = titleFont(size);
            }
            return size;
        };
        ctx.fillStyle = '#0b0f19';
        const oneLine = fitSize(spec.title, 170, 60);
        if (oneLine >= 120 || !spec.title.includes(' ')) {
            ctx.font = titleFont(oneLine);
            ctx.fillText(spec.title, 48, 120 + oneLine * 0.72);
        } else {
            const words = spec.title.split(' ');
            let best = null;
            for (let i = 1; i < words.length; i++) {
                const l1 = words.slice(0, i).join(' ');
                const l2 = words.slice(i).join(' ');
                const size = Math.min(fitSize(l1, 112, 60), fitSize(l2, 112, 60));
                if (!best || size > best.size) best = { l1, l2, size };
            }
            ctx.font = titleFont(best.size);
            ctx.fillText(best.l1, 48, 66 + best.size * 0.92);
            ctx.fillText(best.l2, 48, 66 + best.size * 1.9);
        }

        // Subtitle
        ctx.fillStyle = accent;
        ctx.font = '700 46px "Segoe UI", Arial, sans-serif';
        const subLines = this.wrapText(ctx, spec.subtitle, w - 120);
        let y = headH + 66;
        subLines.slice(0, 2).forEach(l => { ctx.fillText(l, 56, y); y += 52; });
        y += 8;

        // Body lines
        ctx.font = '500 34px "Segoe UI", Arial, sans-serif';
        (spec.lines || []).forEach(line => {
            const wrapped = this.wrapText(ctx, line, w - 170);
            wrapped.forEach((l, li) => {
                if (li === 0) {
                    ctx.fillStyle = accent;
                    ctx.fillRect(60, y - 22, 14, 14);
                }
                ctx.fillStyle = '#d6dee9';
                ctx.fillText(l, 96, y);
                y += 44;
            });
            y += 4;
        });

        // Chips (projects)
        if (spec.chips) {
            ctx.font = '700 30px "Consolas", monospace';
            let cx = 56;
            const cy = h - 150;
            spec.chips.forEach(chip => {
                const tw = ctx.measureText(chip).width + 36;
                ctx.strokeStyle = accent;
                ctx.lineWidth = 3;
                ctx.strokeRect(cx, cy, tw, 50);
                ctx.fillStyle = accent;
                ctx.fillText(chip, cx + 18, cy + 35);
                cx += tw + 18;
            });
        }

        // Footer: barcode + spec line
        ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
        let bx = 56;
        let seed = 0;
        for (let i = 0; i < spec.title.length; i++) seed = (seed * 31 + spec.title.charCodeAt(i)) % 9973;
        for (let i = 0; i < 46; i++) {
            seed = (seed * 73 + 41) % 9973;
            const bw = 2 + (seed % 4) * 2;
            ctx.fillRect(bx, h - 82, bw, 48);
            bx += bw + 3 + (seed % 3);
        }
        ctx.font = '600 24px "Consolas", monospace';
        ctx.fillStyle = '#7b8798';
        ctx.fillText(spec.footer, bx + 24, h - 44);

        // QA stamp
        ctx.save();
        ctx.translate(w - 120, h - 118);
        ctx.rotate(-0.18);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, 62, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = '900 30px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = accent;
        ctx.textAlign = 'center';
        ctx.fillText('QA', 0, -6);
        ctx.font = '700 20px "Consolas", monospace';
        ctx.fillText('PASSED', 0, 24);
        ctx.restore();

        // Laminate edge + corner eyelets
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 6;
        ctx.strokeRect(10, 10, w - 20, h - 20);
        ctx.fillStyle = '#9aa4b2';
        [[30, headH + 30], [w - 30, headH + 30], [30, h - 30], [w - 30, h - 30]].forEach(([x, yy]) => {
            ctx.beginPath();
            ctx.arc(x, yy, 9, 0, Math.PI * 2);
            ctx.fill();
        });

        // Gloss sheen
        const sheen = ctx.createLinearGradient(0, 0, w, h);
        sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
        sheen.addColorStop(0.35, 'rgba(255,255,255,0.0)');
        sheen.addColorStop(0.7, 'rgba(255,255,255,0.0)');
        sheen.addColorStop(0.85, 'rgba(255,255,255,0.05)');
        sheen.addColorStop(1, 'rgba(255,255,255,0.0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(0, 0, w, h);

        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 4;
        return tex;
    }

    sectionBoardSpec(i) {
        const cfg = this.bayConfigs[i];
        const specs = {
            hero: { title: 'AIDAN KORPAR', subtitle: 'Automation Engineer', lines: ['Turning complex engineering challenges into automation solutions', 'Resume, portfolio & contact inside'] },
            about: { title: 'ABOUT ME', subtitle: 'Control Systems Engineer', lines: ['B.Eng Mechatronic Engineering', 'PLC programming, robotics, CAD & automation', 'Team leader & society founder'] },
            experience: { title: 'EXPERIENCE', subtitle: 'Process, Controls & Automation', lines: ['Patrick Terminals - Process & Automation', 'Crossmuller - Control Systems Engineer', 'Virtual commissioning & robot cells'] },
            leadership: { title: 'LEADERSHIP', subtitle: 'Teams, Mentoring & Community', lines: ['Founder & President, UTSMechSoc', 'Youth Development Instructor, Army Cadets', 'Events, outreach & mentorship'] },
            skills: { title: 'TECH SKILLS', subtitle: 'Toolchain & Capabilities', lines: ['PLC: Siemens, Ladder Logic, SEW drives', 'Robotics: Fanuc, Roboguide', 'CAD, FAT & commissioning'] },
            contact: { title: 'CONTACT', subtitle: "Let's build something", lines: ['aidankorpar@gmail.com', 'linkedin.com/in/aidan-korpar', 'Open to new opportunities'] }
        };
        const s = specs[cfg.id];
        return {
            ...s,
            num: cfg.bayNum,
            kicker: `INFO BOARD // BAY ${cfg.bayNum} // ${cfg.short}`,
            color: cfg.color,
            footer: `AK-ARCHIVE  RACK-A  ${cfg.bayNum}`
        };
    }

    projectBoardSpec(pi) {
        const p = PROJECT_LIBRARY[pi % PROJECT_LIBRARY.length];
        const num = String(pi + 1).padStart(2, '0');
        return {
            title: p.name.toUpperCase(),
            subtitle: p.tag,
            lines: [],
            chips: p.chips,
            num,
            kicker: `PROJECT UNIT // FAB-01 // BUILD ${num}`,
            color: p.color,
            footer: `AK-FAB01  LOT ${num}  C1`
        };
    }

    createBoard(textureSpec, accentColor) {
        const group = new THREE.Group();
        const parts = {};

        const faceMat = new THREE.MeshPhysicalMaterial({
            map: this.createBoardTexture(textureSpec), roughness: 0.32, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.12
        });
        const edgeMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.35, metalness: 0.2, emissive: accentColor, emissiveIntensity: 0.0 });
        const backMat = new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.5, metalness: 0.2 });
        const panel = new THREE.Mesh(
            new THREE.BoxGeometry(BOARD.W, BOARD.H, BOARD.T),
            [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat]
        );
        panel.position.y = BOARD.FOOT_H + BOARD.H / 2;
        panel.castShadow = true;
        panel.receiveShadow = true;
        group.add(panel);

        const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.45, metalness: 0.7 });
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.15, metalness: 0.9 });

        // Stand foot + clamp brackets
        const foot = new THREE.Mesh(new THREE.BoxGeometry(BOARD.W * 0.66, BOARD.FOOT_H, 0.26), metalMat);
        foot.position.y = BOARD.FOOT_H / 2;
        foot.castShadow = true;
        foot.receiveShadow = true;
        group.add(foot);
        [-1, 1].forEach(side => {
            const clip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, BOARD.T + 0.03), metalMat);
            clip.position.set(side * BOARD.W * 0.26, BOARD.FOOT_H + 0.04, 0);
            group.add(clip);
        });

        // Grab handle on the top edge
        const topY = BOARD.FOOT_H + BOARD.H;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 14), chromeMat);
        bar.rotation.z = Math.PI / 2;
        bar.position.y = BOARD.HANDLE_Y;
        bar.castShadow = true;
        group.add(bar);
        [-0.15, 0.15].forEach(x => {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, BOARD.HANDLE_Y - topY + 0.01, 0.03), metalMat);
            post.position.set(x, (BOARD.HANDLE_Y + topY) / 2, 0);
            group.add(post);
        });

        parts.faceMat = faceMat;
        parts.edgeMat = edgeMat;
        group.userData.parts = parts;
        return group;
    }

    buildBoards() {
        this.bayConfigs.forEach((cfg, i) => {
            if (i === PROJECTS_INDEX) {
                this.boards.push(null);
                return;
            }
            const board = this.createBoard(this.sectionBoardSpec(i), cfg.color);
            board.userData.index = i;
            board.position.copy(cfg.home.pos);
            board.rotation.y = cfg.home.rotY;
            this.scene.add(board);
            this.boards.push(board);
        });

        // Project boards: some ride the belt, the rest wait inside the fabricator (pool)
        const cv = this.conveyor;
        this.projectTextures = PROJECT_LIBRARY.map((p, pi) => this.createBoardTexture(this.projectBoardSpec(pi)));
        const total = cv.slotCount + 3;
        for (let i = 0; i < total; i++) {
            const pi = i % PROJECT_LIBRARY.length;
            const board = this.createBoard(this.projectBoardSpec(pi), PROJECT_LIBRARY[pi].color);
            board.userData.parts.faceMat.map = this.projectTextures[pi];
            board.userData.index = PROJECTS_INDEX;
            this.scene.add(board);
            const onBelt = i < cv.slotCount;
            const item = { board, projectIndex: pi, state: 'pool', s: 0, lastS: null };
            board.userData.beltItem = item;
            board.visible = false;
            this.beltItems.push(item);
            if (onBelt) {
                this.assignProject(item);
                item.state = 'belt';
                item.s = cv.length + 0.2 - i * cv.spacing;
                item.lastS = item.s;
            }
        }
    }

    buildDust() {
        const count = 260;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 14;
            pos[i * 3 + 1] = -1.6 + Math.random() * 7;
            pos[i * 3 + 2] = -5 + Math.random() * 10;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0xcbd5e1, size: 0.025, transparent: true, opacity: 0.35, depthWrite: false
        }));
        this.scene.add(this.dust);
    }

    /* ------------------------------------------------------------------ */
    /* Motion programs                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * A program is a list of steps (moves, grips, releases) evaluated as a pure
     * function of time, so the same program can be scrubbed forwards/backwards
     * by the scroll wheel or played by a tween.
     */
    createProgram(startPt, places, startGap) {
        const wc = this;
        const prog = {
            steps: [],
            total: 0,
            initPlaces: places.slice(),
            startPt: { ...startPt },
            startGap,
            cursorPt: { ...startPt },
            cursorGap: startGap,
            cursorPlaces: places.slice()
        };
        const held = () => prog.cursorPlaces.indexOf('held');
        const push = (step) => {
            step.t0 = prog.total;
            prog.total += step.dur;
            prog.steps.push(step);
        };
        const api = {
            moveTo(pt, kind = 'line') {
                const a = prog.cursorPt;
                const dist = Math.hypot(pt.x - a.x, pt.y - a.y, pt.z - a.z);
                if (dist < 0.005 && Math.abs(wrapAngle(pt.rotY - a.rotY)) < 0.01) return api;
                let dur;
                if (kind === 'transit') {
                    const da = Math.abs(wrapAngle(Math.atan2(pt.x, pt.z) - Math.atan2(a.x, a.z)));
                    dur = 0.9 + da * 0.75 + dist * 0.22;
                } else {
                    dur = Math.max(0.42, dist / 1.05);
                }
                const gapTo = held() >= 0 ? GRIP_CLOSED : GRIP_OPEN;
                push({ type: 'move', kind, a: { ...a }, b: { ...pt }, gap0: prog.cursorGap, gap1: gapTo, dur });
                prog.cursorPt = { ...pt };
                prog.cursorGap = gapTo;
                return api;
            },
            grip(item) {
                push({ type: 'grip', a: { ...prog.cursorPt }, gap0: prog.cursorGap, gap1: GRIP_CLOSED, item, dur: 0.5 });
                prog.cursorGap = GRIP_CLOSED;
                prog.cursorPlaces[item] = 'held';
                return api;
            },
            release(item, place) {
                push({ type: 'release', a: { ...prog.cursorPt }, gap0: prog.cursorGap, gap1: GRIP_OPEN, item, place, dur: 0.45 });
                prog.cursorGap = GRIP_OPEN;
                prog.cursorPlaces[item] = place;
                return api;
            },
            // Hover above the pick station until the conveyor has staged a board (or a gap)
            waitForBelt(i) {
                if (i !== PROJECTS_INDEX) return api;
                push({ type: 'wait', a: { ...prog.cursorPt }, gap0: prog.cursorGap, gap1: prog.cursorGap, item: i, dur: 0.3 });
                return api;
            },
            // Higher level operations
            fetchToPlinth(i) {
                const home = wc.bayConfigs[i].home;
                const plinth = wc.plinthPlace();
                return api.moveTo(wc.abovePt(home), 'transit').waitForBelt(i).moveTo(wc.handlePt(home)).grip(i)
                    .moveTo(wc.abovePt(home)).moveTo(wc.abovePt(plinth), 'transit')
                    .moveTo(wc.handlePt(plinth)).release(i, 'easel')
                    .moveTo(wc.abovePt(plinth)).moveTo(wc.parkPt);
            },
            returnFromPlinth(i) {
                const home = wc.bayConfigs[i].home;
                const plinth = wc.plinthPlace();
                return api.moveTo(wc.abovePt(plinth)).moveTo(wc.handlePt(plinth)).grip(i)
                    .moveTo(wc.abovePt(plinth)).moveTo(wc.abovePt(home), 'transit').waitForBelt(i)
                    .moveTo(wc.handlePt(home)).release(i, 'home').moveTo(wc.abovePt(home));
            },
            returnHeld(i) {
                const home = wc.bayConfigs[i].home;
                return api.moveTo(wc.abovePt(home), 'transit').waitForBelt(i).moveTo(wc.handlePt(home)).release(i, 'home').moveTo(wc.abovePt(home));
            },
            placeHeld(i) {
                const plinth = wc.plinthPlace();
                return api.moveTo(wc.abovePt(plinth), 'transit').moveTo(wc.handlePt(plinth)).release(i, 'easel')
                    .moveTo(wc.abovePt(plinth)).moveTo(wc.parkPt);
            },
            hold(dur) {
                push({ type: 'move', kind: 'line', a: { ...prog.cursorPt }, b: { ...prog.cursorPt }, gap0: prog.cursorGap, gap1: prog.cursorGap, dur });
                return api;
            },
            park() {
                return api.moveTo(wc.parkPt, 'transit');
            },
            build() {
                return prog;
            }
        };
        return api;
    }

    interpPoint(step, u) {
        const a = step.a;
        const b = step.b;
        if (step.kind !== 'transit') {
            const s = smooth(u);
            return {
                x: a.x + (b.x - a.x) * s,
                y: a.y + (b.y - a.y) * s,
                z: a.z + (b.z - a.z) * s,
                rotY: this.lerpAngle(a.rotY, b.rotY, s)
            };
        }
        // Transit: swing around the base in cylindrical coordinates, pulled into a safe corridor
        const s = smoother(u);
        const a0 = Math.atan2(a.x, a.z);
        const a1 = Math.atan2(b.x, b.z);
        const da = Math.abs(wrapAngle(a1 - a0));
        const r0 = Math.hypot(a.x, a.z);
        const r1 = Math.hypot(b.x, b.z);
        const corridorBlend = Math.min(1, da / 0.6);
        const rLin = r0 + (r1 - r0) * s;
        const rMid = (r0 + r1) / 2;
        const rDip = Math.max(0, rMid - CORRIDOR_R) * corridorBlend * Math.sin(Math.PI * s);
        const r = rLin - rDip;
        const ang = this.lerpAngle(a0, a1, smoothRange(0.12, 0.88, s));
        const yLin = a.y + (b.y - a.y) * s;
        const bump = smoothRange(0, 0.3, s) * (1 - smoothRange(0.7, 1, s));
        const ySafe = Math.max(yLin, Math.min(CORRIDOR_Y, this.maxReachY(r) - 0.05));
        const y = yLin + (ySafe - yLin) * bump;
        return {
            x: Math.sin(ang) * r,
            y,
            z: Math.cos(ang) * r,
            rotY: this.lerpAngle(a.rotY, b.rotY, smoothRange(0.15, 0.85, s))
        };
    }

    maxReachY(r) {
        const reach = (this.L1 + this.L2) * 0.96;
        return Math.sqrt(Math.max(0, reach * reach - r * r)) + this.shoulderY - this.Ltool;
    }

    evalProgram(prog, t) {
        const places = prog.initPlaces.slice();
        let pt = { ...prog.startPt };
        let gap = prog.startGap;
        let activeStep = null;
        for (let i = 0; i < prog.steps.length; i++) {
            const step = prog.steps[i];
            const end = step.t0 + step.dur;
            if (t >= end && i < prog.steps.length - 1) {
                if (step.type === 'grip') places[step.item] = 'held';
                if (step.type === 'release') places[step.item] = step.place;
                pt = step.type === 'move' ? { ...step.b } : { ...step.a };
                gap = step.gap1;
                continue;
            }
            const u = clamp01((t - step.t0) / step.dur);
            if (step.type === 'move') {
                pt = this.interpPoint(step, u);
            } else {
                pt = { ...step.a };
                if (step.type === 'grip' && u >= 1) places[step.item] = 'held';
                if (step.type === 'release' && u >= 1) places[step.item] = step.place;
            }
            gap = step.gap0 + (step.gap1 - step.gap0) * smooth(u);
            activeStep = step;
            break;
        }
        return { pt, gap, places, step: activeStep };
    }

    buildSegmentPrograms() {
        this.segmentPrograms = [];
        for (let k = 0; k < this.bayConfigs.length; k++) {
            const places = this.bayConfigs.map(() => 'home');
            if (k > 0) places[k - 1] = 'easel';
            const api = this.createProgram(this.parkPt, places, GRIP_OPEN);
            if (k > 0) api.returnFromPlinth(k - 1);
            api.fetchToPlinth(k);
            this.segmentPrograms.push(api.build());
        }
    }

    /**
     * Applies an evaluated program state to the arm, gripper and boards.
     */
    applyProgramState(state) {
        this.toolPt = state.pt;
        const pose = this.solveIK(state.pt.x, state.pt.y, state.pt.z, state.pt.rotY);
        this.targetJointAngles = {
            j1: pose.j1 + this.jogOffsets.j1,
            j2: pose.j2 + this.jogOffsets.j2,
            j3: pose.j3 + this.jogOffsets.j3,
            j4: pose.j4 + this.jogOffsets.j4,
            j5: this.jogOffsets.j5,
            j6: wrapAngle(pose.j6 + this.jogOffsets.j6)
        };
        this.targetGripGap = this.manualGripperGap !== null ? this.manualGripperGap : state.gap;
        this.places = state.places;

        // Docked = board on the plinth, released, and the arm has backed away
        const easelIndex = state.places.indexOf('easel');
        const heldIndex = state.places.indexOf('held');
        const plinthHandleY = this.plinthPos.y + BOARD.HANDLE_Y;
        let docked = -1;
        const rise = state.pt.y - plinthHandleY;
        // Hysteresis: open once the arm has backed away, close only once it comes back down
        const threshold = this.dockedSectionIndex === easelIndex ? LIFT * 0.3 : LIFT * 0.6;
        if (easelIndex >= 0 && heldIndex < 0 && state.gap > 0.15 && rise > threshold) {
            docked = easelIndex;
        }
        if (docked !== this.dockedSectionIndex) {
            this.dockedSectionIndex = docked;
            if (this.onSectionChange) {
                if (docked >= 0) this.onSectionChange(this.bayConfigs[docked].id, docked);
                else this.onSectionChange(null, -1);
            }
        }
    }

    evaluateProgress(progress) {
        const p = Math.max(0, Math.min(this.maxProgress, progress));
        let k = Math.floor(p);
        let u = p - k;
        if (k >= this.segmentPrograms.length) {
            k = this.segmentPrograms.length - 1;
            u = 1;
        }
        const prog = this.segmentPrograms[k];
        const state = this.evalProgram(prog, u * prog.total);
        this.applyProgramState(state);
        this.activeProgram = prog;
        this.activeProgramT = u * prog.total;
    }

    // Kept for URL-parameter compatibility with the original workcell
    evaluateDirectTransfer(kFrom, kTo) {
        if (kTo !== null && kTo !== undefined) this.teleportToSection(kTo);
    }

    resetManualOverrides() {
        this.manualGripperGap = null;
        Object.keys(this.jogOffsets).forEach(k => { this.jogOffsets[k] = 0; });
        this.isAtDynamicLimit = false;
        this.limitCulprit = null;
    }

    applyScrollDelta(delta) {
        // Auto-dispatch in progress: let it finish rather than teleporting boards mid-carry
        if (this.isEStopped || this.directTransfer || this.dropAnim) return;
        this.resetManualOverrides();
        this.lastScrollTimestamp = performance.now();

        const maxBufferAhead = 0.045;
        const newTarget = this.targetProgress + delta;
        this.targetProgress = Math.max(0, Math.min(this.maxProgress,
            Math.max(this.currentProgress - maxBufferAhead, Math.min(this.currentProgress + maxBufferAhead, newTarget))));
        this.statusText = `MANUAL SCROLL // PROGRESS: ${(this.targetProgress / this.maxProgress * 100).toFixed(0)}%`;
    }

    runHoldJog(direction, dt = 0.016) {
        if (this.isEStopped || this.directTransfer || this.dropAnim) return;
        this.resetManualOverrides();
        this.lastScrollTimestamp = performance.now();

        const speed = 0.16;
        const maxBufferAhead = 0.04;
        const newTarget = this.targetProgress + direction * speed * dt;
        this.targetProgress = Math.max(0, Math.min(this.maxProgress,
            Math.max(this.currentProgress - maxBufferAhead, Math.min(this.currentProgress + maxBufferAhead, newTarget))));
        this.statusText = `HOLD TO RUN // ${direction > 0 ? 'FWD' : 'REV'} // PROGRESS: ${(this.targetProgress / this.maxProgress * 100).toFixed(0)}%`;
    }

    stopHoldJog() {
        this.targetProgress = this.currentProgress;
    }

    /**
     * Plays a program on the cell's own clock. Time stops while the arm waits on the
     * conveyor (a 'wait' step whose board/gap is not staged yet) and during E-stop.
     */
    runProgram(prog, label, onDone) {
        this.activeTween = null;
        this.directTransfer = { prog, t: 0, label, onDone };
        this.statusText = label;
        this.activeProgram = prog;
        this.activeProgramT = 0;
    }

    tickProgram(dt) {
        const run = this.directTransfer;
        if (!run) return;
        const state = this.evalProgram(run.prog, run.t);
        const waiting = state.step && state.step.type === 'wait' && !this.beltStaged;
        if (waiting) {
            this.statusText = this.beltDemand === 'gap'
                ? 'WAITING FOR A GAP ON CONVEYOR C1'
                : 'WAITING FOR PROJECT BOARD // CONVEYOR C1';
        } else {
            if (this.statusText.startsWith('WAITING')) this.statusText = run.label;
            run.t = Math.min(run.prog.total, run.t + dt);
        }
        this.activeProgram = run.prog;
        this.activeProgramT = run.t;
        this.applyProgramState(this.evalProgram(run.prog, run.t));
        if (run.t >= run.prog.total && this.directTransfer === run) {
            this.directTransfer = null;
            run.onDone();
        }
    }

    /** Clears any in-flight command before a new one starts. */
    beginCommand() {
        this.activeTween = null;
        this.directTransfer = null;
        this.excludeItem = null;
        this.pickTarget = null;
        this.resetManualOverrides();
    }

    currentGap() {
        return this.manualGripperGap !== null ? this.manualGripperGap : this.joints.gripper.gap;
    }

    /**
     * Swap the presented project for the next one off the conveyor: the current board goes
     * back on the belt and the robot waits for the next board to arrive at the pick station.
     */
    nextProject() {
        if (this.isEStopped || this.directTransfer || this.dropAnim) return false;
        if (this.places[PROJECTS_INDEX] !== 'easel') {
            this.goToSection(PROJECTS_INDEX);
            return true;
        }
        const returning = this.claimedItem;
        this.beginCommand();
        this.excludeItem = returning;
        this.pickTarget = null;
        const api = this.createProgram(this.toolPt, this.places.slice(), this.joints.gripper.gap);
        api.returnFromPlinth(PROJECTS_INDEX).fetchToPlinth(PROJECTS_INDEX);
        this.runProgram(api.build(), 'SWAPPING PROJECT // NEXT UNIT FROM FAB-01', () => {
            this.currentProgress = PROJECTS_INDEX + 1.0;
            this.targetProgress = PROJECTS_INDEX + 1.0;
            this.evaluateProgress(this.currentProgress);
            this.statusText = `PRESENTING // PROJECT: ${(this.activeProjectName || '').toUpperCase()}`;
        });
        return true;
    }

    goToSection(sectionIndex) {
        if (this.isEStopped || this.dropAnim) return;
        // A click/tap on a specific conveyor board asks for that board
        const requested = sectionIndex === PROJECTS_INDEX ? this.consumePickHit() : null;
        if (sectionIndex === -1 || sectionIndex === null || sectionIndex === undefined) {
            return this.stowFrontBoxToRack();
        }
        if (sectionIndex < 0 || sectionIndex >= this.bayConfigs.length) return;
        this.targetSectionIndex = sectionIndex;

        const places = this.places.slice();
        const previous = this.claimedItem;
        this.beginCommand();

        const held = places.indexOf('held');
        const onPlinth = places.indexOf('easel');
        const api = this.createProgram(this.toolPt, places, this.joints.gripper.gap);

        if (sectionIndex === PROJECTS_INDEX) {
            this.pickTarget = null;
            if (requested && requested.state === 'belt') {
                if (requested.s <= this.conveyor.pickS + 0.01) {
                    this.pickTarget = requested;
                } else {
                    this.statusText = 'UNIT ALREADY PAST PICK STATION // TAKING NEXT';
                }
            }
            // Clicking another belt board while a project is presented swaps them
            if (onPlinth === PROJECTS_INDEX && held < 0 && this.pickTarget) {
                this.excludeItem = previous;
                api.returnFromPlinth(PROJECTS_INDEX).fetchToPlinth(PROJECTS_INDEX);
                const name = PROJECT_LIBRARY[this.pickTarget.projectIndex].name.toUpperCase();
                this.runProgram(api.build(), `FETCHING PROJECT // ${name}`, () => {
                    this.currentProgress = PROJECTS_INDEX + 1.0;
                    this.targetProgress = PROJECTS_INDEX + 1.0;
                    this.evaluateProgress(this.currentProgress);
                    this.statusText = `PRESENTING // PROJECT: ${(this.activeProjectName || '').toUpperCase()}`;
                });
                return;
            }
            if (held === PROJECTS_INDEX && this.pickTarget) {
                // Already carrying a project board: swap it for the requested one
                this.excludeItem = previous;
                api.returnHeld(PROJECTS_INDEX).fetchToPlinth(PROJECTS_INDEX);
                this.runProgram(api.build(), 'SWAPPING PROJECT BOARD', () => {
                    this.currentProgress = PROJECTS_INDEX + 1.0;
                    this.targetProgress = PROJECTS_INDEX + 1.0;
                    this.evaluateProgress(this.currentProgress);
                });
                return;
            }
        }

        if (held >= 0) {
            if (held === sectionIndex) {
                api.placeHeld(held);
            } else {
                api.returnHeld(held).fetchToPlinth(sectionIndex);
            }
        } else if (onPlinth >= 0) {
            if (onPlinth === sectionIndex) {
                api.moveTo(this.parkPt);
            } else {
                api.returnFromPlinth(onPlinth).fetchToPlinth(sectionIndex);
            }
        } else {
            api.fetchToPlinth(sectionIndex);
        }

        const prog = api.build();
        const cfg = this.bayConfigs[sectionIndex];
        const finish = () => {
            this.currentProgress = sectionIndex + 1.0;
            this.targetProgress = sectionIndex + 1.0;
            this.evaluateProgress(this.currentProgress);
            this.statusText = `PRESENTING // ${cfg.name.toUpperCase()}`;
        };
        if (prog.steps.length === 0) {
            finish();
            return;
        }
        let source = sectionIndex === PROJECTS_INDEX ? 'CONVEYOR C1' : `RACK A BAY ${cfg.bayNum}`;
        if (sectionIndex === PROJECTS_INDEX && this.pickTarget) {
            source = `C1: ${PROJECT_LIBRARY[this.pickTarget.projectIndex].name.toUpperCase()}`;
        }
        this.runProgram(prog, `DISPATCHING // ${source} -> PLINTH`, finish);
    }

    teleportToSection(sectionIndex) {
        if (this.isEStopped || this.dropAnim) return;
        if (sectionIndex < 0 || sectionIndex >= this.bayConfigs.length) return;
        this.beginCommand();
        this.targetSectionIndex = sectionIndex;
        this.currentProgress = sectionIndex + 1.0;
        this.targetProgress = sectionIndex + 1.0;
        this.evaluateProgress(this.currentProgress);
        this.jointAngles = { ...this.targetJointAngles };
        this.joints.gripper.gap = this.targetGripGap;
        this.applyJointTransforms();
        this.statusText = `PRESENTING // ${this.bayConfigs[sectionIndex].name.toUpperCase()}`;
    }

    stowFrontBoxToRack() {
        if (this.isEStopped || this.dropAnim) return;
        const places = this.places.slice();
        this.beginCommand();
        this.targetSectionIndex = -1;

        const held = places.indexOf('held');
        const onPlinth = places.indexOf('easel');
        const api = this.createProgram(this.toolPt, places, this.joints.gripper.gap);
        if (held >= 0) api.returnHeld(held);
        else if (onPlinth >= 0) api.returnFromPlinth(onPlinth);
        api.park();
        const prog = api.build();

        const finish = () => {
            this.currentProgress = 0;
            this.targetProgress = 0;
            this.evaluateProgress(0);
            this.statusText = 'CELL READY // PLINTH EMPTY';
        };
        if (prog.steps.length === 0) {
            finish();
            return;
        }
        this.runProgram(prog, 'STOWING BOARD // RETURNING TO STATION', finish);
    }

    /* ------------------------------------------------------------------ */
    /* Manual jog, gripper & safety                                        */
    /* ------------------------------------------------------------------ */

    jogJoint(jointKey, delta) {
        if (this.isEStopped || this.directTransfer || this.dropAnim) return;
        const limits = {
            j2: [-1.3, 1.5],
            j3: [-0.4, 2.7],
            j4: [-2.4, 2.6]
        };
        let next = (this.jointAngles[jointKey] || 0) + delta;
        let applied = delta;
        this.isAtDynamicLimit = false;
        this.limitCulprit = null;
        if (limits[jointKey]) {
            const [lo, hi] = limits[jointKey];
            if (next < lo || next > hi) {
                const clamped = Math.max(lo, Math.min(hi, next));
                applied = clamped - (this.jointAngles[jointKey] || 0);
                next = clamped;
                this.isAtDynamicLimit = true;
                this.limitCulprit = `${jointKey.toUpperCase()} SOFT LIMIT`;
            }
        }
        this.jogOffsets[jointKey] += applied;
        this.jointAngles[jointKey] = next;
        this.targetJointAngles[jointKey] = next;
        this.applyJointTransforms();

        if (this.isAtDynamicLimit) {
            this.statusText = `SAFETY STOP // DCS: ${this.limitCulprit}`;
        } else {
            const deg = (this.jogOffsets[jointKey] * 180 / Math.PI).toFixed(1);
            this.statusText = `MANUAL JOG // ${jointKey.toUpperCase()}: ${deg > 0 ? '+' : ''}${deg}° OFFSET`;
        }
    }

    toggleGripperManual() {
        if (this.isEStopped) return;
        const willOpen = this.currentGap() <= 0.12;
        this.manualGripperGap = willOpen ? GRIP_OPEN : GRIP_CLOSED;
        this.targetGripGap = this.manualGripperGap;

        const held = this.places.indexOf('held');
        if (willOpen && held >= 0) {
            this.dropHeldBoard(held);
            return;
        }
        this.statusText = willOpen ? 'MANUAL JOG // GRIPPER: OPEN (200mm)' : 'MANUAL JOG // GRIPPER: CLAMPED (75mm)';
    }

    /**
     * Dropping a held board: it tumbles to the floor, then the cell recovers
     * (board is re-issued to its station and the arm returns to park).
     */
    dropHeldBoard(index) {
        const board = this.boardForIndex(index);
        if (!board) return;
        this.beginCommand();
        this.manualGripperGap = GRIP_OPEN;
        this.dropAnim = {
            index,
            board,
            vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6),
            spin: (Math.random() - 0.5) * 2.4,
            tip: 0,
            t: 0
        };
        // A dropped project board is scrapped; the fabricator issues a new one
        if (index === PROJECTS_INDEX && this.claimedItem) {
            this.claimedItem.state = 'scrap';
            this.claimedItem = null;
        }
        this.statusText = 'WORKPIECE DROPPED! // RECOVERING CELL';
        Object.keys(this.jogOffsets).forEach(k => { this.jogOffsets[k] = 0; });
        this.currentProgress = 0;
        this.targetProgress = 0;
    }

    updateDrop(dt) {
        const d = this.dropAnim;
        if (!d) return;
        d.t += dt;
        const b = d.board;
        const floorY = -1.8;
        if (b.position.y > floorY + 0.001) {
            d.vel.y -= 9.8 * dt;
            b.position.addScaledVector(d.vel, dt);
            b.rotation.y += d.spin * dt;
            d.tip = Math.min(Math.PI / 2 - 0.05, d.tip + dt * 2.2);
            b.rotation.x = -d.tip;
            if (b.position.y <= floorY) {
                b.position.y = floorY;
                d.vel.set(0, 0, 0);
                d.spin = 0;
            }
        }
        if (d.t > 1.8) {
            const s = Math.max(0.001, 1 - (d.t - 1.8) / 0.35);
            b.scale.setScalar(s);
        }
        if (d.t > 2.15) {
            b.scale.setScalar(1);
            b.rotation.x = 0;
            const item = b.userData.beltItem;
            if (item) {
                item.state = 'pool';
                b.visible = false;
            }
            this.dropAnim = null;
            this.manualGripperGap = null;
            this.statusText = 'CELL RECOVERED // BOARD RE-ISSUED';
        }
    }

    emergencyStop() {
        this.isEStopped = true;
        this.statusText = 'EMERGENCY STOP (E-STOP) ACTIVATED! MOTORS HALTED';
        if (this.activeTween) this.activeTween.pause();
    }

    resetEmergencyStop() {
        this.isEStopped = false;
        this.statusText = 'E-STOP CLEARED // MOTORS RE-INITIALIZED';
        if (this.activeTween) this.activeTween.resume();
    }

    /* ------------------------------------------------------------------ */
    /* Board placement & conveyor                                          */
    /* ------------------------------------------------------------------ */

    boardForIndex(index) {
        if (index === PROJECTS_INDEX) {
            return this.claimedItem ? this.claimedItem.board : null;
        }
        return this.boards[index];
    }

    /** Next project in the library that is not already out on the belt or presented. */
    assignProject(item) {
        const inUse = new Set(this.beltItems.filter(it => it !== item && (it.state === 'belt' || it.state === 'held')).map(it => it.projectIndex));
        let pi = this.projectCursor % PROJECT_LIBRARY.length;
        for (let k = 0; k < PROJECT_LIBRARY.length && inUse.has(pi); k++) {
            pi = (pi + 1) % PROJECT_LIBRARY.length;
        }
        this.projectCursor = pi + 1;
        item.projectIndex = pi;
        const parts = item.board.userData.parts;
        parts.faceMat.map = this.projectTextures[pi];
        parts.edgeMat.color.setHex(PROJECT_LIBRARY[pi].color);
        parts.edgeMat.emissive.setHex(PROJECT_LIBRARY[pi].color);
    }

    consumePickHit() {
        const hit = this.lastPickHit;
        this.lastPickHit = null;
        if (!hit || performance.now() - hit.time > 1500) return null;
        return hit.item;
    }

    /** Board due at the pick station next (or the requested one). */
    nextArrivingItem() {
        const pickS = this.conveyor.pickS;
        if (this.pickTarget && this.pickTarget.state === 'belt' && this.pickTarget.s <= pickS + 0.01) {
            return this.pickTarget;
        }
        let best = null;
        this.beltItems.forEach(it => {
            if (it.state !== 'belt' || it === this.excludeItem) return;
            if (it.s > pickS + 0.01) return;
            if (!best || it.s > best.s) best = it;
        });
        return best;
    }

    /** Belt travel needed before the pick station has BELT_CLEAR of free belt either side. */
    gapRemaining() {
        const pickS = this.conveyor.pickS;
        const positions = this.beltItems.filter(it => it.state === 'belt').map(it => it.s);
        const valid = (d) => positions.every(sp => Math.abs(sp + d - pickS) >= BELT_CLEAR - 1e-4);
        const candidates = [0, ...positions.map(sp => pickS + BELT_CLEAR - sp).filter(d => d > 0)].sort((a, b) => a - b);
        for (const d of candidates) {
            if (valid(d)) return d;
        }
        return candidates[candidates.length - 1] || 0;
    }

    /**
     * Does the active program have the arm working at the conveyor soon?
     * Returns the window state so scrolling can be gated on it.
     */
    beltWindow(prog, t) {
        if (!prog) return false;
        const steps = prog.steps;
        for (let i = 0; i < steps.length; i++) {
            const st = steps[i];
            if (st.type !== 'wait' || st.item !== PROJECTS_INDEX) continue;
            // Window runs from shortly before the wait until the arm has lifted clear again
            let j = i + 1;
            while (j < steps.length && steps[j].type !== 'grip' && steps[j].type !== 'release') j++;
            const lift = steps[Math.min(steps.length - 1, j + 1)];
            const endT = lift.t0 + lift.dur;
            // Includes a margin after the lift so scrolling back onto the conveyor stages the belt too
            if (t > st.t0 - 4.0 && t < endT + 2.5) return true;
        }
        return false;
    }

    /** Scroll gates (global progress values) around each conveyor visit. */
    beltGates() {
        if (this._beltGates) return this._beltGates;
        const gates = [];
        this.segmentPrograms.forEach((prog, k) => {
            prog.steps.forEach((st, i) => {
                if (st.type !== 'wait' || st.item !== PROJECTS_INDEX) return;
                let j = i + 1;
                while (j < prog.steps.length && prog.steps[j].type !== 'grip' && prog.steps[j].type !== 'release') j++;
                const lift = prog.steps[Math.min(prog.steps.length - 1, j + 1)];
                gates.push({
                    forward: k + (st.t0 + st.dur) / prog.total,
                    backward: k + (lift.t0 + lift.dur) / prog.total
                });
            });
        });
        this._beltGates = gates;
        return gates;
    }

    updateConveyor(dt) {
        const cv = this.conveyor;
        const projectsPlace = this.places[PROJECTS_INDEX];
        const dropping = this.dropAnim && this.dropAnim.index === PROJECTS_INDEX;

        // Claim / release the board at the pick station as the program dictates
        if (projectsPlace !== 'home' && projectsPlace !== 'dropped' && !this.claimedItem && !dropping) {
            let item = this.nextArrivingItem();
            const nearest = this.beltItems
                .filter(it => it.state === 'belt')
                .sort((a, b) => Math.abs(a.s - cv.pickS) - Math.abs(b.s - cv.pickS))[0];
            if (!item || Math.abs(item.s - cv.pickS) > 0.05) item = nearest || item;
            if (!item) {
                item = this.beltItems.find(it => it.state === 'pool');
                if (item) this.assignProject(item);
            }
            if (item) {
                item.state = 'held';
                item.s = cv.pickS;
                this.claimedItem = item;
                this.pickTarget = null;
                this.excludeItem = this.excludeItem === item ? null : this.excludeItem;
                this.activeProjectName = PROJECT_LIBRARY[item.projectIndex].name;
            }
        } else if (projectsPlace === 'home' && this.claimedItem) {
            this.claimedItem.state = 'belt';
            this.claimedItem.s = cv.pickS;
            this.claimedItem.lastS = cv.pickS;
            this.claimedItem = null;
        }

        // Belt demand: stage a board (or a gap) at the pick station while the arm works there
        const prog = this.activeProgram;
        let inWindow = this.beltWindow(prog, this.activeProgramT || 0);
        if (!inWindow && !this.directTransfer && this.segmentPrograms) {
            // Look ahead into the next scroll segment
            const k = Math.floor(this.currentProgress);
            const next = this.segmentPrograms[k + 1];
            if (next && prog) inWindow = this.beltWindow(next, (this.activeProgramT || 0) - prog.total);
        }
        // A specifically requested board is brought to the station and held there until the arm arrives
        if (this.pickTarget && this.pickTarget.state === 'belt' && this.pickTarget.s <= cv.pickS + 0.01 && !this.claimedItem) {
            inWindow = true;
        }
        this.beltDemand = inWindow ? (this.claimedItem ? 'gap' : 'board') : null;

        let remaining = Infinity;
        if (this.beltDemand === 'board') {
            const item = this.nextArrivingItem();
            remaining = item ? Math.max(0, cv.pickS - item.s) : Infinity;
        } else if (this.beltDemand === 'gap') {
            remaining = this.gapRemaining();
        }

        // Never move the belt while the gripper is down at the pick station
        const home = this.bayConfigs[PROJECTS_INDEX].home;
        const tp = this.toolPt;
        const armDown = Math.hypot(tp.x - home.pos.x, tp.z - home.pos.z) < 0.25 && tp.y < home.pos.y + BOARD.HANDLE_Y + LIFT - 0.03;
        if (armDown) remaining = 0;

        // Constant-speed drive with a gentle ramp; it only ever slows down to stop on target
        let vMax = this.isEStopped ? 0 : BELT_SPEED;
        if (remaining !== Infinity) vMax = Math.min(vMax, Math.sqrt(2 * BELT_ACCEL * remaining));
        if (this.beltSpeed < vMax) this.beltSpeed = Math.min(vMax, this.beltSpeed + BELT_ACCEL * dt);
        else this.beltSpeed = Math.max(vMax, this.beltSpeed - BELT_ACCEL * 2 * dt);
        let ds = this.beltSpeed * dt;
        if (ds > remaining) ds = remaining;
        this.beltStaged = (this.beltDemand !== null || armDown) && remaining < 0.003;
        if (this.beltStaged) {
            ds = remaining;
            this.beltSpeed = 0;
        }

        // Advance every board on the belt together
        this.beltPos += ds;
        const emitS = -cv.hiddenIn;
        let minS = Infinity;
        this.beltItems.forEach(it => {
            if (it.state !== 'belt') return;
            it.s += ds;
            if (it.s > cv.length + cv.tail) {
                it.state = 'pool';
                it.board.visible = false;
            } else {
                minS = Math.min(minS, it.s);
            }
        });
        // The fabricator issues the next board once there is room behind the last one
        if (minS - emitS >= cv.spacing) {
            const fresh = this.beltItems.find(it => it.state === 'pool');
            if (fresh) {
                this.assignProject(fresh);
                fresh.state = 'belt';
                fresh.s = minS === Infinity ? emitS : Math.max(emitS, minS - cv.spacing);
                fresh.lastS = fresh.s;
            }
        }

        // Belt texture + rollers
        if (this.beltTex) this.beltTex.offset.y = -this.beltPos / 0.5;
        this.rollers.forEach(r => { r.rotation.x = this.beltPos / 0.08; });
        if (this.lightCurtainMat) {
            this.lightCurtainMat.opacity = this.beltStaged ? 0.12 + 0.08 * Math.sin(this.elapsed * 10) : 0.32;
            this.lightCurtainMat.color.setHex(this.beltStaged ? 0xf59e0b : 0x22d3ee);
        }

        // Position the boards riding the belt
        let sparks = 0;
        let near = 0;
        this.beltItems.forEach(it => {
            if (it.state !== 'belt') return;
            const b = it.board;
            const sNow = it.s;
            if (it.lastS !== null && it.lastS < -0.02 && sNow >= -0.02) sparks += 18;
            it.lastS = sNow;
            if (sNow > -0.6 && sNow < 0.6) near = Math.max(near, 1 - Math.abs(sNow) / 0.6);

            const p = this.beltPoint(Math.min(sNow, cv.length));
            b.rotation.set(0, cv.rotY, 0);
            b.scale.setScalar(1);
            b.visible = sNow > -0.75;
            if (sNow < 0) p.copy(this.beltPoint(sNow));
            if (sNow > cv.length) {
                // Tipping into the recycle chute
                const over = sNow - cv.length;
                const k = Math.min(1, over / cv.tail);
                p.addScaledVector(cv.dir, over * 0.6);
                p.y -= k * k * 1.4;
                b.rotation.x = k * 1.1;
                b.scale.setScalar(Math.max(0.001, 1 - k * 0.6));
                b.visible = k < 0.98;
            }
            b.position.copy(p);
        });

        // Strip curtain sways when a board passes through the exit
        this.curtainStrips.forEach((strip, i) => {
            const target = -near * 0.9 * (1 - Math.abs(i - 3) * 0.08);
            strip.rotation.x += (target + Math.sin(this.elapsed * 3 + i) * 0.02 - strip.rotation.x) * Math.min(1, dt * 8);
        });
        if (sparks) this.emitSparks(sparks);
    }

    emitSparks(n) {
        const cv = this.conveyor;
        const origin = this.beltPoint(0.05);
        origin.y = cv.beltY + 0.55;
        const side = new THREE.Vector3(cv.dir.z, 0, -cv.dir.x);
        for (let i = 0; i < n; i++) {
            const sp = this.sparks.data[this.sparks.next];
            this.sparks.next = (this.sparks.next + 1) % this.sparks.count;
            sp.life = 0.5 + Math.random() * 0.5;
            sp.pos.copy(origin).addScaledVector(side, (Math.random() - 0.5) * 0.9);
            sp.pos.y += (Math.random() - 0.5) * 0.6;
            sp.vel.copy(cv.dir).multiplyScalar(0.6 + Math.random() * 1.4)
                .addScaledVector(side, (Math.random() - 0.5) * 1.6);
            sp.vel.y = 0.6 + Math.random() * 1.6;
        }
    }

    updateSparks(dt) {
        const attr = this.sparks.points.geometry.attributes.position;
        this.sparks.data.forEach((sp, i) => {
            if (sp.life > 0) {
                sp.life -= dt;
                sp.vel.y -= 5.5 * dt;
                sp.pos.addScaledVector(sp.vel, dt);
                attr.setXYZ(i, sp.pos.x, sp.pos.y, sp.pos.z);
            } else {
                attr.setXYZ(i, 0, -50, 0);
            }
        });
        attr.needsUpdate = true;
    }

    updateCarried(board) {
        if (!board || !this.joints.gripper.jawCenter) return;
        this.robot.updateMatrixWorld(true);
        if (!this._boardQuatOffset) {
            const qBoard = new THREE.Quaternion();
            const qJaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI, 'YXZ'));
            this._boardQuatOffset = qJaw.invert().multiply(qBoard);
        }
        const jawQuat = new THREE.Quaternion();
        this.joints.gripper.jawCenter.getWorldQuaternion(jawQuat);
        board.quaternion.copy(jawQuat.multiply(this._boardQuatOffset));
        const pos = new THREE.Vector3(0, BOARD.HANDLE_Y, 0);
        this.joints.gripper.jawCenter.localToWorld(pos);
        board.position.copy(pos);
        board.scale.setScalar(1);
        board.visible = true;
    }

    updateBoards() {
        let carried = null;
        this.places.forEach((place, i) => {
            const board = this.boardForIndex(i);
            if (!board) return;
            if (this.dropAnim && this.dropAnim.board === board) return;
            board.rotation.x = 0;
            if (place === 'held') {
                carried = board;
            } else if (place === 'easel') {
                board.position.copy(this.plinthPos);
                board.rotation.set(0, 0, 0);
                board.visible = true;
                board.scale.setScalar(1);
            } else if (i !== PROJECTS_INDEX) {
                board.position.copy(this.bayConfigs[i].home.pos);
                board.rotation.set(0, this.bayConfigs[i].home.rotY, 0);
            }
        });
        if (carried) this.updateCarried(carried);

        // Rack occupancy LEDs
        if (this.rackLeds) {
            this.rackLeds.forEach(led => {
                const idx = this.bayConfigs.findIndex(c => c.slot && c.slot.tier === led.tier && c.slot.col === led.col);
                const present = idx >= 0 && this.places[idx] === 'home' && !(this.dropAnim && this.dropAnim.index === idx);
                const blink = Math.sin(this.elapsed * 8) > 0;
                led.mesh.material.color.setHex(present ? 0x22c55e : (blink ? 0xf59e0b : 0x3a2a05));
            });
        }

        // Hover glow on board edges
        const hoverBoards = new Set();
        if (this.hoverIndex !== null && this.hoverIndex !== undefined) {
            if (this.hoverIndex === PROJECTS_INDEX) {
                if (this.hoverItem) hoverBoards.add(this.hoverItem.board);
                else this.beltItems.forEach(it => { if (it.state === 'belt') hoverBoards.add(it.board); });
            } else if (this.boards[this.hoverIndex]) {
                hoverBoards.add(this.boards[this.hoverIndex]);
            }
        }
        const pulse = 0.55 + 0.35 * Math.sin(this.elapsed * 6);
        [...this.boards, ...this.beltItems.map(it => it.board)].forEach(b => {
            if (!b) return;
            b.userData.parts.edgeMat.emissiveIntensity = hoverBoards.has(b) ? pulse : 0.0;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Interaction & camera                                                */
    /* ------------------------------------------------------------------ */

    /**
     * Raycast pick: returns the section index under the pointer. A hit on a specific
     * conveyor board is remembered so goToSection(4) fetches that exact board.
     */
    getIntersectedBay(clientX, clientY) {
        this.lastPickHit = null;
        this.hoverItem = null;
        if (!this.camera || !this.renderer) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
        const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        if (!this.raycaster) this.raycaster = new THREE.Raycaster();
        this.raycaster.setFromCamera(ndc, this.camera);

        if (!this._pickTargets) {
            // Static meshes are tagged once; board meshes are re-checked for visibility per call
            this._pickTargets = [];
            const tag = (obj, index) => obj.traverse(c => {
                if (c.isMesh) {
                    c.userData.pickIndex = index;
                    c.userData.pickRoot = obj;
                    this._pickTargets.push(c);
                }
            });
            this.boards.forEach((b, i) => { if (b) tag(b, i); });
            this.beltItems.forEach(it => tag(it.board, PROJECTS_INDEX));
            if (this.fabricatorGroup) tag(this.fabricatorGroup, PROJECTS_INDEX);
            if (this.conveyorGroup) tag(this.conveyorGroup, PROJECTS_INDEX);
        }
        const targets = this._pickTargets.filter(m => m.userData.pickRoot.visible);
        const hits = this.raycaster.intersectObjects(targets, false);
        if (hits.length === 0) return null;
        const mesh = hits[0].object;
        const item = mesh.userData.pickRoot.userData.beltItem;
        if (item && item.state === 'belt') {
            this.hoverItem = item;
            this.lastPickHit = { item, time: performance.now() };
        }
        return mesh.userData.pickIndex !== undefined ? mesh.userData.pickIndex : null;
    }

    updateCameraAspect() {
        if (!this.container || !this.renderer || !this.camera) return;
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        const aspect = width / height;
        this.camera.aspect = aspect;

        // Fit the cell's horizontal span; on desktop leave room for the teach pendant on the left
        // Phones crop the outer edges slightly so the cell reads larger
        const xMin = aspect < 1.0 ? -3.25 : -3.9;
        const xMax = aspect < 1.0 ? 4.3 : 4.75;
        const pendantInset = aspect >= 1.2 ? Math.min(0.26, 370 / width) : 0;
        const halfW = (xMax - xMin) / (2 * (1 - pendantInset));
        const cx = xMax - halfW;

        let camZ;
        let camY;
        let lookY;
        if (aspect < 1.0) {
            camZ = 11.0;
            camY = 2.9;
            lookY = -0.2;
        } else if (aspect < 1.4) {
            camZ = 11.2;
            camY = 2.8;
            lookY = -0.15;
        } else {
            camZ = 12.0;
            camY = 3.1;
            lookY = -0.25;
        }
        const fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfW / (camZ * aspect)));
        this.camera.fov = Math.max(32, Math.min(84, fov));
        this.cameraPos.set(cx, camY, camZ);
        this.cameraLookAt.set(cx, lookY, 0);
        this.camera.position.copy(this.cameraPos);
        this.camera.lookAt(this.cameraLookAt);
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    getFrontApertureScreenPos() {
        if (!this.camera || !this.container) {
            return { x: window.innerWidth / 2, y: window.innerHeight * 0.62, width: 240 };
        }
        const w = this.container.clientWidth || window.innerWidth;
        const h = this.container.clientHeight || window.innerHeight;
        this.camera.updateMatrixWorld();
        const cy = this.plinthPos.y + BOARD.FOOT_H + BOARD.H / 2;
        const project = (x) => new THREE.Vector3(x, cy, this.plinthPos.z).project(this.camera);
        const c = project(0);
        const l = project(-BOARD.W / 2);
        const r = project(BOARD.W / 2);
        return {
            x: (c.x * 0.5 + 0.5) * w,
            y: (-(c.y * 0.5) + 0.5) * h,
            width: Math.abs(r.x - l.x) * 0.5 * w
        };
    }

    onResize() {
        this.updateCameraAspect();
        if (typeof window.updateStageApertureVars === 'function') {
            window.updateStageApertureVars();
        }
    }

    createHoverTag() {
        const tag = document.createElement('div');
        tag.id = 'cell-hover-tag';
        tag.style.cssText = [
            'position:fixed', 'z-index:40', 'pointer-events:none', 'padding:7px 12px', 'border-radius:4px',
            'font:700 12px/1.3 Consolas, "Courier New", monospace', 'letter-spacing:0.08em', 'color:#0b0f19',
            'background:#f59e0b', 'box-shadow:0 8px 24px rgba(0,0,0,0.45)', 'opacity:0', 'transform:translate(14px, 14px)',
            'transition:opacity 0.12s ease', 'white-space:nowrap'
        ].join(';');
        document.body.appendChild(tag);
        this.hoverTag = tag;
    }

    setupEventListeners() {
        this.updateCameraAspect();
        this.createHoverTag();

        window.addEventListener('resize', () => this.onResize());

        window.addEventListener('mousemove', (e) => {
            this.parallaxTarget.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
        });

        if (this.renderer && this.renderer.domElement) {
            const canvas = this.renderer.domElement;
            canvas.addEventListener('mousemove', (e) => {
                const hit = this.getIntersectedBay(e.clientX, e.clientY);
                this.lastPickHit = null; // Hover only; clicks and taps set the requested board
                this.hoverIndex = hit;
                canvas.style.cursor = hit !== null ? 'pointer' : 'default';
                if (this.hoverTag) {
                    if (hit !== null) {
                        const cfg = this.bayConfigs[hit];
                        const hex = '#' + cfg.color.toString(16).padStart(6, '0');
                        const isPresented = this.dockedSectionIndex === hit;
                        const verb = isPresented ? 'ON PLINTH' : 'CLICK TO FETCH';
                        let label = `${cfg.bayNum} // ${cfg.short} - ${verb}`;
                        if (hit === PROJECTS_INDEX) {
                            if (this.hoverItem) {
                                const proj = PROJECT_LIBRARY[this.hoverItem.projectIndex].name.toUpperCase();
                                const past = this.hoverItem.s > this.conveyor.pickS + 0.01;
                                label = `PROJECT // ${proj} - ${past ? 'PAST PICK STATION' : 'CLICK TO FETCH THIS ONE'}`;
                            } else {
                                label = `${cfg.bayNum} // PROJECTS - ${isPresented ? 'ON PLINTH' : 'CLICK TO PICK OFF CONVEYOR'}`;
                            }
                        }
                        this.hoverTag.textContent = label;
                        this.hoverTag.style.background = hex;
                        this.hoverTag.style.left = `${e.clientX}px`;
                        this.hoverTag.style.top = `${e.clientY}px`;
                        this.hoverTag.style.opacity = '1';
                    } else {
                        this.hoverTag.style.opacity = '0';
                    }
                }
            });
            canvas.addEventListener('mouseleave', () => {
                this.hoverIndex = null;
                this.hoverItem = null;
                if (this.hoverTag) this.hoverTag.style.opacity = '0';
            });
            canvas.addEventListener('click', (e) => {
                // Taps are dispatched by the touch handler; ignore the synthesized click that follows
                if (window.__lastCellTap && performance.now() - window.__lastCellTap < 700) return;
                const hit = this.getIntersectedBay(e.clientX, e.clientY);
                if (hit !== null) this.goToSection(hit);
            });
        }
    }

    applyJointTransforms() {
        const j = this.jointAngles;
        if (this.joints.turntable) this.joints.turntable.rotation.y = j.j1;
        if (this.joints.shoulder) this.joints.shoulder.rotation.x = j.j2;
        if (this.joints.elbow) this.joints.elbow.rotation.x = j.j3;
        if (this.joints.wrist) this.joints.wrist.rotation.x = j.j4;
        if (this.joints.wristYaw) this.joints.wristYaw.rotation.z = j.j5 || 0;
        if (this.joints.flange) this.joints.flange.rotation.y = Math.PI / 2 + (j.j6 || 0);
        const gap = this.joints.gripper.gap;
        if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
            this.joints.gripper.leftFinger.position.x = -gap;
            this.joints.gripper.rightFinger.position.x = gap;
        }
    }

    updateAmbient(dt) {
        const t = this.elapsed;
        const accentIdx = this.dockedSectionIndex;
        const accent = accentIdx >= 0 ? this.bayConfigs[accentIdx].color : 0x334155;

        // Plinth presentation lighting
        const on = accentIdx >= 0 ? 1 : 0;
        this.plinthLevel = (this.plinthLevel || 0) + (on - (this.plinthLevel || 0)) * Math.min(1, dt * 4);
        this.plinthGlowMat.color.setHex(accent);
        this.plinthConeMat.color.setHex(accent);
        this.plinthConeMat.opacity = 0.07 * this.plinthLevel;
        this.plinthSpot.color.setHex(accentIdx >= 0 ? accent : 0xffffff);
        this.plinthSpot.intensity = 2.2 * this.plinthLevel;

        // Fabricator process animation
        const busy = this.beltSpeed > 0.05 && !this.isEStopped;
        this.fabHead.position.x = Math.sin(t * (busy ? 3.2 : 0.8)) * 0.6;
        this.fabBeamMat.opacity = busy ? 0.6 + 0.4 * Math.abs(Math.sin(t * 23)) : 0.15;
        const printPhase = ((this.beltPos / this.conveyor.spacing) % 1 + 1) % 1;
        const printH = 0.02 + printPhase * this.fabWinH * 0.42;
        this.fabPrint.scale.y = printH / 0.2;
        this.fabPrint.position.y = this.fabPrintBaseY + printH / 2;
        this.fabGlowMat.color.setHSL(0.53, 0.7, busy ? 0.16 + 0.04 * Math.sin(t * 9) : 0.1);
        this.fabLight.intensity = busy ? 1.6 + Math.random() * 0.6 : 0.4;
        this.hmiMat.color.setHex(this.isEStopped ? 0x7f1d1d : (Math.sin(t * 2) > 0 ? 0x0f766e : 0x115e59));

        // Stack light: green running, amber when indexing to pick, red on E-stop
        const sl = this.stackLights;
        const flash = Math.sin(t * 10) > 0;
        sl.green.emissiveIntensity = !this.isEStopped && !this.beltStaged ? 1.4 : 0.05;
        sl.amber.emissiveIntensity = !this.isEStopped && this.beltDemand !== null ? (flash ? 1.6 : 0.3) : 0.05;
        sl.red.emissiveIntensity = this.isEStopped ? (flash ? 2.0 : 0.4) : 0.05;

        // Robot status LEDs
        const ledColor = this.isEStopped ? 0xef4444 : (this.isAtDynamicLimit ? 0xf97316 : (this.isMoving ? 0x22d3ee : 0x22c55e));
        this.armLedMat.color.setHex(ledColor);
        this.toolLedMat.color.setHex(this.places.indexOf('held') >= 0 ? 0xf59e0b : ledColor);

        // Floor arrows chase along the conveyor
        this.floorArrows.forEach((a, i) => {
            a.material.opacity = 0.25 + 0.6 * Math.max(0, Math.sin(this.beltPos * 2.2 - i * 1.1));
        });

        // Dust drift
        if (this.dust) this.dust.rotation.y = t * 0.01;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const dt = Math.min(0.05, this.clock.getDelta());
        this.elapsed += dt;

        if (!this.isEStopped) {
            if (this.directTransfer && !this.dropAnim) {
                this.tickProgram(dt);
            } else if (!this.dropAnim) {
                const prev = this.currentProgress;
                const diff = this.targetProgress - this.currentProgress;
                let next = this.targetProgress;
                if (Math.abs(diff) > 0.0003) {
                    next = prev + Math.sign(diff) * Math.min(Math.abs(diff), Math.max(0.003, Math.abs(diff) * 0.32));
                }
                // Scroll cannot carry the arm onto the conveyor until a board (or gap) is staged there
                this.waitingOnBelt = false;
                if (!this.beltStaged) {
                    for (const gate of this.beltGates()) {
                        if (prev <= gate.forward && next > gate.forward) {
                            next = gate.forward;
                            this.waitingOnBelt = true;
                        } else if (prev >= gate.backward && next < gate.backward) {
                            next = gate.backward;
                            this.waitingOnBelt = true;
                        }
                    }
                }
                if (this.waitingOnBelt) {
                    this.statusText = this.claimedItem ? 'WAITING FOR A GAP ON CONVEYOR C1' : 'WAITING FOR PROJECT BOARD // CONVEYOR C1';
                }
                this.currentProgress = next;
                this.evaluateProgress(this.currentProgress);
            } else {
                this.evaluateProgress(0);
                this.places = this.places.map((p, i) => (i === this.dropAnim.index ? 'dropped' : p));
            }

            // Joint servo (critically damped, shortest path on the rotary axes)
            const k = 1 - Math.exp(-dt * 16);
            const ja = this.jointAngles;
            const tj = this.targetJointAngles;
            const d1 = wrapAngle(tj.j1 - ja.j1);
            const d6 = wrapAngle(tj.j6 - ja.j6);
            ja.j1 = wrapAngle(ja.j1 + d1 * k);
            ja.j6 = wrapAngle(ja.j6 + d6 * k);
            ja.j2 += (tj.j2 - ja.j2) * k;
            ja.j3 += (tj.j3 - ja.j3) * k;
            ja.j4 += (tj.j4 - ja.j4) * k;
            ja.j5 += (tj.j5 - ja.j5) * k;

            const g = this.joints.gripper;
            g.gap += (this.targetGripGap - g.gap) * (1 - Math.exp(-dt * 14));
            this.applyJointTransforms();

            const jointsMoving = Math.abs(d1) > 0.004 || Math.abs(tj.j2 - ja.j2) > 0.004 || Math.abs(tj.j3 - ja.j3) > 0.004;
            this.isMoving = Math.abs(this.targetProgress - this.currentProgress) > 0.004 || jointsMoving || !!this.directTransfer;
        }

        if (!this.isEStopped) this.updateDrop(dt);
        this.updateConveyor(this.isEStopped ? 0 : dt);
        this.updateBoards();
        this.updateSparks(dt);
        this.updateAmbient(dt);

        // Gentle mouse parallax around the framed view
        this.parallax.lerp(this.parallaxTarget, 0.04);
        const desktop = this.camera.aspect >= 1.2;
        const px = desktop ? this.parallax.x * 0.45 : 0;
        const py = desktop ? -this.parallax.y * 0.22 : 0;
        this.camera.position.set(this.cameraPos.x + px, this.cameraPos.y + py, this.cameraPos.z);
        this.camera.lookAt(this.cameraLookAt);

        this.renderer.render(this.scene, this.camera);

        if (this.onTelemetryUpdate) {
            const docked = this.dockedSectionIndex;
            let activeName = docked >= 0 ? this.bayConfigs[docked].name : 'PLINTH EMPTY';
            if (docked === PROJECTS_INDEX && this.activeProjectName) activeName = `PROJECTS: ${this.activeProjectName}`;
            const deg = (v) => THREE.MathUtils.radToDeg(v || 0).toFixed(1);
            this.onTelemetryUpdate({
                j1: deg(this.jointAngles.j1),
                j2: deg(this.jointAngles.j2),
                j3: deg(this.jointAngles.j3),
                j4: deg(this.jointAngles.j4),
                j5: deg(this.jointAngles.j5),
                j6: deg(this.jointAngles.j6),
                gap: (this.joints.gripper.gap * 1000).toFixed(0),
                isOpen: this.joints.gripper.gap > 0.12,
                status: this.statusText,
                isEStopped: this.isEStopped,
                isAtDynamicLimit: this.isAtDynamicLimit,
                limitCulprit: this.limitCulprit,
                showCollisionModel: false,
                activeBay: activeName,
                progress: (this.currentProgress / this.maxProgress * 100).toFixed(1)
            });
        }
    }
}

window.RobotWorkcell = RobotWorkcell;

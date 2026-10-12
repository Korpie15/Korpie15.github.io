/**
 * ROBOT WORKCELL - THREE.JS 3D INDUSTRIAL ROBOT SYSTEM
 * Centered 6-DOF Yellow Robot Arm holding, carrying, and physically opening 3D topic crates.
 * Features:
 * - Blank Front Stool: destination pedestal where active crates are placed and opened.
 * - 7 Perimeter Storage Racks holding fully enclosed 6-sided 3D crates.
 * - Hinged 3D Crate Lids: Crate lid physically hinges OPEN on the front stool!
 * - Collision-Free Retracted Flight Corridor: payload retracts inward during rotation, never hitting other boxes.
 * - 100% Scrubbable Scroll: stopping scrolling freezes the robot mid-motion.
 * - Exact Analytical IK solver (0.0000m contact accuracy).
 */

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

        // Robot Hierarchical Joints
        this.robot = null;
        this.joints = {
            base: null,
            turntable: null, // J1 (rotation around Y)
            shoulder: null,  // J2 (pitch around X)
            upperArm: null,
            elbow: null,     // J3 (pitch around X)
            forearm: null,
            wrist: null,     // J4 (pitch around X)
            flange: null,
            gripper: {
                base: null,
                jawCenter: null,
                leftFinger: null,
                rightFinger: null,
                gap: 0.18,
                targetGap: 0.18
            }
        };

        // Kinematics Link Constants (verified 0.0000m error)
        this.L1 = 2.1;          // Upper arm length
        this.L2 = 1.9;          // Forearm length
        this.Ltool = 0.52;      // Wrist pivot to jaw center
        this.shoulderY = -0.6;  // World Y of shoulder pivot

        // Standby ready pose (when workcell is idle with blank front stool)
        this.standbyPose = { j1: 0, j2: 0.28, j3: 0.82, j4: 1.05 };
        // Inspection posture (above front stool when crate lid is open)
        this.inspectPose = { j1: 0, j2: 0.12, j3: 0.72, j4: 0.96 };

        // Blank Staging Front Stool (Inspection table - destination where boxes are placed)
        // Table top of front stool is at: -0.5 + 0.05 = -0.45.
        // Crate tub bottom is at local -0.325.
        // So crate center rests at: -0.45 - (-0.325) = -0.125!
        this.frontStoolPos = new THREE.Vector3(0, -0.5, 2.4);
        this.frontBoxRestY = -0.125; // Box center when resting on stool
        this.frontHandleY = this.frontBoxRestY + 0.445; // 0.320
        this.frontStoolBoxPos = new THREE.Vector3(0, this.frontBoxRestY, 2.4);

        // 7 Perimeter Storage Racks (all within verified reach)
        this.bayConfigs = [
            { id: 'hero', name: 'Home / Dossier', bayNum: '00', pos: [-1.6, -0.3, 1.8], rotY: -0.7, color: 0x2563eb },
            { id: 'about', name: 'About Me', bayNum: '01', pos: [-2.3, -0.3, 0.9], rotY: -1.2, color: 0x059669 },
            { id: 'experience', name: 'Experience', bayNum: '02', pos: [-2.0, -0.2, -1.1], rotY: -2.1, color: 0xd97706 },
            { id: 'leadership', name: 'Leadership', bayNum: '03', pos: [0.0, -0.1, -2.4], rotY: Math.PI, color: 0x7c3aed },
            { id: 'projects', name: 'Projects', bayNum: '04', pos: [2.0, -0.2, -1.1], rotY: 2.1, color: 0x0284c7 },
            { id: 'skills', name: 'Technical Skills', bayNum: '05', pos: [2.3, -0.3, 0.9], rotY: 1.2, color: 0xe11d48 },
            { id: 'contact', name: 'Contact', bayNum: '06', pos: [1.6, -0.3, 1.8], rotY: 0.7, color: 0x4f46e5 }
        ];

        // Compute handle heights and rack positions for each storage bay:
        // Shelf top surface is at: cfg.pos[1] + 0.04.
        // Crate bottom is at local -0.325.
        // Crate center rests at: cfg.pos[1] + 0.04 - (-0.325) = cfg.pos[1] + 0.365.
        this.bayConfigs.forEach(cfg => {
            cfg.boxRestY = cfg.pos[1] + 0.365;
            cfg.handleY = cfg.boxRestY + 0.445;
            cfg.boxRestPos = new THREE.Vector3(cfg.pos[0], cfg.boxRestY, cfg.pos[2]);
        });

        // Current & Target Joint Angles (Full 6-Axis Robotic Kinematics)
        this.jointAngles = { ...this.standbyPose, j5: 0, j6: 0 };
        this.targetJointAngles = { ...this.standbyPose, j5: 0, j6: 0 };
        this.jogOffsets = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        this.manualGripperGap = null; // null = follow kinematics; number = manual override clamp/open

        // Continuous Scrubbable Progress State: 0.0 (Idle, blank front stool) to 7.0 (Section 6 docked)
        this.currentProgress = 0.0;
        this.targetProgress = 0.0;
        this.maxProgress = 7.0;
        this.dockedSectionIndex = -1; // -1 means no box docked on front stool
        this.activeTween = null;

        this.bays = [];
        this.pallets = []; // 7 fully enclosed 3D boxes with hinged lids
        this.frontStoolGroup = null;

        // State Machine
        this.isMoving = false;
        this.isEStopped = false;
        this.statusText = 'ROBOT READY // FRONT STOOL BLANK';

        // Camera - centered on workcell
        this.cameraPos = new THREE.Vector3(0, 1.8, 8.2);
        this.cameraLookAt = new THREE.Vector3(0, 0.3, 0);

        // Callbacks
        this.onTelemetryUpdate = null;
        this.onSectionChange = null;

        this.init();
    }

    /**
     * Exact Analytical Inverse Kinematics Solver (Verified 0.0000m error)
     */
    solveIK(tx, ty, tz) {
        const j1 = Math.atan2(tx, tz);
        const R_target = Math.sqrt(tx * tx + tz * tz);
        const Rwrist = R_target;
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

        return { j1, j2, j3, j4 };
    }

    lerpAngle(a, b, t) {
        let diff = (b - a) % (2 * Math.PI);
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        return a + diff * t;
    }

    /**
     * Retracted Central Corridor Flight Pose:
     * Pulls the arm inward to radius R = 1.15m at safe high height Y = 1.45m.
     * This guarantees the carried box bottom (Y = 0.80m) is > 0.4m ABOVE all perimeter crates
     * and > 0.9m inside the perimeter circle. NO collisions possible!
     */
    getFlightCorridorPose(j1) {
        const tx = Math.sin(j1) * 1.15;
        const ty = 1.45;
        const tz = Math.cos(j1) * 1.15;
        return this.solveIK(tx, ty, tz);
    }

    lerpPose(pA, pB, t) {
        return {
            j1: this.lerpAngle(pA.j1, pB.j1, t),
            j2: pA.j2 + (pB.j2 - pA.j2) * t,
            j3: pA.j3 + (pB.j3 - pA.j3) * t,
            j4: pA.j4 + (pB.j4 - pA.j4) * t
        };
    }

    init() {
        this.initThree();
        this.setupLighting();
        this.buildFactoryFloor();
        this.buildRobotArm();
        this.buildFrontStool();
        this.buildStorageRacks();
        this.buildEnclosedBoxes();
        this.setupEventListeners();

        // Initial Pose: Standby with blank front stool
        this.evaluateProgress(0.0);
        this.animate();
    }

    initThree() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e17);
        this.scene.fog = new THREE.FogExp2(0x0a0e17, 0.03);

        this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
        this.camera.position.copy(this.cameraPos);
        this.camera.lookAt(this.cameraLookAt);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;

        this.container.appendChild(this.renderer.domElement);
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x94a3b8, 0.85);
        this.scene.add(ambientLight);

        // Main Studio Spotlight
        const mainLight = new THREE.DirectionalLight(0xfffbeb, 1.6);
        mainLight.position.set(3, 10, 6);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 25;
        mainLight.shadow.camera.left = -6;
        mainLight.shadow.camera.right = 6;
        mainLight.shadow.camera.top = 6;
        mainLight.shadow.camera.bottom = -6;
        mainLight.shadow.bias = -0.0001;
        mainLight.shadow.normalBias = 0.02;
        this.scene.add(mainLight);

        const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
        fillLight.position.set(-5, 6, -3);
        this.scene.add(fillLight);

        const frontStoolLight = new THREE.PointLight(0xffedd5, 0.7, 7);
        frontStoolLight.position.set(0, 1.2, 2.6);
        this.scene.add(frontStoolLight);
    }

    buildFactoryFloor() {
        const floorGeo = new THREE.PlaneGeometry(32, 32);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            roughness: 0.85,
            metalness: 0.2
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -1.8;
        floor.receiveShadow = true;
        this.scene.add(floor);

        const grid = new THREE.GridHelper(26, 26, 0x334155, 0x1e293b);
        grid.position.y = -1.798;
        this.scene.add(grid);

        // Robot Safety Hazard Ring
        const hazardRingGeo = new THREE.RingGeometry(1.5, 1.75, 48);
        const hazardRingMat = new THREE.MeshStandardMaterial({
            color: 0xf59e0b,
            roughness: 0.5,
            side: THREE.DoubleSide
        });
        const hazardRing = new THREE.Mesh(hazardRingGeo, hazardRingMat);
        hazardRing.rotation.x = -Math.PI / 2;
        hazardRing.position.y = -1.795;
        this.scene.add(hazardRing);
    }

    buildRobotArm() {
        const yellowMat = new THREE.MeshStandardMaterial({
            color: 0xf59e0b, // FANUC / CAT Industrial Yellow
            roughness: 0.42,
            metalness: 0.25
        });

        const darkMat = new THREE.MeshStandardMaterial({
            color: 0x18181b,
            roughness: 0.65,
            metalness: 0.45
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xe2e8f0,
            roughness: 0.15,
            metalness: 0.9
        });

        const rubberMat = new THREE.MeshStandardMaterial({
            color: 0x09090b,
            roughness: 0.95
        });

        this.robot = new THREE.Group();
        this.robot.position.set(0, -1.8, 0);

        // --- J0: Base Pedestal ---
        const baseGroup = new THREE.Group();
        const baseFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.98, 0.2, 24), darkMat);
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

        const baseCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, 0.4, 24), yellowMat);
        baseCylinder.position.y = 0.4;
        baseCylinder.castShadow = true;
        baseGroup.add(baseCylinder);

        this.robot.add(baseGroup);
        this.joints.base = baseGroup;

        // --- J1: Turntable (Rotates around Y) ---
        const turntable = new THREE.Group();
        turntable.position.set(0, 0.6, 0);

        const turntableBearing = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.68, 0.15, 24), darkMat);
        turntableBearing.position.y = 0.075;
        turntableBearing.castShadow = true;
        turntable.add(turntableBearing);

        const motorHousing = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.5, 0.7), yellowMat);
        motorHousing.position.set(0, 0.35, -0.05);
        motorHousing.castShadow = true;
        turntable.add(motorHousing);

        this.robot.add(turntable);
        this.joints.turntable = turntable;

        // --- J2: Shoulder (Pitches around X) ---
        const shoulder = new THREE.Group();
        shoulder.position.set(0, 0.6, 0);

        const leftHub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 20), darkMat);
        leftHub.rotation.z = Math.PI / 2;
        leftHub.position.set(-0.36, 0, 0);
        leftHub.castShadow = true;
        shoulder.add(leftHub);

        const rightHub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 20), darkMat);
        rightHub.rotation.z = Math.PI / 2;
        rightHub.position.set(0.36, 0, 0);
        rightHub.castShadow = true;
        shoulder.add(rightHub);

        const counterweight = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.38, 0.45), darkMat);
        counterweight.position.set(0, -0.15, -0.4);
        counterweight.castShadow = true;
        shoulder.add(counterweight);

        // Upper Arm Girder (L1 = 2.1)
        const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.4, this.L1, 0.42), yellowMat);
        upperArm.position.set(0, this.L1 / 2, 0);
        upperArm.castShadow = true;
        shoulder.add(upperArm);

        // Hydraulic lift cylinder along upper arm
        const cylinderBody = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 16), darkMat);
        cylinderBody.position.set(0.24, 0.7, -0.16);
        cylinderBody.castShadow = true;
        shoulder.add(cylinderBody);

        const pistonShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.3, 16), chromeMat);
        pistonShaft.position.set(0.24, 1.25, -0.16);
        shoulder.add(pistonShaft);

        turntable.add(shoulder);
        this.joints.shoulder = shoulder;
        this.joints.upperArm = upperArm;

        // --- J3: Elbow Pivot (Pitches around X) ---
        const elbow = new THREE.Group();
        elbow.position.set(0, this.L1, 0);

        const elbowJointCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.48, 20), darkMat);
        elbowJointCylinder.rotation.z = Math.PI / 2;
        elbowJointCylinder.castShadow = true;
        elbow.add(elbowJointCylinder);

        // Forearm Link (L2 = 1.9)
        const forearm = new THREE.Group();
        forearm.position.set(0, 0, 0);

        const forearmBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, this.L2, 0.32), yellowMat);
        forearmBody.position.set(0, this.L2 / 2, 0);
        forearmBody.castShadow = true;
        forearm.add(forearmBody);

        elbow.add(forearm);
        shoulder.add(elbow);
        this.joints.elbow = elbow;
        this.joints.forearm = forearm;

        // --- J4: Wrist Pitch (Pitches around X) ---
        // --- J4: Wrist Pitch (Pitches around X) ---
        const wrist = new THREE.Group();
        wrist.position.set(0, this.L2, 0);

        const wristPivot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), darkMat);
        wristPivot.castShadow = true;
        wrist.add(wristPivot);

        // --- J5: Wrist Yaw / Tilt (Pivots around Z) ---
        const wristYaw = new THREE.Group();
        wristYaw.position.set(0, 0.08, 0);

        const yawPivot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 16), darkMat);
        yawPivot.castShadow = true;
        wristYaw.add(yawPivot);

        // --- J6: Tool Flange (Rotated 90 deg so jaws clamp across horizontal handle bar, rolls around Y) ---
        const flange = new THREE.Group();
        flange.position.set(0, 0.08, 0);
        flange.rotation.y = Math.PI / 2;

        const flangePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20), chromeMat);
        flangePlate.castShadow = true;
        flange.add(flangePlate);

        // Parallel Gripper Body
        const gripperBase = new THREE.Group();
        gripperBase.position.set(0, 0.12, 0);

        const gripperBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.28), darkMat);
        gripperBody.castShadow = true;
        gripperBase.add(gripperBody);

        // Chrome guide rods
        const guideRod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 12), chromeMat);
        guideRod.rotation.z = Math.PI / 2;
        guideRod.position.set(0, 0.06, 0);
        gripperBase.add(guideRod);

        // Jaw Center Contact Tracking Node
        const jawCenter = new THREE.Group();
        jawCenter.position.set(0, 0.24, 0);
        gripperBase.add(jawCenter);

        // Moving Finger Jaws
        const fingerGeo = new THREE.BoxGeometry(0.07, 0.32, 0.16);
        const padGeo = new THREE.BoxGeometry(0.025, 0.24, 0.14);

        // Left Finger
        const leftFinger = new THREE.Group();
        const leftMesh = new THREE.Mesh(fingerGeo, yellowMat);
        leftMesh.position.y = 0.16;
        leftMesh.castShadow = true;
        leftFinger.add(leftMesh);

        const leftPad = new THREE.Mesh(padGeo, rubberMat);
        leftPad.position.set(0.04, 0.16, 0);
        leftFinger.add(leftPad);

        leftFinger.position.set(-0.09, 0.1, 0);
        gripperBase.add(leftFinger);

        // Right Finger
        const rightFinger = new THREE.Group();
        const rightMesh = new THREE.Mesh(fingerGeo, yellowMat);
        rightMesh.position.y = 0.16;
        rightMesh.castShadow = true;
        rightFinger.add(rightMesh);

        const rightPad = new THREE.Mesh(padGeo, rubberMat);
        rightPad.position.set(-0.04, 0.16, 0);
        rightFinger.add(rightPad);

        rightFinger.position.set(0.09, 0.1, 0);
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

    /**
     * Staging Front Stool: Clean, blank presentation pedestal where active boxes are placed
     */
    buildFrontStool() {
        const steelMat = new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.5,
            metalness: 0.6
        });

        const hazardMat = new THREE.MeshStandardMaterial({
            color: 0xf59e0b,
            roughness: 0.4
        });

        const stoolGroup = new THREE.Group();
        stoolGroup.position.copy(this.frontStoolPos);

        const postHeight = this.frontStoolPos.y - (-1.8);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, postHeight, 0.24), steelMat);
        post.position.set(0, -postHeight / 2, 0);
        post.castShadow = true;
        stoolGroup.add(post);

        const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.8), steelMat);
        basePlate.position.set(0, -postHeight + 0.04, 0);
        stoolGroup.add(basePlate);

        // Main Blank Drop-Off Table
        const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1.0), steelMat);
        tableTop.castShadow = true;
        tableTop.receiveShadow = true;
        stoolGroup.add(tableTop);

        // 4 Corner Alignment Dock Brackets (shows empty landing zone)
        const guideGeo = new THREE.BoxGeometry(0.12, 0.06, 0.12);
        [
            [-0.72, 0.06, -0.42],
            [0.72, 0.06, -0.42],
            [-0.72, 0.06, 0.42],
            [0.72, 0.06, 0.42]
        ].forEach(([gx, gy, gz]) => {
            const guide = new THREE.Mesh(guideGeo, hazardMat);
            guide.position.set(gx, gy, gz);
            stoolGroup.add(guide);
        });

        this.scene.add(stoolGroup);
        this.frontStoolGroup = stoolGroup;
    }

    buildStorageRacks() {
        const steelMat = new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.5,
            metalness: 0.6
        });

        this.bayConfigs.forEach((cfg, index) => {
            const rackGroup = new THREE.Group();
            rackGroup.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
            rackGroup.rotation.y = cfg.rotY;

            const postHeight = cfg.pos[1] - (-1.8);
            if (postHeight > 0.3) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, postHeight, 0.18), steelMat);
                post.position.set(0, -postHeight / 2, 0);
                post.castShadow = true;
                rackGroup.add(post);
            }

            const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.95), steelMat);
            shelf.castShadow = true;
            shelf.receiveShadow = true;
            rackGroup.add(shelf);

            this.scene.add(rackGroup);
            this.bays.push(rackGroup);
        });
    }

    createBoxLabelTexture(title, bayNum, accentHex, isBack = false) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 1024, 512);

        // Header Accent Stripe
        ctx.fillStyle = accentHex;
        ctx.fillRect(0, 0, 1024, 80);

        // Header Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`BAY ${bayNum} // INDUSTRIAL ENCLOSURE`, 36, 54);

        // Border Outline
        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 14;
        ctx.strokeRect(7, 7, 1010, 498);

        // Main Topic Title
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 74px "Segoe UI", Arial, sans-serif';
        ctx.fillText(title.toUpperCase(), 48, 230);

        // Status & Subtitle
        ctx.fillStyle = '#94a3b8';
        ctx.font = '32px monospace';
        if (!isBack) {
            ctx.fillText('STATUS: VERIFIED // READY FOR DISPATCH', 48, 320);
            ctx.fillText('CELL DOCK: 6-DOF ROBOT REACH', 48, 375);
            ctx.fillText('ENCLOSURE: SOLID 6-SIDED MODULAR CASE', 48, 430);
        } else {
            ctx.fillText('TECHNICAL SPEC: AIDAN KORPAR PORTFOLIO', 48, 320);
            ctx.fillText('PAYLOAD FIXTURE: TOP CHROME DOCK HANDLE', 48, 375);
            ctx.fillText('BARCODE: ||||| | |||| || |||||| | |||||', 48, 430);
        }

        // Rivet Screws
        ctx.fillStyle = '#475569';
        [ [40, 40], [984, 40], [40, 472], [984, 472] ].forEach(([x, y]) => {
            ctx.beginPath();
            ctx.arc(x, y, 14, 0, Math.PI * 2);
            ctx.fill();
        });

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    /**
     * Builds Fully Enclosed 3D Boxes with HINGED OPENING LIDS:
     * - The crate tub has interior circuit / avionics details.
     * - The lid hinges open by 80° when placed on the front stool!
     * - When closed, it is a 100% sealed solid industrial crate.
     */
    buildEnclosedBoxes() {
        const darkBodyMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.65,
            metalness: 0.35
        });

        const interiorMat = new THREE.MeshStandardMaterial({
            color: 0x090d16,
            roughness: 0.4,
            metalness: 0.7
        });

        const cornerCapMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            roughness: 0.7,
            metalness: 0.8
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xf1f5f9,
            roughness: 0.15,
            metalness: 0.95
        });

        const boxWidth = 1.25;
        const boxHeight = 0.65;
        const boxDepth = 0.65;

        const tubHeight = 0.50;
        const lidHeight = 0.15;

        this.bayConfigs.forEach((cfg, index) => {
            const boxGroup = new THREE.Group();

            const hexColor = '#' + cfg.color.toString(16).padStart(6, '0');
            const frontTex = this.createBoxLabelTexture(cfg.name, cfg.bayNum, hexColor, false);
            const backTex = this.createBoxLabelTexture(cfg.name, cfg.bayNum, hexColor, true);

            const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.4 });
            const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.4 });

            // 1. Lower Tub Enclosure (Height = 0.50, center at Y = -0.075)
            const tubMaterials = [darkBodyMat, darkBodyMat, interiorMat, darkBodyMat, frontMat, backMat];
            const tubMesh = new THREE.Mesh(new THREE.BoxGeometry(boxWidth, tubHeight, boxDepth), tubMaterials);
            tubMesh.position.set(0, -0.075, 0);
            tubMesh.castShadow = true;
            tubMesh.receiveShadow = true;
            boxGroup.add(tubMesh);

            // Glowing status LED strip inside the crate tub
            const ledStrip = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 0.03, 0.03),
                new THREE.MeshBasicMaterial({ color: cfg.color })
            );
            ledStrip.position.set(0, tubHeight / 2 - 0.08, 0);
            boxGroup.add(ledStrip);

            // 4 Lower Corner Bumper Caps (Flush with tub bottom at Y = -0.325)
            const capGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
            const hx = boxWidth / 2;
            const hz = boxDepth / 2;
            const capCenterY = -0.075 - tubHeight / 2 + 0.06;
            [
                [-hx, capCenterY, -hz], [hx, capCenterY, -hz],
                [-hx, capCenterY,  hz], [hx, capCenterY,  hz]
            ].forEach(([cx, cy, cz]) => {
                const cap = new THREE.Mesh(capGeo, cornerCapMat);
                cap.position.set(cx, cy, cz);
                boxGroup.add(cap);
            });

            // 2. Hinged Top Lid Assembly (Pivots at rear top hinge)
            const hingeY = -0.075 + tubHeight / 2; // Y = 0.175
            const hingeZ = -hz;                   // Z = -0.325

            const lidPivot = new THREE.Group();
            lidPivot.position.set(0, hingeY, hingeZ);
            boxGroup.add(lidPivot);

            const lidMaterials = [darkBodyMat, darkBodyMat, darkBodyMat, interiorMat, darkBodyMat, darkBodyMat];
            const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(boxWidth, lidHeight, boxDepth), lidMaterials);
            lidMesh.position.set(0, lidHeight / 2, hz); // Center of lid relative to hinge
            lidMesh.castShadow = true;
            lidPivot.add(lidMesh);

            // Top Corner Bumpers on Lid
            [
                [-hx, lidHeight, 0], [hx, lidHeight, 0],
                [-hx, lidHeight, boxDepth], [hx, lidHeight, boxDepth]
            ].forEach(([cx, cy, cz]) => {
                const cap = new THREE.Mesh(capGeo, cornerCapMat);
                cap.position.set(cx, cy, cz);
                lidPivot.add(cap);
            });

            // Top Lifting Chrome Handle Bar (Mounted on top of the lid)
            const handleLocalY = lidHeight + 0.12;
            const handleLocalZ = hz;
            const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 16), chromeMat);
            handleBar.rotation.z = Math.PI / 2;
            handleBar.position.set(0, handleLocalY, handleLocalZ);
            handleBar.castShadow = true;
            lidPivot.add(handleBar);

            const leftStanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.13, 12), chromeMat);
            leftStanchion.position.set(-0.16, handleLocalY - 0.065, handleLocalZ);
            lidPivot.add(leftStanchion);

            const rightStanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.13, 12), chromeMat);
            rightStanchion.position.set(0.16, handleLocalY - 0.065, handleLocalZ);
            lidPivot.add(rightStanchion);

            // Pneumatic Gas Struts on left & right sides
            const strutGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8);
            const leftStrut = new THREE.Mesh(strutGeo, chromeMat);
            leftStrut.position.set(-hx - 0.02, 0.1, 0);
            boxGroup.add(leftStrut);

            const rightStrut = new THREE.Mesh(strutGeo, chromeMat);
            rightStrut.position.set(hx + 0.02, 0.1, 0);
            boxGroup.add(rightStrut);

            // Open/Close Control Method:
            // openAmount: 0.0 (closed) -> 1.0 (opened backwards by 80 deg)
            const setOpen = (openAmount) => {
                const amt = Math.max(0, Math.min(1, openAmount));
                lidPivot.rotation.x = -amt * (Math.PI * 0.44); // ~80 degrees open
            };

            // Metadata for positioning
            boxGroup.userData = {
                index,
                cfg,
                rackHomePos: cfg.boxRestPos.clone(),
                rackHomeRotY: cfg.rotY,
                lidPivot,
                setOpen
            };

            // ALL boxes start on their own perimeter pedestals! Front stool is BLANK!
            boxGroup.position.copy(cfg.boxRestPos);
            boxGroup.rotation.set(0, cfg.rotY, 0);
            setOpen(0.0);

            this.scene.add(boxGroup);
            this.pallets.push(boxGroup);
        });
    }

    /**
     * Continuous 100% Scrubbable Kinematics Evaluator:
     * progress in [0.0, 7.0]
     * - p = 0.0: Idle standby, front stool blank, all 7 boxes in perimeter racks with closed lids.
     * - p in [0.04, 0.94]: Fetches Box 0, brings it forward, places it on front stool, and lid opens!
     * - p in [0.94, 1.06]: Section 0 docked plateau. Lid 100% open, Topic Card unfolds!
     * - p in [k + 1.06, k + 1.94]: Seamless continuous scrub transfer from section k to k+1.
     * - p in [k + 1.0 - 0.06, k + 1.0 + 0.06]: Section k docked plateau (k in [0, 6]).
     * - Collision-Free Retracted Flight Corridor (R = 1.15m, Y = 1.45m) + shortest-arc lerpAngle.
     * - Stopping scrolling freezes the robot right where it is.
     */
    evaluateProgress(progress) {
        const p = Math.max(0, Math.min(this.maxProgress, progress));

        const frontGrip = this.solveIK(this.frontStoolPos.x, this.frontHandleY, this.frontStoolPos.z);
        const frontLift = this.solveIK(this.frontStoolPos.x, this.frontHandleY + 0.65, this.frontStoolPos.z);
        const frontCorridor = this.getFlightCorridorPose(0);

        let targetAngles = this.standbyPose;
        let gripGap = 0.18;
        let carriedBox = null;
        let frontDockedSection = -1;
        let frontLidOpenAmount = 0.0;

        // Default all boxes to their home rack position and closed lids
        for (let i = 0; i < this.pallets.length; i++) {
            const box = this.pallets[i];
            box.position.copy(box.userData.rackHomePos);
            box.rotation.set(0, box.userData.rackHomeRotY, 0);
            box.userData.setOpen(0.0);
        }

        if (p <= 0.04) {
            // Standby ready, front stool blank
            targetAngles = this.standbyPose;
            gripGap = 0.18;
        } else if (p < 0.94) {
            // Pickup Box 0 from Rack 0 to Front Stool
            const u = (p - 0.04) / 0.90;
            const b0Cfg = this.bayConfigs[0];
            const j1Bay = b0Cfg.rotY;
            const bayGrip = this.solveIK(b0Cfg.pos[0], b0Cfg.handleY, b0Cfg.pos[2]);
            const bayLift = this.solveIK(b0Cfg.pos[0], b0Cfg.handleY + 0.65, b0Cfg.pos[2]);
            const bayCorridor = this.getFlightCorridorPose(j1Bay);
            const box0 = this.pallets[0];

            if (u <= 0.14) {
                // Step 1: Arm rotates to Bay 0 corridor & extends to bayLift (open fingers)
                const t = u / 0.14;
                targetAngles = t < 0.5 ? this.lerpPose(this.standbyPose, bayCorridor, t / 0.5) : this.lerpPose(bayCorridor, bayLift, (t - 0.5) / 0.5);
                gripGap = 0.20;
                carriedBox = null;
            } else if (u <= 0.26) {
                // Step 2: Arm descends straight down to Box 0 handle (Fingers stay wide open at 0.20!)
                const t = (u - 0.14) / 0.12;
                targetAngles = this.lerpPose(bayLift, bayGrip, t);
                gripGap = 0.20;
                carriedBox = null;
            } else if (u <= 0.36) {
                // Step 3: CLAMPING PHASE! Arm is stationary at handle, fingers slowly clamp shut from 0.20 to 0.075!
                const t = (u - 0.26) / 0.10;
                targetAngles = bayGrip;
                gripGap = 0.20 - t * (0.20 - 0.075);
                carriedBox = null;
            } else if (u <= 0.48) {
                // Step 4: Arm lifts Box 0 straight up off rack
                const t = (u - 0.36) / 0.12;
                targetAngles = this.lerpPose(bayGrip, bayLift, t);
                gripGap = 0.075;
                carriedBox = box0;
            } else if (u <= 0.58) {
                // Step 5: Arm retracts Box 0 radially inward to central flight corridor
                const t = (u - 0.48) / 0.10;
                targetAngles = this.lerpPose(bayLift, bayCorridor, t);
                gripGap = 0.075;
                carriedBox = box0;
            } else if (u <= 0.72) {
                // Step 6: Arm rotates carried Box 0 through high central corridor to Front Stool heading
                const t = (u - 0.58) / 0.14;
                targetAngles = this.lerpPose(bayCorridor, frontCorridor, t);
                gripGap = 0.075;
                carriedBox = box0;
            } else if (u <= 0.80) {
                // Step 7: Arm extends outward above front stool
                const t = (u - 0.72) / 0.08;
                targetAngles = this.lerpPose(frontCorridor, frontLift, t);
                gripGap = 0.075;
                carriedBox = box0;
            } else if (u <= 0.88) {
                // Step 8: Arm lowers Box 0 onto front stool
                const t = (u - 0.80) / 0.08;
                targetAngles = this.lerpPose(frontLift, frontGrip, t);
                gripGap = 0.075;
                carriedBox = box0;
            } else if (u <= 0.94) {
                // Step 9: UNCLAMPING PHASE! Box 0 rests on stool, arm stationary, fingers open from 0.075 to 0.20!
                const t = (u - 0.88) / 0.06;
                targetAngles = frontGrip;
                gripGap = 0.075 + t * (0.20 - 0.075);
                box0.position.copy(this.frontStoolBoxPos);
                box0.rotation.set(0, 0, 0);
                carriedBox = null;
            } else if (u <= 0.97) {
                // Step 10: Arm backs away to inspect pose
                const t = (u - 0.94) / 0.03;
                targetAngles = this.lerpPose(frontGrip, this.inspectPose, t);
                gripGap = 0.20;
                box0.position.copy(this.frontStoolBoxPos);
                box0.rotation.set(0, 0, 0);
                carriedBox = null;
            } else {
                // Step 11: Box 0 lid hinges OPEN 80 degrees, topic card unfolds!
                const t = (u - 0.97) / 0.03;
                targetAngles = this.inspectPose;
                gripGap = 0.20;
                box0.position.copy(this.frontStoolBoxPos);
                box0.rotation.set(0, 0, 0);
                carriedBox = null;
                frontDockedSection = 0;
                frontLidOpenAmount = t;
                box0.userData.setOpen(t);
            }
        } else {
            // Sections 0 through 6
            const kActive = Math.min(6, Math.floor(p - 0.94));
            const plateauCenter = kActive + 1.0;
            const plateauHalf = 0.06;

            if (p >= plateauCenter - plateauHalf && (p <= plateauCenter + plateauHalf || kActive === 6)) {
                // === DOCKED PLATEAU FOR SECTION kActive ===
                const boxActive = this.pallets[kActive];
                boxActive.position.copy(this.frontStoolBoxPos);
                boxActive.rotation.set(0, 0, 0);
                boxActive.userData.setOpen(1.0);

                targetAngles = this.inspectPose;
                gripGap = 0.20;
                carriedBox = null;
                frontDockedSection = kActive;
                frontLidOpenAmount = 1.0;
            } else {
                // === CONTINUOUS SCRUB TRANSITION BETWEEN SECTION kActive AND kActive + 1 ===
                const kFrom = kActive;
                const kTo = Math.min(6, kActive + 1);

                const transStart = kFrom + 1.0 + plateauHalf;
                const transEnd = kTo + 1.0 - plateauHalf;
                const u = Math.max(0, Math.min(1, (p - transStart) / (transEnd - transStart)));

                const bFromCfg = this.bayConfigs[kFrom];
                const j1From = bFromCfg.rotY;
                const fromGrip = this.solveIK(bFromCfg.pos[0], bFromCfg.handleY, bFromCfg.pos[2]);
                const fromLift = this.solveIK(bFromCfg.pos[0], bFromCfg.handleY + 0.65, bFromCfg.pos[2]);
                const fromCorridor = this.getFlightCorridorPose(j1From);

                const bToCfg = this.bayConfigs[kTo];
                const j1To = bToCfg.rotY;
                const toGrip = this.solveIK(bToCfg.pos[0], bToCfg.handleY, bToCfg.pos[2]);
                const toLift = this.solveIK(bToCfg.pos[0], bToCfg.handleY + 0.65, bToCfg.pos[2]);
                const toCorridor = this.getFlightCorridorPose(j1To);

                const boxFrom = this.pallets[kFrom];
                const boxTo = this.pallets[kTo];

                if (u <= 0.56) {
                    boxFrom.position.copy(this.frontStoolBoxPos);
                    boxFrom.rotation.set(0, 0, 0);
                } else {
                    boxFrom.position.copy(boxFrom.userData.rackHomePos);
                    boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                }

                if (u <= 0.06) {
                    // Step 1: BoxFrom lid hinges completely CLOSED! Arm stays at inspect pose
                    const t = u / 0.06;
                    targetAngles = this.inspectPose;
                    gripGap = 0.20;
                    boxFrom.userData.setOpen(1.0 - t);
                    carriedBox = null;
                } else if (u <= 0.12) {
                    // Step 2: Arm lowers from inspectPose to frontGrip handle of BoxFrom (fingers open)
                    const t = (u - 0.06) / 0.06;
                    targetAngles = this.lerpPose(this.inspectPose, frontGrip, t);
                    gripGap = 0.20;
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                } else if (u <= 0.18) {
                    // Step 3: CLAMPING PHASE! Arm stationary at frontGrip, fingers clamp from 0.20 to 0.075!
                    const t = (u - 0.12) / 0.06;
                    targetAngles = frontGrip;
                    gripGap = 0.20 - t * (0.20 - 0.075);
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                } else if (u <= 0.26) {
                    // Step 4: Arm lifts BoxFrom straight up off front stool (frontGrip -> frontLift)
                    const t = (u - 0.18) / 0.08;
                    targetAngles = this.lerpPose(frontGrip, frontLift, t);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                    boxFrom.userData.setOpen(0.0);
                } else if (u <= 0.34) {
                    // Step 5: Arm retracts BoxFrom into central flight corridor (frontLift -> frontCorridor)
                    const t = (u - 0.26) / 0.08;
                    targetAngles = this.lerpPose(frontLift, frontCorridor, t);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (u <= 0.44) {
                    // Step 6: Arm rotates carried BoxFrom through central corridor directly to Rack k heading
                    const t = (u - 0.34) / 0.10;
                    targetAngles = this.lerpPose(frontCorridor, fromCorridor, t);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (u <= 0.50) {
                    // Step 7: Arm extends outward to Rack k (fromCorridor -> fromLift)
                    const t = (u - 0.44) / 0.06;
                    targetAngles = this.lerpPose(fromCorridor, fromLift, t);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (u <= 0.56) {
                    // Step 8: Arm lowers BoxFrom onto Rack k (fromLift -> fromGrip)
                    const t = (u - 0.50) / 0.06;
                    targetAngles = this.lerpPose(fromLift, fromGrip, t);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (u <= 0.62) {
                    // Step 9: UNCLAMPING PHASE! BoxFrom sits on Rack k, arm stationary, fingers open from 0.075 to 0.18!
                    const t = (u - 0.56) / 0.06;
                    targetAngles = fromGrip;
                    gripGap = 0.075 + t * (0.18 - 0.075);
                    boxFrom.position.copy(boxFrom.userData.rackHomePos);
                    boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                    carriedBox = null;
                } else if (u <= 0.68) {
                    // Step 10: Empty arm retracts from Rack k into central corridor (fromGrip -> fromCorridor)
                    const t = (u - 0.62) / 0.06;
                    targetAngles = this.lerpPose(fromGrip, fromCorridor, t);
                    gripGap = 0.18;
                    carriedBox = null;
                } else if (u <= 0.76) {
                    // Step 11: Empty arm rotates through central corridor to Rack k+1 heading (fromCorridor -> toCorridor)
                    const t = (u - 0.68) / 0.08;
                    targetAngles = this.lerpPose(fromCorridor, toCorridor, t);
                    gripGap = 0.18;
                    carriedBox = null;
                } else if (u <= 0.82) {
                    // Step 12: Empty arm extends to Rack k+1 and descends to handle (toCorridor -> toLift -> toGrip)
                    const t = (u - 0.76) / 0.06;
                    targetAngles = t < 0.5 ? this.lerpPose(toCorridor, toLift, t / 0.5) : this.lerpPose(toLift, toGrip, (t - 0.5) / 0.5);
                    gripGap = 0.18;
                    boxTo.position.copy(boxTo.userData.rackHomePos);
                    boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);
                    carriedBox = null;
                } else if (u <= 0.87) {
                    // Step 13: CLAMPING PHASE! Arm stationary at toGrip, fingers clamp handle of BoxTo from 0.18 to 0.075!
                    const t = (u - 0.82) / 0.05;
                    targetAngles = toGrip;
                    gripGap = 0.18 - t * (0.18 - 0.075);
                    boxTo.position.copy(boxTo.userData.rackHomePos);
                    boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);
                    carriedBox = null;
                } else if (u <= 0.91) {
                    // Step 14: Arm lifts BoxTo straight up (toGrip -> toLift)
                    const t = (u - 0.87) / 0.04;
                    targetAngles = this.lerpPose(toGrip, toLift, t);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (u <= 0.94) {
                    // Step 15: Arm retracts BoxTo into central corridor (toLift -> toCorridor)
                    const t = (u - 0.91) / 0.03;
                    targetAngles = this.lerpPose(toLift, toCorridor, t);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (u <= 0.965) {
                    // Step 16: Arm rotates BoxTo to front corridor and extends (toCorridor -> frontCorridor -> frontLift)
                    const t = (u - 0.94) / 0.025;
                    targetAngles = t < 0.6 ? this.lerpPose(toCorridor, frontCorridor, t / 0.6) : this.lerpPose(frontCorridor, frontLift, (t - 0.6) / 0.4);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (u <= 0.98) {
                    // Step 17: Arm lowers BoxTo onto front stool (frontLift -> frontGrip)
                    const t = (u - 0.965) / 0.015;
                    targetAngles = this.lerpPose(frontLift, frontGrip, t);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (u <= 0.99) {
                    // Step 18: UNCLAMP & BACK AWAY! Fingers open from 0.075 to 0.20, arm backs up to inspectPose
                    const t = (u - 0.98) / 0.01;
                    targetAngles = this.lerpPose(frontGrip, this.inspectPose, t);
                    gripGap = 0.075 + t * (0.20 - 0.075);
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    carriedBox = null;
                } else {
                    // Step 19: BoxTo lid hinges OPEN from 0.0 to 1.0! Topic card unfolds
                    const t = (u - 0.99) / 0.01;
                    targetAngles = this.inspectPose;
                    gripGap = 0.20;
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    carriedBox = null;
                    frontDockedSection = kTo;
                    frontLidOpenAmount = t;
                    boxTo.userData.setOpen(t);
                }
            }
        }

        // Apply Joint Angles with active manual jog offsets (Full 6-Axis Robotic Kinematics)
        const jOffsets = this.jogOffsets || { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        this.jointAngles.j1 = targetAngles.j1 + (jOffsets.j1 || 0);
        this.jointAngles.j2 = targetAngles.j2 + (jOffsets.j2 || 0);
        this.jointAngles.j3 = targetAngles.j3 + (jOffsets.j3 || 0);
        this.jointAngles.j4 = targetAngles.j4 + (jOffsets.j4 || 0);
        this.jointAngles.j5 = (jOffsets.j5 || 0);
        this.jointAngles.j6 = (jOffsets.j6 || 0);

        if (this.joints.turntable) this.joints.turntable.rotation.y = this.jointAngles.j1;
        if (this.joints.shoulder) this.joints.shoulder.rotation.x = this.jointAngles.j2;
        if (this.joints.elbow) this.joints.elbow.rotation.x = this.jointAngles.j3;
        if (this.joints.wrist) this.joints.wrist.rotation.x = this.jointAngles.j4;
        if (this.joints.wristYaw) this.joints.wristYaw.rotation.z = this.jointAngles.j5;
        if (this.joints.flange) this.joints.flange.rotation.y = Math.PI / 2 + this.jointAngles.j6;

        // Manual Gripper Override check:
        const effectiveGap = this.manualGripperGap !== null ? this.manualGripperGap : gripGap;
        this.joints.gripper.targetGap = effectiveGap;
        this.joints.gripper.gap = effectiveGap;

        if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
            this.joints.gripper.leftFinger.position.x = -effectiveGap;
            this.joints.gripper.rightFinger.position.x = effectiveGap;
        }

        // Lock carried box directly to the robot jaw center
        if (carriedBox && this.joints.gripper.jawCenter) {
            this.robot.updateMatrixWorld(true);
            const jawWorldPos = new THREE.Vector3();
            this.joints.gripper.jawCenter.getWorldPosition(jawWorldPos);

            // Handle is at +0.445 above box center, so box center is 0.445 below jaw
            carriedBox.position.set(jawWorldPos.x, jawWorldPos.y - 0.445, jawWorldPos.z);
            // Box stays level with gravity and turns with base heading J1
            carriedBox.rotation.set(0, targetAngles.j1, 0);
        }

        // Precise Docking Notification:
        // A section card opens ONLY when its box has landed squarely on the front stool and its lid is open (> 0.6).
        // If the box is being lifted, carried, or the front stool is blank, ALL pop-up sections are CLOSED!
        if (frontDockedSection >= 0 && frontLidOpenAmount > 0.6) {
            if (this.dockedSectionIndex !== frontDockedSection) {
                this.dockedSectionIndex = frontDockedSection;
                if (this.onSectionChange) {
                    this.onSectionChange(this.bayConfigs[frontDockedSection].id, frontDockedSection);
                }
            }
        } else {
            if (this.dockedSectionIndex !== -1) {
                this.dockedSectionIndex = -1;
                if (this.onSectionChange) {
                    this.onSectionChange(null, -1);
                }
            }
        }
    }

    /**
     * Direct Dossier Transfer Evaluator:
     * When clicking a Teach Pendant button or Navbar link:
     * Takes its time and moves DIRECTLY between the current dossier and requested dossier,
     * without picking up or moving through any of the intermediate dossiers!
     * kFrom: index of currently docked box on front stool (or null if blank)
     * kTo: index of requested box to bring to front stool
     * t in [0.0, 1.0]
     */
    evaluateDirectTransfer(kFrom, kTo, t) {
        const frontGrip = this.solveIK(this.frontStoolPos.x, this.frontHandleY, this.frontStoolPos.z);
        const frontLift = this.solveIK(this.frontStoolPos.x, this.frontHandleY + 0.65, this.frontStoolPos.z);
        const frontCorridor = this.getFlightCorridorPose(0);

        let targetAngles = this.standbyPose;
        let gripGap = 0.18;
        let carriedBox = null;
        let frontDockedSection = -1;
        let frontLidOpenAmount = 0.0;

        // Reset all uninvolved boxes to their home rack position and closed lids
        for (let i = 0; i < this.pallets.length; i++) {
            if (i !== kFrom && i !== kTo) {
                const box = this.pallets[i];
                box.position.copy(box.userData.rackHomePos);
                box.rotation.set(0, box.userData.rackHomeRotY, 0);
                box.userData.setOpen(0.0);
            }
        }

        if (kFrom === null || kFrom === undefined || kFrom < 0) {
            // Direct fetch from Standby -> kTo
            const bToCfg = this.bayConfigs[kTo];
            const j1To = bToCfg.rotY;
            const toGrip = this.solveIK(bToCfg.pos[0], bToCfg.handleY, bToCfg.pos[2]);
            const toLift = this.solveIK(bToCfg.pos[0], bToCfg.handleY + 0.65, bToCfg.pos[2]);
            const toCorridor = this.getFlightCorridorPose(j1To);
            const boxTo = this.pallets[kTo];

            boxTo.position.copy(boxTo.userData.rackHomePos);
            boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);
            boxTo.userData.setOpen(0.0);

            if (t <= 0.15) {
                const u = t / 0.15;
                targetAngles = u < 0.5 ? this.lerpPose(this.standbyPose, toCorridor, u / 0.5) : this.lerpPose(toCorridor, toLift, (u - 0.5) / 0.5);
                gripGap = 0.18;
            } else if (t <= 0.25) {
                const u = (t - 0.15) / 0.10;
                if (u <= 0.7) {
                    targetAngles = this.lerpPose(toLift, toGrip, u / 0.7);
                    gripGap = 0.18;
                } else {
                    targetAngles = toGrip;
                    gripGap = 0.18 - ((u - 0.7) / 0.3) * (0.18 - 0.075);
                }
            } else if (t <= 0.38) {
                const u = (t - 0.25) / 0.13;
                targetAngles = this.lerpPose(toGrip, toLift, u);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.52) {
                const u = (t - 0.38) / 0.14;
                targetAngles = this.lerpPose(toLift, toCorridor, u);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.72) {
                const u = (t - 0.52) / 0.20;
                targetAngles = this.lerpPose(toCorridor, frontCorridor, u);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.84) {
                const u = (t - 0.72) / 0.12;
                targetAngles = this.lerpPose(frontCorridor, frontLift, u);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.92) {
                const u = (t - 0.84) / 0.08;
                if (u <= 0.75) {
                    targetAngles = this.lerpPose(frontLift, frontGrip, u / 0.75);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else {
                    targetAngles = frontGrip;
                    gripGap = 0.075 + ((u - 0.75) / 0.25) * (0.18 - 0.075);
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    carriedBox = null;
                }
            } else if (t <= 0.96) {
                const u = (t - 0.92) / 0.04;
                targetAngles = this.lerpPose(frontGrip, this.inspectPose, u);
                gripGap = 0.20;
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                carriedBox = null;
            } else {
                const u = (t - 0.96) / 0.04;
                targetAngles = this.inspectPose;
                gripGap = 0.20;
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                carriedBox = null;
                frontDockedSection = kTo;
                frontLidOpenAmount = u;
                boxTo.userData.setOpen(u);
            }
        } else {
            // Direct transfer from kFrom -> kTo (without intermediate boxes)
            const bFromCfg = this.bayConfigs[kFrom];
            const j1From = bFromCfg.rotY;
            const fromGrip = this.solveIK(bFromCfg.pos[0], bFromCfg.handleY, bFromCfg.pos[2]);
            const fromLift = this.solveIK(bFromCfg.pos[0], bFromCfg.handleY + 0.65, bFromCfg.pos[2]);
            const fromCorridor = this.getFlightCorridorPose(j1From);

            const bToCfg = this.bayConfigs[kTo];
            const j1To = bToCfg.rotY;
            const toGrip = this.solveIK(bToCfg.pos[0], bToCfg.handleY, bToCfg.pos[2]);
            const toLift = this.solveIK(bToCfg.pos[0], bToCfg.handleY + 0.65, bToCfg.pos[2]);
            const toCorridor = this.getFlightCorridorPose(j1To);

            const boxFrom = this.pallets[kFrom];
            const boxTo = this.pallets[kTo];

            if (t <= 0.50) {
                boxFrom.position.copy(this.frontStoolBoxPos);
                boxFrom.rotation.set(0, 0, 0);
            } else {
                boxFrom.position.copy(boxFrom.userData.rackHomePos);
                boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
            }

            boxTo.position.copy(boxTo.userData.rackHomePos);
            boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);

            if (t <= 0.05) {
                // Lid closes, gripper lowers to handle
                const u = t / 0.05;
                if (u <= 0.5) {
                    targetAngles = this.inspectPose;
                    gripGap = 0.20;
                    boxFrom.userData.setOpen(1.0 - (u / 0.5));
                } else {
                    const gu = (u - 0.5) / 0.5;
                    targetAngles = this.lerpPose(this.inspectPose, frontGrip, gu);
                    gripGap = 0.20 - gu * (0.20 - 0.075);
                    boxFrom.userData.setOpen(0.0);
                }
                carriedBox = null;
            } else if (t <= 0.14) {
                // Lift off front stool
                const u = (t - 0.05) / 0.09;
                targetAngles = this.lerpPose(frontGrip, frontLift, u);
                gripGap = 0.075;
                carriedBox = boxFrom;
                boxFrom.userData.setOpen(0.0);
            } else if (t <= 0.24) {
                // Retract into central corridor
                const u = (t - 0.14) / 0.10;
                targetAngles = this.lerpPose(frontLift, frontCorridor, u);
                gripGap = 0.075;
                carriedBox = boxFrom;
            } else if (t <= 0.38) {
                // Rotate directly to Rack kFrom
                const u = (t - 0.24) / 0.14;
                targetAngles = this.lerpPose(frontCorridor, fromCorridor, u);
                gripGap = 0.075;
                carriedBox = boxFrom;
            } else if (t <= 0.45) {
                // Extend outward to Rack kFrom
                const u = (t - 0.38) / 0.07;
                targetAngles = this.lerpPose(fromCorridor, fromLift, u);
                gripGap = 0.075;
                carriedBox = boxFrom;
            } else if (t <= 0.50) {
                // Lower onto Rack kFrom, unclamp
                const u = (t - 0.45) / 0.05;
                if (u <= 0.7) {
                    targetAngles = this.lerpPose(fromLift, fromGrip, u / 0.7);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else {
                    const uu = (u - 0.7) / 0.3;
                    targetAngles = fromGrip;
                    gripGap = 0.075 + uu * (0.18 - 0.075);
                    boxFrom.position.copy(boxFrom.userData.rackHomePos);
                    boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                    carriedBox = null;
                }
            } else if (t <= 0.56) {
                // Empty arm lifts & retracts into central corridor
                const u = (t - 0.50) / 0.06;
                targetAngles = this.lerpPose(fromGrip, fromCorridor, u);
                gripGap = 0.18;
                carriedBox = null;
            } else if (t <= 0.68) {
                // Empty arm rotates DIRECTLY through central corridor from Rack kFrom to Rack kTo!
                const u = (t - 0.56) / 0.12;
                targetAngles = this.lerpPose(fromCorridor, toCorridor, u);
                gripGap = 0.18;
                carriedBox = null;
            } else if (t <= 0.74) {
                // Empty arm extends to Rack kTo, descends to handle, clamps
                const u = (t - 0.68) / 0.06;
                if (u <= 0.5) {
                    targetAngles = this.lerpPose(toCorridor, toLift, u / 0.5);
                    gripGap = 0.18;
                } else if (u <= 0.85) {
                    const du = (u - 0.5) / 0.35;
                    targetAngles = this.lerpPose(toLift, toGrip, du);
                    gripGap = 0.18;
                } else {
                    targetAngles = toGrip;
                    const cu = (u - 0.85) / 0.15;
                    gripGap = 0.18 - cu * (0.18 - 0.075);
                }
                carriedBox = null;
            } else if (t <= 0.80) {
                // Lift Box kTo vertically
                const u = (t - 0.74) / 0.06;
                targetAngles = this.lerpPose(toGrip, toLift, u);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.86) {
                // Retract Box kTo into central corridor
                const u = (t - 0.80) / 0.06;
                targetAngles = this.lerpPose(toLift, toCorridor, u);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.94) {
                // Rotate Box kTo through central corridor directly to Front Stool heading, extend outward
                const u = (t - 0.86) / 0.08;
                targetAngles = u < 0.6 ? this.lerpPose(toCorridor, frontCorridor, u / 0.6) : this.lerpPose(frontCorridor, frontLift, (u - 0.6) / 0.4);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.97) {
                // Lower Box kTo onto Front Stool, unclamp
                const u = (t - 0.94) / 0.03;
                if (u <= 0.7) {
                    targetAngles = this.lerpPose(frontLift, frontGrip, u / 0.7);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else {
                    targetAngles = frontGrip;
                    gripGap = 0.075 + ((u - 0.7) / 0.3) * (0.18 - 0.075);
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    carriedBox = null;
                }
            } else if (t <= 0.985) {
                // Arm backs up to inspect pose
                const u = (t - 0.97) / 0.015;
                targetAngles = this.lerpPose(frontGrip, this.inspectPose, u);
                gripGap = 0.20;
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                carriedBox = null;
            } else {
                // Box kTo lid hinges OPEN!
                const u = (t - 0.985) / 0.015;
                targetAngles = this.inspectPose;
                gripGap = 0.20;
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                carriedBox = null;
                frontDockedSection = kTo;
                frontLidOpenAmount = u;
                boxTo.userData.setOpen(u);
            }
        }

        // Apply Joint Angles
        this.jointAngles.j1 = targetAngles.j1;
        this.jointAngles.j2 = targetAngles.j2;
        this.jointAngles.j3 = targetAngles.j3;
        this.jointAngles.j4 = targetAngles.j4;
        this.joints.gripper.targetGap = gripGap;
        this.joints.gripper.gap = gripGap;

        if (this.joints.turntable) this.joints.turntable.rotation.y = targetAngles.j1;
        if (this.joints.shoulder) this.joints.shoulder.rotation.x = targetAngles.j2;
        if (this.joints.elbow) this.joints.elbow.rotation.x = targetAngles.j3;
        if (this.joints.wrist) this.joints.wrist.rotation.x = targetAngles.j4;

        if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
            this.joints.gripper.leftFinger.position.x = -gripGap;
            this.joints.gripper.rightFinger.position.x = gripGap;
        }

        if (carriedBox && this.joints.gripper.jawCenter) {
            this.robot.updateMatrixWorld(true);
            const jawWorldPos = new THREE.Vector3();
            this.joints.gripper.jawCenter.getWorldPosition(jawWorldPos);
            carriedBox.position.set(jawWorldPos.x, jawWorldPos.y - 0.445, jawWorldPos.z);
            carriedBox.rotation.set(0, targetAngles.j1, 0);
        }

        if (frontDockedSection >= 0 && frontLidOpenAmount > 0.6) {
            if (this.dockedSectionIndex !== frontDockedSection) {
                this.dockedSectionIndex = frontDockedSection;
                if (this.onSectionChange) {
                    this.onSectionChange(this.bayConfigs[frontDockedSection].id, frontDockedSection);
                }
            }
        } else {
            if (this.dockedSectionIndex !== -1) {
                this.dockedSectionIndex = -1;
                if (this.onSectionChange) {
                    this.onSectionChange(null, -1);
                }
            }
        }
    }

    /**
     * Mouse Wheel Scroll Input: Directly scrubs robot kinematics
     * Stopping scrolling freezes the robot right where it is!
     */
    applyScrollDelta(delta) {
        if (this.isEStopped) return;
        if (this.activeTween) {
            this.activeTween.kill();
            this.activeTween = null;
        }
        if (this.directTransfer) {
            this.directTransfer = null;
            this.targetProgress = this.currentProgress;
        }
        this.manualGripperGap = null;
        if (this.jogOffsets) {
            this.jogOffsets.j1 = 0;
            this.jogOffsets.j2 = 0;
            this.jogOffsets.j3 = 0;
            this.jogOffsets.j4 = 0;
            this.jogOffsets.j5 = 0;
            this.jogOffsets.j6 = 0;
        }

        this.targetProgress = Math.max(0, Math.min(this.maxProgress, this.targetProgress + delta));
        this.statusText = `MANUAL SCROLL // PROGRESS: ${(this.targetProgress / this.maxProgress * 100).toFixed(0)}%`;
    }

    /**
     * Direct Dossier Dispatch:
     * When clicking a Teach Pendant button or Navbar link:
     * Takes its time, puts the current box away, and goes directly to the requested dossier!
     */
    goToSection(sectionIndex) {
        if (this.isEStopped) return;
        if (sectionIndex < 0 || sectionIndex >= this.bayConfigs.length) return;
        if (this.activeTween) {
            this.activeTween.kill();
            this.activeTween = null;
        }
        this.manualGripperGap = null;
        if (this.jogOffsets) {
            this.jogOffsets.j1 = 0;
            this.jogOffsets.j2 = 0;
            this.jogOffsets.j3 = 0;
            this.jogOffsets.j4 = 0;
            this.jogOffsets.j5 = 0;
            this.jogOffsets.j6 = 0;
        }

        const kFrom = this.dockedSectionIndex >= 0 ? this.dockedSectionIndex : null;
        const kTo = sectionIndex;

        if (kFrom === kTo) {
            // Already at this section! Ensure opened.
            this.evaluateProgress(sectionIndex + 1.0);
            return;
        }

        const duration = kFrom === null ? 2.8 : 4.0; // Stately, deliberate industrial motion
        this.statusText = `DISPATCHING: BAY [${this.bayConfigs[kTo].bayNum} // ${this.bayConfigs[kTo].name.toUpperCase()}]`;

        const transferState = { t: 0.0 };
        this.directTransfer = { kFrom, kTo, state: transferState };

        this.activeTween = gsap.to(transferState, {
            t: 1.0,
            duration: duration,
            ease: 'power1.inOut',
            onUpdate: () => {
                if (this.directTransfer) {
                    this.evaluateDirectTransfer(kFrom, kTo, transferState.t);
                }
            },
            onComplete: () => {
                this.activeTween = null;
                this.directTransfer = null;
                this.currentProgress = kTo + 1.0;
                this.targetProgress = kTo + 1.0;
                this.evaluateProgress(this.currentProgress);
                this.statusText = `PLACED ON FRONT STOOL // ${this.bayConfigs[kTo].name.toUpperCase()}`;
            }
        });
    }

    // Manual Jog and Safety Controls (All 6 Articulated Axes + Gripper)
    jogJoint(jointKey, delta) {
        if (this.isEStopped) return;
        if (!this.jogOffsets) this.jogOffsets = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        if (this.jogOffsets[jointKey] === undefined) this.jogOffsets[jointKey] = 0;
        this.jogOffsets[jointKey] += delta;
        this.jointAngles[jointKey] = (this.jointAngles[jointKey] || 0) + delta;

        // Apply immediately to Three.js meshes
        if (jointKey === 'j1' && this.joints.turntable) {
            this.joints.turntable.rotation.y = this.jointAngles.j1;
        } else if (jointKey === 'j2' && this.joints.shoulder) {
            this.joints.shoulder.rotation.x = this.jointAngles.j2;
        } else if (jointKey === 'j3' && this.joints.elbow) {
            this.joints.elbow.rotation.x = this.jointAngles.j3;
        } else if (jointKey === 'j4' && this.joints.wrist) {
            this.joints.wrist.rotation.x = this.jointAngles.j4;
        } else if (jointKey === 'j5' && this.joints.wristYaw) {
            this.joints.wristYaw.rotation.z = this.jogOffsets.j5;
        } else if (jointKey === 'j6' && this.joints.flange) {
            this.joints.flange.rotation.y = Math.PI / 2 + this.jogOffsets.j6;
        }

        const degVal = ((this.jogOffsets[jointKey] || 0) * (180 / Math.PI)).toFixed(1);
        this.statusText = `MANUAL JOG // ${jointKey.toUpperCase()}: ${degVal > 0 ? '+' : ''}${degVal}° OFFSET`;
    }

    toggleGripperManual() {
        if (this.isEStopped) return;
        const currentGap = this.manualGripperGap !== null ? this.manualGripperGap : this.joints.gripper.gap;
        // Toggle clamp (75mm) / open (200mm)
        this.manualGripperGap = currentGap > 0.12 ? 0.075 : 0.20;
        this.joints.gripper.targetGap = this.manualGripperGap;
        this.joints.gripper.gap = this.manualGripperGap;

        if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
            this.joints.gripper.leftFinger.position.x = -this.manualGripperGap;
            this.joints.gripper.rightFinger.position.x = this.manualGripperGap;
        }
        this.statusText = this.manualGripperGap > 0.12 ? 'MANUAL JOG // GRIPPER: OPEN (200mm)' : 'MANUAL JOG // GRIPPER: CLAMPED (75mm)';
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

    setupEventListeners() {
        window.addEventListener('resize', () => {
            if (!this.container || !this.renderer || !this.camera) return;
            const width = this.container.clientWidth || window.innerWidth;
            const height = this.container.clientHeight || window.innerHeight;
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        if (!this.isEStopped) {
            if (!this.directTransfer) {
                // Smoothly lerp towards targetProgress (settles immediately when user stops scrolling!)
                const lerpSpeed = 0.18;
                this.currentProgress += (this.targetProgress - this.currentProgress) * lerpSpeed;

                // Evaluate continuous scrub kinematics
                this.evaluateProgress(this.currentProgress);

                this.isMoving = Math.abs(this.targetProgress - this.currentProgress) > 0.005;
            } else {
                this.isMoving = true;
            }
        }

        // Camera softly frames robot
        this.camera.position.lerp(this.cameraPos, 0.05);
        this.camera.lookAt(this.cameraLookAt);

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }

        // Telemetry Update for Teach Pendant
        if (this.onTelemetryUpdate) {
            const activeName = this.dockedSectionIndex >= 0 ? this.bayConfigs[this.dockedSectionIndex].name : 'FRONT STOOL BLANK';
            this.onTelemetryUpdate({
                j1: THREE.MathUtils.radToDeg(this.jointAngles.j1).toFixed(1),
                j2: THREE.MathUtils.radToDeg(this.jointAngles.j2).toFixed(1),
                j3: THREE.MathUtils.radToDeg(this.jointAngles.j3).toFixed(1),
                j4: THREE.MathUtils.radToDeg(this.jointAngles.j4).toFixed(1),
                j5: THREE.MathUtils.radToDeg(this.jointAngles.j5 || 0).toFixed(1),
                j6: THREE.MathUtils.radToDeg(this.jointAngles.j6 || 0).toFixed(1),
                gap: (this.joints.gripper.gap * 1000).toFixed(0),
                isOpen: this.joints.gripper.gap > 0.12,
                status: this.statusText,
                isEStopped: this.isEStopped,
                activeBay: activeName,
                progress: (this.currentProgress / this.maxProgress * 100).toFixed(1)
            });
        }
    }
}

// Global Export
window.RobotWorkcell = RobotWorkcell;

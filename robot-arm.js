/**
 * ROBOT WORKCELL - THREE.JS 3D INDUSTRIAL ROBOT SYSTEM
 * Centered 6-DOF Yellow Robot Arm holding the active section in the middle of the page
 * Physically picks up 3D pallets from surrounding bays, carries them through 3D space, and holds them in the center.
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
                leftFinger: null,
                rightFinger: null,
                gap: 0.08,
                targetGap: 0.08
            }
        };

        // Inverse Kinematics Link Constants
        this.L1 = 2.0;       // Upper arm length
        this.L2 = 1.8;       // Forearm length
        this.Ltool = 0.4;    // Gripper length
        this.shoulderY = -0.6; // Shoulder pivot height in world space

        // Center Hold Pose (holding workpiece in middle of screen)
        this.centerPose = this.solveIK(0, 0.4, 2.5);

        // Current & Target Joint Angles
        this.jointAngles = { ...this.centerPose, gap: 0.08 };
        this.targetJointAngles = { ...this.centerPose, gap: 0.08 };

        // Topic Bay Definitions (Arranged in 3D around the robot)
        this.bayConfigs = [
            { id: 'hero', name: 'Home / Dossier', bayNum: '00', pos: [0, -0.4, 2.6], rotY: 0, color: 0x2563eb },
            { id: 'about', name: 'About Me', bayNum: '01', pos: [-3.2, -0.2, 0.4], rotY: 0.8, color: 0x059669 },
            { id: 'experience', name: 'Experience', bayNum: '02', pos: [-2.6, 0.8, -2.4], rotY: 1.4, color: 0xd97706 },
            { id: 'leadership', name: 'Leadership', bayNum: '03', pos: [0, 1.2, -3.2], rotY: Math.PI, color: 0x7c3aed },
            { id: 'projects', name: 'Projects', bayNum: '04', pos: [2.6, 0.8, -2.4], rotY: -1.4, color: 0x0284c7 },
            { id: 'skills', name: 'Technical Skills', bayNum: '05', pos: [3.2, -0.2, 0.4], rotY: -0.8, color: 0xe11d48 },
            { id: 'contact', name: 'Contact', bayNum: '06', pos: [2.0, -0.6, 2.2], rotY: -0.4, color: 0x4f46e5 }
        ];

        this.bays = [];
        this.pallets = [];
        this.activePalletIndex = 0;
        this.carriedPallet = null;

        // State Machine
        this.isMoving = false;
        this.isEStopped = false;
        this.statusText = 'ROBOT ONLINE // HOLDING IN CENTER';

        // Camera - perfectly centered on robot
        this.cameraPos = new THREE.Vector3(0, 1.8, 8.2);
        this.cameraLookAt = new THREE.Vector3(0, 0.4, 0);

        // Callbacks
        this.onTelemetryUpdate = null;
        this.onSectionChange = null;

        this.init();
    }

    /**
     * Exact Analytical Inverse Kinematics Solver
     */
    solveIK(targetX, targetY, targetZ) {
        const j1 = Math.atan2(targetX, targetZ);
        const R = Math.sqrt(targetX * targetX + targetZ * targetZ);
        const Yrel = targetY - this.shoulderY;

        const thetaTool = 0.35; // Slight forward pitch
        const Rwrist = R - this.Ltool * Math.sin(thetaTool);
        const Ywrist = Yrel + this.Ltool * Math.cos(thetaTool);

        const D = Math.sqrt(Rwrist * Rwrist + Ywrist * Ywrist);
        const Dclamp = Math.min(D, (this.L1 + this.L2) * 0.96);

        const cosElbow = (Dclamp * Dclamp - this.L1 * this.L1 - this.L2 * this.L2) / (2 * this.L1 * this.L2);
        const safeCos = Math.max(-1, Math.min(1, cosElbow));
        const j3 = -(Math.PI - Math.acos(safeCos));

        const alpha = Math.atan2(Ywrist, Rwrist);
        const beta = Math.acos(Math.max(-1, Math.min(1, (this.L1 * this.L1 + Dclamp * Dclamp - this.L2 * this.L2) / (2 * this.L1 * Dclamp))));
        const j2 = Math.PI / 2 - (alpha + beta);
        const j4 = thetaTool - (j2 + j3);

        return { j1, j2, j3, j4 };
    }

    init() {
        this.initThree();
        this.setupLighting();
        this.buildFactoryFloor();
        this.buildRobotArm();
        this.buildWorkcellBays();
        this.setupEventListeners();
        this.animate();

        // Start at Section 0 (Home/Hero) held in center
        this.setTargetBay(0, false);
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
        const ambientLight = new THREE.AmbientLight(0x94a3b8, 0.8);
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

        const centerLight = new THREE.PointLight(0xffedd5, 0.6, 6);
        centerLight.position.set(0, 1.5, 3.0);
        this.scene.add(centerLight);
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
            color: 0xf59e0b, // FANUC / CAT Yellow
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

        // --- J0: Bolted Pedestal ---
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

        // --- J2: Shoulder Pivot (Pitches around X) ---
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

        // Upper Arm Girder (Length L1 = 2.0)
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

        // Forearm Link (Length L2 = 1.8)
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
        const wrist = new THREE.Group();
        wrist.position.set(0, this.L2, 0);

        const wristPivot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), darkMat);
        wristPivot.castShadow = true;
        wrist.add(wristPivot);

        // Tool Flange
        const flange = new THREE.Group();
        flange.position.set(0, 0.16, 0);

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

        leftFinger.position.set(-0.08, 0.1, 0);
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

        rightFinger.position.set(0.08, 0.1, 0);
        gripperBase.add(rightFinger);

        flange.add(gripperBase);
        wrist.add(flange);
        forearm.add(wrist);

        this.joints.wrist = wrist;
        this.joints.flange = flange;
        this.joints.gripper.base = gripperBase;
        this.joints.gripper.leftFinger = leftFinger;
        this.joints.gripper.rightFinger = rightFinger;

        this.scene.add(this.robot);
    }

    createPalletTexture(title, bayNum, accentHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 1024, 512);

        ctx.fillStyle = accentHex;
        ctx.fillRect(0, 0, 1024, 80);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`BAY ${bayNum} // WORKPIECE FIXTURE`, 32, 54);

        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 12;
        ctx.strokeRect(6, 6, 1012, 500);

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 74px "Segoe UI", Arial, sans-serif';
        ctx.fillText(title.toUpperCase(), 48, 240);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '32px monospace';
        ctx.fillText('STATUS: VERIFIED // READY FOR DISPATCH', 48, 330);
        ctx.fillText('CELL DOCK: 6-DOF ROBOT REACH', 48, 385);

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

    buildWorkcellBays() {
        const steelMat = new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.5,
            metalness: 0.6
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xf1f5f9,
            roughness: 0.15,
            metalness: 0.95
        });

        this.bayConfigs.forEach((cfg, index) => {
            // Storage Rack Stand
            const bayGroup = new THREE.Group();
            bayGroup.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
            bayGroup.rotation.y = cfg.rotY;

            const postHeight = cfg.pos[1] - (-1.8);
            if (postHeight > 0.4) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, postHeight, 0.18), steelMat);
                post.position.set(0, -postHeight / 2, 0);
                post.castShadow = true;
                bayGroup.add(post);
            }

            const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.1), steelMat);
            shelf.castShadow = true;
            shelf.receiveShadow = true;
            bayGroup.add(shelf);

            this.scene.add(bayGroup);
            this.bays.push(bayGroup);

            // 3D Workpiece Pallet
            const palletGroup = new THREE.Group();
            palletGroup.position.set(cfg.pos[0], cfg.pos[1] + 0.1, cfg.pos[2]);
            palletGroup.rotation.y = cfg.rotY;

            const palletBase = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.9), steelMat);
            palletBase.castShadow = true;
            palletGroup.add(palletBase);

            const hexColor = '#' + cfg.color.toString(16).padStart(6, '0');
            const faceTex = this.createPalletTexture(cfg.name, cfg.bayNum, hexColor);
            const faceMat = new THREE.MeshStandardMaterial({
                map: faceTex,
                roughness: 0.4,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
            });
            const faceplate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.65, 0.04), faceMat);
            faceplate.position.set(0, 0.44, 0.45);
            faceplate.castShadow = true;
            palletGroup.add(faceplate);

            // Top Lifting Handle
            const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 16), chromeMat);
            handleBar.rotation.z = Math.PI / 2;
            handleBar.position.set(0, 0.82, 0);
            handleBar.castShadow = true;
            palletGroup.add(handleBar);

            const leftStanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.15, 12), chromeMat);
            leftStanchion.position.set(-0.16, 0.74, 0);
            palletGroup.add(leftStanchion);

            const rightStanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.15, 12), chromeMat);
            rightStanchion.position.set(0.16, 0.74, 0);
            palletGroup.add(rightStanchion);

            palletGroup.userData = {
                index,
                cfg,
                homePos: new THREE.Vector3(cfg.pos[0], cfg.pos[1] + 0.1, cfg.pos[2]),
                homeRotY: cfg.rotY
            };

            this.scene.add(palletGroup);
            this.pallets.push(palletGroup);
        });
    }

    /**
     * Pick and Place Execution:
     * - Returns previous pallet to its bay
     * - Travels to target bay, grips pallet
     * - Carries pallet in 3D arc to Center of Screen!
     */
    setTargetBay(index, animate = true) {
        if (this.isEStopped) return;
        if (index < 0 || index >= this.bayConfigs.length) return;

        const targetCfg = this.bayConfigs[index];
        const prevIndex = this.activePalletIndex;
        this.activePalletIndex = index;
        this.isMoving = true;
        this.statusText = `DISPATCHING: BAY [${targetCfg.bayNum} // ${targetCfg.name.toUpperCase()}]`;

        if (!animate) {
            // Instant center pose with Pallet 0 held
            this.targetJointAngles = { ...this.centerPose };
            this.jointAngles = { ...this.centerPose };
            this.carriedPallet = this.pallets[index];
            this.updateCarriedPalletTransform();
            this.isMoving = false;
            this.statusText = `HOLDING IN CENTER // ${targetCfg.name.toUpperCase()}`;
            if (this.onSectionChange) this.onSectionChange(targetCfg.id, index);
            return;
        }

        this.executeFullPickAndPlace(prevIndex, index, targetCfg);
    }

    executeFullPickAndPlace(fromIndex, toIndex, targetCfg) {
        if (this.activeTimeline) {
            this.activeTimeline.kill();
        }

        const stageCard = document.getElementById('robot-front-stage');
        if (stageCard) stageCard.classList.add('transitioning');

        const currentPallet = this.carriedPallet;
        const targetPallet = this.pallets[toIndex];
        const targetBayPose = this.solveIK(targetCfg.pos[0], targetCfg.pos[1] + 0.9, targetCfg.pos[2]);

        const tl = gsap.timeline({
            onComplete: () => {
                this.isMoving = false;
                this.statusText = `HOLDING IN CENTER // ${targetCfg.name.toUpperCase()}`;
                if (stageCard) stageCard.classList.remove('transitioning');
                if (this.onSectionChange) this.onSectionChange(targetCfg.id, toIndex);
            }
        });

        this.activeTimeline = tl;

        // --- STEP 1: Return current carried pallet back to its bay rack ---
        if (currentPallet && fromIndex !== toIndex) {
            const currentCfg = this.bayConfigs[fromIndex];
            const returnPose = this.solveIK(currentCfg.pos[0], currentCfg.pos[1] + 0.9, currentCfg.pos[2]);

            // Lift up slightly in center
            tl.to(this.jointAngles, {
                j2: this.centerPose.j2 - 0.2,
                j3: this.centerPose.j3 + 0.15,
                duration: 0.35,
                ease: 'power2.out'
            });

            // Swing over to return bay (pallet travels attached to gripper!)
            tl.to(this.jointAngles, {
                j1: returnPose.j1,
                j2: returnPose.j2,
                j3: returnPose.j3,
                j4: returnPose.j4,
                duration: 0.8,
                ease: 'power2.inOut'
            });

            // Release gripper & detach pallet at its home position
            tl.to(this.joints.gripper, {
                targetGap: 0.22,
                duration: 0.25,
                onComplete: () => {
                    this.carriedPallet = null;
                    currentPallet.position.copy(currentPallet.userData.homePos);
                    currentPallet.rotation.set(0, currentPallet.userData.homeRotY, 0);
                }
            });

            // Lift empty gripper
            tl.to(this.jointAngles, {
                j2: returnPose.j2 - 0.25,
                duration: 0.3,
                ease: 'power2.out'
            });
        }

        // --- STEP 2: Rotate base and reach to target Bay ---
        tl.to(this.jointAngles, {
            j1: targetBayPose.j1,
            j2: targetBayPose.j2,
            j3: targetBayPose.j3,
            j4: targetBayPose.j4,
            duration: 0.85,
            ease: 'power2.inOut'
        });

        // --- STEP 3: Clamp Gripper onto target pallet handle ---
        tl.to(this.joints.gripper, {
            targetGap: 0.08,
            duration: 0.3,
            ease: 'power2.in',
            onComplete: () => {
                this.carriedPallet = targetPallet; // Attach to gripper!
            }
        });

        // --- STEP 4: Lift pallet from shelf ---
        tl.to(this.jointAngles, {
            j2: targetBayPose.j2 - 0.2,
            j3: targetBayPose.j3 + 0.15,
            duration: 0.35,
            ease: 'power2.out'
        });

        // --- STEP 5: Swing pallet to Center of Screen (Center Hold Pose) ---
        tl.to(this.jointAngles, {
            j1: this.centerPose.j1,
            j2: this.centerPose.j2,
            j3: this.centerPose.j3,
            j4: this.centerPose.j4,
            duration: 1.1,
            ease: 'power2.inOut'
        });

        // --- STEP 6: Lock grip in center ---
        tl.to(this.joints.gripper, {
            targetGap: 0.07,
            duration: 0.2
        });
    }

    updateCarriedPalletTransform() {
        if (!this.carriedPallet || !this.joints.gripper || !this.joints.gripper.base) return;

        const gripPos = new THREE.Vector3();
        this.joints.gripper.base.getWorldPosition(gripPos);

        const gripQuat = new THREE.Quaternion();
        this.joints.gripper.base.getWorldQuaternion(gripQuat);

        // Pallet handle is at Y = +0.82, so center of pallet is 0.82 units below gripper
        const offset = new THREE.Vector3(0, -0.78, 0).applyQuaternion(gripQuat);
        this.carriedPallet.position.copy(gripPos).add(offset);
        this.carriedPallet.quaternion.copy(gripQuat);
    }

    jogJoint(jointKey, delta) {
        if (this.isEStopped) return;
        this.statusText = `MANUAL JOG // ${jointKey.toUpperCase()}`;
        if (this.jointAngles[jointKey] !== undefined) {
            this.jointAngles[jointKey] += delta;
        }
    }

    toggleGripperManual() {
        if (this.isEStopped) return;
        this.joints.gripper.targetGap = this.joints.gripper.targetGap > 0.15 ? 0.07 : 0.22;
        this.statusText = this.joints.gripper.targetGap > 0.15 ? 'GRIPPER: OPEN' : 'GRIPPER: CLAMPED';
    }

    emergencyStop() {
        this.isEStopped = true;
        this.statusText = 'EMERGENCY STOP (E-STOP) ACTIVATED! MOTORS HALTED';
        if (typeof gsap !== 'undefined') gsap.globalTimeline.pause();
    }

    resetEmergencyStop() {
        this.isEStopped = false;
        this.statusText = 'E-STOP CLEARED // MOTORS RE-INITIALIZED';
        if (typeof gsap !== 'undefined') gsap.globalTimeline.resume();
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
            // Apply Joint Rotations directly to 3D Nodes
            if (this.joints.turntable) this.joints.turntable.rotation.y = this.jointAngles.j1;
            if (this.joints.shoulder) this.joints.shoulder.rotation.x = this.jointAngles.j2;
            if (this.joints.elbow) this.joints.elbow.rotation.x = this.jointAngles.j3;
            if (this.joints.wrist) this.joints.wrist.rotation.x = this.jointAngles.j4;

            // Gripper Finger Motion
            this.joints.gripper.gap += (this.joints.gripper.targetGap - this.joints.gripper.gap) * 10.0 * delta;
            if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
                this.joints.gripper.leftFinger.position.x = -this.joints.gripper.gap;
                this.joints.gripper.rightFinger.position.x = this.joints.gripper.gap;
            }

            // Keep Carried Pallet locked to Gripper!
            this.updateCarriedPalletTransform();
        }

        // Camera smoothly frames robot
        this.camera.position.lerp(this.cameraPos, 0.05);
        this.camera.lookAt(this.cameraLookAt);

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }

        // Telemetry Update
        if (this.onTelemetryUpdate) {
            this.onTelemetryUpdate({
                j1: THREE.MathUtils.radToDeg(this.jointAngles.j1).toFixed(1),
                j2: THREE.MathUtils.radToDeg(this.jointAngles.j2).toFixed(1),
                j3: THREE.MathUtils.radToDeg(this.jointAngles.j3).toFixed(1),
                gap: (this.joints.gripper.gap * 100).toFixed(0),
                status: this.statusText,
                isEStopped: this.isEStopped,
                activeBay: this.bayConfigs[this.activePalletIndex].name
            });
        }
    }
}

// Global Export
window.RobotWorkcell = RobotWorkcell;

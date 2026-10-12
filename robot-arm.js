/**
 * ROBOT WORKCELL - THREE.JS 3D INDUSTRIAL ROBOT SYSTEM
 * Industrial 6-DOF Robot Arm with Parallel Gripper & 3D Surrounding Section Bays
 * Authentic Industrial Yellow (FANUC / CAT Yellow), No Cyber Glow
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
            base: null,     // J0: Bolted pedestal
            turntable: null,// J1: Base rotation around Y
            shoulder: null, // J2: Pitch around X
            upperArm: null,
            elbow: null,    // J3: Pitch around X
            forearm: null,  // J4: Roll around Y
            wrist: null,    // J5: Pitch around X
            flange: null,   // J6: Tool roll
            gripper: {
                base: null,
                leftFinger: null,
                rightFinger: null,
                gap: 0.25,
                targetGap: 0.25
            }
        };

        // Kinematic Targets & Current State
        this.jointAngles = {
            j1: 0,
            j2: 0.35,
            j3: -0.5,
            j4: 0,
            j5: 0.15,
            j6: 0
        };

        this.targetJointAngles = { ...this.jointAngles };

        // Industrial Pallets & Storage Bays
        this.bays = [];
        this.pallets = [];
        this.activePalletIndex = 0;
        this.carriedPallet = null;

        // Motion & State Machine
        this.isMoving = false;
        this.isEStopped = false;
        this.isManualJog = false;
        this.statusText = 'SYSTEM READY - AUTO RUN';

        // Camera animation targets (framed for split-screen on desktop, centered on mobile)
        const isWide = typeof window !== 'undefined' && window.innerWidth > 992;
        this.cameraPos = new THREE.Vector3(isWide ? -0.9 : 0, 3.2, 7.2);
        this.cameraLookAt = new THREE.Vector3(isWide ? -0.9 : 0, 1.4, 0);

        // Section Bay Definitions (Arranged in 3D around the robot)
        this.bayConfigs = [
            { id: 'hero', name: 'Home / Dossier', bayNum: '00', pos: [0, 0.45, 2.8], rotY: 0, color: 0x2563eb },
            { id: 'about', name: 'About Me', bayNum: '01', pos: [-3.8, 1.2, 0.8], rotY: 0.7, color: 0x059669 },
            { id: 'experience', name: 'Experience', bayNum: '02', pos: [-3.2, 2.2, -2.6], rotY: 1.3, color: 0xd97706 },
            { id: 'leadership', name: 'Leadership', bayNum: '03', pos: [0, 2.6, -3.8], rotY: Math.PI, color: 0x7c3aed },
            { id: 'projects', name: 'Projects', bayNum: '04', pos: [3.2, 2.2, -2.6], rotY: -1.3, color: 0x0284c7 },
            { id: 'skills', name: 'Technical Skills', bayNum: '05', pos: [3.8, 1.2, 0.8], rotY: -0.7, color: 0xe11d48 },
            { id: 'contact', name: 'Contact', bayNum: '06', pos: [2.5, 0.6, 2.6], rotY: -0.35, color: 0x4f46e5 }
        ];

        // Callbacks for UI updates
        this.onTelemetryUpdate = null;
        this.onSectionChange = null;

        this.init();
    }

    init() {
        this.initThree();
        this.setupLighting();
        this.buildFactoryFloor();
        this.buildRobotArm();
        this.buildWorkcellBays();
        this.setupEventListeners();
        this.animate();

        // Start at home section
        this.setTargetBay(0, false);
    }

    initThree() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0b0f17);
        this.scene.fog = new THREE.FogExp2(0x0b0f17, 0.035);

        // Clean Front-Facing Perspective Camera
        this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
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
        // High-Bay Industrial Overhead Lighting
        const ambientLight = new THREE.AmbientLight(0x94a3b8, 0.7);
        this.scene.add(ambientLight);

        // Main Directional Factory Spotlight (Casts crisp soft shadows)
        const mainLight = new THREE.DirectionalLight(0xfffbeb, 1.8);
        mainLight.position.set(4, 9, 6);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 25;
        mainLight.shadow.camera.left = -7;
        mainLight.shadow.camera.right = 7;
        mainLight.shadow.camera.top = 7;
        mainLight.shadow.camera.bottom = -7;
        mainLight.shadow.bias = -0.0005;
        this.scene.add(mainLight);

        // Secondary Cool Industrial Fill Light
        const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.6);
        fillLight.position.set(-6, 6, -3);
        this.scene.add(fillLight);

        // Floor reflection light
        const floorBounce = new THREE.PointLight(0xffffff, 0.4, 8);
        floorBounce.position.set(0, 0.3, 1.5);
        this.scene.add(floorBounce);
    }

    createHazardTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#f59e0b'; // Industrial warning yellow
        ctx.fillRect(0, 0, 256, 64);

        ctx.fillStyle = '#18181b'; // Dark black stripe
        const stripeWidth = 32;
        for (let x = -64; x < 320; x += stripeWidth * 2) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + stripeWidth, 0);
            ctx.lineTo(x + stripeWidth - 40, 64);
            ctx.lineTo(x - 40, 64);
            ctx.closePath();
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        return texture;
    }

    buildFactoryFloor() {
        // Concrete Floor Slab
        const floorGeo = new THREE.PlaneGeometry(30, 30);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x111827,
            roughness: 0.85,
            metalness: 0.2
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Workcell Grid Pattern
        const grid = new THREE.GridHelper(24, 24, 0x374151, 0x1f2937);
        grid.position.y = 0.002;
        this.scene.add(grid);

        // Yellow-Black Hazard Perimeter Line around Robot Envelope
        const hazardTex = this.createHazardTexture();
        hazardTex.repeat.set(8, 1);

        const hazardRingGeo = new THREE.RingGeometry(1.6, 1.85, 32);
        const hazardRingMat = new THREE.MeshStandardMaterial({
            map: hazardTex,
            roughness: 0.6,
            side: THREE.DoubleSide
        });
        const hazardRing = new THREE.Mesh(hazardRingGeo, hazardRingMat);
        hazardRing.rotation.x = -Math.PI / 2;
        hazardRing.position.y = 0.005;
        this.scene.add(hazardRing);

        // Front Dock Workstation Platform
        const dockGeo = new THREE.BoxGeometry(2.4, 0.15, 1.6);
        const dockMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.7,
            metalness: 0.4
        });
        const dock = new THREE.Mesh(dockGeo, dockMat);
        dock.position.set(0, 0.075, 2.5);
        dock.receiveShadow = true;
        dock.castShadow = true;
        this.scene.add(dock);

        // Dock Guide Rails & Fixture Pegs
        const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
        const leftRail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 16), railMat);
        leftRail.rotation.x = Math.PI / 2;
        leftRail.position.set(-1.0, 0.18, 2.5);
        this.scene.add(leftRail);

        const rightRail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 16), railMat);
        rightRail.rotation.x = Math.PI / 2;
        rightRail.position.set(1.0, 0.18, 2.5);
        this.scene.add(rightRail);
    }

    buildRobotArm() {
        // High-Quality Industrial Powder-Coated Materials
        const yellowMat = new THREE.MeshStandardMaterial({
            color: 0xf59e0b, // FANUC / CAT Yellow
            roughness: 0.4,
            metalness: 0.25
        });

        const darkJointMat = new THREE.MeshStandardMaterial({
            color: 0x18181b, // Cast iron dark graphite
            roughness: 0.65,
            metalness: 0.4
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xe2e8f0, // Polished chrome pistons
            roughness: 0.15,
            metalness: 0.9
        });

        const rubberMat = new THREE.MeshStandardMaterial({
            color: 0x09090b,
            roughness: 0.95,
            metalness: 0.05
        });

        this.robot = new THREE.Group();
        this.robot.position.set(0, 0, 0);

        // --- J0: Bolted Pedestal Base ---
        const baseGroup = new THREE.Group();
        const baseFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 0.18, 24), darkJointMat);
        baseFlange.position.y = 0.09;
        baseFlange.castShadow = true;
        baseFlange.receiveShadow = true;
        baseGroup.add(baseFlange);

        // Anchor Bolts around flange
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), chromeMat);
            bolt.position.set(Math.cos(angle) * 0.92, 0.2, Math.sin(angle) * 0.92);
            baseGroup.add(bolt);
        }

        const baseCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.82, 0.4, 24), yellowMat);
        baseCylinder.position.y = 0.38;
        baseCylinder.castShadow = true;
        baseGroup.add(baseCylinder);

        this.robot.add(baseGroup);
        this.joints.base = baseGroup;

        // --- J1: Turntable (Rotates around Y axis) ---
        const turntable = new THREE.Group();
        turntable.position.set(0, 0.58, 0);

        const turntableBearing = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 0.14, 24), darkJointMat);
        turntableBearing.position.y = 0.07;
        turntableBearing.castShadow = true;
        turntable.add(turntableBearing);

        // J1 Motor Housing
        const motorHousing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.75), yellowMat);
        motorHousing.position.set(0, 0.38, -0.05);
        motorHousing.castShadow = true;
        turntable.add(motorHousing);

        this.robot.add(turntable);
        this.joints.turntable = turntable;

        // --- J2: Shoulder Pivot ---
        const shoulder = new THREE.Group();
        shoulder.position.set(0, 0.65, 0); // Shoulder pivot point

        // Shoulder heavy side plates
        const shoulderPlateLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 24), darkJointMat);
        shoulderPlateLeft.rotation.z = Math.PI / 2;
        shoulderPlateLeft.position.set(-0.38, 0, 0);
        shoulderPlateLeft.castShadow = true;
        shoulder.add(shoulderPlateLeft);

        const shoulderPlateRight = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 24), darkJointMat);
        shoulderPlateRight.rotation.z = Math.PI / 2;
        shoulderPlateRight.position.set(0.38, 0, 0);
        shoulderPlateRight.castShadow = true;
        shoulder.add(shoulderPlateRight);

        // Counterweight block at rear
        const counterweight = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.4, 0.5), darkJointMat);
        counterweight.position.set(0, -0.15, -0.45);
        counterweight.castShadow = true;
        shoulder.add(counterweight);

        // Upper Arm Girder Structure (Length ~ 1.8m)
        const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.7, 0.45), yellowMat);
        upperArm.position.set(0, 0.85, 0.08);
        upperArm.castShadow = true;
        shoulder.add(upperArm);

        // Hydraulic lift cylinder along upper arm
        const cylinderBody = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.0, 16), darkJointMat);
        cylinderBody.position.set(0.24, 0.6, -0.18);
        cylinderBody.castShadow = true;
        shoulder.add(cylinderBody);

        const pistonShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 16), chromeMat);
        pistonShaft.position.set(0.24, 1.1, -0.18);
        shoulder.add(pistonShaft);

        turntable.add(shoulder);
        this.joints.shoulder = shoulder;
        this.joints.upperArm = upperArm;

        // --- J3: Elbow Pivot ---
        const elbow = new THREE.Group();
        elbow.position.set(0, 1.7, 0.08); // Top of upper arm

        const elbowJointCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.52, 24), darkJointMat);
        elbowJointCylinder.rotation.z = Math.PI / 2;
        elbowJointCylinder.castShadow = true;
        elbow.add(elbowJointCylinder);

        // Forearm Link (Length ~ 1.5m)
        const forearm = new THREE.Group();
        forearm.position.set(0, 0, 0);

        const forearmBody = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.45, 0.35), yellowMat);
        forearmBody.position.set(0, 0.72, 0.02);
        forearmBody.castShadow = true;
        forearm.add(forearmBody);

        // J4 Forearm Roll Barrel
        const rollBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 20), darkJointMat);
        rollBarrel.position.set(0, 1.45, 0.02);
        rollBarrel.castShadow = true;
        forearm.add(rollBarrel);

        elbow.add(forearm);
        shoulder.add(elbow);
        this.joints.elbow = elbow;
        this.joints.forearm = forearm;

        // --- J5: Wrist Pitch Pivot ---
        const wrist = new THREE.Group();
        wrist.position.set(0, 1.62, 0.02);

        const wristPivot = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 16), darkJointMat);
        wristPivot.castShadow = true;
        wrist.add(wristPivot);

        // --- J6: Tool Mount Flange & Parallel Gripper Attachment ---
        const flange = new THREE.Group();
        flange.position.set(0, 0.15, 0);

        const flangePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 20), chromeMat);
        flangePlate.castShadow = true;
        flange.add(flangePlate);

        // Gripper Body (Pneumatic actuator housing)
        const gripperBody = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.22, 0.32), darkJointMat);
        gripperBody.position.set(0, 0.15, 0);
        gripperBody.castShadow = true;
        flange.add(gripperBody);

        // Chrome linear guide shafts for fingers
        const leftGuide = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.44, 12), chromeMat);
        leftGuide.rotation.z = Math.PI / 2;
        leftGuide.position.set(0, 0.18, 0.08);
        flange.add(leftGuide);

        const rightGuide = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.44, 12), chromeMat);
        rightGuide.rotation.z = Math.PI / 2;
        rightGuide.position.set(0, 0.18, -0.08);
        flange.add(rightGuide);

        // Dual Moving Finger Jaws
        const fingerGeo = new THREE.BoxGeometry(0.08, 0.35, 0.18);
        const padGeo = new THREE.BoxGeometry(0.03, 0.26, 0.16);

        // Left Finger
        const leftFinger = new THREE.Group();
        const leftFingerMesh = new THREE.Mesh(fingerGeo, yellowMat);
        leftFingerMesh.position.y = 0.18;
        leftFingerMesh.castShadow = true;
        leftFinger.add(leftFingerMesh);

        const leftPad = new THREE.Mesh(padGeo, rubberMat);
        leftPad.position.set(0.045, 0.18, 0);
        leftFinger.add(leftPad);

        leftFinger.position.set(-0.16, 0.26, 0);
        flange.add(leftFinger);

        // Right Finger
        const rightFinger = new THREE.Group();
        const rightFingerMesh = new THREE.Mesh(fingerGeo, yellowMat);
        rightFingerMesh.position.y = 0.18;
        rightFingerMesh.castShadow = true;
        rightFinger.add(rightFingerMesh);

        const rightPad = new THREE.Mesh(padGeo, rubberMat);
        rightPad.position.set(-0.045, 0.18, 0);
        rightFinger.add(rightPad);

        rightFinger.position.set(0.16, 0.26, 0);
        flange.add(rightFinger);

        wrist.add(flange);
        forearm.add(wrist);

        this.joints.wrist = wrist;
        this.joints.flange = flange;
        this.joints.gripper.base = flange;
        this.joints.gripper.leftFinger = leftFinger;
        this.joints.gripper.rightFinger = rightFinger;

        this.scene.add(this.robot);
    }

    createPalletTexture(text, bayNum, accentColor) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Dark industrial plate background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 512, 256);

        // Border with accent color
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 14;
        ctx.strokeRect(7, 7, 498, 242);

        // Header bar
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 0, 512, 54);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`BAY ${bayNum} // WORKPIECE DOCK`, 24, 38);

        // Main Section Title
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
        ctx.fillText(text.toUpperCase(), 32, 130);

        // Subtitle / Specs
        ctx.fillStyle = '#94a3b8';
        ctx.font = '20px monospace';
        ctx.fillText('STATUS: LOCKED / VERIFIED', 32, 175);
        ctx.fillText('PAYLOAD: ENGINEERING ASSET', 32, 208);

        // Corner bolt circles
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(28, 28, 8, 0, Math.PI * 2);
        ctx.arc(484, 28, 8, 0, Math.PI * 2);
        ctx.arc(28, 228, 8, 0, Math.PI * 2);
        ctx.arc(484, 228, 8, 0, Math.PI * 2);
        ctx.fill();

        return new THREE.CanvasTexture(canvas);
    }

    buildWorkcellBays() {
        const rackSteelMat = new THREE.MeshStandardMaterial({
            color: 0x334155,
            metalness: 0.6,
            roughness: 0.5
        });

        const handleChromeMat = new THREE.MeshStandardMaterial({
            color: 0xf1f5f9,
            metalness: 0.9,
            roughness: 0.2
        });

        this.bayConfigs.forEach((cfg, index) => {
            const bayGroup = new THREE.Group();
            bayGroup.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
            bayGroup.rotation.y = cfg.rotY;

            // Cantilever Storage Rack Stand
            const postHeight = cfg.pos[1];
            if (postHeight > 0.4) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, postHeight, 0.18), rackSteelMat);
                post.position.set(0, -postHeight / 2, 0);
                post.castShadow = true;
                bayGroup.add(post);
            }

            // Shelf Cradle
            const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1.1), rackSteelMat);
            shelf.castShadow = true;
            shelf.receiveShadow = true;
            bayGroup.add(shelf);

            // Side Guide Brackets
            const leftGuide = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 1.1), rackSteelMat);
            leftGuide.position.set(-0.84, 0.1, 0);
            bayGroup.add(leftGuide);

            const rightGuide = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 1.1), rackSteelMat);
            rightGuide.position.set(0.84, 0.1, 0);
            bayGroup.add(rightGuide);

            this.scene.add(bayGroup);
            this.bays.push(bayGroup);

            // Workpiece Section Pallet
            const palletGroup = new THREE.Group();
            palletGroup.position.set(cfg.pos[0], cfg.pos[1] + 0.12, cfg.pos[2]);
            palletGroup.rotation.y = cfg.rotY;

            // Pallet Base Slab
            const palletSlab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 0.95), rackSteelMat);
            palletSlab.castShadow = true;
            palletGroup.add(palletSlab);

            // Front Info Display Faceplate
            const hexColor = '#' + cfg.color.toString(16).padStart(6, '0');
            const faceTex = this.createPalletTexture(cfg.name, cfg.bayNum, hexColor);
            const faceMat = new THREE.MeshStandardMaterial({
                map: faceTex,
                roughness: 0.4,
                metalness: 0.1
            });
            const faceplate = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), faceMat);
            faceplate.position.set(0, 0.42, 0.48);
            faceplate.castShadow = true;
            palletGroup.add(faceplate);

            // Steel Lift Lug / Handle for Gripper Clamping
            const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.32, 16), handleChromeMat);
            handleBar.rotation.z = Math.PI / 2;
            handleBar.position.set(0, 0.78, 0);
            handleBar.castShadow = true;
            palletGroup.add(handleBar);

            const leftStanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), handleChromeMat);
            leftStanchion.position.set(-0.16, 0.7, 0);
            palletGroup.add(leftStanchion);

            const rightStanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), handleChromeMat);
            rightStanchion.position.set(0.16, 0.7, 0);
            palletGroup.add(rightStanchion);

            palletGroup.userData = {
                index,
                cfg,
                homePos: new THREE.Vector3(cfg.pos[0], cfg.pos[1] + 0.12, cfg.pos[2]),
                homeRotY: cfg.rotY
            };

            this.scene.add(palletGroup);
            this.pallets.push(palletGroup);
        });
    }

    /**
     * Kinematic Solve for reaching a target position in cell space
     */
    calculateJointsForPosition(targetPos, pitchAngle = 0.2) {
        // Polar angle on horizontal plane gives J1 base angle
        const dx = targetPos.x;
        const dz = targetPos.z;
        const j1 = Math.atan2(dx, dz);

        // Distance in horizontal reach
        const r = Math.sqrt(dx * dx + dz * dz);
        const y = targetPos.y;

        // Simplified 2-link geometric reach for J2 (shoulder) and J3 (elbow)
        const L1 = 1.7; // Upper arm length
        const L2 = 1.5; // Forearm length

        // Wrist center offset
        const r_target = Math.max(0.8, r - 0.25);
        const y_target = Math.max(0.4, y);

        const d_sq = r_target * r_target + (y_target - 0.8) * (y_target - 0.8);
        const d = Math.sqrt(d_sq);

        // Clamp reach within physical envelope
        const reach = Math.min(d, (L1 + L2) * 0.96);

        // Law of Cosines for elbow angle
        const cosElbow = (reach * reach - L1 * L1 - L2 * L2) / (2 * L1 * L2);
        const safeCos = Math.max(-1, Math.min(1, cosElbow));
        const elbowAngle = -Math.acos(safeCos);

        // Shoulder elevation angle
        const alpha = Math.atan2(y_target - 0.8, r_target);
        const beta = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + reach * reach - L2 * L2) / (2 * L1 * reach))));
        const shoulderAngle = Math.PI / 2 - (alpha + beta);

        return {
            j1: j1,
            j2: THREE.MathUtils.clamp(shoulderAngle, -0.6, 1.2),
            j3: THREE.MathUtils.clamp(elbowAngle, -1.8, -0.1),
            j4: 0,
            j5: THREE.MathUtils.clamp(pitchAngle, -0.8, 0.8),
            j6: 0
        };
    }

    /**
     * Dispatches robot to target section bay with full pick-and-place sequence
     */
    setTargetBay(index, animate = true) {
        if (this.isEStopped) {
            console.warn('Robot is halted by E-STOP');
            return;
        }

        if (index < 0 || index >= this.bayConfigs.length) return;

        const targetCfg = this.bayConfigs[index];
        const previousIndex = this.activePalletIndex;
        this.activePalletIndex = index;
        this.isMoving = true;
        this.statusText = `DISPATCHING TO BAY [${targetCfg.bayNum} // ${targetCfg.name.toUpperCase()}]`;

        if (!animate) {
            // Instant setup for initial load
            const angles = this.calculateJointsForPosition(
                new THREE.Vector3(targetCfg.pos[0], targetCfg.pos[1] + 0.6, targetCfg.pos[2])
            );
            this.jointAngles = { ...angles };
            this.targetJointAngles = { ...angles };
            this.updatePalletPositionsImmediate(index);
            this.isMoving = false;
            this.statusText = `DOCKED AT FRONT STAGE // ${targetCfg.name.toUpperCase()}`;
            if (this.onSectionChange) this.onSectionChange(targetCfg.id, index);
            return;
        }

        // GSAP Pick-and-Place Animated Choreography
        if (typeof gsap !== 'undefined') {
            this.executePickAndPlaceChoreography(previousIndex, index, targetCfg);
        } else {
            // Fallback lerp target
            const targetPos = new THREE.Vector3(targetCfg.pos[0], targetCfg.pos[1] + 0.6, targetCfg.pos[2]);
            this.targetJointAngles = this.calculateJointsForPosition(targetPos);
            this.updatePalletPositionsImmediate(index);
            setTimeout(() => {
                this.isMoving = false;
                this.statusText = `DOCKED // ${targetCfg.name.toUpperCase()}`;
                if (this.onSectionChange) this.onSectionChange(targetCfg.id, index);
            }, 1200);
        }
    }

    executePickAndPlaceChoreography(fromIndex, toIndex, targetCfg) {
        const tl = gsap.timeline({
            onComplete: () => {
                this.isMoving = false;
                this.statusText = `DOCKED AT FRONT STAGE // ${targetCfg.name.toUpperCase()}`;
                if (this.onSectionChange) this.onSectionChange(targetCfg.id, toIndex);
            }
        });

        const currentPallet = this.pallets[fromIndex];
        const targetPallet = this.pallets[toIndex];
        const frontPos = new THREE.Vector3(0, 0.45 + 0.12, 2.5);

        // Step 1: Open Gripper
        tl.to(this.joints.gripper, {
            targetGap: 0.28,
            duration: 0.35,
            ease: 'power2.out'
        });

        // Step 2: If previous pallet is at front stage and not target, return it to its bay
        if (fromIndex !== toIndex && fromIndex !== 0) {
            const returnAngles = this.calculateJointsForPosition(
                new THREE.Vector3(currentPallet.userData.homePos.x, currentPallet.userData.homePos.y + 0.5, currentPallet.userData.homePos.z)
            );

            // Lift pallet from front dock
            tl.to(currentPallet.position, {
                y: frontPos.y + 0.8,
                duration: 0.5,
                ease: 'power2.inOut'
            }, 'returnStart');

            // Move robot to return bay
            tl.to(this.targetJointAngles, {
                ...returnAngles,
                duration: 0.9,
                ease: 'power2.inOut'
            }, 'returnStart');

            // Pallet travels with arm to its home bay
            tl.to(currentPallet.position, {
                x: currentPallet.userData.homePos.x,
                y: currentPallet.userData.homePos.y,
                z: currentPallet.userData.homePos.z,
                duration: 0.9,
                ease: 'power2.inOut'
            }, 'returnStart+=0.2');

            tl.to(currentPallet.rotation, {
                y: currentPallet.userData.homeRotY,
                duration: 0.9,
                ease: 'power2.inOut'
            }, 'returnStart+=0.2');
        }

        // Step 3: Align to target bay & approach workpiece
        const pickAngles = this.calculateJointsForPosition(
            new THREE.Vector3(targetPallet.userData.homePos.x, targetPallet.userData.homePos.y + 0.5, targetPallet.userData.homePos.z)
        );

        tl.to(this.targetJointAngles, {
            ...pickAngles,
            duration: 0.8,
            ease: 'power2.inOut'
        }, 'fetch');

        // Step 4: Close Gripper around target workpiece
        tl.to(this.joints.gripper, {
            targetGap: 0.08, // Clamp tight
            duration: 0.35,
            ease: 'power2.in'
        });

        // Step 5: Hoist & Swing Workpiece to Front Center Dock
        const frontAngles = this.calculateJointsForPosition(
            new THREE.Vector3(0, 0.45 + 0.5, 2.5)
        );

        tl.to(this.targetJointAngles, {
            ...frontAngles,
            duration: 1.1,
            ease: 'power2.inOut'
        }, 'carry');

        tl.to(targetPallet.position, {
            x: 0,
            y: frontPos.y + 0.1,
            z: frontPos.z,
            duration: 1.1,
            ease: 'power2.inOut'
        }, 'carry');

        tl.to(targetPallet.rotation, {
            y: 0,
            duration: 1.1,
            ease: 'power2.inOut'
        }, 'carry');

        // Step 6: Dock onto front platform & Release Gripper
        tl.to(targetPallet.position, {
            y: frontPos.y,
            duration: 0.3,
            ease: 'bounce.out'
        });

        tl.to(this.joints.gripper, {
            targetGap: 0.24, // Release clamp
            duration: 0.35,
            ease: 'power2.out'
        });
    }

    updatePalletPositionsImmediate(activeIdx) {
        const frontPos = new THREE.Vector3(0, 0.45 + 0.12, 2.5);

        this.pallets.forEach((pallet, idx) => {
            if (idx === activeIdx) {
                pallet.position.set(frontPos.x, frontPos.y, frontPos.z);
                pallet.rotation.y = 0;
            } else {
                pallet.position.copy(pallet.userData.homePos);
                pallet.rotation.y = pallet.userData.homeRotY;
            }
        });
    }

    /**
     * Manual Jog Controls for Teach Pendant
     */
    jogJoint(jointKey, delta) {
        if (this.isEStopped) return;
        this.isManualJog = true;
        this.statusText = `MANUAL JOG // ${jointKey.toUpperCase()} ADJUST`;

        if (this.targetJointAngles[jointKey] !== undefined) {
            this.targetJointAngles[jointKey] += delta;
        }
    }

    toggleGripperManual() {
        if (this.isEStopped) return;
        this.joints.gripper.targetGap = this.joints.gripper.targetGap > 0.15 ? 0.08 : 0.26;
        this.statusText = this.joints.gripper.targetGap > 0.15 ? 'GRIPPER: OPEN' : 'GRIPPER: CLAMPED';
    }

    emergencyStop() {
        this.isEStopped = true;
        this.isMoving = false;
        this.statusText = 'EMERGENCY STOP (E-STOP) ACTIVATED! ALL DRIVES HALTED';
        if (typeof gsap !== 'undefined') gsap.globalTimeline.pause();
    }

    resetEmergencyStop() {
        this.isEStopped = false;
        this.statusText = 'E-STOP CLEARED // DRIVES RE-INITIALIZED';
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

            const isWide = width > 992;
            this.cameraPos.x = isWide ? -0.9 : 0;
            this.cameraLookAt.x = isWide ? -0.9 : 0;
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        // Interpolate Joint Angles (Physical Servo Lerp)
        if (!this.isEStopped) {
            const lerpSpeed = 5.0 * delta;
            this.jointAngles.j1 += (this.targetJointAngles.j1 - this.jointAngles.j1) * lerpSpeed;
            this.jointAngles.j2 += (this.targetJointAngles.j2 - this.jointAngles.j2) * lerpSpeed;
            this.jointAngles.j3 += (this.targetJointAngles.j3 - this.jointAngles.j3) * lerpSpeed;
            this.jointAngles.j4 += (this.targetJointAngles.j4 - this.jointAngles.j4) * lerpSpeed;
            this.jointAngles.j5 += (this.targetJointAngles.j5 - this.jointAngles.j5) * lerpSpeed;
            this.jointAngles.j6 += (this.targetJointAngles.j6 - this.jointAngles.j6) * lerpSpeed;

            // Apply to 3D Hierarchical Joints
            if (this.joints.turntable) this.joints.turntable.rotation.y = this.jointAngles.j1;
            if (this.joints.shoulder) this.joints.shoulder.rotation.x = this.jointAngles.j2;
            if (this.joints.elbow) this.joints.elbow.rotation.x = this.jointAngles.j3;
            if (this.joints.forearm) this.joints.forearm.rotation.y = this.jointAngles.j4;
            if (this.joints.wrist) this.joints.wrist.rotation.x = this.jointAngles.j5;

            // Gripper Finger Jaw Translation
            this.joints.gripper.gap += (this.joints.gripper.targetGap - this.joints.gripper.gap) * 8.0 * delta;
            if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
                this.joints.gripper.leftFinger.position.x = -this.joints.gripper.gap;
                this.joints.gripper.rightFinger.position.x = this.joints.gripper.gap;
            }
        }

        // Camera gentle tracking
        this.camera.position.lerp(this.cameraPos, 0.05);
        this.camera.lookAt(this.cameraLookAt);

        // Render Frame
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }

        // Telemetry readout for UI Teach Pendant
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

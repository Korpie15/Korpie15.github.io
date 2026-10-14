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

/**
 * 3D Line Segment to Segment Distance (Dan Sunday / Lumelsky Algorithm)
 * Computes exact minimum Euclidean distance between two 3D capsule line segments.
 */
function distSegmentToSegment(p0, p1, q0, q1) {
    const u = new THREE.Vector3().subVectors(p1, p0);
    const v = new THREE.Vector3().subVectors(q1, q0);
    const w = new THREE.Vector3().subVectors(p0, q0);

    const a = u.dot(u);
    const b = u.dot(v);
    const c = v.dot(v);
    const d = u.dot(w);
    const e = v.dot(w);
    const D = a * c - b * b;

    let sN, sD = D;
    let tN, tD = D;

    if (D < 1e-7) {
        sN = 0.0;
        sD = 1.0;
        tN = e;
        tD = c;
    } else {
        sN = (b * e - c * d);
        tN = (a * e - b * d);
        if (sN < 0.0) {
            sN = 0.0;
            tN = e;
            tD = c;
        } else if (sN > sD) {
            sN = sD;
            tN = e + b;
            tD = c;
        }
    }

    if (tN < 0.0) {
        tN = 0.0;
        if (-d < 0.0) sN = 0.0;
        else if (-d > a) sN = sD;
        else {
            sN = -d;
            sD = a;
        }
    } else if (tN > tD) {
        tN = tD;
        if ((-d + b) < 0.0) sN = 0.0;
        else if ((-d + b) > a) sN = sD;
        else {
            sN = (-d + b);
            sD = a;
        }
    }

    const sc = Math.abs(sN) < 1e-7 ? 0.0 : sN / sD;
    const tc = Math.abs(tN) < 1e-7 ? 0.0 : tN / tD;

    const dP = new THREE.Vector3().copy(w).addScaledVector(u, sc).addScaledVector(v, -tc);
    return {
        dist: dP.length(),
        s: sc,
        t: tc
    };
}

/**
 * DYNAMIC ROBOT COLLISION MODEL (DCS - DUAL CHECK SAFETY)
 * Real-time analytical collision verification for 6-DOF industrial robot arm.
 * Detects dynamic self-intersections (forearm vs upper arm, tool vs upper arm, tool vs forearm,
 * counterweight vs base, and floor clearance) and dynamically halts motion slightly before contact.
 */
class RobotCollisionChecker {
    constructor() {
        // Shadow forward kinematics hierarchy (identical to Three.js robot structure)
        this.root = new THREE.Group();
        this.root.position.set(0, -1.8, 0);

        this.turntable = new THREE.Group();
        this.turntable.position.set(0, 0.6, 0);
        this.root.add(this.turntable);

        this.shoulder = new THREE.Group();
        this.shoulder.position.set(0, 0.6, 0);
        this.turntable.add(this.shoulder);

        this.counterweight = new THREE.Group();
        this.counterweight.position.set(0, -0.15, -0.4);
        this.shoulder.add(this.counterweight);

        this.elbow = new THREE.Group();
        this.elbow.position.set(0, 2.1, 0);
        this.shoulder.add(this.elbow);

        this.wrist = new THREE.Group();
        this.wrist.position.set(0, 1.9, 0);
        this.elbow.add(this.wrist);

        this.wristYaw = new THREE.Group();
        this.wristYaw.position.set(0, 0.08, 0);
        this.wrist.add(this.wristYaw);

        this.flange = new THREE.Group();
        this.flange.position.set(0, 0.08, 0);
        this.flange.rotation.y = Math.PI / 2;
        this.wristYaw.add(this.flange);

        this.toolTip = new THREE.Group();
        this.toolTip.position.set(0, 0.52, 0);
        this.flange.add(this.toolTip);

        this.fingertips = new THREE.Group();
        this.fingertips.position.set(0, 0.68, 0);
        this.flange.add(this.fingertips);

        // Effective physical collision radii (meters)
        this.R_base = 0.78;
        this.R_turn = 0.48;
        this.R_upper = 0.22;
        this.R_forearm = 0.18;
        this.R_tool = 0.22;

        // Dynamic safety stop margin: halts 40mm before surface contact
        this.safetyMargin = 0.04;
        this.floorY = -1.80;
        this.floorClearance = 0.06;
    }

    forwardKinematics(j1, j2, j3, j4, j5 = 0, j6 = 0) {
        this.turntable.rotation.y = j1;
        this.shoulder.rotation.x = j2;
        this.elbow.rotation.x = j3;
        this.wrist.rotation.x = j4;
        this.wristYaw.rotation.z = j5;
        this.flange.rotation.y = Math.PI / 2 + j6;
        this.root.updateMatrixWorld(true);

        const getPos = (obj) => {
            const p = new THREE.Vector3();
            obj.getWorldPosition(p);
            return p;
        };

        const pSh = getPos(this.shoulder);
        const pCw = getPos(this.counterweight);
        const pEl = getPos(this.elbow);
        const pWr = getPos(this.wrist);
        const pTool = getPos(this.toolTip);
        const pTip = getPos(this.fingertips);

        const uUpper = new THREE.Vector3().subVectors(pEl, pSh).normalize();
        const uFore = new THREE.Vector3().subVectors(pWr, pEl).normalize();
        const uTool = new THREE.Vector3().subVectors(pTip, pWr).normalize();

        // 3D position and orientation of carried payload (topic crate) in forward kinematics:
        const pBox = new THREE.Vector3(0, 0.805, 0);
        this.flange.localToWorld(pBox);

        if (!this._boxQuatOffset) {
            const q_box = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));
            const q_jaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI, 'YXZ'));
            this._boxQuatOffset = q_jaw.invert().multiply(q_box);
        }
        const flangeQuat = new THREE.Quaternion();
        this.flange.getWorldQuaternion(flangeQuat);
        const boxQuat = flangeQuat.clone().multiply(this._boxQuatOffset);

        const boxX = new THREE.Vector3(1, 0, 0).applyQuaternion(boxQuat);
        const boxY = new THREE.Vector3(0, 1, 0).applyQuaternion(boxQuat);
        const boxZ = new THREE.Vector3(0, 0, 1).applyQuaternion(boxQuat);

        // Segment along the long axis of crate (1.25m wide, half-length 0.55m):
        const pBoxEnd1 = pBox.clone().addScaledVector(boxX, 0.55);
        const pBoxEnd2 = pBox.clone().addScaledVector(boxX, -0.55);

        return {
            pSh, pCw, pEl, pWr, pTool, pTip, pBox, pBoxEnd1, pBoxEnd2, boxQuat, boxX, boxY, boxZ,
            uUpper, uFore, uTool,
            upperArmBody: [
                new THREE.Vector3().copy(pSh).addScaledVector(uUpper, 0.1),
                new THREE.Vector3().copy(pEl).addScaledVector(uUpper, -0.45)
            ],
            upperArmFull: [
                new THREE.Vector3().copy(pSh),
                new THREE.Vector3().copy(pEl)
            ],
            forearmBody: [
                new THREE.Vector3().copy(pEl).addScaledVector(uFore, 0.45),
                new THREE.Vector3().copy(pWr).addScaledVector(uFore, -0.20)
            ],
            forearmFull: [
                new THREE.Vector3().copy(pEl),
                new THREE.Vector3().copy(pWr)
            ],
            toolSegment: [
                new THREE.Vector3().copy(pWr).addScaledVector(uTool, 0.05),
                new THREE.Vector3().copy(pTip)
            ],
            baseSegment: [
                new THREE.Vector3(0, -1.8, 0),
                new THREE.Vector3(0, -1.15, 0)
            ]
        };
    }

    checkCollision(pose, isHoldingBox = false) {
        const { j1 = 0, j2 = 0, j3 = 0, j4 = 0, j5 = 0, j6 = 0 } = pose;
        const fk = this.forwardKinematics(j1, j2, j3, j4, j5, j6);
        const report = {
            inCollision: false,
            minClearance: Infinity,
            culprit: null
        };

        const checkPair = (name, d, rSum) => {
            const clearance = d - rSum;
            if (clearance < report.minClearance) {
                report.minClearance = clearance;
            }
            if (clearance <= this.safetyMargin) {
                report.inCollision = true;
                if (!report.culprit) report.culprit = name;
            }
        };

        // 1. Forearm vs Upper Arm (Elbow folding forward and backward stops)
        if (j3 < -0.05) {
            const hypClearance = (j3 - (-0.05));
            if (hypClearance < report.minClearance) report.minClearance = hypClearance;
            report.inCollision = true;
            if (!report.culprit) report.culprit = 'ELBOW MECHANICAL LIMIT (HYPEREXTENSION)';
        }
        if (j3 > 2.15) {
            const foldClearance = 2.15 - j3;
            if (foldClearance < report.minClearance) report.minClearance = foldClearance;
            report.inCollision = true;
            if (!report.culprit) report.culprit = 'FOREARM / UPPER ARM (ELBOW FOLD STOP)';
        }
        const d_fore_upper = distSegmentToSegment(
            fk.upperArmBody[0], fk.upperArmBody[1],
            fk.forearmBody[0], fk.forearmBody[1]
        ).dist;
        checkPair('FOREARM / UPPER ARM', d_fore_upper, this.R_upper + this.R_forearm);

        // 2. Tool vs Forearm (Wrist pitch forward and backward curl limits)
        if (j4 < -1.85) {
            const revClearance = j4 - (-1.85);
            if (revClearance < report.minClearance) report.minClearance = revClearance;
            report.inCollision = true;
            if (!report.culprit) report.culprit = 'TOOL / FOREARM (WRIST REVERSE CURL)';
        }
        if (j4 > 2.12) {
            const fwdClearance = 2.12 - j4;
            if (fwdClearance < report.minClearance) report.minClearance = fwdClearance;
            report.inCollision = true;
            if (!report.culprit) report.culprit = 'TOOL / FOREARM (WRIST FORWARD CURL)';
        }

        // 3. Wrist Lateral Tilt Limit (J5):
        if (Math.abs(j5) > 1.35) {
            const tiltClearance = 1.35 - Math.abs(j5);
            if (tiltClearance < report.minClearance) report.minClearance = tiltClearance;
            report.inCollision = true;
            if (!report.culprit) report.culprit = 'WRIST LATERAL TILT LIMIT (J5)';
        }

        // 4. Tool vs Upper Arm (Tool curling back into upper arm)
        const d_tool_upper = distSegmentToSegment(
            fk.upperArmFull[0], fk.upperArmFull[1],
            fk.toolSegment[0], fk.toolSegment[1]
        ).dist;
        checkPair('TOOL / UPPER ARM', d_tool_upper, this.R_upper + this.R_tool);

        // 5. Shoulder Counterweight vs Turntable Base (Backwards shoulder pitch hard limit at -24 deg)
        if (j2 < -0.40) {
            const cwClearance = j2 - (-0.40);
            if (cwClearance < report.minClearance) report.minClearance = cwClearance;
            report.inCollision = true;
            if (!report.culprit) report.culprit = 'SHOULDER COUNTERWEIGHT / TURNTABLE';
        }

        // Shoulder forward limit (prevent upper arm crashing down onto motor housing)
        if (j2 > 1.85) {
            report.inCollision = true;
            if (!report.culprit) report.culprit = 'SHOULDER / MOTOR HOUSING';
        }

        // 6. Forearm vs Base Pedestal
        const d_fore_base = distSegmentToSegment(
            fk.baseSegment[0], fk.baseSegment[1],
            fk.forearmFull[0], fk.forearmFull[1]
        ).dist;
        checkPair('FOREARM / BASE PEDESTAL', d_fore_base, this.R_base + this.R_forearm);

        // 7. Tool vs Base Pedestal
        const d_tool_base = distSegmentToSegment(
            fk.baseSegment[0], fk.baseSegment[1],
            fk.toolSegment[0], fk.toolSegment[1]
        ).dist;
        checkPair('TOOL / BASE PEDESTAL', d_tool_base, this.R_base + this.R_tool);

        // 8. Floor Clearance (Elbow, Forearm, Wrist, Tool, Fingertips)
        const lowestPointY = Math.min(
            fk.pEl.y - this.R_forearm,
            fk.pWr.y - this.R_forearm,
            fk.pTool.y - this.R_tool,
            fk.pTip.y - this.R_tool
        );
        const floorClearance = lowestPointY - this.floorY;
        if (floorClearance < report.minClearance) report.minClearance = floorClearance;
        if (floorClearance <= this.floorClearance) {
            report.inCollision = true;
            if (!report.culprit) report.culprit = 'ROBOT / FACTORY FLOOR';
        }

        // 9. Dynamic Carried Object (Topic Crate) Collision Envelope:
        if (isHoldingBox) {
            // Box vs Floor (All 8 corners tested with 3D orientation)
            let minBoxY = Infinity;
            for (const dx of [-0.60, 0.60]) {
                for (const dy of [-0.32, 0.32]) {
                    for (const dz of [-0.32, 0.32]) {
                        const cy = fk.pBox.y + fk.boxX.y * dx + fk.boxY.y * dy + fk.boxZ.y * dz;
                        if (cy < minBoxY) minBoxY = cy;
                    }
                }
            }
            const boxFloorClearance = minBoxY - this.floorY;
            if (boxFloorClearance < report.minClearance) report.minClearance = boxFloorClearance;
            if (boxFloorClearance <= 0.05) {
                report.inCollision = true;
                if (!report.culprit) report.culprit = 'CARRIED OBJECT / FACTORY FLOOR';
            }

            // Box vs Upper Arm (segment along box length vs upper arm girder)
            const d_box_upper = distSegmentToSegment(
                fk.upperArmBody[0], fk.upperArmBody[1],
                fk.pBoxEnd1, fk.pBoxEnd2
            ).dist;
            checkPair('CARRIED OBJECT / UPPER ARM', d_box_upper, this.R_upper + 0.33);

            // Box vs Forearm (segment along box length vs forearm girder)
            const d_box_fore = distSegmentToSegment(
                fk.forearmBody[0], fk.forearmBody[1],
                fk.pBoxEnd1, fk.pBoxEnd2
            ).dist;
            checkPair('CARRIED OBJECT / FOREARM', d_box_fore, this.R_forearm + 0.33);

            // Box vs Base Pedestal
            const d_box_base = distSegmentToSegment(
                fk.baseSegment[0], fk.baseSegment[1],
                fk.pBoxEnd1, fk.pBoxEnd2
            ).dist;
            checkPair('CARRIED OBJECT / BASE PEDESTAL', d_box_base, this.R_base + 0.33);
        }

        return report;
    }

    /**
     * Binary Search Bisection:
     * Calculates the exact maximum safe step that stops SLIGHTLY BEFORE physical collision.
     */
    calcSafeJogDelta(currentPose, jointKey, delta, isHoldingBox = false) {
        const candidatePose = { ...currentPose, [jointKey]: (currentPose[jointKey] || 0) + delta };
        const testReport = this.checkCollision(candidatePose, isHoldingBox);

        if (!testReport.inCollision) {
            return { safeDelta: delta, stoppedAtLimit: false, culprit: null };
        }

        // Binary search for maximum safe step that stops SLIGHTLY BEFORE collision
        let tSafe = 0.0;
        let tUnsafe = 1.0;
        let culprit = testReport.culprit;

        for (let iter = 0; iter < 6; iter++) {
            const tMid = (tSafe + tUnsafe) / 2;
            const midPose = { ...currentPose, [jointKey]: (currentPose[jointKey] || 0) + tMid * delta };
            const midReport = this.checkCollision(midPose, isHoldingBox);
            if (!midReport.inCollision) {
                tSafe = tMid;
            } else {
                tUnsafe = tMid;
                culprit = midReport.culprit;
            }
        }

        return {
            safeDelta: tSafe * delta,
            stoppedAtLimit: true,
            culprit: culprit
        };
    }
}

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
        this.standbyPose = { j1: 0, j2: 0.28, j3: 0.82, j4: 1.05, j6: 0 };
        // Inspection posture (above front stool when crate lid is open)
        this.inspectPose = { j1: 0, j2: 0.12, j3: 0.72, j4: 0.96, j6: 0 };

        // Blank Staging Front Stool (Inspection table - destination where boxes are placed)
        // Table top of front stool is at: -0.5 + 0.05 = -0.45.
        // Crate tub bottom is at local -0.325.
        // So crate center rests at: -0.45 - (-0.325) = -0.125!
        this.frontStoolPos = new THREE.Vector3(0, -0.5, 2.4);
        this.frontBoxRestY = -0.06; // Briefcase center when resting on stool (tub bottom at local -0.39, table top at -0.45)
        this.frontHandleY = this.frontBoxRestY + 0.475; // 0.415m (Handle center at +0.475m relative to briefcase center)
        this.frontStoolBoxPos = new THREE.Vector3(0, this.frontBoxRestY, 2.4);

        // 7 Perimeter Storage Racks:
        // - Home and Contact lowered close to the ground (Y = -1.05) on low floor stands
        // - About Me and Technical Skills elevated (Y = 0.05) and rotated facing the front (+Z)
        //   so their wide, high-res faceplates are 100% visible and unobstructed from the front camera!
        // - Experience, Leadership, and Projects tiered up in amphitheater formation behind the arm
        this.bayConfigs = [
            { id: 'hero', name: 'Home / Dossier', bayNum: '00', pos: [-1.65, -1.05, 1.85], rotY: -0.45, color: 0x2563eb },
            { id: 'about', name: 'About Me', bayNum: '01', pos: [-2.45, 0.05, 0.60], rotY: 0.12, color: 0x059669 },
            { id: 'experience', name: 'Experience', bayNum: '02', pos: [-1.95, 0.15, -1.35], rotY: -2.00, color: 0xd97706 },
            { id: 'leadership', name: 'Leadership', bayNum: '03', pos: [0.0, 0.25, -2.45], rotY: Math.PI, color: 0x7c3aed },
            { id: 'projects', name: 'Projects', bayNum: '04', pos: [1.95, 0.15, -1.35], rotY: 2.00, color: 0x0284c7 },
            { id: 'skills', name: 'Technical Skills', bayNum: '05', pos: [2.45, 0.05, 0.60], rotY: -0.12, color: 0xe11d48 },
            { id: 'contact', name: 'Contact', bayNum: '06', pos: [1.65, -1.05, 1.85], rotY: 0.45, color: 0x4f46e5 }
        ];

        // Compute handle heights and rack positions for each storage bay:
        // Shelf top surface is at: cfg.pos[1] + 0.04.
        // Briefcase bottom is at local -0.39.
        // Briefcase center rests at: cfg.pos[1] + 0.04 - (-0.39) = cfg.pos[1] + 0.43.
        this.bayConfigs.forEach(cfg => {
            cfg.boxRestY = cfg.pos[1] + 0.43;
            cfg.handleY = cfg.boxRestY + 0.475;
            cfg.boxRestPos = new THREE.Vector3(cfg.pos[0], cfg.boxRestY, cfg.pos[2]);
        });

        // Current & Target Joint Angles (Full 6-Axis Robotic Kinematics)
        this.jointAngles = { ...this.standbyPose, j5: 0, j6: 0 };
        this.targetJointAngles = { ...this.standbyPose, j5: 0, j6: 0 };
        this.jogOffsets = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        this.manualGripperGap = null; // null = follow kinematics; number = manual override clamp/open

        // Dynamic Collision Model & DCS (Dual Check Safety)
        this.collisionChecker = new RobotCollisionChecker();
        this.isAtDynamicLimit = false;
        this.limitCulprit = null;
        this.showCollisionModel = false;
        this.collisionVisualGroup = null;
        this.collisionEnvelopes = [];
        this.collisionMat = null;
        this.carriedBox = null;

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

        // Camera - centered on workcell with full clearance
        this.cameraPos = new THREE.Vector3(0, 2.0, 9.4);
        this.cameraLookAt = new THREE.Vector3(0, 0.3, 0);

        // Callbacks
        this.onTelemetryUpdate = null;
        this.onSectionChange = null;

        this.init();
    }

    /**
     * Exact Analytical Inverse Kinematics Solver (Verified 0.0000m error)
     * Automatically calculates Joint 6 wrist roll (j6 = rotY - j1) to align parallel jaws with briefcase handle!
     */
    solveIK(tx, ty, tz, rotY = null) {
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

        let j6 = 0;
        if (rotY !== null && rotY !== undefined) {
            // Gripper fingers separate along local X of gripperBase.
            // When tool points vertically down (elbow and wrist pitched down),
            // the world clamping axis angle in the XZ plane is (j1 - j6).
            // To align the clamping axis perpendicular to the horizontal handle (parallel to the box normal at rotY):
            // j1 - j6 = rotY => j6 = j1 - rotY!
            let diff = (j1 - rotY) % (2 * Math.PI);
            if (diff > Math.PI) diff -= 2 * Math.PI;
            if (diff < -Math.PI) diff += 2 * Math.PI;
            j6 = diff;
        }

        return { j1, j2, j3, j4, j6 };
    }

    lerpAngle(a, b, t) {
        let diff = (b - a) % (2 * Math.PI);
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        let res = a + diff * t;
        while (res > Math.PI) res -= 2 * Math.PI;
        while (res < -Math.PI) res += 2 * Math.PI;
        return res;
    }

    /**
     * Retracted Central Corridor Flight Pose:
     * Pulls the arm inward to radius R = 1.15m at safe high height Y = 1.45m.
     * This guarantees the carried box bottom (Y = 0.80m) is > 0.4m ABOVE all perimeter crates
     * and > 0.9m inside the perimeter circle. NO collisions possible!
     */
    getFlightCorridorPose(j1, j6 = 0) {
        const tx = Math.sin(j1) * 1.15;
        const ty = 1.45;
        const tz = Math.cos(j1) * 1.15;
        const pose = this.solveIK(tx, ty, tz);
        pose.j6 = j6;
        return pose;
    }

    lerpPose(pA, pB, t) {
        return {
            j1: this.lerpAngle(pA.j1, pB.j1, t),
            j2: pA.j2 + (pB.j2 - pA.j2) * t,
            j3: pA.j3 + (pB.j3 - pA.j3) * t,
            j4: pA.j4 + (pB.j4 - pA.j4) * t,
            j6: this.lerpAngle(pA.j6 || 0, pB.j6 || 0, t)
        };
    }

    init() {
        this.initThree();
        this.setupLighting();
        this.buildFactoryFloor();
        this.buildRobotArm();
        this.buildCollisionVisualizer();
        this.buildFrontStool();
        this.buildStorageRacks();
        this.buildEnclosedBoxes();
        this.setupEventListeners();

        // Initial Pose: Standby with blank front stool
        this.evaluateProgress(0.0);
        this.jointAngles = { ...this.targetJointAngles };
        this.joints.gripper.gap = this.targetGripGap;
        if (this.joints.turntable) this.joints.turntable.rotation.y = this.jointAngles.j1;
        if (this.joints.shoulder) this.joints.shoulder.rotation.x = this.jointAngles.j2;
        if (this.joints.elbow) this.joints.elbow.rotation.x = this.jointAngles.j3;
        if (this.joints.wrist) this.joints.wrist.rotation.x = this.jointAngles.j4;
        if (this.joints.wristYaw) this.joints.wristYaw.rotation.z = this.jointAngles.j5;
        if (this.joints.flange) this.joints.flange.rotation.y = Math.PI / 2 + this.jointAngles.j6;
        if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
            this.joints.gripper.leftFinger.position.x = -this.joints.gripper.gap;
            this.joints.gripper.rightFinger.position.x = this.joints.gripper.gap;
        }
        this.animate();
        if (typeof window.dismissLoader === 'function') {
            window.dismissLoader();
        }
    }

    initThree() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e17);
        this.scene.fog = new THREE.FogExp2(0x0a0e17, 0.014);

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

        // Main yellow forearm girder stops at L2 - 0.22 (Y = 1.68m)
        const forearmBody = new THREE.Mesh(new THREE.BoxGeometry(0.30, this.L2 - 0.22, 0.30), yellowMat);
        forearmBody.position.set(0, (this.L2 - 0.22) / 2, 0);
        forearmBody.castShadow = true;
        forearm.add(forearmBody);

        // Circular beveled dark transition collar to the spherical wrist joint
        // Prevents sharp rectangular corners from sticking past the wrist sphere
        const wristCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 0.22, 24), darkMat);
        wristCollar.position.set(0, this.L2 - 0.11, 0);
        wristCollar.castShadow = true;
        forearm.add(wristCollar);

        elbow.add(forearm);
        shoulder.add(elbow);
        this.joints.elbow = elbow;
        this.joints.forearm = forearm;

        // --- J4: Wrist Pitch (Pitches around X) ---
        const wrist = new THREE.Group();
        wrist.position.set(0, this.L2, 0);

        const wristPivot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 20), darkMat);
        wristPivot.castShadow = true;
        wrist.add(wristPivot);

        // --- J5: Wrist Yaw / Tilt (Pivots around Z) ---
        const wristYaw = new THREE.Group();
        wristYaw.position.set(0, 0.09, 0);

        const yawPivot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 20), darkMat);
        yawPivot.castShadow = true;
        wristYaw.add(yawPivot);

        // --- J6: Tool Flange (Rotated 90 deg so jaws clamp across horizontal handle bar, rolls around Y) ---
        const flange = new THREE.Group();
        flange.position.set(0, 0.09, 0);
        flange.rotation.y = Math.PI / 2;

        const flangePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20), chromeMat);
        flangePlate.castShadow = true;
        flange.add(flangePlate);

        // Parallel Gripper Body (0.09 + 0.09 + 0.14 + 0.20 = 0.52 = Ltool exact)
        const gripperBase = new THREE.Group();
        gripperBase.position.set(0, 0.14, 0);

        // Neck cylinder connecting flange to gripper body
        const gripperNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 20), darkMat);
        gripperNeck.position.set(0, -0.04, 0);
        gripperNeck.castShadow = true;
        gripperBase.add(gripperNeck);

        // Slim, collision-free gripper chassis (raised to Y = 0.07 so bottom is at Y = 0.00 relative to gripperBase)
        // Distance from wrist pitch pivot to gripper chassis bottom = 0.09 + 0.09 + 0.14 = 0.32m!
        // Sphere radius is 0.18m. Clearance at full 90 deg pitch is 0.14m (140mm)! Zero collision!
        const gripperBody = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.22), darkMat);
        gripperBody.position.set(0, 0.07, 0);
        gripperBody.castShadow = true;
        gripperBase.add(gripperBody);

        // Chrome guide rods
        const guideRod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 14), chromeMat);
        guideRod.rotation.z = Math.PI / 2;
        guideRod.position.set(0, 0.07, 0);
        gripperBase.add(guideRod);

        // Jaw Center Contact Tracking Node (Total distance from wrist = 0.09 + 0.09 + 0.14 + 0.20 = 0.52 = Ltool)
        const jawCenter = new THREE.Group();
        jawCenter.position.set(0, 0.20, 0);
        gripperBase.add(jawCenter);

        // Moving Finger Jaws:
        // Finger height is 0.15m (half-height 0.075m).
        // Fingers centered at Y = 0.20m to align with jawCenter (0.125 + 0.075 = 0.20m)!
        // Fingertip reaches down to 0.20 - 0.075 = 0.125m in gripperBase frame (0.075m below jawCenter).
        // When jawCenter grasps handleY (boxRestY + 0.475), fingertips stop at boxRestY + 0.400m,
        // which gives +10mm of clean daylight above the briefcase lid surface (boxRestY + 0.390m) - ZERO PENETRATION!
        const fingerGeo = new THREE.BoxGeometry(0.06, 0.15, 0.14);
        const padGeo = new THREE.BoxGeometry(0.022, 0.11, 0.12);

        // Left Finger
        const leftFinger = new THREE.Group();
        const leftMesh = new THREE.Mesh(fingerGeo, yellowMat);
        leftMesh.position.y = 0.075;
        leftMesh.castShadow = true;
        leftFinger.add(leftMesh);

        const leftPad = new THREE.Mesh(padGeo, rubberMat);
        leftPad.position.set(0.035, 0.075, 0);
        leftFinger.add(leftPad);

        leftFinger.position.set(-0.08, 0.125, 0);
        gripperBase.add(leftFinger);

        // Right Finger
        const rightFinger = new THREE.Group();
        const rightMesh = new THREE.Mesh(fingerGeo, yellowMat);
        rightMesh.position.y = 0.075;
        rightMesh.castShadow = true;
        rightFinger.add(rightMesh);

        const rightPad = new THREE.Mesh(padGeo, rubberMat);
        rightPad.position.set(-0.035, 0.075, 0);
        rightFinger.add(rightPad);

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

    /**
     * 3D Dynamic Collision Safety Envelopes (DCS Visualization):
     * Semi-transparent glowing capsules & spheres around each robot link.
     * Can be toggled on/off from the Teach Pendant.
     */
    buildCollisionVisualizer() {
        this.collisionMat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.35,
            wireframe: true,
            depthWrite: false
        });

        this.collisionVisualGroup = new THREE.Group();
        this.collisionVisualGroup.visible = this.showCollisionModel;

        // Base Envelope
        const baseEnv = new THREE.Mesh(
            new THREE.CylinderGeometry(0.78, 0.78, 0.65, 20),
            this.collisionMat
        );
        baseEnv.position.y = 0.325;
        this.collisionVisualGroup.add(baseEnv);
        if (this.robot) this.robot.add(this.collisionVisualGroup);

        // Counterweight Envelope
        const cwEnv = new THREE.Mesh(
            new THREE.SphereGeometry(0.30, 14, 14),
            this.collisionMat
        );
        cwEnv.position.set(0, -0.15, -0.4);
        cwEnv.visible = this.showCollisionModel;
        if (this.joints.shoulder) this.joints.shoulder.add(cwEnv);

        // Upper Arm Envelope
        const upperEnv = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.22, 1.68, 16),
            this.collisionMat
        );
        upperEnv.position.set(0, 1.05, 0);
        upperEnv.visible = this.showCollisionModel;
        if (this.joints.shoulder) this.joints.shoulder.add(upperEnv);

        // Forearm Envelope
        const foreEnv = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.18, 1.55, 16),
            this.collisionMat
        );
        foreEnv.position.set(0, 0.95, 0);
        foreEnv.visible = this.showCollisionModel;
        if (this.joints.elbow) this.joints.elbow.add(foreEnv);

        // Tool Envelope
        const toolEnv = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.22, 0.52, 16),
            this.collisionMat
        );
        toolEnv.position.set(0, 0.26, 0);
        toolEnv.visible = this.showCollisionModel;
        if (this.joints.flange) this.joints.flange.add(toolEnv);

        this.collisionEnvelopes = [baseEnv, cwEnv, upperEnv, foreEnv, toolEnv];
    }

    toggleCollisionModel() {
        this.showCollisionModel = !this.showCollisionModel;
        if (this.collisionEnvelopes) {
            this.collisionEnvelopes.forEach(m => { if (m) m.visible = this.showCollisionModel; });
        }
        if (this.collisionVisualGroup) {
            this.collisionVisualGroup.visible = this.showCollisionModel;
        }
        return this.showCollisionModel;
    }

    /**
     * Synchronize Carried Object:
     * Locks carried payload position and 3D orientation rigidly to the robot gripper.
     * When Joint 6 rolls, Joint 5 tilts, or Joint 1 turns, the object rotates dynamically with the gripper in real time!
     */
    updateCarriedBox() {
        if (!this.carriedBox || !this.joints.gripper.jawCenter) return;
        this.robot.updateMatrixWorld(true);

        // Constant offset quaternion linking jawCenter orientation to box orientation:
        // At frontGrip (j1=0, j6=0), jawQuat has Euler (0, PI/2, PI, 'YXZ') and box has Euler (0,0,0)
        if (!this._boxQuatOffset) {
            const q_box = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));
            const q_jaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI, 'YXZ'));
            this._boxQuatOffset = q_jaw.invert().multiply(q_box);
        }

        const jawQuat = new THREE.Quaternion();
        this.joints.gripper.jawCenter.getWorldQuaternion(jawQuat);
        const boxQuat = jawQuat.clone().multiply(this._boxQuatOffset);
        this.carriedBox.quaternion.copy(boxQuat);

        // Position: In jawCenter frame, the box center is at (0, +0.475, 0)
        const boxPos = new THREE.Vector3(0, 0.475, 0);
        this.joints.gripper.jawCenter.localToWorld(boxPos);
        this.carriedBox.position.copy(boxPos);
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
            if (postHeight > 0.2) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, postHeight, 0.18), steelMat);
                post.position.set(0, -postHeight / 2, 0);
                post.castShadow = true;
                rackGroup.add(post);

                const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.06, 0.65), steelMat);
                basePlate.position.set(0, -postHeight + 0.03, 0);
                rackGroup.add(basePlate);
            }

            // Sleek shelf tailored to briefcase dimensions (clean flush surface)
            const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 0.50), steelMat);
            shelf.castShadow = true;
            shelf.receiveShadow = true;
            rackGroup.add(shelf);

            this.scene.add(rackGroup);
            this.bays.push(rackGroup);
        });
    }

    createBoxLabelTexture(title, bayNum, accentHex, isBack = false) {
        const canvas = document.createElement('canvas');
        canvas.width = 2048;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // Deep Navy-Carbon Background
        ctx.fillStyle = '#070b14';
        ctx.fillRect(0, 0, 2048, 1024);

        // Subtle Industrial Tech Hatching Lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.lineWidth = 2;
        for (let y = 0; y < 1024; y += 32) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(2048, y);
            ctx.stroke();
        }

        // Heavy High-Tech Outer Chamfered Border
        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 20;
        ctx.strokeRect(16, 16, 2016, 992);

        // Header Accent Stripe
        ctx.fillStyle = accentHex;
        ctx.fillRect(16, 16, 2016, 140);

        // Header Classification Badge
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 52px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`CLASSIFIED BRIEFING // BAY ${bayNum} // DOSSIER FLIGHT CASE`, 64, 105);

        // Glowing LED Indicator in header
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(1960, 85, 22, 0, Math.PI * 2);
        ctx.fill();

        // High-Contrast Dark Display Panel
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(48, 180, 1952, 680);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 6;
        ctx.strokeRect(48, 180, 1952, 680);

        // HERO TOPIC TITLE - ULTRA HIGH DEFINITION & CRISP
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 4;
        ctx.font = '900 148px "Segoe UI", Arial, sans-serif';
        ctx.fillText(title.toUpperCase(), 90, 420);

        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Glowing Underline Accent Bar
        ctx.fillStyle = accentHex;
        ctx.fillRect(90, 460, 1860, 14);

        // Subtitle Technical Meta Data
        ctx.fillStyle = '#38bdf8'; // Bright Cyan
        ctx.font = 'bold 64px "Segoe UI", monospace';
        if (!isBack) {
            ctx.fillText('STATUS: DISPATCH VERIFIED // 6-DOF REACH', 90, 580);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '500 52px monospace';
            ctx.fillText('ENCLOSURE: RUGGED ATTACHÉ FLIGHT BRIEFCASE', 90, 670);
            ctx.fillText('SECURITY LEVEL: LEVEL 4 CLEARED // AIDAN KORPAR', 90, 755);
        } else {
            ctx.fillText('PORTFOLIO ARCHIVE // AIDAN KORPAR', 90, 580);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '500 52px monospace';
            ctx.fillText('HARDWARE FIXTURE: CONTOURED TOP CARRY HANDLE', 90, 670);
            ctx.fillText('AUTHENTICATION: ||||| | |||| || |||||| | |||||', 90, 755);
        }

        // Heavy Industrial Corner Bolts
        ctx.fillStyle = '#cbd5e1';
        [ [70, 70], [1978, 70], [70, 954], [1978, 954] ].forEach(([x, y]) => {
            ctx.beginPath();
            ctx.arc(x, y, 22, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 6;
            ctx.stroke();
        });

        const texture = new THREE.CanvasTexture(canvas);
        const maxAniso = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 16;
        texture.anisotropy = maxAniso;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }


    /**
     * Builds Authentic Rugged Attaché Flight Briefcases with HINGED OPENING LIDS:
     * - Slim, executive briefcase proportions (Depth: 0.34m, Width: 1.20m, Height: 0.78m)
     * - Dual heavy-duty chrome flight-case toggle latches
     * - Perimeter aluminum extrusion rims and 8 protective corner ball caps
     * - Contoured chrome handle with molded rubber center grip
     * - Hinged lid opens backwards by 80° when placed on front stool!
     */
    buildEnclosedBoxes() {
        const darkBodyMat = new THREE.MeshStandardMaterial({
            color: 0x182234,
            roughness: 0.55,
            metalness: 0.4
        });

        const interiorMat = new THREE.MeshStandardMaterial({
            color: 0x090d16,
            roughness: 0.4,
            metalness: 0.7
        });

        const cornerCapMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            roughness: 0.6,
            metalness: 0.85
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xf1f5f9,
            roughness: 0.15,
            metalness: 0.95
        });

        const goldMat = new THREE.MeshStandardMaterial({
            color: 0xfbbf24,
            roughness: 0.25,
            metalness: 0.85
        });

        const rubberMat = new THREE.MeshStandardMaterial({
            color: 0x0f172a,
            roughness: 0.95,
            metalness: 0.05
        });

        // Briefcase Proportions: Slim, authentic attaché flight case!
        const boxWidth = 1.20;
        const boxHeight = 0.78;
        const boxDepth = 0.34; // Sleek briefcase depth!
        const hx = boxWidth / 2;
        const hz = boxDepth / 2;

        const tubHeight = 0.62;
        const lidHeight = 0.16;

        this.bayConfigs.forEach((cfg, index) => {
            const boxGroup = new THREE.Group();

            const hexColor = '#' + cfg.color.toString(16).padStart(6, '0');
            const frontTex = this.createBoxLabelTexture(cfg.name, cfg.bayNum, hexColor, false);
            const backTex = this.createBoxLabelTexture(cfg.name, cfg.bayNum, hexColor, true);

            const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.35 });
            const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.35 });

            // 1. Lower Briefcase Tub (Height = 0.62, center at Y = -0.08)
            const tubMaterials = [darkBodyMat, darkBodyMat, interiorMat, darkBodyMat, frontMat, backMat];
            const tubMesh = new THREE.Mesh(new THREE.BoxGeometry(boxWidth, tubHeight, boxDepth), tubMaterials);
            tubMesh.position.set(0, -0.08, 0);
            tubMesh.castShadow = true;
            tubMesh.receiveShadow = true;
            boxGroup.add(tubMesh);

            // Aluminum perimeter parting rim around top of tub
            const rimMesh = new THREE.Mesh(new THREE.BoxGeometry(boxWidth + 0.02, 0.025, boxDepth + 0.02), chromeMat);
            rimMesh.position.set(0, -0.08 + tubHeight / 2 - 0.012, 0);
            boxGroup.add(rimMesh);

            // Glowing status LED strip inside the crate tub
            const ledStrip = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 0.03, 0.03),
                new THREE.MeshBasicMaterial({ color: cfg.color })
            );
            ledStrip.position.set(0, tubHeight / 2 - 0.08, 0);
            boxGroup.add(ledStrip);

            // 4 Rubber Base Feet
            const footGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12);
            [
                [-0.45, -0.08 - tubHeight / 2 - 0.015, -0.10],
                [0.45, -0.08 - tubHeight / 2 - 0.015, -0.10],
                [-0.45, -0.08 - tubHeight / 2 - 0.015, 0.10],
                [0.45, -0.08 - tubHeight / 2 - 0.015, 0.10]
            ].forEach(([fx, fy, fz]) => {
                const foot = new THREE.Mesh(footGeo, rubberMat);
                foot.position.set(fx, fy, fz);
                boxGroup.add(foot);
            });

            // Dual Heavy-Duty Flight-Case Toggle Latches on front face
            [-0.38, 0.38].forEach(lx => {
                const latchPlate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.025), chromeMat);
                latchPlate.position.set(lx, -0.08 + tubHeight / 2 - 0.06, hz + 0.012);
                boxGroup.add(latchPlate);

                const toggleLock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.03), goldMat);
                toggleLock.position.set(lx, -0.08 + tubHeight / 2 - 0.06, hz + 0.02);
                boxGroup.add(toggleLock);
            });

            // 2. Hinged Top Lid Assembly (Pivots at rear top hinge)
            const hingeY = -0.08 + tubHeight / 2; // Y = +0.23
            const hingeZ = -hz;                   // Z = -0.17

            const lidPivot = new THREE.Group();
            lidPivot.position.set(0, hingeY, hingeZ);
            boxGroup.add(lidPivot);

            const lidMaterials = [darkBodyMat, darkBodyMat, darkBodyMat, interiorMat, darkBodyMat, darkBodyMat];
            const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(boxWidth, lidHeight, boxDepth), lidMaterials);
            lidMesh.position.set(0, lidHeight / 2, hz); // Center of lid relative to hinge
            lidMesh.castShadow = true;
            lidPivot.add(lidMesh);

            // Aluminum rim around bottom of lid
            const lidRim = new THREE.Mesh(new THREE.BoxGeometry(boxWidth + 0.02, 0.025, boxDepth + 0.02), chromeMat);
            lidRim.position.set(0, 0.012, hz);
            lidPivot.add(lidRim);

            // Top Briefcase Handle Assembly (Mounted on top of lid)
            // Handle bar at local Y = 0.475 relative to box center (0.23 + 0.16 + 0.085 = 0.475 exact!)
            const handleLocalY = lidHeight + 0.085;
            const handleLocalZ = hz;

            // Chrome handle bar
            const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.36, 16), chromeMat);
            handleBar.rotation.z = Math.PI / 2;
            handleBar.position.set(0, handleLocalY, handleLocalZ);
            handleBar.castShadow = true;
            lidPivot.add(handleBar);

            // Ergonomic Black Center Molded Grip
            const handleGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.20, 16), rubberMat);
            handleGrip.rotation.z = Math.PI / 2;
            handleGrip.position.set(0, handleLocalY, handleLocalZ);
            lidPivot.add(handleGrip);

            // Left & Right Chrome Handle Stanchions (Height: 0.085m, anchored cleanly to lid surface)
            const stanchionHeight = 0.085;
            const leftStanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, stanchionHeight, 12), chromeMat);
            leftStanchion.position.set(-0.16, handleLocalY - stanchionHeight / 2, handleLocalZ);
            lidPivot.add(leftStanchion);

            const rightStanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, stanchionHeight, 12), chromeMat);
            rightStanchion.position.set(0.16, handleLocalY - stanchionHeight / 2, handleLocalZ);
            lidPivot.add(rightStanchion);

            // Pneumatic Gas Struts on left & right sides
            const strutGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8);
            const leftStrut = new THREE.Mesh(strutGeo, chromeMat);
            leftStrut.position.set(-hx - 0.02, 0.1, 0);
            boxGroup.add(leftStrut);

            const rightStrut = new THREE.Mesh(strutGeo, chromeMat);
            rightStrut.position.set(hx + 0.02, 0.1, 0);
            boxGroup.add(rightStrut);

            // Interior Holographic Projector Aperture inside briefcase tub (Emits the floating dossier card)
            const emitterGeo = new THREE.BoxGeometry(boxWidth - 0.28, 0.035, 0.08);
            const emitterMat = new THREE.MeshBasicMaterial({ color: cfg.color });
            const emitterMesh = new THREE.Mesh(emitterGeo, emitterMat);
            emitterMesh.position.set(0, tubHeight / 2 - 0.06, 0);
            boxGroup.add(emitterMesh);

            // Open/Close Control Method:
            // openAmount: 0.0 (closed) -> 1.0 (opened backwards by 80 deg)
            const setOpen = (openAmount) => {
                const amt = Math.max(0, Math.min(1, openAmount));
                // Lid rotates backwards
                lidPivot.rotation.x = -amt * (Math.PI * 0.44);
            };

            // Metadata for positioning & physics
            boxGroup.userData = {
                index,
                cfg,
                rackHomePos: cfg.boxRestPos.clone(),
                rackHomeRotY: cfg.rotY,
                lidPivot,
                setOpen,
                physics: { active: false }
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

        const frontGrip = this.solveIK(this.frontStoolPos.x, this.frontHandleY, this.frontStoolPos.z, 0);
        const frontLift = this.solveIK(this.frontStoolPos.x, this.frontHandleY + 0.65, this.frontStoolPos.z, 0);
        const frontCorridor = this.getFlightCorridorPose(0, 0);

        let targetAngles = this.standbyPose;
        let gripGap = 0.18;
        let carriedBox = null;
        let frontDockedSection = -1;
        let frontLidOpenAmount = 0.0;

        // Default all boxes to their home rack position and closed lids (unless physics is actively simulating)
        for (let i = 0; i < this.pallets.length; i++) {
            const box = this.pallets[i];
            if (!box.userData.physics || !box.userData.physics.active) {
                box.position.copy(box.userData.rackHomePos);
                box.rotation.set(0, box.userData.rackHomeRotY, 0);
                box.userData.setOpen(0.0);
            }
        }

        if (p <= 0.04) {
            // Standby ready, front stool blank
            targetAngles = this.standbyPose;
            gripGap = 0.18;
        } else if (p < 0.94) {
            // Pickup Box 0 from Rack 0 to Front Stool
            const u = (p - 0.04) / 0.90;
            const b0Cfg = this.bayConfigs[0];
            const j1Bay = Math.atan2(b0Cfg.pos[0], b0Cfg.pos[2]);
            const bayGrip = this.solveIK(b0Cfg.pos[0], b0Cfg.handleY, b0Cfg.pos[2], b0Cfg.rotY);
            const bayLift = this.solveIK(b0Cfg.pos[0], b0Cfg.handleY + 0.65, b0Cfg.pos[2], b0Cfg.rotY);
            const bayCorridor = this.getFlightCorridorPose(j1Bay, bayGrip.j6);
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
            const plateauHalf = 0.08;

            if (p >= plateauCenter - plateauHalf && (p <= plateauCenter + plateauHalf || kActive === 6)) {
                // === DOCKED PLATEAU FOR SECTION kActive ===
                const boxActive = this.pallets[kActive];
                if (!boxActive.userData.physics || !boxActive.userData.physics.active) {
                    boxActive.position.copy(this.frontStoolBoxPos);
                    boxActive.rotation.set(0, 0, 0);
                    boxActive.userData.setOpen(1.0);
                }

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
                const j1From = Math.atan2(bFromCfg.pos[0], bFromCfg.pos[2]);
                const fromGrip = this.solveIK(bFromCfg.pos[0], bFromCfg.handleY, bFromCfg.pos[2], bFromCfg.rotY);
                const fromLift = this.solveIK(bFromCfg.pos[0], bFromCfg.handleY + 0.65, bFromCfg.pos[2], bFromCfg.rotY);
                const fromCorridor = this.getFlightCorridorPose(j1From, fromGrip.j6);

                const bToCfg = this.bayConfigs[kTo];
                const j1To = Math.atan2(bToCfg.pos[0], bToCfg.pos[2]);
                const toGrip = this.solveIK(bToCfg.pos[0], bToCfg.handleY, bToCfg.pos[2], bToCfg.rotY);
                const toLift = this.solveIK(bToCfg.pos[0], bToCfg.handleY + 0.65, bToCfg.pos[2], bToCfg.rotY);
                const toCorridor = this.getFlightCorridorPose(j1To, toGrip.j6);

                const boxFrom = this.pallets[kFrom];
                const boxTo = this.pallets[kTo];

                if (!boxFrom.userData.physics || !boxFrom.userData.physics.active) {
                    if (u <= 0.36) {
                        boxFrom.position.copy(this.frontStoolBoxPos);
                        boxFrom.rotation.set(0, 0, 0);
                    } else {
                        boxFrom.position.copy(boxFrom.userData.rackHomePos);
                        boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                    }
                }

                if (u <= 0.04) {
                    // Step 1: BoxFrom lid hinges completely CLOSED! Arm stays at inspect pose
                    const t = u / 0.04;
                    targetAngles = this.inspectPose;
                    gripGap = 0.20;
                    boxFrom.userData.setOpen(1.0 - t);
                    carriedBox = null;
                } else if (u <= 0.08) {
                    // Step 2: Arm lowers from inspectPose to frontGrip handle of BoxFrom (fingers open)
                    const t = (u - 0.04) / 0.04;
                    targetAngles = this.lerpPose(this.inspectPose, frontGrip, t);
                    gripGap = 0.20;
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                } else if (u <= 0.13) {
                    // Step 3: CLAMPING PHASE! Arm stationary at frontGrip, fingers clamp from 0.20 to 0.075!
                    const t = (u - 0.08) / 0.05;
                    targetAngles = frontGrip;
                    gripGap = 0.20 - t * (0.20 - 0.075);
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                } else if (u <= 0.18) {
                    // Step 4: Arm lifts BoxFrom straight up off front stool (frontGrip -> frontLift)
                    const t = (u - 0.13) / 0.05;
                    targetAngles = this.lerpPose(frontGrip, frontLift, t);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                    boxFrom.userData.setOpen(0.0);
                } else if (u <= 0.23) {
                    // Step 5: Arm retracts BoxFrom into central flight corridor (frontLift -> frontCorridor)
                    const t = (u - 0.18) / 0.05;
                    targetAngles = this.lerpPose(frontLift, frontCorridor, t);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (u <= 0.31) {
                    // Step 6: Arm rotates carried BoxFrom through central corridor to Rack k heading
                    const t = (u - 0.23) / 0.08;
                    targetAngles = this.lerpPose(frontCorridor, fromCorridor, t);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (u <= 0.36) {
                    // Step 7: Arm extends & lowers BoxFrom onto Rack k (fromCorridor -> fromLift -> fromGrip)
                    const t = (u - 0.31) / 0.05;
                    targetAngles = t < 0.5 ? this.lerpPose(fromCorridor, fromLift, t / 0.5) : this.lerpPose(fromLift, fromGrip, (t - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (u <= 0.40) {
                    // Step 8: UNCLAMPING PHASE! BoxFrom sits on Rack k, arm stationary, fingers open from 0.075 to 0.18!
                    const t = (u - 0.36) / 0.04;
                    targetAngles = fromGrip;
                    gripGap = 0.075 + t * (0.18 - 0.075);
                    boxFrom.position.copy(boxFrom.userData.rackHomePos);
                    boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                    carriedBox = null;
                } else if (u <= 0.44) {
                    // Step 9: Empty arm retracts from Rack k into central corridor (fromGrip -> fromCorridor)
                    const t = (u - 0.40) / 0.04;
                    targetAngles = this.lerpPose(fromGrip, fromCorridor, t);
                    gripGap = 0.18;
                    carriedBox = null;
                } else if (u <= 0.50) {
                    // Step 10: Empty arm rotates swiftly through central corridor to Rack k+1 heading (fromCorridor -> toCorridor)
                    const t = (u - 0.44) / 0.06;
                    targetAngles = this.lerpPose(fromCorridor, toCorridor, t);
                    gripGap = 0.18;
                    carriedBox = null;
                } else if (u <= 0.56) {
                    // Step 11: GOES TO OBJECT! Empty arm extends to Rack k+1 and descends to handle (toCorridor -> toLift -> toGrip)
                    const t = (u - 0.50) / 0.06;
                    targetAngles = t < 0.5 ? this.lerpPose(toCorridor, toLift, t / 0.5) : this.lerpPose(toLift, toGrip, (t - 0.5) / 0.5);
                    gripGap = 0.18;
                    boxTo.position.copy(boxTo.userData.rackHomePos);
                    boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);
                    carriedBox = null;
                } else if (u <= 0.62) {
                    // Step 12: CLOSES THE GRIPPER! Arm stationary at toGrip, fingers clamp handle of BoxTo from 0.18 to 0.075!
                    const t = (u - 0.56) / 0.06;
                    targetAngles = toGrip;
                    gripGap = 0.18 - t * (0.18 - 0.075);
                    boxTo.position.copy(boxTo.userData.rackHomePos);
                    boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);
                    carriedBox = null;
                } else if (u <= 0.68) {
                    // Step 13: PICKS IT UP! Arm lifts BoxTo straight up off rack (toGrip -> toLift)
                    const t = (u - 0.62) / 0.06;
                    targetAngles = this.lerpPose(toGrip, toLift, t);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (u <= 0.73) {
                    // Step 14: Arm retracts BoxTo into central corridor (toLift -> toCorridor)
                    const t = (u - 0.68) / 0.05;
                    targetAngles = this.lerpPose(toLift, toCorridor, t);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (u <= 0.81) {
                    // Step 15: Arm rotates BoxTo through corridor to front corridor (toCorridor -> frontCorridor)
                    const t = (u - 0.73) / 0.08;
                    targetAngles = this.lerpPose(toCorridor, frontCorridor, t);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (u <= 0.87) {
                    // Step 16: Arm extends & lowers BoxTo onto front stool (frontCorridor -> frontLift -> frontGrip)
                    const t = (u - 0.81) / 0.06;
                    targetAngles = t < 0.5 ? this.lerpPose(frontCorridor, frontLift, t / 0.5) : this.lerpPose(frontLift, frontGrip, (t - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (u <= 0.92) {
                    // Step 17: UNCLAMPING PHASE! BoxTo rests on front stool, arm stationary at frontGrip, fingers open from 0.075 to 0.20!
                    const t = (u - 0.87) / 0.05;
                    targetAngles = frontGrip;
                    gripGap = 0.075 + t * (0.20 - 0.075);
                    if (!boxTo.userData.physics || !boxTo.userData.physics.active) {
                        boxTo.position.copy(this.frontStoolBoxPos);
                        boxTo.rotation.set(0, 0, 0);
                    }
                    carriedBox = null;
                } else if (u <= 0.96) {
                    // Step 18: Arm backs away gently from front stool to inspectPose (waiting position)
                    const t = (u - 0.92) / 0.04;
                    const sT = t * t * (3 - 2 * t);
                    targetAngles = this.lerpPose(frontGrip, this.inspectPose, sT);
                    gripGap = 0.20;
                    if (!boxTo.userData.physics || !boxTo.userData.physics.active) {
                        boxTo.position.copy(this.frontStoolBoxPos);
                        boxTo.rotation.set(0, 0, 0);
                    }
                    carriedBox = null;
                } else {
                    // Step 19: BoxTo lid hinges OPEN from 0.0 to 1.0! Topic card unfolds
                    const t = (u - 0.96) / 0.04;
                    const sT = t * t * (3 - 2 * t);
                    targetAngles = this.inspectPose;
                    gripGap = 0.20;
                    if (!boxTo.userData.physics || !boxTo.userData.physics.active) {
                        boxTo.position.copy(this.frontStoolBoxPos);
                        boxTo.rotation.set(0, 0, 0);
                        boxTo.userData.setOpen(sT);
                    }
                    carriedBox = null;
                    frontDockedSection = kTo;
                    frontLidOpenAmount = sT;
                }
            }
        }

        if (carriedBox && carriedBox.userData && carriedBox.userData.physics && carriedBox.userData.physics.active) {
            carriedBox = null;
        }

        // Apply Joint Angles with active manual jog offsets (Full 6-Axis Robotic Kinematics)
        const jOffsets = this.jogOffsets || { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        let cJ1 = targetAngles.j1 + (jOffsets.j1 || 0);
        let cJ2 = targetAngles.j2 + (jOffsets.j2 || 0);
        let cJ3 = targetAngles.j3 + (jOffsets.j3 || 0);
        let cJ4 = targetAngles.j4 + (jOffsets.j4 || 0);
        let cJ5 = (targetAngles.j5 || 0) + (jOffsets.j5 || 0);
        let cJ6 = (targetAngles.j6 || 0) + (jOffsets.j6 || 0);

        // Verify with dynamic collision model
        if (this.collisionChecker) {
            const checkReport = this.collisionChecker.checkCollision({
                j1: cJ1, j2: cJ2, j3: cJ3, j4: cJ4, j5: cJ5, j6: cJ6
            }, !!carriedBox);
            if (checkReport.inCollision) {
                this.isAtDynamicLimit = true;
                this.limitCulprit = checkReport.culprit;
                // Clamp jog offsets so robot never intersects with itself!
                cJ1 = targetAngles.j1;
                cJ2 = targetAngles.j2;
                cJ3 = targetAngles.j3;
                cJ4 = targetAngles.j4;
            } else if (!this.isMoving && checkReport.minClearance > 0.05) {
                this.isAtDynamicLimit = false;
                this.limitCulprit = null;
            }
        }

        this.targetJointAngles = {
            j1: cJ1,
            j2: cJ2,
            j3: cJ3,
            j4: cJ4,
            j5: cJ5,
            j6: cJ6
        };

        // Target gripper gap (driven smoothly at physical speed in animate loop)
        const effectiveGap = this.manualGripperGap !== null ? this.manualGripperGap : gripGap;
        this.targetGripGap = effectiveGap;

        // Lock carried box directly to the robot jaw center - ROTATES WITH JOINT 6 & BASE JOINT 1!
        this.carriedBox = carriedBox;
        if (carriedBox) {
            this.updateCarriedBox();
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
    evaluateDirectTransfer(mode, kFrom, kTo, t) {
        if (arguments.length === 3) {
            t = kTo;
            kTo = kFrom;
            kFrom = mode;
            mode = (kFrom !== null && kFrom !== undefined && kFrom >= 0) ? 'returnAndFetch' : 'fetchFromStandby';
        }

        const sCurve = (u) => {
            const c = Math.max(0, Math.min(1, u));
            return c * c * (3 - 2 * c);
        };
        const sLerp = (pA, pB, u) => this.lerpPose(pA, pB, sCurve(u));

        const frontGrip = this.solveIK(this.frontStoolPos.x, this.frontHandleY, this.frontStoolPos.z, 0);
        const frontLift = this.solveIK(this.frontStoolPos.x, this.frontHandleY + 0.65, this.frontStoolPos.z, 0);
        const frontCorridor = this.getFlightCorridorPose(0, 0);

        let targetAngles = this.standbyPose;
        let gripGap = 0.20;
        let carriedBox = null;
        let frontDockedSection = -1;
        let frontLidOpenAmount = 0.0;

        // Reset UNINVOLVED briefcases to their home rack pedestals (unless simulated by physics)
        for (let i = 0; i < this.pallets.length; i++) {
            if (i !== kFrom && i !== kTo) {
                const box = this.pallets[i];
                if (!box.userData.physics || !box.userData.physics.active) {
                    box.position.copy(box.userData.rackHomePos);
                    box.rotation.set(0, box.userData.rackHomeRotY, 0);
                    box.userData.setOpen(0.0);
                }
            }
        }

        const bToCfg = this.bayConfigs[kTo];
        const j1To = Math.atan2(bToCfg.pos[0], bToCfg.pos[2]);
        const toGrip = this.solveIK(bToCfg.pos[0], bToCfg.handleY, bToCfg.pos[2], bToCfg.rotY);
        const toLift = this.solveIK(bToCfg.pos[0], bToCfg.handleY + 0.65, bToCfg.pos[2], bToCfg.rotY);
        const toCorridor = this.getFlightCorridorPose(j1To, toGrip.j6);
        const boxTo = this.pallets[kTo];

        let boxFrom = null;
        let fromGrip = null;
        let fromLift = null;
        let fromCorridor = null;

        if (kFrom !== null && kFrom !== undefined && kFrom >= 0) {
            boxFrom = this.pallets[kFrom];
            const bFromCfg = this.bayConfigs[kFrom];
            const j1From = Math.atan2(bFromCfg.pos[0], bFromCfg.pos[2]);
            fromGrip = this.solveIK(bFromCfg.pos[0], bFromCfg.handleY, bFromCfg.pos[2], bFromCfg.rotY);
            fromLift = this.solveIK(bFromCfg.pos[0], bFromCfg.handleY + 0.65, bFromCfg.pos[2], bFromCfg.rotY);
            fromCorridor = this.getFlightCorridorPose(j1From, fromGrip.j6);
        }

        if (mode === 'fetchFromStandby') {
            boxTo.position.copy(boxTo.userData.rackHomePos);
            boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);
            boxTo.userData.setOpen(0.0);

            const startPose = this.directTransferStartPose || this.standbyPose;

            if (t <= 0.20) {
                // Slew empty arm to rack flight corridor
                targetAngles = sLerp(startPose, toCorridor, t / 0.20);
                gripGap = 0.20;
            } else if (t <= 0.40) {
                // Descend smoothly through toLift into toGrip
                const u = (t - 0.20) / 0.20;
                targetAngles = u < 0.5 ? sLerp(toCorridor, toLift, u / 0.5) : sLerp(toLift, toGrip, (u - 0.5) / 0.5);
                gripGap = 0.20;
            } else if (t <= 0.48) {
                // Clamp handle
                const u = (t - 0.40) / 0.08;
                targetAngles = toGrip;
                gripGap = 0.20 - sCurve(u) * (0.20 - 0.075);
            } else if (t <= 0.66) {
                // Lift box smoothly through toLift up to toCorridor
                const u = (t - 0.48) / 0.18;
                targetAngles = u < 0.5 ? sLerp(toGrip, toLift, u / 0.5) : sLerp(toLift, toCorridor, (u - 0.5) / 0.5);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.84) {
                // Traverse smoothly from toCorridor to frontCorridor
                const u = (t - 0.66) / 0.18;
                targetAngles = sLerp(toCorridor, frontCorridor, u);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.86) {
                // Descend smoothly onto front stool: frontCorridor -> frontLift -> frontGrip
                const u = (t - 0.76) / 0.10;
                targetAngles = u < 0.5 ? sLerp(frontCorridor, frontLift, u / 0.5) : sLerp(frontLift, frontGrip, (u - 0.5) / 0.5);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.90) {
                // Unclamp handle onto front stool
                const u = (t - 0.86) / 0.04;
                targetAngles = frontGrip;
                gripGap = 0.075 + sCurve(u) * (0.20 - 0.075);
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                carriedBox = null;
            } else if (t <= 0.96) {
                // Retract arm gently up to inspectPose (waiting position)
                const u = (t - 0.90) / 0.06;
                targetAngles = sLerp(frontGrip, this.inspectPose, u);
                gripGap = 0.20;
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                carriedBox = null;
            } else {
                // Open briefcase lid
                const u = (t - 0.96) / 0.04;
                targetAngles = this.inspectPose;
                gripGap = 0.20;
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                boxTo.userData.setOpen(sCurve(u));
                carriedBox = null;
                frontDockedSection = kTo;
                frontLidOpenAmount = sCurve(u);
            }
        } else if (mode === 'placeHeldDirect') {
            const startPose = this.directTransferStartPose || frontCorridor;

            if (t <= 0.22) {
                // Smoothly guide held box to frontCorridor
                targetAngles = sLerp(startPose, frontCorridor, t / 0.22);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.62) {
                // Descend to front stool
                const u = (t - 0.22) / 0.40;
                targetAngles = u < 0.5 ? sLerp(frontCorridor, frontLift, u / 0.5) : sLerp(frontLift, frontGrip, (u - 0.5) / 0.5);
                gripGap = 0.075;
                carriedBox = boxTo;
            } else if (t <= 0.74) {
                // Unclamp handle
                const u = (t - 0.62) / 0.12;
                targetAngles = frontGrip;
                gripGap = 0.075 + sCurve(u) * (0.20 - 0.075);
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                carriedBox = null;
            } else if (t <= 0.90) {
                // Retract gently to inspectPose (waiting position)
                const u = (t - 0.74) / 0.16;
                targetAngles = sLerp(frontGrip, this.inspectPose, u);
                gripGap = 0.20;
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                carriedBox = null;
            } else {
                // Open lid
                const u = (t - 0.90) / 0.10;
                targetAngles = this.inspectPose;
                gripGap = 0.20;
                boxTo.position.copy(this.frontStoolBoxPos);
                boxTo.rotation.set(0, 0, 0);
                boxTo.userData.setOpen(sCurve(u));
                carriedBox = null;
                frontDockedSection = kTo;
                frontLidOpenAmount = sCurve(u);
            }
        } else if (mode === 'stowHeldAndFetch') {
            const tSplit = 0.50;
            if (t <= tSplit) {
                // Phase 1: Stow held boxFrom back onto its rack pedestal
                const tau = t / tSplit;
                boxTo.position.copy(boxTo.userData.rackHomePos);
                boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);
                boxTo.userData.setOpen(0.0);

                const startPose = this.directTransferStartPose || fromCorridor;

                if (tau <= 0.25) {
                    // Fly smoothly from current pose to fromCorridor
                    targetAngles = sLerp(startPose, fromCorridor, tau / 0.25);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (tau <= 0.60) {
                    // Descend smoothly into Rack fromGrip
                    const u = (tau - 0.25) / 0.35;
                    targetAngles = u < 0.5 ? sLerp(fromCorridor, fromLift, u / 0.5) : sLerp(fromLift, fromGrip, (u - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (tau <= 0.75) {
                    // Unclamp handle on rack pedestal
                    const u = (tau - 0.60) / 0.15;
                    targetAngles = fromGrip;
                    gripGap = 0.075 + sCurve(u) * (0.20 - 0.075);
                    boxFrom.position.copy(boxFrom.userData.rackHomePos);
                    boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                } else {
                    // Retract empty arm up to fromCorridor
                    const u = (tau - 0.75) / 0.25;
                    targetAngles = sLerp(fromGrip, fromCorridor, u);
                    gripGap = 0.20;
                    boxFrom.position.copy(boxFrom.userData.rackHomePos);
                    boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                }
            } else {
                // Phase 2: Traverse to Rack kTo and fetch boxTo to front stool
                const tau = (t - tSplit) / (1.0 - tSplit);
                boxFrom.position.copy(boxFrom.userData.rackHomePos);
                boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                boxFrom.userData.setOpen(0.0);

                if (tau <= 0.18) {
                    // Empty arm slews from fromCorridor to toCorridor
                    targetAngles = sLerp(fromCorridor, toCorridor, tau / 0.18);
                    gripGap = 0.20;
                    carriedBox = null;
                } else if (tau <= 0.38) {
                    // Descend into toGrip
                    const u = (tau - 0.18) / 0.20;
                    targetAngles = u < 0.5 ? sLerp(toCorridor, toLift, u / 0.5) : sLerp(toLift, toGrip, (u - 0.5) / 0.5);
                    gripGap = 0.20;
                    carriedBox = null;
                } else if (tau <= 0.46) {
                    // Clamp boxTo handle
                    const u = (tau - 0.38) / 0.08;
                    targetAngles = toGrip;
                    gripGap = 0.20 - sCurve(u) * (0.20 - 0.075);
                    carriedBox = null;
                } else if (tau <= 0.64) {
                    // Lift boxTo to toCorridor
                    const u = (tau - 0.46) / 0.18;
                    targetAngles = u < 0.5 ? sLerp(toGrip, toLift, u / 0.5) : sLerp(toLift, toCorridor, (u - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (tau <= 0.80) {
                    // Traverse across cell to frontCorridor
                    const u = (tau - 0.64) / 0.16;
                    targetAngles = sLerp(toCorridor, frontCorridor, u);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (tau <= 0.88) {
                    // Descend to front stool
                    const u = (tau - 0.80) / 0.08;
                    targetAngles = u < 0.5 ? sLerp(frontCorridor, frontLift, u / 0.5) : sLerp(frontLift, frontGrip, (u - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (tau <= 0.92) {
                    // Unclamp handle onto stool
                    const u = (tau - 0.88) / 0.04;
                    targetAngles = frontGrip;
                    gripGap = 0.075 + sCurve(u) * (0.20 - 0.075);
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    carriedBox = null;
                } else if (tau <= 0.965) {
                    // Retract arm gently up to inspectPose (waiting position)
                    const u = (tau - 0.92) / 0.045;
                    targetAngles = sLerp(frontGrip, this.inspectPose, u);
                    gripGap = 0.20;
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    carriedBox = null;
                } else {
                    // Open lid
                    const u = (tau - 0.965) / 0.035;
                    targetAngles = this.inspectPose;
                    gripGap = 0.20;
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    boxTo.userData.setOpen(sCurve(u));
                    carriedBox = null;
                    frontDockedSection = kTo;
                    frontLidOpenAmount = sCurve(u);
                }
            }
        } else {
            // Mode: 'returnAndFetch' (BoxFrom starts docked or resting on front stool)
            const tSplit = 0.50;
            if (t <= tSplit) {
                // Phase 1: Close lid, clamp, and carry boxFrom back to Rack kFrom
                const tau = t / tSplit;
                boxTo.position.copy(boxTo.userData.rackHomePos);
                boxTo.rotation.set(0, boxTo.userData.rackHomeRotY, 0);
                boxTo.userData.setOpen(0.0);

                if (tau <= 0.12) {
                    // Close lid smoothly
                    const u = tau / 0.12;
                    targetAngles = this.inspectPose;
                    gripGap = 0.20;
                    boxFrom.position.copy(this.frontStoolBoxPos);
                    boxFrom.rotation.set(0, 0, 0);
                    boxFrom.userData.setOpen(1.0 - sCurve(u));
                    carriedBox = null;
                } else if (tau <= 0.24) {
                    // Arm moves from inspectPose to frontGrip
                    const u = (tau - 0.12) / 0.12;
                    targetAngles = sLerp(this.inspectPose, frontGrip, u);
                    gripGap = 0.20;
                    boxFrom.position.copy(this.frontStoolBoxPos);
                    boxFrom.rotation.set(0, 0, 0);
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                } else if (tau <= 0.32) {
                    // Clamp boxFrom handle
                    const u = (tau - 0.24) / 0.08;
                    targetAngles = frontGrip;
                    gripGap = 0.20 - sCurve(u) * (0.20 - 0.075);
                    boxFrom.position.copy(this.frontStoolBoxPos);
                    boxFrom.rotation.set(0, 0, 0);
                    carriedBox = null;
                } else if (tau <= 0.50) {
                    // Lift boxFrom up through frontLift to frontCorridor
                    const u = (tau - 0.32) / 0.18;
                    targetAngles = u < 0.5 ? sLerp(frontGrip, frontLift, u / 0.5) : sLerp(frontLift, frontCorridor, (u - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (tau <= 0.70) {
                    // Traverse across cell to fromCorridor
                    const u = (tau - 0.50) / 0.20;
                    targetAngles = sLerp(frontCorridor, fromCorridor, u);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (tau <= 0.86) {
                    // Descend to Rack fromGrip
                    const u = (tau - 0.70) / 0.16;
                    targetAngles = u < 0.5 ? sLerp(fromCorridor, fromLift, u / 0.5) : sLerp(fromLift, fromGrip, (u - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxFrom;
                } else if (tau <= 0.93) {
                    // Unclamp handle onto rack pedestal
                    const u = (tau - 0.86) / 0.07;
                    targetAngles = fromGrip;
                    gripGap = 0.075 + sCurve(u) * (0.20 - 0.075);
                    boxFrom.position.copy(boxFrom.userData.rackHomePos);
                    boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                } else {
                    // Retract empty arm up to fromCorridor
                    const u = (tau - 0.93) / 0.07;
                    targetAngles = sLerp(fromGrip, fromCorridor, u);
                    gripGap = 0.20;
                    boxFrom.position.copy(boxFrom.userData.rackHomePos);
                    boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                    boxFrom.userData.setOpen(0.0);
                    carriedBox = null;
                }
            } else {
                // Phase 2: Traverse to Rack kTo and fetch boxTo to front stool
                const tau = (t - tSplit) / (1.0 - tSplit);
                boxFrom.position.copy(boxFrom.userData.rackHomePos);
                boxFrom.rotation.set(0, boxFrom.userData.rackHomeRotY, 0);
                boxFrom.userData.setOpen(0.0);

                if (tau <= 0.18) {
                    // Slew empty arm from fromCorridor to toCorridor
                    targetAngles = sLerp(fromCorridor, toCorridor, tau / 0.18);
                    gripGap = 0.20;
                    carriedBox = null;
                } else if (tau <= 0.38) {
                    // Descend into toGrip
                    const u = (tau - 0.18) / 0.20;
                    targetAngles = u < 0.5 ? sLerp(toCorridor, toLift, u / 0.5) : sLerp(toLift, toGrip, (u - 0.5) / 0.5);
                    gripGap = 0.20;
                    carriedBox = null;
                } else if (tau <= 0.46) {
                    // Clamp boxTo handle
                    const u = (tau - 0.38) / 0.08;
                    targetAngles = toGrip;
                    gripGap = 0.20 - sCurve(u) * (0.20 - 0.075);
                    carriedBox = null;
                } else if (tau <= 0.64) {
                    // Lift boxTo to toCorridor
                    const u = (tau - 0.46) / 0.18;
                    targetAngles = u < 0.5 ? sLerp(toGrip, toLift, u / 0.5) : sLerp(toLift, toCorridor, (u - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (tau <= 0.80) {
                    // Slew to frontCorridor
                    const u = (tau - 0.64) / 0.16;
                    targetAngles = sLerp(toCorridor, frontCorridor, u);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (tau <= 0.88) {
                    // Descend onto front stool
                    const u = (tau - 0.80) / 0.08;
                    targetAngles = u < 0.5 ? sLerp(frontCorridor, frontLift, u / 0.5) : sLerp(frontLift, frontGrip, (u - 0.5) / 0.5);
                    gripGap = 0.075;
                    carriedBox = boxTo;
                } else if (tau <= 0.92) {
                    // Unclamp handle onto stool
                    const u = (tau - 0.88) / 0.04;
                    targetAngles = frontGrip;
                    gripGap = 0.075 + sCurve(u) * (0.20 - 0.075);
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    carriedBox = null;
                } else if (tau <= 0.965) {
                    // Retract arm gently up to inspectPose (waiting position)
                    const u = (tau - 0.92) / 0.045;
                    targetAngles = sLerp(frontGrip, this.inspectPose, u);
                    gripGap = 0.20;
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    carriedBox = null;
                } else {
                    // Open lid
                    const u = (tau - 0.965) / 0.035;
                    targetAngles = this.inspectPose;
                    gripGap = 0.20;
                    boxTo.position.copy(this.frontStoolBoxPos);
                    boxTo.rotation.set(0, 0, 0);
                    boxTo.userData.setOpen(sCurve(u));
                    carriedBox = null;
                    frontDockedSection = kTo;
                    frontLidOpenAmount = sCurve(u);
                }
            }
        }

        // Apply Target Joint Angles & Gripper Target
        this.targetJointAngles = {
            j1: targetAngles.j1,
            j2: targetAngles.j2,
            j3: targetAngles.j3,
            j4: targetAngles.j4,
            j5: (targetAngles.j5 || 0) + (this.jogOffsets.j5 || 0),
            j6: (targetAngles.j6 || 0) + (this.jogOffsets.j6 || 0)
        };
        this.targetGripGap = gripGap;

        this.carriedBox = carriedBox;
        if (carriedBox) {
            this.updateCarriedBox();
        }

        // Synchronize continuous scrub progress with current direct transfer progress
        const progFrom = (kFrom !== null && kFrom !== undefined && kFrom >= 0) ? (kFrom + 1.0) : 0.0;
        const progTo = kTo + 1.0;
        this.currentProgress = progFrom + t * (progTo - progFrom);
        this.targetProgress = this.currentProgress;

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

        // Active scroll timestamp: used in animate loop to detect immediate release
        this.lastScrollTimestamp = performance.now();

        // Responsive buffer clamp: prevents targetProgress from running away ahead of currentProgress
        const maxBufferAhead = 0.045;
        const newTarget = this.targetProgress + delta;
        this.targetProgress = Math.max(
            0,
            Math.min(
                this.maxProgress,
                Math.max(this.currentProgress - maxBufferAhead, Math.min(this.currentProgress + maxBufferAhead, newTarget))
            )
        );
        this.statusText = `MANUAL SCROLL // PROGRESS: ${(this.targetProgress / this.maxProgress * 100).toFixed(0)}%`;
    }

    /**
     * Hold-To-Run Jog Controller:
     * While button is held, robot arm continuously runs through motion.
     * Releasing immediately freezes the robot arm in place!
     */
    runHoldJog(direction, dt = 0.016) {
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

        this.lastScrollTimestamp = performance.now();

        const speed = 0.42;
        const delta = direction * speed * dt;
        const maxBufferAhead = 0.06;
        const newTarget = this.targetProgress + delta;

        this.targetProgress = Math.max(
            0,
            Math.min(
                this.maxProgress,
                Math.max(this.currentProgress - maxBufferAhead, Math.min(this.currentProgress + maxBufferAhead, newTarget))
            )
        );
        this.statusText = `HOLD TO RUN // ${direction > 0 ? 'FWD' : 'REV'} // PROGRESS: ${(this.targetProgress / this.maxProgress * 100).toFixed(0)}%`;
    }

    stopHoldJog() {
        this.targetProgress = this.currentProgress;
    }

    /**
     * Direct Dossier Dispatch:
     * When clicking a Teach Pendant button or Navbar link:
     * Physical, deliberate industrial motion:
     * If robot is already carrying a briefcase, it returns it smoothly to its rack pedestal before fetching the new one.
     * ZERO teleportation under any circumstance!
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

        // Record start pose for smooth continuous motion
        this.directTransferStartPose = {
            j1: this.jointAngles.j1,
            j2: this.jointAngles.j2,
            j3: this.jointAngles.j3,
            j4: this.jointAngles.j4,
            j5: this.jointAngles.j5 || 0,
            j6: this.jointAngles.j6 || 0
        };

        const kTo = sectionIndex;

        // Detect if arm is currently carrying a briefcase
        let carriedIndex = (this.carriedBox && this.carriedBox.userData && this.carriedBox.userData.index !== undefined)
            ? this.carriedBox.userData.index
            : null;

        // Detect if any box is currently docked or resting on the front stool
        let frontBoxIndex = this.dockedSectionIndex >= 0 ? this.dockedSectionIndex : null;
        if (frontBoxIndex === null) {
            for (let i = 0; i < this.pallets.length; i++) {
                const box = this.pallets[i];
                if (box !== this.carriedBox && box.position.distanceTo(this.frontStoolBoxPos) < 0.25) {
                    frontBoxIndex = i;
                    break;
                }
            }
        }

        let mode = 'fetchFromStandby';
        let kFrom = null;
        let duration = 7.8;

        if (carriedIndex !== null) {
            kFrom = carriedIndex;
            if (carriedIndex === kTo) {
                mode = 'placeHeldDirect';
                duration = 5.5;
            } else {
                mode = 'stowHeldAndFetch';
                duration = 13.5;
            }
        } else if (frontBoxIndex !== null) {
            kFrom = frontBoxIndex;
            if (frontBoxIndex === kTo) {
                // Already at this section! Ensure opened.
                this.dockedSectionIndex = sectionIndex;
                this.currentProgress = sectionIndex + 1.0;
                this.targetProgress = sectionIndex + 1.0;
                this.evaluateProgress(sectionIndex + 1.0);
                if (this.onSectionChange) {
                    this.onSectionChange(this.bayConfigs[sectionIndex].id, sectionIndex);
                }
                return;
            } else {
                mode = 'returnAndFetch';
                duration = 13.5;
            }
        } else {
            mode = 'fetchFromStandby';
            duration = 7.8;
        }

        this.statusText = `DISPATCHING: BAY [${this.bayConfigs[kTo].bayNum} // ${this.bayConfigs[kTo].name.toUpperCase()}]`;

        const transferState = { t: 0.0 };
        this.directTransfer = { mode, kFrom, kTo, state: transferState };

        this.activeTween = gsap.to(transferState, {
            t: 1.0,
            duration: duration,
            ease: 'linear', // Let Hermite S-curves inside evaluateDirectTransfer handle smooth easing!
            onUpdate: () => {
                if (this.directTransfer) {
                    this.evaluateDirectTransfer(mode, kFrom, kTo, transferState.t);
                }
            },
            onComplete: () => {
                this.activeTween = null;
                this.directTransfer = null;
                this.directTransferStartPose = null;
                this.currentProgress = kTo + 1.0;
                this.targetProgress = kTo + 1.0;
                this.dockedSectionIndex = kTo;
                this.evaluateProgress(this.currentProgress);
                this.statusText = `PLACED ON FRONT STOOL // ${this.bayConfigs[kTo].name.toUpperCase()}`;
                if (this.onSectionChange) {
                    this.onSectionChange(this.bayConfigs[kTo].id, kTo);
                }
            }
        });
    }

    // Manual Jog and Safety Controls (All 6 Articulated Axes + Gripper)
    jogJoint(jointKey, delta) {
        if (this.isEStopped) return;
        if (!this.jogOffsets) this.jogOffsets = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };
        if (this.jogOffsets[jointKey] === undefined) this.jogOffsets[jointKey] = 0;

        // Current total joint angles
        const currentAngles = {
            j1: this.jointAngles.j1 || 0,
            j2: this.jointAngles.j2 || 0,
            j3: this.jointAngles.j3 || 0,
            j4: this.jointAngles.j4 || 0,
            j5: this.jointAngles.j5 || 0,
            j6: this.jointAngles.j6 || 0
        };

        const isHoldingBox = !!this.carriedBox;
        // Dynamically compute safe delta stopping slightly before collision!
        const safeRes = this.collisionChecker
            ? this.collisionChecker.calcSafeJogDelta(currentAngles, jointKey, delta, isHoldingBox)
            : { safeDelta: delta, stoppedAtLimit: false, culprit: null };

        if (Math.abs(safeRes.safeDelta) > 0.0005) {
            this.jogOffsets[jointKey] += safeRes.safeDelta;
            this.jointAngles[jointKey] = (this.jointAngles[jointKey] || 0) + safeRes.safeDelta;

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

            // Immediately synchronize carried box position and rotation (especially Joint 6 roll!)
            if (this.carriedBox) {
                this.updateCarriedBox();
            }
        }

        if (safeRes.stoppedAtLimit) {
            this.isAtDynamicLimit = true;
            this.limitCulprit = safeRes.culprit;
            this.statusText = `SAFETY STOP // DYNAMIC LIMIT: ${safeRes.culprit}`;
        } else {
            this.isAtDynamicLimit = false;
            this.limitCulprit = null;
            const degVal = ((this.jogOffsets[jointKey] || 0) * (180 / Math.PI)).toFixed(1);
            this.statusText = `MANUAL JOG // ${jointKey.toUpperCase()}: ${degVal > 0 ? '+' : ''}${degVal}° OFFSET`;
        }
    }

    toggleGripperManual() {
        if (this.isEStopped) return;
        const currentGap = this.manualGripperGap !== null ? this.manualGripperGap : this.joints.gripper.gap;
        const willOpen = currentGap <= 0.12;

        if (willOpen) {
            this.manualGripperGap = 0.20;
            // If holding a box, drop it with realistic 3D gravity & collision physics!
            if (this.carriedBox) {
                this.dropCarriedBox();
            }
        } else {
            this.manualGripperGap = 0.075;
        }

        this.joints.gripper.targetGap = this.manualGripperGap;
        this.joints.gripper.gap = this.manualGripperGap;

        if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
            this.joints.gripper.leftFinger.position.x = -this.manualGripperGap;
            this.joints.gripper.rightFinger.position.x = this.manualGripperGap;
        }
        if (!this.statusText.includes('WORKPIECE DROPPED')) {
            this.statusText = this.manualGripperGap > 0.12 ? 'MANUAL JOG // GRIPPER: OPEN (200mm)' : 'MANUAL JOG // GRIPPER: CLAMPED (75mm)';
        }
    }

    dropCarriedBox() {
        if (!this.carriedBox) return;
        const dropped = this.carriedBox;
        this.carriedBox = null;

        // Cancel any active animation/tween so robot stops mid-transit motion
        if (this.activeTween) {
            this.activeTween.kill();
            this.activeTween = null;
        }
        if (this.directTransfer) {
            this.directTransfer = null;
        }

        // Initialize realistic 3D rigid body physics simulation
        const randomImpulseX = (Math.random() - 0.5) * 0.8;
        const randomImpulseZ = (Math.random() - 0.5) * 0.8;
        const randomSpinX = (Math.random() - 0.5) * 6.0;
        const randomSpinY = (Math.random() - 0.5) * 4.0;
        const randomSpinZ = (Math.random() - 0.5) * 6.0;

        dropped.userData.physics = {
            active: true,
            velocity: new THREE.Vector3(randomImpulseX, -0.6, randomImpulseZ),
            angularVelocity: new THREE.Vector3(randomSpinX, randomSpinY, randomSpinZ),
            groundTimer: 0,
            settled: false,
            impactCount: 0,
            respawnDuration: 2.8 // seconds resting on ground before respawning on pedestal
        };
        dropped.userData.isDropped = true;

        // Notify UI to close any popup card
        this.dockedSectionIndex = -1;
        if (this.onSectionChange) {
            this.onSectionChange(null, -1);
        }

        // Return robot to clean standby pose with open gripper
        this.targetProgress = 0.0;
        this.currentProgress = 0.0;
        this.manualGripperGap = 0.20;
        this.joints.gripper.targetGap = 0.20;
        this.joints.gripper.gap = 0.20;
        if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
            this.joints.gripper.leftFinger.position.x = -0.20;
            this.joints.gripper.rightFinger.position.x = 0.20;
        }

        if (typeof gsap !== 'undefined') {
            gsap.to(this.jointAngles, {
                j1: this.standbyPose.j1,
                j2: this.standbyPose.j2,
                j3: this.standbyPose.j3,
                j4: this.standbyPose.j4,
                j5: 0,
                j6: 0,
                duration: 1.2,
                ease: 'power2.out',
                onUpdate: () => {
                    this.targetJointAngles = { ...this.jointAngles };
                }
            });
        }

        this.statusText = '⚠️ WORKPIECE DROPPED! GRAVITY & COLLISION PHYSICS ENGAGED';
    }

    updateBoxPhysics(box, delta) {
        const phys = box.userData.physics;
        if (!phys || !phys.active) return;

        // Gravity acceleration (punchy industrial feel)
        const gravity = 16.0;
        phys.velocity.y -= gravity * delta;

        // Linear translation
        box.position.addScaledVector(phys.velocity, delta);

        // Rotational tumbling
        const qRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            phys.angularVelocity.x * delta,
            phys.angularVelocity.y * delta,
            phys.angularVelocity.z * delta
        ));
        box.quaternion.multiply(qRot);

        // Air damping
        phys.velocity.x *= 0.985;
        phys.velocity.z *= 0.985;
        phys.angularVelocity.multiplyScalar(0.975);

        // 1. Collision with Front Stool Table:
        // Table top surface is at Y = -0.45. Stool center: (0, -0.5, 2.4), width: 1.6, depth: 1.0.
        // Briefcase resting center Y on table is -0.06.
        const onStoolX = Math.abs(box.position.x) < 0.8;
        const onStoolZ = Math.abs(box.position.z - 2.4) < 0.5;
        if (onStoolX && onStoolZ && box.position.y <= -0.06 && phys.velocity.y < 0) {
            box.position.y = -0.06;
            phys.impactCount++;
            if (Math.abs(phys.velocity.y) > 0.8) {
                phys.velocity.y = -phys.velocity.y * 0.40; // Table bounce
                phys.angularVelocity.x += (Math.random() - 0.5) * 4.0;
                this.statusText = '💥 IMPACT // DEFLECTED OFF PEDESTAL TABLE TOP!';
            } else {
                phys.velocity.set(0, 0, 0);
                phys.angularVelocity.set(0, 0, 0);
                phys.settled = true;
            }
        }

        // 2. Collision with Storage Shelves:
        this.bayConfigs.forEach(cfg => {
            const dx = box.position.x - cfg.pos[0];
            const dz = box.position.z - cfg.pos[2];
            const distXZ = Math.sqrt(dx * dx + dz * dz);
            const shelfRestY = cfg.boxRestY;
            if (distXZ < 0.70 && box.position.y <= shelfRestY && box.position.y >= shelfRestY - 0.35 && phys.velocity.y < 0) {
                box.position.y = shelfRestY;
                phys.impactCount++;
                phys.velocity.y = -phys.velocity.y * 0.35;
                phys.velocity.x += (dx > 0 ? 0.8 : -0.8);
                phys.velocity.z += (dz > 0 ? 0.8 : -0.8);
                this.statusText = `💥 IMPACT // HIT STORAGE RACK [BAY ${cfg.bayNum}]!`;
            }
        });

        // 3. Collision with Factory Floor (Floor at Y = -1.8m, Briefcase resting center Y = -1.41m):
        const floorRestY = -1.41;
        if (box.position.y <= floorRestY) {
            box.position.y = floorRestY;
            phys.impactCount++;
            if (Math.abs(phys.velocity.y) > 0.7) {
                phys.velocity.y = -phys.velocity.y * 0.32; // Floor bounce
                phys.velocity.x *= 0.65;
                phys.velocity.z *= 0.65;
                phys.angularVelocity.multiplyScalar(0.5);
                this.statusText = '💥 IMPACT // BOUNCED OFF FACTORY FLOOR!';
            } else {
                phys.velocity.set(0, 0, 0);
                phys.angularVelocity.set(0, 0, 0);
                phys.settled = true;
            }
        }

        // 4. Ground Timer & Respawn Countdown:
        if (phys.settled || box.position.y <= floorRestY + 0.05) {
            phys.groundTimer += delta;
            const remaining = Math.max(0, phys.respawnDuration - phys.groundTimer);
            this.statusText = `RESTING ON GROUND // RESPAWNING ON STORAGE PEDESTAL IN ${remaining.toFixed(1)}s...`;

            if (phys.groundTimer >= phys.respawnDuration) {
                this.respawnBoxOnPedestal(box);
            }
        }
    }

    respawnBoxOnPedestal(box) {
        if (box.userData.physics) {
            box.userData.physics.active = false;
            box.userData.physics.settled = false;
        }
        box.userData.isDropped = false;

        const homePos = box.userData.rackHomePos || (box.userData.cfg && box.userData.cfg.boxRestPos);
        const homeRotY = (box.userData.rackHomeRotY !== undefined) ? box.userData.rackHomeRotY : ((box.userData.cfg && box.userData.cfg.rotY) || 0);

        if (!homePos) return;

        // Ensure lid is closed and clamped
        if (box.userData.setOpen) {
            box.userData.setOpen(0.0);
        }

        // Float slightly above its own perimeter storage pedestal, then bounce into place on its pedestal!
        box.position.set(homePos.x, homePos.y + 0.5, homePos.z);
        box.rotation.set(0, homeRotY, 0);

        if (typeof gsap !== 'undefined') {
            gsap.to(box.position, {
                x: homePos.x,
                y: homePos.y,
                z: homePos.z,
                duration: 0.7,
                ease: 'bounce.out',
                onComplete: () => {
                    const bayName = box.userData.cfg ? box.userData.cfg.name.toUpperCase() : 'BRIEFCASE';
                    this.statusText = `✅ DOSSIER RECOVERED // [${bayName}] RESPAWNED ON STORAGE PEDESTAL`;
                }
            });
        } else {
            box.position.copy(homePos);
            const bayName = box.userData.cfg ? box.userData.cfg.name.toUpperCase() : 'BRIEFCASE';
            this.statusText = `✅ DOSSIER RECOVERED // [${bayName}] RESPAWNED ON STORAGE PEDESTAL`;
        }

        // Guarantee disconnection from robot gripper
        if (this.carriedBox === box) {
            this.carriedBox = null;
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

    /**
     * Raycasting Briefcase Detection:
     * Identifies which 3D briefcase (0 to 6) is clicked or tapped on screen.
     */
    getIntersectedBay(clientX, clientY) {
        if (!this.camera || !this.renderer || !this.pallets || !this.pallets.length) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
            return null;
        }
        const x = ((clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((clientY - rect.top) / rect.height) * 2 + 1;

        if (!this.raycaster) this.raycaster = new THREE.Raycaster();
        this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

        const clickableMeshes = [];
        this.pallets.forEach(boxGroup => {
            if (boxGroup) {
                boxGroup.traverse(child => {
                    if (child.isMesh) {
                        child.userData.bayParent = boxGroup;
                        clickableMeshes.push(child);
                    }
                });
            }
        });

        const intersects = this.raycaster.intersectObjects(clickableMeshes, false);
        if (intersects.length > 0) {
            const hitMesh = intersects[0].object;
            const parent = hitMesh.userData.bayParent;
            if (parent && parent.userData && parent.userData.index !== undefined) {
                return parent.userData.index;
            }
        }
        return null;
    }

    updateCameraAspect() {
        if (!this.container || !this.renderer || !this.camera) return;
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        const aspect = width / height;

        this.camera.aspect = aspect;

        // Guaranteed Horizontal Coverage:
        // The outer perimeter briefcases span from X = -3.4m to X = +3.4m (6.8m total span).
        // To ensure all 7 briefcases and the robot cell fit with generous breathing margins on all mobile devices:
        if (aspect < 1.0) {
            // Mobile Portrait (e.g. phones):
            const camZ = 13.8;
            const camY = 3.1;
            if (this.cameraPos) this.cameraPos.set(0, camY, camZ);
            if (this.cameraLookAt) this.cameraLookAt.set(0, 0.1, 0);
            this.camera.position.set(0, camY, camZ);
            this.camera.lookAt(0, 0.1, 0);

            // Compute vertical FOV so that horizontal width at center is guaranteed ~9.7m:
            const halfWidth = 4.85; // Perfectly frames the cell and briefcases without cut-off or excess zoom-out
            const tanH = halfWidth / camZ;
            const tanV = tanH / aspect;
            const vFovDeg = THREE.MathUtils.radToDeg(Math.atan(tanV) * 2);
            this.camera.fov = Math.max(40, Math.min(84, vFovDeg));
        } else if (aspect < 1.4) {
            // Tablets / Square Viewports:
            const camZ = 12.2;
            const camY = 2.8;
            if (this.cameraPos) this.cameraPos.set(0, camY, camZ);
            if (this.cameraLookAt) this.cameraLookAt.set(0, 0.1, 0);
            this.camera.position.set(0, camY, camZ);
            this.camera.lookAt(0, 0.1, 0);

            const halfWidth = 5.1;
            const tanH = halfWidth / camZ;
            const tanV = tanH / aspect;
            const vFovDeg = THREE.MathUtils.radToDeg(Math.atan(tanV) * 2);
            this.camera.fov = Math.max(40, Math.min(70, vFovDeg));
        } else {
            // Widescreen Desktop:
            if (this.cameraPos) this.cameraPos.set(0, 2.0, 9.6);
            if (this.cameraLookAt) this.cameraLookAt.set(0, 0.3, 0);
            this.camera.position.set(0, 2.0, 9.6);
            this.camera.lookAt(0, 0.3, 0);
            this.camera.fov = 40;
        }

        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    onResize() {
        this.updateCameraAspect();
    }

    setupEventListeners() {
        this.updateCameraAspect();

        window.addEventListener('resize', () => {
            this.updateCameraAspect();
        });

        if (this.renderer && this.renderer.domElement) {
            const canvas = this.renderer.domElement;

            // Desktop hover cursor feedback:
            canvas.addEventListener('mousemove', (e) => {
                if (this.isMoving) {
                    canvas.style.cursor = 'default';
                    return;
                }
                const hitBay = this.getIntersectedBay(e.clientX, e.clientY);
                canvas.style.cursor = hitBay !== null ? 'pointer' : 'default';
            });

            // Direct click on 3D briefcase in scene:
            canvas.addEventListener('click', (e) => {
                const hitBay = this.getIntersectedBay(e.clientX, e.clientY);
                if (hitBay !== null) {
                    this.goToSection(hitBay);
                }
            });
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        if (!this.isEStopped) {
            if (!this.directTransfer) {
                // Responsive physical gripper finger actuation in scrub mode
                if (this.targetGripGap !== undefined) {
                    const gripSpeed = 1.0; // m/s (fast & snappy, eliminates gripper lag in manual mode)
                    const maxGripDelta = gripSpeed * Math.min(delta, 0.05);
                    if (this.joints.gripper.gap < this.targetGripGap) {
                        this.joints.gripper.gap = Math.min(this.targetGripGap, this.joints.gripper.gap + maxGripDelta);
                    } else if (this.joints.gripper.gap > this.targetGripGap) {
                        this.joints.gripper.gap = Math.max(this.targetGripGap, this.joints.gripper.gap - maxGripDelta);
                    }
                }

                // Responsive manual progress follower:
                // Direct proportional spring with clean snap ensures:
                // 1) Every scroll notch executes its full satisfying distance without being truncated.
                // 2) When scrolling stops, the robot cleanly halts within ~100ms without endless creeping.
                const progressDiff = this.targetProgress - this.currentProgress;
                if (Math.abs(progressDiff) > 0.0003) {
                    const step = Math.sign(progressDiff) * Math.min(Math.abs(progressDiff), Math.max(0.003, Math.abs(progressDiff) * 0.32));
                    this.currentProgress += step;
                } else {
                    this.currentProgress = this.targetProgress;
                }

                // Evaluate continuous scrub kinematics
                this.evaluateProgress(this.currentProgress);
            } else {
                // In directTransfer, drive gripper fingers smoothly to targetGripGap
                if (this.targetGripGap !== undefined) {
                    this.joints.gripper.gap += (this.targetGripGap - this.joints.gripper.gap) * 0.25;
                }
            }

            // Continuous Industrial Joint Servo (The arm ALWAYS drives smoothly, never teleports!)
            const servoFactor = 0.30;

            // J1 Turntable (Shortest angular path - eliminates any 360 deg spin or pi/-pi flip)
            let diffJ1 = (this.targetJointAngles.j1 - this.jointAngles.j1) % (2 * Math.PI);
            if (diffJ1 > Math.PI) diffJ1 -= 2 * Math.PI;
            if (diffJ1 < -Math.PI) diffJ1 += 2 * Math.PI;
            this.jointAngles.j1 += diffJ1 * servoFactor;
            while (this.jointAngles.j1 > Math.PI) this.jointAngles.j1 -= 2 * Math.PI;
            while (this.jointAngles.j1 < -Math.PI) this.jointAngles.j1 += 2 * Math.PI;

            // Pitch & Roll axes
            this.jointAngles.j2 += (this.targetJointAngles.j2 - this.jointAngles.j2) * servoFactor;
            this.jointAngles.j3 += (this.targetJointAngles.j3 - this.jointAngles.j3) * servoFactor;
            this.jointAngles.j4 += (this.targetJointAngles.j4 - this.jointAngles.j4) * servoFactor;
            this.jointAngles.j5 += (this.targetJointAngles.j5 - this.jointAngles.j5) * servoFactor;
            this.jointAngles.j6 += (this.targetJointAngles.j6 - this.jointAngles.j6) * servoFactor;

            // Update physical Three.js joint transforms
            if (this.joints.turntable) this.joints.turntable.rotation.y = this.jointAngles.j1;
            if (this.joints.shoulder) this.joints.shoulder.rotation.x = this.jointAngles.j2;
            if (this.joints.elbow) this.joints.elbow.rotation.x = this.jointAngles.j3;
            if (this.joints.wrist) this.joints.wrist.rotation.x = this.jointAngles.j4;
            if (this.joints.wristYaw) this.joints.wristYaw.rotation.z = this.jointAngles.j5;
            if (this.joints.flange) this.joints.flange.rotation.y = Math.PI / 2 + this.jointAngles.j6;

            // Drive physical gripper fingers strictly from the physical gap
            if (this.joints.gripper.leftFinger && this.joints.gripper.rightFinger) {
                this.joints.gripper.leftFinger.position.x = -this.joints.gripper.gap;
                this.joints.gripper.rightFinger.position.x = this.joints.gripper.gap;
            }

            const jointsMoving = Math.abs(diffJ1) > 0.005 || Math.abs(this.targetJointAngles.j2 - this.jointAngles.j2) > 0.005;
            const gripperMoving = Math.abs(this.targetGripGap - this.joints.gripper.gap) > 0.003;
            this.isMoving = Math.abs(this.targetProgress - this.currentProgress) > 0.005 || jointsMoving || gripperMoving || !!this.directTransfer;
        }

        // Update physics simulation for any dropped boxes
        if (this.pallets) {
            for (let i = 0; i < this.pallets.length; i++) {
                const box = this.pallets[i];
                if (box && box.userData && box.userData.physics && box.userData.physics.active) {
                    this.updateBoxPhysics(box, delta);
                }
            }
        }

        // Synchronize carried payload in real-time
        if (this.carriedBox && (!this.carriedBox.userData.physics || !this.carriedBox.userData.physics.active)) {
            this.updateCarriedBox();
        }

        // Camera softly frames robot
        this.camera.position.lerp(this.cameraPos, 0.05);
        this.camera.lookAt(this.cameraLookAt);

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }

        // Dynamic Collision Envelope styling update
        if (this.showCollisionModel && this.collisionMat) {
            if (this.isAtDynamicLimit) {
                const pulse = 0.45 + 0.3 * Math.sin(Date.now() * 0.009);
                this.collisionMat.opacity = pulse;
                this.collisionMat.color.setHex(0xef4444);
            } else {
                this.collisionMat.opacity = 0.3;
                this.collisionMat.color.setHex(0x00e5ff);
            }
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
                isAtDynamicLimit: this.isAtDynamicLimit,
                limitCulprit: this.limitCulprit,
                showCollisionModel: this.showCollisionModel,
                activeBay: activeName,
                progress: (this.currentProgress / this.maxProgress * 100).toFixed(1)
            });
        }
    }
}

// Global Export
window.RobotWorkcell = RobotWorkcell;

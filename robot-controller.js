/**
 * ROBOT CONTROLLER & TEACH PENDANT INTERFACE
 * Industrial Teach Pendant UI, Jog Controls, Section Card Synchronization, and Scroll Driver
 */

document.addEventListener('DOMContentLoaded', () => {
    // Check if robot canvas container exists
    const canvasContainer = document.getElementById('robot-canvas-container');
    if (!canvasContainer) return;

    // Initialize 3D Workcell (fall back to Classic View if WebGL is unavailable or fails)
    let workcell;
    try {
        const probe = document.createElement('canvas');
        if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) {
            throw new Error('WebGL not supported');
        }
        workcell = new RobotWorkcell('robot-canvas-container');
    } catch (err) {
        console.warn('3D workcell unavailable, showing Classic View:', err);
        document.body.classList.add('classic-view-mode', 'no-webgl');
        canvasContainer.style.display = 'none';
        const appContainer = document.getElementById('robot-app-container');
        if (appContainer) appContainer.style.display = 'none';
        const toggle = document.getElementById('viewModeToggle');
        if (toggle) toggle.style.display = 'none';
        document.querySelectorAll('.section, .hero').forEach(sec => {
            sec.classList.remove('robot-mode-hidden', 'robot-mode-active');
        });
        if (typeof window.dismissLoader === 'function') window.dismissLoader();
        return;
    }
    window.activeWorkcell = workcell;

    // Section Mappings
    const sectionIds = ['hero', 'about', 'experience', 'leadership', 'projects', 'skills', 'contact'];
    let currentSectionIndex = 0;
    let isScrollLocked = false;
    let viewMode = 'robot'; // 'robot' or 'classic'
    let stageRetractTimer = null;

    // Create Industrial Teach Pendant UI
    createTeachPendantUI();

    // Hook up Workcell Telemetry to Teach Pendant
    workcell.onTelemetryUpdate = (telemetry) => {
        updatePendantTelemetry(telemetry);
    };

    // Hook up Section Changes
    workcell.onSectionChange = (sectionId, index) => {
        if (sectionId && index >= 0) {
            currentSectionIndex = index;
            highlightActivePendantButton(index);
            displayFrontStageSection(sectionId, index);
            updateNavMenuHighlight(sectionId);
            updateMobileControls(index);
        } else {
            hideFrontStageSection();
            highlightActivePendantButton(-1);
            updateNavMenuHighlight('');
            updateMobileControls(-1);
        }
    };

    // Initial state: start with blank front stool, robot in standby, NO pop-ups open!
    hideFrontStageSection(true);
    highlightActivePendantButton(-1);

    // Create Mobile Workcell UI (Safety Sign Banner & Prev/Next Controls)
    createMobileWorkcellUI();

    // Support URL parameters for automated verification (?bay=1&inspect=true&progress=0.5)
    const urlParams = new URLSearchParams(window.location.search);
    const inspectParam = urlParams.get('inspect');
    const targetBayParam = urlParams.get('bay');
    const progressParam = urlParams.get('progress');

    if (inspectParam === 'true') {
        const stage = document.getElementById('robot-front-stage');
        if (stage) stage.classList.add('minimized-dock');
        const btn = document.getElementById('dockInspectBtn');
        if (btn) btn.textContent = '📄 View Topic Card';
    }

    if (progressParam !== null) {
        const p = parseFloat(progressParam);
        if (!isNaN(p)) {
            setTimeout(() => {
                workcell.targetProgress = p;
                workcell.currentProgress = p;
                workcell.evaluateProgress(p);
            }, 100);
        }
    } else if (targetBayParam !== null) {
        const bIdx = parseInt(targetBayParam, 10);
        if (!isNaN(bIdx)) {
            setTimeout(() => {
                workcell.goToSection(bIdx);
            }, 100);
        }
    }

    const directFromParam = urlParams.get('directFrom');
    const directToParam = urlParams.get('directTo');
    const directTParam = urlParams.get('directT');
    if (directToParam !== null && directTParam !== null) {
        const fromIdx = directFromParam !== null ? parseInt(directFromParam, 10) : null;
        const toIdx = parseInt(directToParam, 10);
        const tVal = parseFloat(directTParam);
        setTimeout(() => {
            workcell.evaluateDirectTransfer(fromIdx, toIdx, tVal);
        }, 120);
    }

    const gripBayParam = urlParams.get('gripBay') || urlParams.get('reachBay');
    if (gripBayParam !== null) {
        const bIdx = parseInt(gripBayParam, 10);
        if (!isNaN(bIdx)) {
            setTimeout(() => {
                const cfg = workcell.bayConfigs[bIdx];
                const pose = workcell.solveIK(cfg.pos[0], cfg.handleY, cfg.pos[2], cfg.rotY);
                workcell.jointAngles.j1 = pose.j1;
                workcell.jointAngles.j2 = pose.j2;
                workcell.jointAngles.j3 = pose.j3;
                workcell.jointAngles.j4 = pose.j4;
                workcell.jointAngles.j6 = pose.j6 || 0;
                workcell.joints.gripper.targetGap = 0.075;
                workcell.joints.gripper.gap = 0.075;
                workcell.statusText = `CLAMPED AT BAY [${cfg.bayNum} // ${cfg.name.toUpperCase()}]`;
            }, 100);
        }
    }

    /**
     * Build the Authentic Industrial Teach Pendant DOM Element
     */
    function createTeachPendantUI() {
        const pendant = document.createElement('div');
        pendant.id = 'teach-pendant';
        pendant.className = 'teach-pendant';
        pendant.innerHTML = `
            <!-- Top Bezel & Grip -->
            <div class="tp-header" id="tp-header">
                <div class="tp-title">
                    <span class="tp-brand">FANUC-STYLE // TP-6000</span>
                    <span class="tp-subtitle">ROBOTIC TEACH PENDANT</span>
                </div>
                <div class="tp-window-actions">
                    <button class="tp-minimize-btn" id="tp-minimize-btn" title="Minimize/Maximize Pendant">−</button>
                </div>
            </div>

            <!-- Body Container -->
            <div class="tp-body" id="tp-body">
                <!-- Status Indicators -->
                <div class="tp-status-bar">
                    <div class="tp-led tp-led-run active" id="tp-led-run" title="Robot Running">
                        <span class="led-pip"></span> RUN
                    </div>
                    <div class="tp-led tp-led-jog" id="tp-led-jog" title="Manual Jog Mode">
                        <span class="led-pip"></span> JOG
                    </div>
                    <div class="tp-led tp-led-limit" id="tp-led-limit" title="Dynamic Collision Limit Active">
                        <span class="led-pip"></span> LIMIT
                    </div>
                    <div class="tp-led tp-led-estop" id="tp-led-estop" title="Emergency Stop">
                        <span class="led-pip"></span> E-STOP
                    </div>
                </div>

                <!-- Industrial Green LCD Telemetry Display -->
                <div class="tp-lcd-screen">
                    <div class="lcd-line lcd-status" id="lcd-status">SYS READY // DOCKED AT HOME</div>
                    <div class="lcd-line lcd-telemetry">
                        <span id="lcd-j1">J1: 0.0°</span>
                        <span id="lcd-j2">J2: 20.0°</span>
                        <span id="lcd-j3">J3: -28.6°</span>
                    </div>
                    <div class="lcd-line lcd-telemetry">
                        <span id="lcd-j4">J4: 8.6°</span>
                        <span id="lcd-j5">J5: 0.0°</span>
                        <span id="lcd-j6">J6: 0.0°</span>
                    </div>
                    <div class="lcd-line lcd-gripper">
                        <span id="lcd-grip">GRIPPER: 200mm (OPEN)</span>
                        <span id="lcd-bay" class="lcd-highlight">ACTIVE: HOME / DOSSIER</span>
                    </div>
                </div>

                <!-- Section Workpiece Selector Buttons -->
                <div class="tp-section-label">WORKPIECE SELECTOR (CLICK TO DRIVE ROBOT):</div>
                <div class="tp-button-grid">
                    <button class="tp-btn tp-workpiece-btn" data-index="0">0: HOME</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="1">1: ABOUT</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="2">2: EXPERT</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="3">3: LEAD</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="4">4: PROJ</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="5">5: SKILLS</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="6">6: CONTACT</button>
                </div>

                <!-- Manual 6-Axis Jog Buttons + Gripper -->
                <div class="tp-jog-container">
                    <div class="tp-section-label">MANUAL 6-AXIS JOG OVERRIDE:</div>
                    <div class="tp-jog-controls">
                        <div class="tp-jog-row">
                            <span class="jog-label">J1 BASE:</span>
                            <button class="tp-jog-btn" id="jog-j1-neg">◀ -J1</button>
                            <button class="tp-jog-btn" id="jog-j1-pos">+J1 ▶</button>
                        </div>
                        <div class="tp-jog-row">
                            <span class="jog-label">J2 SHLDR:</span>
                            <button class="tp-jog-btn" id="jog-j2-neg">▼ -J2</button>
                            <button class="tp-jog-btn" id="jog-j2-pos">+J2 ▲</button>
                        </div>
                        <div class="tp-jog-row">
                            <span class="jog-label">J3 ELBOW:</span>
                            <button class="tp-jog-btn" id="jog-j3-neg">▼ -J3</button>
                            <button class="tp-jog-btn" id="jog-j3-pos">+J3 ▲</button>
                        </div>
                        <div class="tp-jog-row">
                            <span class="jog-label">J4 WRIST:</span>
                            <button class="tp-jog-btn" id="jog-j4-neg">▼ -J4</button>
                            <button class="tp-jog-btn" id="jog-j4-pos">+J4 ▲</button>
                        </div>
                        <div class="tp-jog-row">
                            <span class="jog-label">J5 YAW:</span>
                            <button class="tp-jog-btn" id="jog-j5-neg">◀ -J5</button>
                            <button class="tp-jog-btn" id="jog-j5-pos">+J5 ▶</button>
                        </div>
                        <div class="tp-jog-row">
                            <span class="jog-label">J6 ROLL:</span>
                            <button class="tp-jog-btn" id="jog-j6-neg">↺ -J6</button>
                            <button class="tp-jog-btn" id="jog-j6-pos">+J6 ↻</button>
                        </div>
                        <div class="tp-jog-row tp-grip-row">
                            <span class="jog-label">GRIPPER:</span>
                            <button class="tp-jog-btn tp-grip-btn" id="jog-grip-toggle">CLAMP / OPEN JAWS</button>
                        </div>
                        <div class="tp-safety-toggle-row">
                            <div class="tp-safety-pill">DCS ACTIVE // SELF-COLLISION PREVENTED</div>
                        </div>
                    </div>
                </div>

                <!-- Bottom Safety Row: E-STOP Button -->
                <div class="tp-safety-row">
                    <button class="tp-estop-btn" id="tp-estop-btn">
                        <span class="estop-ring"></span>
                        <span class="estop-label">EMERGENCY<br>STOP</span>
                    </button>
                    <div class="tp-estop-caption">PRESS TO HALT ROBOT<br>CLICK TO RESET</div>
                </div>
            </div>
        `;

        document.body.appendChild(pendant);

        // Bind Teach Pendant Button Events
        setupPendantEvents(pendant);
    }

    /**
     * Wire Up All Buttons on the Teach Pendant
     */
    function setupPendantEvents(pendant) {
        // Minimize / Maximize Pendant
        const minBtn = pendant.querySelector('#tp-minimize-btn');
        const header = pendant.querySelector('#tp-header');
        const body = pendant.querySelector('#tp-body');

        // Scale the pendant so it fits below the safety sign without scrolling
        function fitPendant() {
            const signVisible = window.innerHeight >= 760 && !document.body.classList.contains('classic-view-mode');
            const bottomGap = parseFloat(getComputedStyle(pendant).bottom) || 20;
            const topLimit = signVisible ? 198 : 100; // sign: top 84 + ~102 tall + 12 gap
            const natural = header.offsetHeight + body.scrollHeight + 6;
            const fit = Math.min(1, (window.innerHeight - topLimit - bottomGap) / natural);
            const scale = pendant.classList.contains('minimized') ? 1 : Math.max(0.55, fit);
            document.documentElement.style.setProperty('--tp-scale', scale.toFixed(3));
        }
        window.addEventListener('resize', fitPendant);
        window.addEventListener('load', fitPendant);
        fitPendant();

        // Scrolling over the pendant must never drive the robot
        pendant.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        pendant.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

        minBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pendant.classList.toggle('minimized');
            fitPendant();
            minBtn.textContent = pendant.classList.contains('minimized') ? '+' : '−';
        });

        if (header) {
            header.addEventListener('click', (e) => {
                if (e.target && e.target.closest('#tp-minimize-btn')) return;
                if (pendant.classList.contains('minimized')) {
                    pendant.classList.remove('minimized');
                    minBtn.textContent = '−';
                    fitPendant();
                }
            });
        }

        // Workpiece Selector Buttons
        const workpieceBtns = pendant.querySelectorAll('.tp-workpiece-btn');
        workpieceBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.getAttribute('data-index'), 10);
                if (workcell.isEStopped) {
                    alert('Robot is halted by EMERGENCY STOP! Click the E-STOP button to reset safety circuit.');
                    return;
                }
                currentSectionIndex = index;
                if (workcell) workcell.targetSectionIndex = index;
                highlightActivePendantButton(index);
                updateNavMenuHighlight(sectionIds[index]);
                updateMobileControls(index);
                workcell.goToSection(index);
            });
        });

        // 6-Axis Articulated Jog Controls
        const jogBindings = [
            ['#jog-j1-neg', 'j1', -0.15],
            ['#jog-j1-pos', 'j1', 0.15],
            ['#jog-j2-neg', 'j2', -0.10],
            ['#jog-j2-pos', 'j2', 0.10],
            ['#jog-j3-neg', 'j3', -0.10],
            ['#jog-j3-pos', 'j3', 0.10],
            ['#jog-j4-neg', 'j4', -0.12],
            ['#jog-j4-pos', 'j4', 0.12],
            ['#jog-j5-neg', 'j5', -0.15],
            ['#jog-j5-pos', 'j5', 0.15],
            ['#jog-j6-neg', 'j6', -0.20],
            ['#jog-j6-pos', 'j6', 0.20],
        ];

        jogBindings.forEach(([selector, axis, delta]) => {
            const btn = pendant.querySelector(selector);
            if (btn) {
                btn.addEventListener('click', () => {
                    workcell.jogJoint(axis, delta);
                    activateJogLED();
                });
            }
        });

        // Gripper Clamp / Open Manual Toggle
        const gripToggleBtn = pendant.querySelector('#jog-grip-toggle');
        if (gripToggleBtn) {
            gripToggleBtn.addEventListener('click', () => {
                workcell.toggleGripperManual();
                activateJogLED();
            });
        }


        // Emergency Stop Button
        const estopBtn = pendant.querySelector('#tp-estop-btn');
        estopBtn.addEventListener('click', () => {
            if (!workcell.isEStopped) {
                workcell.emergencyStop();
                estopBtn.classList.add('latched');
                pendant.querySelector('#tp-led-estop').classList.add('active');
                pendant.querySelector('#tp-led-run').classList.remove('active');
            } else {
                workcell.resetEmergencyStop();
                estopBtn.classList.remove('latched');
                pendant.querySelector('#tp-led-estop').classList.remove('active');
                pendant.querySelector('#tp-led-run').classList.add('active');
            }
        });
    }

    function activateJogLED() {
        const jogLed = document.getElementById('tp-led-jog');
        if (jogLed) {
            jogLed.classList.add('active');
            clearTimeout(jogLed._timer);
            jogLed._timer = setTimeout(() => jogLed.classList.remove('active'), 1500);
        }
    }

    function highlightActivePendantButton(activeIndex) {
        document.querySelectorAll('.tp-workpiece-btn').forEach((btn, idx) => {
            if (idx === activeIndex) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function updatePendantTelemetry(data) {
        const lcdStatus = document.getElementById('lcd-status');
        const lcdJ1 = document.getElementById('lcd-j1');
        const lcdJ2 = document.getElementById('lcd-j2');
        const lcdJ3 = document.getElementById('lcd-j3');
        const lcdJ4 = document.getElementById('lcd-j4');
        const lcdJ5 = document.getElementById('lcd-j5');
        const lcdJ6 = document.getElementById('lcd-j6');
        const lcdGrip = document.getElementById('lcd-grip');
        const lcdBay = document.getElementById('lcd-bay');

        const limitLed = document.getElementById('tp-led-limit');
        if (limitLed) {
            if (data.isAtDynamicLimit) {
                limitLed.classList.add('active');
            } else {
                limitLed.classList.remove('active');
            }
        }

        if (lcdStatus) {
            lcdStatus.textContent = data.status;
            if (data.isAtDynamicLimit) {
                lcdStatus.style.color = '#f97316';
            } else {
                lcdStatus.style.color = '#86efac';
            }
        }
        if (lcdJ1) lcdJ1.textContent = `J1: ${data.j1}°`;
        if (lcdJ2) lcdJ2.textContent = `J2: ${data.j2}°`;
        if (lcdJ3) lcdJ3.textContent = `J3: ${data.j3}°`;
        if (lcdJ4) lcdJ4.textContent = `J4: ${data.j4}°`;
        if (lcdJ5) lcdJ5.textContent = `J5: ${data.j5}°`;
        if (lcdJ6) lcdJ6.textContent = `J6: ${data.j6}°`;
        if (lcdGrip) lcdGrip.textContent = `GRIPPER: ${data.gap}mm ${data.isOpen ? '(OPEN)' : '(CLAMPED)'}`;
        if (lcdBay) lcdBay.textContent = `ACTIVE: ${data.activeBay.toUpperCase()}`;
    }

    /**
     * Front Stage Display Management
     * Seamlessly docks, unfolds, and retracts the target HTML section card
     */
    function hideFrontStageSection(immediate = false, onComplete = null) {
        const stageCard = document.getElementById('robot-front-stage');
        const stageBeam = document.getElementById('robot-stage-beam');
        if (!stageCard) {
            if (typeof onComplete === 'function') onComplete();
            return;
        }

        if (stageRetractTimer) {
            clearTimeout(stageRetractTimer);
            stageRetractTimer = null;
        }

        const isCurrentlyExpanded = stageCard.classList.contains('expanded') && !stageCard.classList.contains('docked-hidden');

        if (immediate || !isCurrentlyExpanded) {
            stageCard.classList.remove('expanded', 'retracting');
            stageCard.classList.add('docked-hidden');
            if (stageBeam) {
                stageBeam.classList.remove('expanded', 'retracting');
                stageBeam.classList.add('docked-hidden');
            }
            if (typeof onComplete === 'function') onComplete();
            return;
        }

        updateStageApertureVars();

        // 1. Trigger the physics-driven retraction animation into briefcase mouth
        stageCard.classList.remove('expanded');
        stageCard.classList.add('retracting');
        if (stageBeam) {
            stageBeam.classList.remove('expanded');
            stageBeam.classList.add('retracting');
        }

        // 2. Once animation completes (480ms), transition cleanly to docked-hidden
        stageRetractTimer = setTimeout(() => {
            stageCard.classList.remove('retracting');
            stageCard.classList.add('docked-hidden');
            if (stageBeam) {
                stageBeam.classList.remove('retracting');
                stageBeam.classList.add('docked-hidden');
            }
            stageRetractTimer = null;
            if (typeof onComplete === 'function') onComplete();
        }, 480);
    }
    window.hideFrontStageSection = hideFrontStageSection;

    function updateStageApertureVars() {
        let mouthY = window.innerHeight * 0.62;
        let mouthW = 240;

        if (workcell && typeof workcell.getFrontApertureScreenPos === 'function') {
            const pos = workcell.getFrontApertureScreenPos();
            if (pos && pos.y > 100) {
                mouthY = pos.y;
                mouthW = Math.max(160, Math.min(420, pos.width));
            }
        }

        document.documentElement.style.setProperty('--briefcase-mouth-y', `${mouthY.toFixed(1)}px`);
        document.documentElement.style.setProperty('--briefcase-mouth-w', `${mouthW.toFixed(1)}px`);
    }
    window.updateStageApertureVars = updateStageApertureVars;

    function displayFrontStageSection(sectionId, index) {
        if (viewMode !== 'robot') return;

        const stageCard = document.getElementById('robot-front-stage');
        const stageBeam = document.getElementById('robot-stage-beam');
        if (!stageCard) return;

        if (stageRetractTimer) {
            clearTimeout(stageRetractTimer);
            stageRetractTimer = null;
        }

        updateStageApertureVars();

        // 1. Immediately emerge the stage card and beam (emerging from briefcase mouth)
        stageCard.classList.remove('docked-hidden', 'transitioning', 'retracting');
        stageCard.classList.add('expanded');
        if (stageBeam) {
            stageBeam.classList.remove('docked-hidden', 'transitioning', 'retracting');
            stageBeam.classList.add('expanded');
        }

        // 2. Hide all other sections, show target section inside front stage
        document.querySelectorAll('.section, .hero').forEach(sec => {
            sec.classList.add('robot-mode-hidden');
            sec.classList.remove('robot-mode-active');
        });

        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.classList.remove('robot-mode-hidden');
            targetSection.classList.add('robot-mode-active');
        }

        // 3. Update styling and animations inside safe try-catch
        try {
            const dockTitle = document.getElementById('dock-active-title');
            if (workcell && workcell.bayConfigs && workcell.bayConfigs[index]) {
                const cfg = workcell.bayConfigs[index];
                if (dockTitle) {
                    dockTitle.textContent = `ACTIVE TOPIC: [${cfg.bayNum}] ${cfg.name.toUpperCase()}`;
                }
                const hexColor = '#' + cfg.color.toString(16).padStart(6, '0');
                stageCard.style.setProperty('--accent-color', hexColor);
                stageCard.style.setProperty('--accent-glow', hexColor + '55');
                stageCard.style.borderTopColor = hexColor;
                stageCard.style.borderBottomColor = hexColor;
                stageCard.style.boxShadow = `0 40px 95px rgba(0, 0, 0, 0.92), 0 0 45px ${hexColor}40`;

                if (stageBeam) {
                    stageBeam.style.setProperty('--accent-glow', hexColor + '60');
                }
            }

            // Scroll front stage card to top for newly opened dossier
            stageCard.scrollTop = 0;

            // Fabrication cell: a presented project board shows only that project
            clearSoloProject();
            if (sectionId === 'projects' && workcell && workcell.activeProjectName && targetSection) {
                showSoloProject(targetSection, workcell.activeProjectName, dockTitle);
            }

            if (targetSection) {
                if (typeof animateSkillBars === 'function' && targetSection.querySelector('.skill-bars')) {
                    animateSkillBars();
                }
                if (typeof animateCounters === 'function' && targetSection.querySelector('[data-count]')) {
                    animateCounters(targetSection);
                }
            }
        } catch (err) {
            console.error('Error decorating front stage card:', err);
        }
    }

    /**
     * Single-project dossier: when the robot presents one project board,
     * the Projects card shows only that project, opened to its full details.
     */
    function findProjectCard(section, projectName) {
        const wanted = projectName.toLowerCase().replace(/[^a-z0-9]/g, '');
        return Array.from(section.querySelectorAll('.project-card')).find(c => {
            const h3 = c.querySelector('h3');
            const name = h3 ? h3.textContent.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
            return name && (name.includes(wanted) || wanted.includes(name.slice(0, 10)));
        });
    }

    function ensureSoloBar(section) {
        let bar = section.querySelector('.fab-solo-bar');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.className = 'fab-solo-bar';
        bar.innerHTML = `
            <div class="fab-solo-meta">
                <span class="fab-solo-kicker">PROJECT UNIT // FAB-01</span>
                <span class="fab-solo-count" id="fabSoloCount"></span>
            </div>
            <div class="fab-solo-actions">
                <button type="button" class="fab-solo-btn" id="fabAllProjects">View all projects</button>
                <button type="button" class="fab-solo-btn primary" id="fabNextProject">Next project off the line &#9654;</button>
            </div>
        `;
        const grid = section.querySelector('.projects-grid');
        grid.parentNode.insertBefore(bar, grid);

        bar.querySelector('#fabNextProject').addEventListener('click', (e) => {
            e.stopPropagation();
            if (workcell.isEStopped || workcell.directTransfer) return;
            if (typeof workcell.nextProject === 'function' && workcell.nextProject() !== false) {
                hideFrontStageSection(false);
            }
        });
        bar.querySelector('#fabAllProjects').addEventListener('click', (e) => {
            e.stopPropagation();
            clearSoloProject();
            const stageCard = document.getElementById('robot-front-stage');
            if (stageCard) stageCard.scrollTop = 0;
        });
        return bar;
    }

    function showSoloProject(section, projectName, dockTitle) {
        const card = findProjectCard(section, projectName);
        if (!card) return;
        const cards = Array.from(section.querySelectorAll('.project-card'));
        const bar = ensureSoloBar(section);
        const count = bar.querySelector('#fabSoloCount');
        if (count) count.textContent = `${cards.indexOf(card) + 1} OF ${cards.length}`;

        section.classList.add('fab-solo-mode');
        card.classList.add('fab-solo');
        if (!card.classList.contains('expanded')) {
            card.classList.add('expanded');
            card.dataset.fabAutoExpanded = 'true';
        }
        if (dockTitle) {
            dockTitle.textContent = `ACTIVE TOPIC: [04] PROJECT // ${projectName.toUpperCase()}`;
        }
    }

    function clearSoloProject() {
        const section = document.getElementById('projects');
        if (!section) return;
        section.classList.remove('fab-solo-mode');
        section.querySelectorAll('.project-card.fab-solo').forEach(card => {
            card.classList.remove('fab-solo');
            if (card.dataset.fabAutoExpanded) {
                card.classList.remove('expanded');
                delete card.dataset.fabAutoExpanded;
            }
        });
    }
    window.clearSoloProject = clearSoloProject;

    function updateNavMenuHighlight(sectionId) {
        document.querySelectorAll('.nav-link').forEach(link => {
            if (link.getAttribute('href') === `#${sectionId}`) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    /**
     * Mouse Wheel Continuous Scrub Driver:
     * Directly scrubs robot kinematics across sections.
     * Stopping scrolling immediately freezes the robot in mid-motion!
     * Never speeds up or interrupts the set 0.3s emergence/collapse animation!
     */
    window.addEventListener('wheel', (e) => {
        if (viewMode !== 'robot' || workcell.isEStopped) return;

        const stageCard = document.getElementById('robot-front-stage');
        const isDossierOpen = stageCard && stageCard.classList.contains('expanded') && !stageCard.classList.contains('docked-hidden') && !stageCard.classList.contains('minimized-dock');

        // Handle deltaMode (0 = pixels, 1 = lines, 2 = pages)
        let rawDelta = e.deltaY;
        if (e.deltaMode === 1) rawDelta *= 33;
        else if (e.deltaMode === 2) rawDelta *= 100;

        if (isDossierOpen) {
            const hasScrollableContent = stageCard.scrollHeight > stageCard.clientHeight + 10;
            if (hasScrollableContent) {
                const maxScroll = stageCard.scrollHeight - stageCard.clientHeight;
                const isAtBottom = stageCard.scrollTop >= maxScroll - 15;
                const isAtTop = stageCard.scrollTop <= 10;
                const isHoveringDossier = stageCard.contains(e.target);

                // Scrolling down inside or at the side of an open popup:
                if (rawDelta > 0 && !isAtBottom) {
                    if (!isHoveringDossier) {
                        stageCard.scrollTop += rawDelta;
                    }
                    return; // Consumed by scrolling the popup
                }

                // Scrolling up inside or at the side of an open popup:
                if (rawDelta < 0 && !isAtTop) {
                    if (!isHoveringDossier) {
                        stageCard.scrollTop += rawDelta;
                    }
                    return; // Consumed by scrolling the popup
                }
            }
        }

        // Scrub sensitivity: ~0.020 progress per mouse notch => ~45 deliberate scrolls per section
        // Guarantees that approaching, clamping, and lifting each require at least 1-2 distinct scrolls
        const scrubSensitivity = 0.00020;
        const maxNotchDelta = 100;
        const clampedDelta = Math.sign(rawDelta) * Math.min(maxNotchDelta, Math.abs(rawDelta));
        workcell.applyScrollDelta(clampedDelta * scrubSensitivity);

        const activeProg = (workcell.currentProgress !== undefined) ? workcell.currentProgress : workcell.targetProgress;
        if (typeof activeProg === 'number' && activeProg >= 0.5) {
            currentSectionIndex = Math.max(0, Math.min(sectionIds.length - 1, Math.round(activeProg) - 1));
        }
    }, { passive: true });

    /**
     * Mobile Touch Gestures:
     * - Vertical Swipe: directly scrubs robot kinematics like mouse wheel!
     * - Tap on 3D Briefcase: dispatches the robot arm directly to that section!
     */
    let touchStartY = 0;
    let touchStartX = 0;
    let lastTouchY = 0;
    let touchStartTime = 0;
    let touchMoved = false;

    window.addEventListener('touchstart', (e) => {
        if (viewMode !== 'robot' || workcell.isEStopped) return;
        if (!e.touches || e.touches.length === 0) return;

        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        lastTouchY = touch.clientY;
        touchStartTime = performance.now();
        touchMoved = false;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (viewMode !== 'robot' || workcell.isEStopped) return;
        if (!e.touches || e.touches.length === 0) return;

        const stageCard = document.getElementById('robot-front-stage');
        const isDossierOpen = stageCard && stageCard.classList.contains('expanded') && !stageCard.classList.contains('docked-hidden') && !stageCard.classList.contains('minimized-dock');

        const touch = e.touches[0];
        const deltaY = lastTouchY - touch.clientY;
        const totalDist = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);

        if (totalDist > 8) {
            touchMoved = true;
        }

        // If touching inside an open, scrollable popup card, let native vertical scrolling handle it
        if (isDossierOpen && stageCard.contains(e.target)) {
            const hasScrollableContent = stageCard.scrollHeight > stageCard.clientHeight + 10;
            if (hasScrollableContent) {
                const maxScroll = stageCard.scrollHeight - stageCard.clientHeight;
                const isAtBottom = stageCard.scrollTop >= maxScroll - 15;
                const isAtTop = stageCard.scrollTop <= 10;

                if ((deltaY > 0 && !isAtBottom) || (deltaY < 0 && !isAtTop)) {
                    lastTouchY = touch.clientY;
                    return;
                }
            }
        }

        // Outside popup card: touch drag scrubs the robot kinematics
        lastTouchY = touch.clientY;
        const touchSensitivity = 0.00028;
        workcell.applyScrollDelta(deltaY * touchSensitivity);

        // Prevent pull-to-refresh or page bouncing when scrubbing the 3D cell
        if (e.cancelable && !isDossierOpen) {
            e.preventDefault();
        }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        if (viewMode !== 'robot' || workcell.isEStopped) return;

        const stageCard = document.getElementById('robot-front-stage');
        if (stageCard && stageCard.contains(e.target)) return;
        if (e.target && e.target.closest && e.target.closest('#teach-pendant, #mobile-workcell-controls, #mobile-safety-sign, nav, button, a')) return;

        const dt = performance.now() - touchStartTime;
        if (!touchMoved && dt < 350) {
            // It was a quick tap! Check if a 3D briefcase was tapped:
            if (workcell && typeof workcell.getIntersectedBay === 'function') {
                const hitIndex = workcell.getIntersectedBay(touchStartX, touchStartY);
                if (hitIndex !== null) {
                    window.__lastCellTap = performance.now();
                    currentSectionIndex = hitIndex;
                    if (workcell) workcell.targetSectionIndex = hitIndex;
                    highlightActivePendantButton(hitIndex);
                    updateNavMenuHighlight(sectionIds[hitIndex]);
                    updateMobileControls(hitIndex);
                    workcell.goToSection(hitIndex);
                }
            }
        }
    }, { passive: true });

    /**
     * Navbar Link Clicks
     * Clicking navbar links drives the robot directly to the corresponding bay
     */
    document.querySelectorAll('.nav-menu a[href^="#"]').forEach(link => {
        link.addEventListener('click', (e) => {
            if (viewMode === 'robot') {
                e.preventDefault();
                e.stopPropagation();
                if (workcell.isEStopped) {
                    alert('Robot is halted by EMERGENCY STOP! Click the E-STOP button to reset safety circuit.');
                    return;
                }
                const targetId = link.getAttribute('href').substring(1);
                const targetIdx = sectionIds.indexOf(targetId);
                if (targetIdx !== -1) {
                    currentSectionIndex = targetIdx;
                    if (workcell) workcell.targetSectionIndex = targetIdx;
                    highlightActivePendantButton(targetIdx);
                    updateNavMenuHighlight(targetId);
                    updateMobileControls(targetIdx);
                    workcell.goToSection(targetIdx);
                }
            }
        });
    });

    /**
     * View Mode Switcher (Robot Cell vs Classic Scroll)
     */
    window.setRobotViewMode = function(mode) {
        viewMode = mode;
        const appContainer = document.getElementById('robot-app-container');
        const pendant = document.getElementById('teach-pendant');
        const stageCard = document.getElementById('robot-front-stage');
        const stageBeam = document.getElementById('robot-stage-beam');
        const btn = document.getElementById('viewModeToggle');

        const safetySign = document.getElementById('mobile-safety-sign');
        const mobileControls = document.getElementById('mobile-workcell-controls');

        if (mode === 'classic') {
            // Robust active section detection from all possible Robot Mode states:
            let targetSectionId = null;

            // 1. Check if a section is actively displayed inside the popup dossier
            const activeSectionEl = document.querySelector('.section.robot-mode-active, .hero.robot-mode-active');
            if (activeSectionEl && activeSectionEl.id && sectionIds.includes(activeSectionEl.id)) {
                targetSectionId = activeSectionEl.id;
            }

            // 2. Check workcell.dockedSectionIndex (briefcase placed on front stool)
            if (!targetSectionId && workcell && typeof workcell.dockedSectionIndex === 'number' && workcell.dockedSectionIndex >= 0 && workcell.dockedSectionIndex < sectionIds.length) {
                targetSectionId = sectionIds[workcell.dockedSectionIndex];
            }

            // 3. Check workcell.targetSectionIndex (briefcase dispatched/targeted)
            if (!targetSectionId && workcell && typeof workcell.targetSectionIndex === 'number' && workcell.targetSectionIndex >= 0 && workcell.targetSectionIndex < sectionIds.length) {
                targetSectionId = sectionIds[workcell.targetSectionIndex];
            }

            // 4. Check active navbar link
            if (!targetSectionId) {
                const activeNav = document.querySelector('.nav-link.active');
                if (activeNav && activeNav.getAttribute('href')) {
                    const hrefId = activeNav.getAttribute('href').substring(1);
                    if (sectionIds.includes(hrefId) && hrefId !== 'hero') {
                        targetSectionId = hrefId;
                    }
                }
            }

            // 5. Check active teach pendant button
            if (!targetSectionId) {
                const activeTp = document.querySelector('.tp-workpiece-btn.active');
                if (activeTp) {
                    const tpIdx = parseInt(activeTp.getAttribute('data-index'), 10);
                    if (tpIdx >= 0 && tpIdx < sectionIds.length) {
                        targetSectionId = sectionIds[tpIdx];
                    }
                }
            }

            // 6. Check workcell continuous scrub progress (0.0 Idle, 1.0 Hero, 2.0 About, 3.0 Experience, 4.0 Leadership, 5.0 Projects, 6.0 Skills, 7.0 Contact)
            if (!targetSectionId && workcell) {
                const p = (typeof workcell.currentProgress === 'number') ? workcell.currentProgress : workcell.targetProgress;
                if (typeof p === 'number' && p >= 0.5) {
                    const scrubIdx = Math.max(0, Math.min(sectionIds.length - 1, Math.round(p) - 1));
                    targetSectionId = sectionIds[scrubIdx];
                }
            }

            // 7. Fallback to currentSectionIndex
            if (!targetSectionId && typeof currentSectionIndex === 'number' && currentSectionIndex >= 0 && currentSectionIndex < sectionIds.length) {
                targetSectionId = sectionIds[currentSectionIndex];
            }

            if (targetSectionId) {
                const targetIdx = sectionIds.indexOf(targetSectionId);
                if (targetIdx !== -1) {
                    currentSectionIndex = targetIdx;
                    if (workcell) {
                        workcell.targetSectionIndex = targetIdx;
                        workcell.dockedSectionIndex = targetIdx;
                    }
                }
            }

            clearSoloProject();
            document.body.classList.add('classic-view-mode');
            if (appContainer) appContainer.style.display = 'none';
            if (pendant) pendant.style.display = 'none';
            if (stageBeam) stageBeam.style.display = 'none';
            if (safetySign) safetySign.style.display = 'none';
            if (mobileControls) mobileControls.style.display = 'none';
            if (stageCard) {
                stageCard.classList.remove('docked-hidden', 'transitioning', 'minimized-dock', 'retracting');
                stageCard.classList.add('expanded');
            }
            document.querySelectorAll('.section, .hero').forEach(sec => {
                sec.classList.remove('robot-mode-hidden', 'robot-mode-active');
            });
            if (btn) {
                btn.innerHTML = '<span>🤖</span> Robot Cell';
            }

            // Immediately scroll down to the active section in Classic View!
            if (targetSectionId && targetSectionId !== 'hero') {
                const performScroll = () => {
                    const targetEl = document.getElementById(targetSectionId);
                    if (!targetEl) return;
                    const navbar = document.getElementById('navbar');
                    const navOffset = navbar ? (navbar.offsetHeight + 16) : 80;
                    const rect = targetEl.getBoundingClientRect();
                    const targetTop = (rect.top + window.pageYOffset) - navOffset;

                    const prevScrollBehavior = document.documentElement.style.scrollBehavior;
                    document.documentElement.style.scrollBehavior = 'auto';
                    window.scrollTo(0, Math.max(0, targetTop));
                    if (typeof targetEl.scrollIntoView === 'function') {
                        targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
                        window.scrollBy(0, -navOffset);
                    }
                    setTimeout(() => {
                        document.documentElement.style.scrollBehavior = prevScrollBehavior;
                    }, 60);
                };

                performScroll();
                requestAnimationFrame(performScroll);
                setTimeout(performScroll, 50);
                setTimeout(performScroll, 160);
            } else {
                window.scrollTo({ top: 0, behavior: 'instant' });
            }
        } else {
            // Switching from Classic Mode -> Robot Cell Mode:
            // Detect which section is currently scrolled into view so the robot cell opens that same section!
            let activeIdx = currentSectionIndex;
            const scrollMiddle = window.scrollY + window.innerHeight * 0.4;
            for (let i = 0; i < sectionIds.length; i++) {
                const el = document.getElementById(sectionIds[i]);
                if (el) {
                    const top = el.offsetTop;
                    const height = el.offsetHeight;
                    if (scrollMiddle >= top && scrollMiddle < top + height) {
                        activeIdx = i;
                        break;
                    }
                }
            }
            if (activeIdx < 0 || activeIdx >= sectionIds.length) {
                activeIdx = 0;
            }

            document.body.classList.remove('classic-view-mode');
            window.scrollTo({ top: 0, behavior: 'instant' });

            if (appContainer) appContainer.style.display = 'block';
            if (pendant) pendant.style.display = 'flex';
            if (stageBeam) stageBeam.style.display = '';
            if (safetySign) safetySign.style.display = '';
            if (mobileControls) mobileControls.style.display = '';
            if (btn) {
                btn.innerHTML = '<span>📄</span> Classic View';
            }
            if (workcell && typeof workcell.onResize === 'function') {
                workcell.onResize();
            }

            // Immediately teleport the robot workcell to this exact section and open the dossier!
            currentSectionIndex = activeIdx;
            if (workcell && typeof workcell.teleportToSection === 'function') {
                workcell.teleportToSection(activeIdx);
            } else if (workcell && typeof workcell.goToSection === 'function') {
                workcell.goToSection(activeIdx);
            }
            displayFrontStageSection(sectionIds[activeIdx], activeIdx);
        }
    };

    window.toggleViewMode = function() {
        const isClassic = document.body.classList.contains('classic-view-mode');
        const newMode = isClassic ? 'robot' : 'classic';
        window.setRobotViewMode(newMode);
    };

    window.toggleDockExpand = function() {
        const stage = document.getElementById('robot-front-stage');
        const btn = document.getElementById('expandDockBtn');
        if (!stage) return;
        stage.classList.toggle('expanded-full');
        if (btn) {
            btn.textContent = stage.classList.contains('expanded-full') ? '🗗 Split View' : '⛶ Expand';
        }
    };

    window.toggleCardInspect = function(actionOrEvent) {
        if (actionOrEvent && typeof actionOrEvent.stopPropagation === 'function') {
            actionOrEvent.stopPropagation();
        }

        const stage = document.getElementById('robot-front-stage');
        const btn = document.getElementById('dockInspectBtn');
        if (!stage) return;

        let shouldMinimize;
        if (actionOrEvent === 'expand') {
            shouldMinimize = false;
        } else if (actionOrEvent === 'minimize') {
            shouldMinimize = true;
        } else {
            // Default toggle: if currently minimized, expand; if open, minimize
            shouldMinimize = !stage.classList.contains('minimized-dock');
        }

        if (shouldMinimize) {
            stage.classList.add('minimized-dock');
            if (btn) btn.textContent = '📄 View Topic Card';
        } else {
            stage.classList.remove('minimized-dock');
            if (btn) btn.textContent = '👁 Inspect 3D Cell';
        }
    };

    window.toggleFrontStageDock = function() {
        window.toggleCardInspect();
    };

    window.closeFrontStageDossier = function(e) {
        if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
        }
        if (workcell && workcell.isEStopped) {
            alert('Robot is halted by EMERGENCY STOP! Click the E-STOP button to reset safety circuit.');
            return;
        }
        hideFrontStageSection(false);
        if (workcell && typeof workcell.stowFrontBoxToRack === 'function') {
            workcell.stowFrontBoxToRack();
        } else if (workcell && typeof workcell.goToSection === 'function') {
            workcell.goToSection(-1);
        }
        highlightActivePendantButton(-1);
        updateNavMenuHighlight('');
        updateMobileControls(-1);
    };
    window.stowDossierBackToBriefcase = window.closeFrontStageDossier;

    /**
     * Re-open Minimized Dock Pop-up on Any Click or Tap:
     * When #robot-front-stage is minimized, clicking/tapping anywhere on the bar
     * (the dock bracket, indicator, title, or button) re-opens it immediately.
     */
    const frontStage = document.getElementById('robot-front-stage');
    const dockInspectBtn = document.getElementById('dockInspectBtn');

    if (dockInspectBtn) {
        // Fast touch response on mobile without 300ms delay or double fire
        dockInspectBtn.addEventListener('touchend', (e) => {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            window.toggleCardInspect();
        }, { passive: false });
    }

    if (frontStage) {
        let dockTouchStartX = 0;
        let dockTouchStartY = 0;
        let dockTouchMoved = false;

        frontStage.addEventListener('touchstart', (e) => {
            if (e.target && e.target.closest('#dockInspectBtn')) return;
            if (frontStage.classList.contains('minimized-dock') && e.touches.length > 0) {
                const t = e.touches[0];
                dockTouchStartX = t.clientX;
                dockTouchStartY = t.clientY;
                dockTouchMoved = false;
            }
        }, { passive: true });

        frontStage.addEventListener('touchmove', (e) => {
            if (e.target && e.target.closest('#dockInspectBtn')) return;
            if (frontStage.classList.contains('minimized-dock') && e.touches.length > 0) {
                const t = e.touches[0];
                if (Math.hypot(t.clientX - dockTouchStartX, t.clientY - dockTouchStartY) > 10) {
                    dockTouchMoved = true;
                }
            }
        }, { passive: true });

        frontStage.addEventListener('touchend', (e) => {
            // If the user tapped the inspect button itself, ignore here
            if (e.target && e.target.closest('#dockInspectBtn')) return;
            if (frontStage.classList.contains('minimized-dock') && !dockTouchMoved) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                window.toggleCardInspect('expand');
            }
        }, { passive: false });

        frontStage.addEventListener('click', (e) => {
            // CRITICAL: If the user clicked the button itself, do not handle here
            // (Otherwise the button's minimize action gets immediately reversed!)
            if (e.target && e.target.closest('#dockInspectBtn')) {
                return;
            }
            if (frontStage.classList.contains('minimized-dock')) {
                e.stopPropagation();
                window.toggleCardInspect('expand');
            }
        });
    }

    /**
     * Mobile Workcell Interface:
     * 1. Constant, prominent Safety Sign banner at the top of the mobile screen.
     * 2. Touch-friendly PREV / NEXT cycle buttons + active bay readout at the bottom.
     */
    function createMobileWorkcellUI() {
        if (document.getElementById('mobile-safety-sign')) return;

        // 1. Prominent Industrial Blue Mandatory Safety Sign at Top
        const safetySign = document.createElement('div');
        safetySign.id = 'mobile-safety-sign';
        safetySign.className = 'mobile-safety-sign blue-mandatory-sign osha-danger-sign';
        safetySign.innerHTML = `
            <div class="mandatory-inner-frame">
                <!-- Top Blue Header with Mandatory Badge -->
                <div class="mandatory-header">
                    <span class="mandatory-title">MANDATORY</span>
                </div>
                <!-- Main Sign Content Area -->
                <div class="mandatory-body">
                    <!-- Circular Blue Pictogram Badge -->
                    <div class="mandatory-icon-badge" aria-hidden="true">
                        <!-- Hand / Direct Action Touch Symbol -->
                        <svg class="mandatory-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
                            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
                            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
                            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.83L7 15"/>
                        </svg>
                    </div>
                    <!-- Instruction Message Area -->
                    <div class="mandatory-msg-box">
                        <!-- Desktop Instructions -->
                        <div class="mandatory-text mandatory-desktop-text osha-desktop-body">
                            <div class="mandatory-line-1">SCROLL OR CLICK</div>
                            <div class="mandatory-line-2">A BOARD</div>
                        </div>
                        <!-- Mobile Instructions -->
                        <div class="mandatory-text mandatory-mobile-text osha-mobile-body">
                            <div class="mandatory-line-1">TAP A BOARD</div>
                            <div class="mandatory-line-2">TO PRESENT IT</div>
                            <div class="mandatory-line-sub">HOLD PREV / NEXT TO RUN</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(safetySign);

        // 2. Mobile Hold-To-Run Navigation Controls at Bottom
        const controls = document.createElement('div');
        controls.id = 'mobile-workcell-controls';
        controls.className = 'mobile-workcell-controls';
        controls.innerHTML = `
            <button id="mobileNavPrev" class="mobile-nav-btn prev-btn" aria-label="Hold to run backward">
                <span class="btn-arrow">◀</span>
                <div class="btn-label-group">
                    <span class="btn-text">PREV</span>
                    <span class="btn-subtext">HOLD</span>
                </div>
            </button>
            <button id="mobileNavNext" class="mobile-nav-btn next-btn" aria-label="Hold to run forward">
                <div class="btn-label-group">
                    <span class="btn-text">NEXT</span>
                    <span class="btn-subtext">HOLD</span>
                </div>
                <span class="btn-arrow">▶</span>
            </button>
        `;
        document.body.appendChild(controls);

        // Industrial Hold-To-Run Driver:
        // Runs robot arm continuously while button is held down.
        // Releasing freezes the arm instantly right where it is!
        function bindHoldToRun(btn, direction) {
            if (!btn) return;
            let animId = null;
            let lastTime = null;
            let isHolding = false;

            function runStep(now) {
                if (!isHolding) return;
                if (lastTime !== null) {
                    const dt = Math.min(0.05, (now - lastTime) / 1000);
                    if (workcell && typeof workcell.runHoldJog === 'function') {
                        workcell.runHoldJog(direction, dt);
                    }
                }
                lastTime = now;
                animId = requestAnimationFrame(runStep);
            }

            function startHold(e) {
                if (e.button !== undefined && e.button !== 0) return;
                if (workcell.isEStopped) return;
                if (e.cancelable) e.preventDefault(); // Prevents iOS/mobile text selection and magnifier callout
                if (isHolding) return;
                isHolding = true;
                lastTime = performance.now();
                btn.classList.add('holding');
                if (btn.setPointerCapture && e.pointerId !== undefined) {
                    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
                }
                animId = requestAnimationFrame(runStep);
            }

            function stopHold(e) {
                if (!isHolding) return;
                isHolding = false;
                btn.classList.remove('holding');
                if (animId) {
                    cancelAnimationFrame(animId);
                    animId = null;
                }
                lastTime = null;
                if (workcell && typeof workcell.stopHoldJog === 'function') {
                    workcell.stopHoldJog();
                }
                if (btn.releasePointerCapture && e && e.pointerId !== undefined) {
                    try { btn.releasePointerCapture(e.pointerId); } catch (err) {}
                }
            }

            btn.addEventListener('pointerdown', startHold);
            btn.addEventListener('pointerup', stopHold);
            btn.addEventListener('pointercancel', stopHold);
            btn.addEventListener('pointerleave', stopHold);
            btn.addEventListener('contextmenu', (e) => e.preventDefault());
        }

        const prevBtn = controls.querySelector('#mobileNavPrev');
        const nextBtn = controls.querySelector('#mobileNavNext');
        bindHoldToRun(prevBtn, -1);
        bindHoldToRun(nextBtn, 1);
    }

    function updateMobileControls(index) {
        // Badge removed per user request
    }

    // Keyboard access: arrow keys step through briefcases, Escape stows the open dossier
    document.addEventListener('keydown', (e) => {
        if (document.body.classList.contains('classic-view-mode')) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const tag = (e.target && e.target.tagName) || '';
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
        const stage = document.getElementById('robot-front-stage');
        const stageHidden = !stage || stage.classList.contains('docked-hidden');

        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            if (e.repeat) return;
            const step = e.key === 'ArrowRight' ? 1 : -1;
            const count = sectionIds.length;
            const target = stageHidden
                ? (step > 0 ? 0 : count - 1)
                : (currentSectionIndex + step + count) % count;
            e.preventDefault();
            workcell.goToSection(target);
        } else if (e.key === 'Escape' && !stageHidden) {
            window.closeFrontStageDossier();
        }
    });
});

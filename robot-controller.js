/**
 * ROBOT CONTROLLER & TEACH PENDANT INTERFACE
 * Industrial Teach Pendant UI, Jog Controls, Section Card Synchronization, and Scroll Driver
 */

document.addEventListener('DOMContentLoaded', () => {
    // Check if robot canvas container exists
    const canvasContainer = document.getElementById('robot-canvas-container');
    if (!canvasContainer) return;

    // Initialize 3D Workcell
    const workcell = new RobotWorkcell('robot-canvas-container');
    window.activeWorkcell = workcell;

    // Section Mappings
    const sectionIds = ['hero', 'about', 'experience', 'leadership', 'projects', 'skills', 'contact'];
    let currentSectionIndex = 0;
    let isScrollLocked = false;
    let viewMode = 'robot'; // 'robot' or 'classic'

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
        } else {
            hideFrontStageSection();
            highlightActivePendantButton(-1);
            updateNavMenuHighlight('');
        }
    };

    // Initial state: start with blank front stool, robot in standby, NO pop-ups open!
    hideFrontStageSection();
    highlightActivePendantButton(-1);

    // Mobile discovery hint:
    if (window.innerWidth <= 768) {
        const hint = document.createElement('div');
        hint.className = 'mobile-workcell-hint';
        hint.innerHTML = '<span>👆</span> Tap briefcase to open • <span>↕</span> Swipe to scrub';
        document.body.appendChild(hint);
    }

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
                <div class="tp-grip-tab"></div>
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
        const body = pendant.querySelector('#tp-body');
        minBtn.addEventListener('click', () => {
            pendant.classList.toggle('minimized');
            minBtn.textContent = pendant.classList.contains('minimized') ? '+' : '−';
        });

        // Workpiece Selector Buttons
        const workpieceBtns = pendant.querySelectorAll('.tp-workpiece-btn');
        workpieceBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.getAttribute('data-index'), 10);
                if (workcell.isEStopped) {
                    alert('Robot is halted by EMERGENCY STOP! Click the E-STOP button to reset safety circuit.');
                    return;
                }
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
     * Seamlessly docks and unfolds the target HTML section card
     */
    function hideFrontStageSection() {
        const stageCard = document.getElementById('robot-front-stage');
        const stageBeam = document.getElementById('robot-stage-beam');
        if (!stageCard) return;

        stageCard.classList.remove('expanded');
        stageCard.classList.add('docked-hidden');
        if (stageBeam) {
            stageBeam.classList.remove('expanded');
            stageBeam.classList.add('docked-hidden');
        }
    }

    function displayFrontStageSection(sectionId, index) {
        if (viewMode !== 'robot') return;

        const stageCard = document.getElementById('robot-front-stage');
        const stageBeam = document.getElementById('robot-stage-beam');
        if (!stageCard) return;

        // 1. Immediately emerge the stage card and beam (0.3s CSS transition)
        stageCard.classList.remove('docked-hidden', 'transitioning');
        stageCard.classList.add('expanded');
        if (stageBeam) {
            stageBeam.classList.remove('docked-hidden', 'transitioning');
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

        const dt = performance.now() - touchStartTime;
        if (!touchMoved && dt < 350) {
            // It was a quick tap! Check if a 3D briefcase was tapped:
            if (workcell && typeof workcell.getIntersectedBay === 'function') {
                const hitIndex = workcell.getIntersectedBay(touchStartX, touchStartY);
                if (hitIndex !== null) {
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
                const targetId = link.getAttribute('href').substring(1);
                const targetIdx = sectionIds.indexOf(targetId);
                if (targetIdx !== -1) {
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

        const hint = document.querySelector('.mobile-workcell-hint');

        if (mode === 'classic') {
            document.body.classList.add('classic-view-mode');
            if (appContainer) appContainer.style.display = 'none';
            if (pendant) pendant.style.display = 'none';
            if (stageBeam) stageBeam.style.display = 'none';
            if (hint) hint.style.display = 'none';
            if (stageCard) {
                stageCard.classList.remove('docked-hidden', 'transitioning', 'minimized-dock');
                stageCard.classList.add('expanded');
            }
            document.querySelectorAll('.section, .hero').forEach(sec => {
                sec.classList.remove('robot-mode-hidden', 'robot-mode-active');
            });
            if (btn) {
                btn.innerHTML = '<span>🤖</span> Robot Cell';
            }
        } else {
            document.body.classList.remove('classic-view-mode');
            if (appContainer) appContainer.style.display = 'block';
            if (pendant) pendant.style.display = 'flex';
            if (stageBeam) stageBeam.style.display = '';
            if (hint) hint.style.display = 'flex';
            if (btn) {
                btn.innerHTML = '<span>📄</span> Classic View';
            }
            if (workcell && typeof workcell.onResize === 'function') {
                workcell.onResize();
            }
            displayFrontStageSection(sectionIds[currentSectionIndex], currentSectionIndex);
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
});

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
        currentSectionIndex = index;
        highlightActivePendantButton(index);
        displayFrontStageSection(sectionId, index);
        updateNavMenuHighlight(sectionId);
    };

    // Initial display of Section 0 (Home/Hero)
    displayFrontStageSection(sectionIds[0], 0);
    highlightActivePendantButton(0);

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
                    <div class="lcd-line lcd-gripper">
                        <span id="lcd-grip">GRIPPER: 25mm</span>
                        <span id="lcd-bay" class="lcd-highlight">ACTIVE: HOME / DOSSIER</span>
                    </div>
                </div>

                <!-- Section Workpiece Selector Buttons -->
                <div class="tp-section-label">WORKPIECE SELECTOR (CLICK TO DRIVE ROBOT):</div>
                <div class="tp-button-grid">
                    <button class="tp-btn tp-workpiece-btn active" data-index="0">0: HOME</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="1">1: ABOUT</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="2">2: EXPERT</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="3">3: LEAD</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="4">4: PROJ</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="5">5: SKILLS</button>
                    <button class="tp-btn tp-workpiece-btn" data-index="6">6: CONTACT</button>
                </div>

                <!-- Manual Jog Buttons -->
                <div class="tp-jog-container">
                    <div class="tp-section-label">MANUAL JOG OVERRIDE:</div>
                    <div class="tp-jog-controls">
                        <div class="tp-jog-row">
                            <span class="jog-label">J1 BASE:</span>
                            <button class="tp-jog-btn" id="jog-j1-neg">◀ -J1</button>
                            <button class="tp-jog-btn" id="jog-j1-pos">+J1 ▶</button>
                        </div>
                        <div class="tp-jog-row">
                            <span class="jog-label">ARM REACH:</span>
                            <button class="tp-jog-btn" id="jog-reach-pos">▲ EXT</button>
                            <button class="tp-jog-btn" id="jog-reach-neg">▼ RET</button>
                        </div>
                        <div class="tp-jog-row">
                            <span class="jog-label">GRIPPER:</span>
                            <button class="tp-jog-btn tp-grip-btn" id="jog-grip-toggle">CLAMP / OPEN</button>
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
                workcell.setTargetBay(index, true);
            });
        });

        // Jog Controls
        pendant.querySelector('#jog-j1-neg').addEventListener('click', () => {
            workcell.jogJoint('j1', -0.15);
            activateJogLED();
        });
        pendant.querySelector('#jog-j1-pos').addEventListener('click', () => {
            workcell.jogJoint('j1', 0.15);
            activateJogLED();
        });
        pendant.querySelector('#jog-reach-pos').addEventListener('click', () => {
            workcell.jogJoint('j2', 0.1);
            workcell.jogJoint('j3', -0.1);
            activateJogLED();
        });
        pendant.querySelector('#jog-reach-neg').addEventListener('click', () => {
            workcell.jogJoint('j2', -0.1);
            workcell.jogJoint('j3', 0.1);
            activateJogLED();
        });
        pendant.querySelector('#jog-grip-toggle').addEventListener('click', () => {
            workcell.toggleGripperManual();
            activateJogLED();
        });

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
        const lcdGrip = document.getElementById('lcd-grip');
        const lcdBay = document.getElementById('lcd-bay');

        if (lcdStatus) lcdStatus.textContent = data.status;
        if (lcdJ1) lcdJ1.textContent = `J1: ${data.j1}°`;
        if (lcdJ2) lcdJ2.textContent = `J2: ${data.j2}°`;
        if (lcdJ3) lcdJ3.textContent = `J3: ${data.j3}°`;
        if (lcdGrip) lcdGrip.textContent = `GRIPPER: ${data.gap}mm`;
        if (lcdBay) lcdBay.textContent = `ACTIVE: ${data.activeBay.toUpperCase()}`;
    }

    /**
     * Front Stage Display Management
     * Seamlessly docks and unfolds the target HTML section card
     */
    function displayFrontStageSection(sectionId, index) {
        if (viewMode !== 'robot') return;

        const stageCard = document.getElementById('robot-front-stage');
        if (!stageCard) return;

        // Hide all original sections in standard flow while in robot mode
        document.querySelectorAll('.section, .hero').forEach(sec => {
            sec.classList.add('robot-mode-hidden');
            sec.classList.remove('robot-mode-active');
        });

        // Show target section inside Front Stage
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.classList.remove('robot-mode-hidden');
            targetSection.classList.add('robot-mode-active');
            stageCard.classList.add('expanded');

            const dockTitle = document.getElementById('dock-active-title');
            if (dockTitle && workcell && workcell.bayConfigs && workcell.bayConfigs[index]) {
                dockTitle.textContent = `ACTIVE TOPIC: [${workcell.bayConfigs[index].bayNum}] ${workcell.bayConfigs[index].name.toUpperCase()}`;
            }

            // Scroll front stage card to top
            stageCard.scrollTop = 0;

            // Trigger animations (counters, skill bars) if present in this section
            if (typeof animateSkillBars === 'function' && targetSection.querySelector('.skill-bars')) {
                animateSkillBars();
            }
            if (typeof animateCounters === 'function' && targetSection.querySelector('[data-count]')) {
                animateCounters(targetSection);
            }
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
     * Mouse Wheel Scroll Driver
     * Scrolling smoothly commands the robot to transition to adjacent sections
     */
    window.addEventListener('wheel', (e) => {
        if (viewMode !== 'robot' || workcell.isEStopped || isScrollLocked) return;

        const stageCard = document.getElementById('robot-front-stage');
        // If user is scrolling inside an expanded section that has scrollable content, allow them to read
        if (stageCard && stageCard.classList.contains('expanded')) {
            const isAtBottom = stageCard.scrollHeight - stageCard.scrollTop <= stageCard.clientHeight + 10;
            const isAtTop = stageCard.scrollTop <= 10;

            if (e.deltaY > 0 && !isAtBottom) return; // User is scrolling down through text
            if (e.deltaY < 0 && !isAtTop) return;    // User is scrolling up through text
        }

        // Section transition threshold
        if (Math.abs(e.deltaY) > 35) {
            isScrollLocked = true;
            if (e.deltaY > 0) {
                // Scroll down -> next section
                const nextIdx = Math.min(sectionIds.length - 1, currentSectionIndex + 1);
                if (nextIdx !== currentSectionIndex) {
                    workcell.setTargetBay(nextIdx, true);
                }
            } else {
                // Scroll up -> previous section
                const prevIdx = Math.max(0, currentSectionIndex - 1);
                if (prevIdx !== currentSectionIndex) {
                    workcell.setTargetBay(prevIdx, true);
                }
            }

            setTimeout(() => {
                isScrollLocked = false;
            }, 1400); // Debounce to allow robot motion to execute
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
                const targetId = link.getAttribute('href').substring(1);
                const targetIdx = sectionIds.indexOf(targetId);
                if (targetIdx !== -1) {
                    workcell.setTargetBay(targetIdx, true);
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

        if (mode === 'classic') {
            document.body.classList.add('classic-view-mode');
            if (appContainer) appContainer.style.display = 'none';
            if (pendant) pendant.style.display = 'none';
            document.querySelectorAll('.section, .hero').forEach(sec => {
                sec.classList.remove('robot-mode-hidden', 'robot-mode-active');
            });
        } else {
            document.body.classList.remove('classic-view-mode');
            if (appContainer) appContainer.style.display = 'block';
            if (pendant) pendant.style.display = 'flex';
            displayFrontStageSection(sectionIds[currentSectionIndex], currentSectionIndex);
        }
    };

    window.toggleViewMode = function() {
        const isClassic = document.body.classList.contains('classic-view-mode');
        const newMode = isClassic ? 'robot' : 'classic';
        window.setRobotViewMode(newMode);
        const btn = document.getElementById('viewModeToggle');
        if (btn) {
            btn.innerHTML = newMode === 'robot' ? '<span>🤖</span> Robot Cell' : '<span>📄</span> Classic View';
        }
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
});

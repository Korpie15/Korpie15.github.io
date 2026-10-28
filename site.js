/* Page chrome: navigation, detail sheets and live durations. */
(() => {
    'use strict';

    const root = document.documentElement;

    /* Durations such as "3 yrs 9 mos" from data-from / data-to (YYYY-MM). */
    function monthsBetween(from, to) {
        const [fy, fm] = from.split('-').map(Number);
        const end = to ? to.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
        return Math.max(0, (end[0] - fy) * 12 + (end[1] - fm) + (to ? 1 : 0));
    }
    function formatMonths(n) {
        const y = Math.floor(n / 12), m = n % 12;
        const parts = [];
        if (y) parts.push(y + (y === 1 ? ' yr' : ' yrs'));
        if (m) parts.push(m + (m === 1 ? ' mo' : ' mos'));
        return parts.join(' ') || '1 mo';
    }
    function fillDurations(scope) {
        scope.querySelectorAll('.dur[data-from]').forEach(el => {
            el.textContent = formatMonths(monthsBetween(el.dataset.from, el.dataset.to));
        });
    }
    fillDurations(document);
    const years = Math.floor(monthsBetween('2022-06') / 12);
    document.querySelectorAll('[data-years]').forEach(el => { el.textContent = years + '+'; });

    /* Navigation: chapters scroll the cell to the right moment. */
    const menuBtn = document.querySelector('.nav-menu');
    const menu = document.getElementById('menu-sheet');
    function setMenu(open) {
        if (!menu) return;
        menu.hidden = !open;
        menuBtn.setAttribute('aria-expanded', String(open));
    }
    if (menuBtn) menuBtn.addEventListener('click', () => setMenu(menu.hidden));

    document.addEventListener('click', e => {
        const a = e.target.closest('a[href^="#"], [data-go]');
        if (!a) return;
        const go = a.dataset.go;
        setMenu(false);
        const cell = window.CELL && root.classList.contains('cell-on') ? window.CELL : null;
        if (go && cell) {
            e.preventDefault();
            cell.scrollToMark(go);
            return;
        }
        if (go === 'top') {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        const id = (a.getAttribute('href') || '').slice(1);
        const target = id && document.getElementById(id);
        if (target && cell) {
            // Sections after the robot cell: glide there so the robot still moves at a natural pace.
            e.preventDefault();
            cell.scrollToY(target.getBoundingClientRect().top + window.scrollY);
            return;
        }
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    /* Detail sheets fed from <template> elements. */
    const sheet = document.getElementById('sheet');
    const body = document.getElementById('sheet-body');
    const panel = sheet.querySelector('.sheet-panel');
    let lastFocus = null;

    function openSheet(id) {
        const tpl = document.getElementById(id);
        if (!tpl) return;
        body.replaceChildren(tpl.content.cloneNode(true));
        fillDurations(body);
        body.querySelectorAll('.gallery:not(.gallery-1)').forEach(makeCarousel);
        if (sheet.hidden) {
            lastFocus = document.activeElement;
            sheet.hidden = false;
            root.classList.add('sheet-lock');
            requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
        }
        // Reset after un-hiding: scrollTop on a display:none panel is ignored.
        panel.scrollTop = 0;
        sheet.querySelector('.sheet-close').focus({ preventScroll: true });
    }

    /* Photo carousel: swipe or use the arrows and dots. */
    const arrow = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    function makeCarousel(gallery) {
        const imgs = [...gallery.querySelectorAll('img')];
        if (imgs.length < 2) return;
        gallery.classList.add('carousel-wrap');
        const frame = document.createElement('div');
        frame.className = 'carousel';
        const track = document.createElement('div');
        track.className = 'carousel-track';
        imgs.forEach(img => track.appendChild(img));
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'carousel-btn prev';
        prev.setAttribute('aria-label', 'Previous photo');
        prev.innerHTML = arrow('M15 5l-7 7 7 7');
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'carousel-btn next';
        next.setAttribute('aria-label', 'Next photo');
        next.innerHTML = arrow('M9 5l7 7-7 7');
        frame.append(track, prev, next);
        const dots = document.createElement('div');
        dots.className = 'carousel-dots';
        imgs.forEach((_, i) => {
            const d = document.createElement('button');
            d.type = 'button';
            d.setAttribute('aria-label', `Photo ${i + 1} of ${imgs.length}`);
            d.addEventListener('click', () => go(i));
            dots.appendChild(d);
        });
        gallery.replaceChildren(frame, dots);

        const index = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        const go = i => track.scrollTo({ left: clampIdx(i) * track.clientWidth });
        const clampIdx = i => Math.max(0, Math.min(imgs.length - 1, i));
        function update() {
            const i = index();
            [...dots.children].forEach((d, j) => d.setAttribute('aria-current', String(i === j)));
            prev.disabled = i === 0;
            next.disabled = i === imgs.length - 1;
        }
        prev.addEventListener('click', () => go(index() - 1));
        next.addEventListener('click', () => go(index() + 1));
        track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
        update();
    }
    function closeSheet() {
        if (sheet.hidden) return;
        sheet.classList.remove('open');
        root.classList.remove('sheet-lock');
        setTimeout(() => {
            sheet.hidden = true;
            body.replaceChildren();
            if (lastFocus) lastFocus.focus({ preventScroll: true });
        }, 380);
    }

    document.addEventListener('click', e => {
        const opener = e.target.closest('[data-open]');
        if (opener) {
            e.preventDefault();
            openSheet(opener.dataset.open);
            return;
        }
        if (e.target.closest('[data-close]')) closeSheet();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeSheet(); setMenu(false); }
    });
})();

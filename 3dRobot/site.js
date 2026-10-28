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
        if (go === 'top') {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (go && window.CELL && root.classList.contains('cell-on')) {
            e.preventDefault();
            window.CELL.scrollToMark(go);
            return;
        }
        const id = (a.getAttribute('href') || '').slice(1);
        const target = id && document.getElementById(id);
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
        panel.scrollTop = 0;
        if (sheet.hidden) {
            lastFocus = document.activeElement;
            sheet.hidden = false;
            root.classList.add('sheet-lock');
            requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
        }
        sheet.querySelector('.sheet-close').focus({ preventScroll: true });
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

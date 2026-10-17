/* ==========================================================================
 * glass.js — iOS 26 風格 Liquid Glass 時鐘玻璃 + 手機底部液態導航列與物理彈性膠囊 (極速零延遲版)
 *  - 預設磨砂 = 0 (純光學凸透鏡折射 + 菲涅爾色散高光，不模糊)
 *  - 專屬水境主題導航名稱與純單色極簡向量圖示 (杜絕任何彩色 Emoji)
 *  - 極速觸控優化：
 *    1) pointerdown 瞬發反應 + 場景列表 Fast-Tap (< 8px 零延遲觸發)，徹底消除 100ms click 延遲
 *    2) 高剛性二階欠阻尼彈簧 (stiffness=460, damping=24) + 拖曳時手指直接耦合跟手 (Direct Tracking)
 *    3) 滑桿 requestAnimationFrame 合批節流，120Hz 觸控螢幕拖動絲滑不卡頓
 * ========================================================================== */
(function () {
    'use strict';
    const KEY = 'chrono_glass_lab_v1';
    const NS = 'http://www.w3.org/2000/svg';
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

    // ---- 十種效果：fn(ctx) 回傳 [dx, dy] ∈ [-1,1] (取樣偏移方向) ----
    const EFFECTS = [
        { id: 'convex',  name: '01 CONVEX LENS 凸透鏡', fn: c => { const m = Math.pow(1 - c.depth, 2); return [-c.nx * m, -c.ny * m]; } },
        { id: 'bezel',   name: '02 BEZEL RIM 窄邊折射', fn: c => { const m = 1 - smooth(0, 0.55, c.depth); return [-c.nx * m, -c.ny * m]; } },
        { id: 'concave', name: '03 CONCAVE 凹透鏡',     fn: c => { const m = Math.pow(1 - c.depth, 2); return [c.nx * m, c.ny * m]; } },
        { id: 'ripple',  name: '04 RIPPLE 水波環',      fn: c => { const m = (1 - c.depth) * Math.sin(c.depth * 18); return [-c.nx * m, -c.ny * m]; } },
        { id: 'wave',    name: '05 FLOW WAVE 流體波',   fn: c => [Math.sin(c.y * 5.5 + 1.2) * 0.7, Math.sin(c.x * 4.2) * 0.7] },
        { id: 'whirl',   name: '06 WHIRL 漩渦',         fn: c => { const m = (1 - clamp(c.r, 0, 1)); return [-Math.sin(c.t) * m, Math.cos(c.t) * m]; } },
        { id: 'pinch',   name: '07 PINCH 收縮',         fn: c => { const m = clamp(c.r, 0, 1); return [c.x * m, c.y * m]; } },
        { id: 'bulge',   name: '08 BULGE 鼓脹',         fn: c => { const m = 1 - clamp(c.r, 0, 1); return [-c.x * m, -c.y * m]; } },
        { id: 'facet',   name: '09 FACET 稜鏡切面',     fn: c => { const m = Math.floor((1 - c.depth) * 4) / 4; return [-c.nx * m, -c.ny * m]; } },
        { id: 'jelly',   name: '10 JELLY 果凍噪波',     fn: c => [vnoise(c.x * 2.6 + 3.1, c.y * 2.6) * 1.6 - 0.8, vnoise(c.x * 2.6, c.y * 2.6 + 7.7) * 1.6 - 0.8] }
    ];
    function hash(i, j) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
    function vnoise(x, y) {
        const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    const DEF = { fx: 0, opacity: 0.08, frost: 0, refract: 60, bezel: 0.35, disp: 0.18, sat: 170, bright: 105, edge: 1, radius: 26 };
    let P = Object.assign({}, DEF);
    try { Object.assign(P, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { }

    let stage, svg, feImg, dR, dG, dB, panel;
    let pillFeImg, pillDisp;
    const cv = document.createElement('canvas');

    function buildSvg() {
        svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
        svg.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none';
        svg.innerHTML =
            '<filter id="lgFilter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB" filterUnits="objectBoundingBox">' +
            '<feImage id="lgImg" x="0" y="0" width="300" height="120" preserveAspectRatio="none" result="map"/>' +
            '<feDisplacementMap id="lgDR" in="SourceGraphic" in2="map" scale="60" xChannelSelector="R" yChannelSelector="G" result="dr"/>' +
            '<feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cr"/>' +
            '<feDisplacementMap id="lgDG" in="SourceGraphic" in2="map" scale="60" xChannelSelector="R" yChannelSelector="G" result="dg"/>' +
            '<feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cg"/>' +
            '<feDisplacementMap id="lgDB" in="SourceGraphic" in2="map" scale="60" xChannelSelector="R" yChannelSelector="G" result="db"/>' +
            '<feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cb"/>' +
            '<feBlend in="cr" in2="cg" mode="screen" result="rg"/>' +
            '<feBlend in="rg" in2="cb" mode="screen"/>' +
            '</filter>' +
            '<filter id="iosPillLensFilter" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">' +
            '<feImage id="pillLensImg" x="0%" y="0%" width="100%" height="100%" preserveAspectRatio="none" result="pmap"/>' +
            '<feDisplacementMap id="pillDisp" in="SourceGraphic" in2="pmap" scale="48" xChannelSelector="R" yChannelSelector="G"/>' +
            '</filter>';
        document.body.appendChild(svg);
        feImg = svg.querySelector('#lgImg'); dR = svg.querySelector('#lgDR'); dG = svg.querySelector('#lgDG'); dB = svg.querySelector('#lgDB');
        pillFeImg = svg.querySelector('#pillLensImg'); pillDisp = svg.querySelector('#pillDisp');
        buildPillLensMap(96, 52);
    }

    function buildPillLensMap(w, h) {
        if (!pillFeImg) return;
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data;
        const hw = w / 2, hh = h / 2, R = hh, bz = hh * 0.68;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const px = i + 0.5 - hw, py = j + 0.5 - hh;
            const qx = Math.abs(px) - (hw - R), qy = Math.abs(py) - (hh - R);
            const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
            const sd = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - R;
            let nx = 0, ny = 0;
            if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = Math.sign(px) * qx / l; ny = Math.sign(py) * qy / l; }
            else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
            const depth = clamp(-sd / bz, 0, 1);
            const m = Math.pow(1 - depth, 2.2);
            const k = (j * w + i) * 4;
            d[k] = clamp(128 + 127 * (-nx * m), 0, 255);
            d[k + 1] = clamp(128 + 127 * (-ny * m), 0, 255);
            d[k + 2] = 128; d[k + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        const url = cv.toDataURL('image/png');
        pillFeImg.setAttribute('href', url);
        pillFeImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
    }

    let cachedMapKey = '';
    let cachedMapUrl = '';
    function renderMap(w, h) {
        const S = Math.min(1, 160 / Math.max(w, h));
        const cw = Math.max(8, Math.round(w * S)), ch = Math.max(8, Math.round(h * S));
        const key = `${cw}x${ch}_${P.fx}_${P.radius}_${P.bezel}`;
        if (key === cachedMapKey && cachedMapUrl) return cachedMapUrl;

        cv.width = cw; cv.height = ch;
        const g = cv.getContext('2d'), img = g.createImageData(cw, ch), d = img.data;
        const hw = cw / 2, hh = ch / 2, R = Math.min(P.radius * S, hw, hh), bz = Math.max(2, P.bezel * Math.min(hw, hh));
        const fn = EFFECTS[P.fx].fn;
        for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
            const px = i + 0.5 - hw, py = j + 0.5 - hh;
            const qx = Math.abs(px) - (hw - R), qy = Math.abs(py) - (hh - R);
            const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
            const sd = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - R;
            let nx, ny;
            if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = Math.sign(px) * qx / l; ny = Math.sign(py) * qy / l; }
            else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
            const depth = clamp(-sd / bz, 0, 1);
            const x = px / hw, y = py / hh, r = Math.hypot(x, y) / 1.2;
            const o = fn({ x, y, r, t: Math.atan2(y, x), nx, ny, depth });
            const k = (j * cw + i) * 4;
            d[k] = clamp(128 + 127 * o[0], 0, 255);
            d[k + 1] = clamp(128 + 127 * o[1], 0, 255);
            d[k + 2] = 128; d[k + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        cachedMapKey = key;
        cachedMapUrl = cv.toDataURL('image/png');
        return cachedMapUrl;
    }

    let raf = 0;
    function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); }); }

    function apply() {
        if (!stage) return;
        const on = stage.classList.contains('liquid-glass');
        const props = ['backdrop-filter', '-webkit-backdrop-filter', 'background'];
        const w = Math.max(40, stage.offsetWidth), h = Math.max(40, stage.offsetHeight);
        const url = renderMap(w, h);
        feImg.setAttribute('width', w); feImg.setAttribute('height', h);
        feImg.setAttribute('href', url); feImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
        const s = P.refract;
        dR.setAttribute('scale', (s * (1 - P.disp)).toFixed(1));
        dG.setAttribute('scale', s.toFixed(1));
        dB.setAttribute('scale', (s * (1 + P.disp)).toFixed(1));

        if (pillDisp) {
            pillDisp.setAttribute('scale', Math.max(24, s * 0.85).toFixed(1));
        }

        const pillBf = 'url(#iosPillLensFilter) blur(' + P.frost + 'px) saturate(' + Math.min(210, P.sat + 15) + '%) brightness(' + (P.bright + 3) + '%)';
        document.documentElement.style.setProperty('--lg-pill-filter', pillBf);

        const fastSheetBf = 'blur(' + P.frost + 'px) saturate(' + P.sat + '%) brightness(' + P.bright + '%) contrast(108%)';
        document.documentElement.style.setProperty('--lg-fast-filter', fastSheetBf);

        if (!on) {
            props.forEach(p => stage.style.removeProperty(p));
            return;
        }
        const bf = 'url(#lgFilter) blur(' + P.frost + 'px) saturate(' + P.sat + '%) brightness(' + P.bright + '%)';
        stage.style.setProperty('backdrop-filter', bf, 'important');
        stage.style.setProperty('-webkit-backdrop-filter', bf, 'important');
        stage.style.setProperty('background',
            'linear-gradient(135deg, rgba(255,255,255,' + (P.opacity * 1.4).toFixed(3) + ') 0%, rgba(255,255,255,' + (P.opacity * 0.4).toFixed(3) + ') 45%, rgba(0,0,0,' + (P.opacity * 0.9).toFixed(3) + ') 100%)', 'important');
        stage.style.setProperty('border-radius', P.radius + 'px', 'important');
        stage.style.setProperty('--lg-edge', P.edge);
    }

    function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { } }

    // ---------------- 面板 ----------------
    const SLIDERS = [
        ['opacity', 'OPACITY 透明度', 0, 0.6, 0.01],
        ['frost', 'FROST 磨砂', 0, 24, 0.5],
        ['refract', 'REFRACTION 折射強度', 0, 160, 1],
        ['bezel', 'BEZEL 折射邊寬', 0.05, 1, 0.01],
        ['disp', 'DISPERSION 色散', 0, 0.6, 0.01],
        ['sat', 'SATURATION 飽和', 50, 300, 1],
        ['bright', 'BRIGHTNESS 亮度', 60, 160, 1],
        ['edge', 'EDGE GLOW 邊緣高光', 0, 1.6, 0.05],
        ['radius', 'RADIUS 圓角', 0, 60, 1]
    ];
    function buildPanel() {
        const st = document.createElement('style');
        st.textContent =
            '.chrono-clock-stage.liquid-glass::before,.chrono-clock-stage.liquid-glass::after{opacity:var(--lg-edge,1)}' +
            '#glassLab{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(100px + env(safe-area-inset-bottom, 0px));width:min(92vw, 380px);max-height:66vh;overflow:auto;z-index:380;padding:16px 18px;border-radius:28px;' +
            'background:linear-gradient(135deg,rgba(255,255,255,0.12) 0%,rgba(12,24,18,0.45) 45%,rgba(5,12,9,0.62) 100%);' +
            'backdrop-filter:var(--lg-fast-filter, blur(0px) saturate(170%) brightness(105%));' +
            '-webkit-backdrop-filter:var(--lg-fast-filter, blur(0px) saturate(170%) brightness(105%));' +
            'box-shadow:inset 1.5px 2px 2px rgba(255,255,255,0.88),inset -1.5px -2px 2px rgba(var(--chrono-rgb,82,229,155),0.4),0 24px 60px rgba(0,0,0,0.65);' +
            'border:1.5px solid rgba(255,255,255,0.52);color:var(--chrono-text,#e2e8f0);font:11px/1.4 inherit;font-family:inherit;display:none;letter-spacing:1px}' +
            '#glassLab.open{display:block}#glassLab h4{margin:0 0 8px;font-size:12px;color:var(--chrono-pink,#52e59b);display:flex;justify-content:space-between;text-shadow:0 1px 4px rgba(0,0,0,0.85)}' +
            '#glassLab .fxg{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}' +
            '#glassLab .fxg button{font:inherit;font-size:10px;padding:8px 8px;border-radius:14px;border:1px solid rgba(255,255,255,.38);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;text-align:left;box-shadow:inset 1px 1px 1.5px rgba(255,255,255,0.65);text-shadow:0 1px 3px rgba(0,0,0,0.85);touch-action:manipulation}' +
            '#glassLab .fxg button.on{background:rgba(var(--chrono-rgb,82,229,155),.28);border-color:var(--chrono-pink,#52e59b);color:var(--chrono-pink,#52e59b);font-weight:700}' +
            '#glassLab label{display:flex;justify-content:space-between;margin-top:7px;font-size:10.5px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.85)}#glassLab input[type=range]{width:100%;accent-color:var(--chrono-pink,#52e59b)}' +
            '#glassLab .rb{margin-top:10px;width:100%;font:inherit;padding:9px;border-radius:16px;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.10);color:#fff;cursor:pointer;box-shadow:inset 1px 1.5px 2px rgba(255,255,255,0.75);text-shadow:0 1px 3px rgba(0,0,0,0.85);font-weight:700;touch-action:manipulation}';
        document.head.appendChild(st);

        panel = document.createElement('div'); panel.id = 'glassLab';
        let html = '<h4><span>GLASS LAB // 液態玻璃光學參數</span><span id="glClose" style="cursor:pointer;padding:2px 6px;">✕</span></h4><div class="fxg">';
        EFFECTS.forEach((e, i) => { html += '<button data-fx="' + i + '">' + e.name + '</button>'; });
        html += '</div>';
        SLIDERS.forEach(s => { html += '<label><span>' + s[1] + '</span><b id="glv_' + s[0] + '"></b></label><input type="range" data-k="' + s[0] + '" min="' + s[2] + '" max="' + s[3] + '" step="' + s[4] + '">'; });
        html += '<button class="rb" id="glReset">RESET 還原預設 (磨砂 = 0)</button>';
        panel.innerHTML = html;
        document.body.appendChild(panel);
        ['pointerdown', 'wheel', 'keydown'].forEach(ev => panel.addEventListener(ev, e => e.stopPropagation()));

        panel.querySelectorAll('[data-fx]').forEach(b => b.addEventListener('pointerdown', () => { P.fx = +b.dataset.fx; sync(); save(); schedule(); }));
        panel.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => { P[inp.dataset.k] = parseFloat(inp.value); sync(); save(); schedule(); }));
        panel.querySelector('#glReset').addEventListener('pointerdown', () => { P = Object.assign({}, DEF); sync(); save(); schedule(); });
        panel.querySelector('#glClose').addEventListener('pointerdown', toggle);
        sync();
    }
    function sync() {
        panel.querySelectorAll('[data-fx]').forEach(b => b.classList.toggle('on', +b.dataset.fx === P.fx));
        panel.querySelectorAll('input[data-k]').forEach(inp => {
            inp.value = P[inp.dataset.k];
            const v = panel.querySelector('#glv_' + inp.dataset.k); if (v) v.textContent = (+P[inp.dataset.k]).toFixed(inp.step < 1 ? 2 : 0);
        });
    }
    function toggle() { panel.classList.toggle('open'); }

    function addButton() {
        const ref = document.getElementById('btnCycleGlassShape');
        if (!ref || !ref.parentElement) return;
        const li = document.createElement('li'); li.innerHTML = '<button class="chrono-btn" id="btnGlassLab" style="font-size:11px;padding:8px 18px;"><span id="glassLabLabel">GLASS LAB: 玻璃參數</span><span class="shortcut">L [面板]</span></button>';
        ref.parentElement.parentElement.insertBefore(li, ref.parentElement.nextSibling);
        li.querySelector('button').addEventListener('click', toggle);
    }

    // =========================================================================
    // iOS 26 手機操作介面 (專屬水境導航圖示與名稱 + 零延遲觸控架構)
    // =========================================================================
    function buildMobileInterface() {
        const st = document.createElement('style');
        st.textContent = `
            :root {
                --lg-pill-filter: url(#iosPillLensFilter) blur(0px) saturate(185%) brightness(108%);
                --lg-fast-filter: blur(0px) saturate(170%) brightness(105%) contrast(108%);
            }

            .chrono-hud,
            .scene-selector-hud,
            .hud-toggle-btn,
            .bottom-hint,
            .status-hud,
            .chrono-clock-stage.clock-hidden {
                display: none !important;
            }

            /* 介面所有按鈕：預設同款磨砂=0 高通透液態玻璃質感 + touch-action: manipulation 零延遲 */
            .lg-btn {
                position: relative;
                background: radial-gradient(
                    120% 120% at 50% 50%,
                    rgba(255, 255, 255, 0.03) 0%,
                    rgba(255, 255, 255, 0.09) 70%,
                    rgba(255, 255, 255, 0.22) 100%
                );
                border: 1.2px solid rgba(255, 255, 255, 0.54);
                border-radius: 22px;
                color: var(--chrono-white, #ffffff);
                font-family: inherit;
                font-size: 12px;
                letter-spacing: 1.4px;
                padding: 12px 15px;
                cursor: pointer;
                touch-action: manipulation;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                box-shadow:
                    inset 1.2px 1.8px 2px rgba(255, 255, 255, 0.90),
                    inset 2.5px 0 7px rgba(255, 110, 155, 0.20),
                    inset -2.5px 0 7px rgba(80, 210, 255, 0.24),
                    inset -1px -1.5px 2px rgba(var(--chrono-rgb, 82, 229, 155), 0.38),
                    0 8px 20px rgba(0, 0, 0, 0.32);
                text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
                transition: transform 0.14s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.16s ease, color 0.16s ease;
                overflow: hidden;
            }
            .lg-btn::before {
                content: '';
                position: absolute;
                top: 0; left: 10%; right: 10%; height: 38%;
                border-radius: 99px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.32) 0%, rgba(255, 255, 255, 0) 100%);
                pointer-events: none;
            }
            .lg-btn:active {
                transform: scale(0.94, 0.96);
            }
            .lg-btn.active {
                border-color: var(--chrono-pink);
                color: var(--chrono-pink);
                font-weight: 700;
                box-shadow:
                    inset 1.5px 2px 2.2px rgba(255, 255, 255, 0.96),
                    inset 3px 0 8px rgba(255, 110, 155, 0.26),
                    inset -3px 0 8px rgba(80, 210, 255, 0.30),
                    inset 0 0 14px rgba(var(--chrono-rgb, 82, 229, 155), 0.36),
                    0 8px 22px rgba(0, 0, 0, 0.42),
                    0 0 14px rgba(var(--chrono-rgb, 82, 229, 155), 0.30);
            }
            .lg-btn .sub-tag {
                font-size: 10px;
                color: var(--chrono-pink);
                opacity: 0.95;
                font-weight: 700;
                letter-spacing: 1px;
            }

            @keyframes jellyPopAnim {
                0%   { transform: scale(1, 1); }
                25%  { transform: scale(1.14, 0.86); }
                52%  { transform: scale(0.92, 1.08); }
                76%  { transform: scale(1.03, 0.98); }
                100% { transform: scale(1, 1); }
            }
            .jelly-pop {
                animation: jellyPopAnim 0.34s cubic-bezier(0.25, 1, 0.5, 1);
            }

            /* 手機分頁上彈卡片 (極速 0.22s Q彈展開 / 0.14s 瞬收，contain 隔離排版) */
            .ios-page-sheet {
                position: fixed;
                left: 50%;
                bottom: calc(98px + env(safe-area-inset-bottom, 0px));
                transform: translate3d(-50%, 18px, 0) scale(0.96);
                width: min(92vw, 430px);
                max-height: 55vh;
                overflow-y: auto;
                scrollbar-width: none;
                padding: 16px 18px 18px 18px;
                border-radius: 34px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, rgba(10, 22, 16, 0.24) 45%, rgba(4, 10, 8, 0.36) 100%);
                border: 1.5px solid rgba(255, 255, 255, 0.58);
                box-shadow:
                    inset 1.5px 2px 2.5px rgba(255, 255, 255, 0.90),
                    inset 3px 0 10px rgba(255, 110, 155, 0.22),
                    inset -3px 0 10px rgba(80, 210, 255, 0.26),
                    inset 0 -8px 18px -6px rgba(var(--chrono-rgb, 82, 229, 155), 0.40),
                    0 24px 60px rgba(0, 0, 0, 0.55),
                    0 0 26px rgba(var(--chrono-rgb, 82, 229, 155), 0.22);
                z-index: 210;
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                contain: layout style;
                will-change: transform, opacity;
                transition:
                    transform 0.15s ease-out,
                    opacity 0.14s ease-out,
                    visibility 0.15s;
            }
            .ios-page-sheet::-webkit-scrollbar { display: none; }
            .ios-page-sheet.open {
                transform: translate3d(-50%, 0, 0) scale(1);
                opacity: 1;
                visibility: visible;
                pointer-events: auto;
                backdrop-filter: var(--lg-fast-filter);
                -webkit-backdrop-filter: var(--lg-fast-filter);
                transition:
                    transform 0.22s cubic-bezier(0.2, 1.28, 0.32, 1),
                    opacity 0.16s ease-out,
                    visibility 0s;
            }

            .sheet-pill-handle {
                width: 38px;
                height: 4px;
                border-radius: 99px;
                background: rgba(255, 255, 255, 0.48);
                margin: 0 auto 12px auto;
                box-shadow: 0 0 8px rgba(255, 255, 255, 0.4);
            }
            .sheet-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
                padding: 0 4px;
            }
            .sheet-title {
                font-size: 12.5px;
                font-weight: 700;
                letter-spacing: 2.2px;
                color: var(--chrono-white, #ffffff);
                text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
            }
            .sheet-badge {
                font-size: 10px;
                padding: 3px 9px;
                border-radius: 99px;
                border: 1px solid rgba(255, 255, 255, 0.48);
                color: var(--chrono-pink);
                background: rgba(255, 255, 255, 0.08);
                font-weight: 700;
            }

            .sheet-grid-2 {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 9px;
                margin-top: 8px;
            }
            .sheet-scene-list {
                display: grid;
                grid-template-columns: 1fr;
                gap: 8px;
            }

            .lg-slider-card {
                padding: 11px 15px;
                border-radius: 22px;
                background: radial-gradient(120% 120% at 50% 50%, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.12) 100%);
                border: 1px solid rgba(255, 255, 255, 0.46);
                box-shadow:
                    inset 1px 1.5px 2px rgba(255, 255, 255, 0.78),
                    inset 2px 0 6px rgba(255, 110, 155, 0.16),
                    inset -2px 0 6px rgba(80, 210, 255, 0.20);
                margin-bottom: 9px;
            }
            .lg-slider-head {
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                margin-bottom: 7px;
                color: var(--chrono-white, #ffffff);
                text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
            }
            .lg-slider-head b {
                color: var(--chrono-pink);
            }

            .lg-cycle-pills {
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 6px;
                margin-top: 9px;
            }
            .lg-pill-mini {
                padding: 7px 2px;
                border-radius: 15px;
                font-size: 10.5px;
                font-family: inherit;
                color: var(--chrono-white, #ffffff);
                background: radial-gradient(100% 100% at 50% 50%, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.16) 100%);
                border: 1px solid rgba(255, 255, 255, 0.44);
                box-shadow: inset 0 1px 1.5px rgba(255, 255, 255, 0.78);
                cursor: pointer;
                touch-action: manipulation;
                text-align: center;
                text-shadow: 0 1px 3px rgba(0,0,0,0.85);
                transition: transform 0.14s ease, border-color 0.14s ease, color 0.14s ease;
            }
            .lg-pill-mini.active {
                border-color: var(--chrono-pink);
                color: var(--chrono-pink);
                background: rgba(var(--chrono-rgb, 82, 229, 155), 0.24);
                font-weight: 700;
                box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.94), 0 0 12px var(--chrono-pink-glow);
            }

            /* ==================== 截圖同款 iOS 26 底部懸浮導航列 (專屬水境名稱與純向量圖示) ==================== */
            .ios-bottom-dock {
                position: fixed;
                left: 50%;
                bottom: max(18px, env(safe-area-inset-bottom, 18px));
                transform: translateX(-50%);
                display: flex;
                align-items: center;
                gap: 12px;
                z-index: 260;
                width: min(94vw, 430px);
                justify-content: center;
                user-select: none;
                -webkit-user-select: none;
            }

            .ios-tab-capsule {
                position: relative;
                flex: 1;
                height: 68px;
                padding: 5px;
                border-radius: 999px;
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                align-items: center;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.09) 0%, rgba(255, 255, 255, 0.02) 45%, rgba(0, 0, 0, 0.18) 100%);
                border: 1.5px solid rgba(255, 255, 255, 0.54);
                box-shadow:
                    inset 1.5px 2px 2.5px rgba(255, 255, 255, 0.88),
                    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
                    inset 3px 0 9px rgba(255, 110, 155, 0.20),
                    inset -3px 0 9px rgba(80, 210, 255, 0.24),
                    inset 0 -6px 14px -6px rgba(var(--chrono-rgb, 82, 229, 155), 0.38),
                    0 18px 44px rgba(0, 0, 0, 0.50),
                    0 0 22px rgba(var(--chrono-rgb, 82, 229, 155), 0.20);
                touch-action: none;
            }

            /* 在按鈕上方移動的高通透 + 周圍強折射與色散橢圓形液態玻璃滑塊 */
            .ios-sliding-pill {
                position: absolute;
                top: 5px;
                left: 0;
                height: calc(100% - 10px);
                width: 82px;
                border-radius: 999px;
                pointer-events: none;
                z-index: 3;
                transform-origin: center center;
                will-change: transform;
                background: radial-gradient(
                    100% 100% at 50% 50%,
                    rgba(255, 255, 255, 0.01) 0%,
                    rgba(255, 255, 255, 0.05) 58%,
                    rgba(255, 255, 255, 0.24) 86%,
                    rgba(255, 255, 255, 0.44) 100%
                );
                backdrop-filter: var(--lg-pill-filter);
                -webkit-backdrop-filter: var(--lg-pill-filter);
                border: 1.5px solid rgba(255, 255, 255, 0.90);
                box-shadow:
                    inset 1.5px 2.5px 2.5px rgba(255, 255, 255, 1),
                    inset -1.5px -2.5px 3px rgba(255, 255, 255, 0.72),
                    inset 3.5px 0 9px rgba(255, 105, 155, 0.36),
                    inset -3.5px 0 9px rgba(75, 210, 255, 0.42),
                    inset 0 0 16px rgba(var(--chrono-rgb, 82, 229, 155), 0.30),
                    0 6px 18px rgba(0, 0, 0, 0.34),
                    0 0 16px rgba(var(--chrono-rgb, 82, 229, 155), 0.30);
            }
            .ios-sliding-pill::before {
                content: '';
                position: absolute;
                top: 2px;
                left: 14%;
                right: 14%;
                height: 35%;
                border-radius: 999px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.54) 0%, rgba(255, 255, 255, 0) 100%);
                pointer-events: none;
            }

            /* 導航列單個 Page 按鈕 */
            .ios-tab-item {
                position: relative;
                z-index: 4;
                height: 100%;
                border: none;
                background: transparent;
                color: rgba(255, 255, 255, 0.78);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                cursor: pointer;
                touch-action: none;
                font-family: inherit;
                padding: 0;
                transition: color 0.14s ease, transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1);
                text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
            }
            .ios-tab-item svg {
                width: 22px;
                height: 22px;
                stroke: currentColor;
                fill: none;
                stroke-width: 1.85;
                stroke-linecap: round;
                stroke-linejoin: round;
                filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.65));
                transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), stroke 0.14s ease;
            }
            .ios-tab-item span {
                font-size: 10.5px;
                font-weight: 700;
                letter-spacing: 1.5px;
            }
            .ios-tab-item.active {
                color: var(--chrono-pink);
                text-shadow: 0 0 12px var(--chrono-pink-glow), 0 1px 3px rgba(0, 0, 0, 0.9);
            }
            .ios-tab-item.active svg {
                transform: translateY(-1px) scale(1.08);
                filter: drop-shadow(0 0 8px var(--chrono-pink-glow));
            }

            /* 右側獨立圓形液態玻璃按鈕 (水滴漣漪躍魚觸發器) */
            .ios-action-orb {
                width: 66px;
                height: 66px;
                flex-shrink: 0;
                border-radius: 50%;
                background: radial-gradient(
                    100% 100% at 50% 50%,
                    rgba(255, 255, 255, 0.03) 0%,
                    rgba(255, 255, 255, 0.08) 62%,
                    rgba(255, 255, 255, 0.28) 100%
                );
                backdrop-filter: var(--lg-pill-filter);
                -webkit-backdrop-filter: var(--lg-pill-filter);
                border: 1.5px solid rgba(255, 255, 255, 0.76);
                color: var(--chrono-white, #ffffff);
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                touch-action: manipulation;
                box-shadow:
                    inset 1.5px 2px 2.5px rgba(255, 255, 255, 0.95),
                    inset -1.5px -2px 2.5px rgba(var(--chrono-rgb, 82, 229, 155), 0.45),
                    inset 3px 0 8px rgba(255, 110, 155, 0.28),
                    inset -3px 0 8px rgba(80, 210, 255, 0.34),
                    0 18px 42px rgba(0, 0, 0, 0.50),
                    0 0 20px rgba(var(--chrono-rgb, 82, 229, 155), 0.25);
                transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.16s ease;
                position: relative;
            }
            .ios-action-orb::before {
                content: '';
                position: absolute;
                top: 3px; left: 18%; right: 18%; height: 32%;
                border-radius: 999px;
                background: linear-gradient(180deg, rgba(255,255,255,0.48), rgba(255,255,255,0));
                pointer-events: none;
            }
            .ios-action-orb svg {
                width: 26px;
                height: 26px;
                stroke: var(--chrono-pink);
                fill: none;
                stroke-width: 1.95;
                stroke-linecap: round;
                stroke-linejoin: round;
                filter: drop-shadow(0 0 8px var(--chrono-pink-glow));
            }
            .ios-action-orb:active {
                transform: scale(0.88);
            }

            @media (max-width: 760px) {
                .chrono-clock-stage.liquid-glass {
                    padding: 16px 26px 14px 26px !important;
                    max-width: 92vw;
                }
                .mega-time { font-size: clamp(48px, 13.5vw, 88px); }
                .mono-wrap { font-size: clamp(44px, 12vw, 80px); }
                .st-day { font-size: clamp(46px, 12.5vw, 84px); }
                .st-time { font-size: clamp(24px, 6.2vw, 40px); }
            }
        `;
        document.head.appendChild(st);

        const wrap = document.createElement('div');
        wrap.id = 'iosMobileUIContainer';
        wrap.innerHTML = `
            <!-- Page 2: 水域 (SCENES) 水境場景選擇抽屜 -->
            <div class="ios-page-sheet" data-page-sheet="scenes">
                <div class="sheet-pill-handle"></div>
                <div class="sheet-header">
                    <span class="sheet-title">WATER ARCHIVES // 八大水域</span>
                    <span class="sheet-badge">8 MODES</span>
                </div>
                <div class="sheet-scene-list" id="mobileSceneList"></div>
            </div>

            <!-- Page 3: 時晷 (CHRONO & SOLAR) 時鐘與天象控制抽屜 -->
            <div class="ios-page-sheet" data-page-sheet="chrono">
                <div class="sheet-pill-handle"></div>
                <div class="sheet-header">
                    <span class="sheet-title">CHRONO &amp; SOLAR // 時晷與天象</span>
                    <span class="sheet-badge" id="mobileSolarBadge">SOLAR SYNC</span>
                </div>

                <div class="lg-slider-card">
                    <div class="lg-slider-head">
                        <span>SOLAR PHASE 日照時刻</span>
                        <b id="mobileSolarTimeTxt">06:00 // 日出</b>
                    </div>
                    <input type="range" id="mobileSolarSlider" class="chrono-slider" style="width:100%;display:block;" min="0" max="1" step="0.001" value="0.25">
                    <div class="lg-cycle-pills" id="mobileCycleGrid">
                        <button type="button" class="lg-pill-mini" data-sec="3600">1hr</button>
                        <button type="button" class="lg-pill-mini" data-sec="900">15m</button>
                        <button type="button" class="lg-pill-mini active" data-sec="180">3m</button>
                        <button type="button" class="lg-pill-mini" data-sec="60">1m</button>
                        <button type="button" class="lg-pill-mini" data-sec="30">30s</button>
                    </div>
                </div>

                <div class="lg-slider-card">
                    <div class="lg-slider-head">
                        <span>CLOCK SCALE 時鐘縮放</span>
                        <b id="mobileClockScaleTxt">1.05×</b>
                    </div>
                    <input type="range" id="mobileClockScaleSlider" class="chrono-slider" style="width:100%;display:block;" min="0.5" max="2.5" step="0.05" value="1.05">
                </div>

                <div class="sheet-grid-2">
                    <button type="button" class="lg-btn" id="mBtnToggleClockShow" style="grid-column: span 2;">
                        <span>時鐘顯示開關</span>
                        <span class="sub-tag" id="mClockShowTxt">OFF</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnCycleClock">
                        <span>錶盤樣式</span>
                        <span class="sub-tag" id="mClockFaceTxt">SIGNET</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnSolarSweep">
                        <span>日出⇄日落</span>
                        <span class="sub-tag">SWEEP</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnGlassShape">
                        <span>玻璃幾何</span>
                        <span class="sub-tag" id="mGlassShapeTxt">SQUIRCLE</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnResetClock">
                        <span>重置時鐘位置</span>
                        <span class="sub-tag">CENTER</span>
                    </button>
                </div>
            </div>

            <!-- Page 4: 生態 (ECOLOGY & LAB) 生態互動、水聲與光學調校抽屜 (純文字/符號標籤，無彩色Emoji) -->
            <div class="ios-page-sheet" data-page-sheet="lab">
                <div class="sheet-pill-handle"></div>
                <div class="sheet-header">
                    <span class="sheet-title">ECOLOGY &amp; OPTICS // 生態與光學</span>
                    <span class="sheet-badge">FROST = 0</span>
                </div>

                <div class="lg-slider-card">
                    <div class="lg-slider-head">
                        <span>AMBIENT VOLUME 水聲音量</span>
                        <b id="mobileVolumeTxt">75%</b>
                    </div>
                    <input type="range" id="mobileVolumeSlider" class="chrono-slider" style="width:100%;display:block;" min="0" max="1" step="0.01" value="0.75">
                </div>

                <div class="sheet-grid-2">
                    <button type="button" class="lg-btn active" id="mBtnWildlifeSfx">
                        <span>魚蛙水花音效</span>
                        <span class="sub-tag" id="mWildlifeSfxTxt">ON</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnChirpToggle">
                        <span>蟲鳥鳴叫開關</span>
                        <span class="sub-tag" id="mChirpStateTxt">OFF</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnSpawnKoi">
                        <span>錦鯉躍水</span>
                        <span class="sub-tag">LEAP ⤒</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnTriggerEco">
                        <span>驚動生態</span>
                        <span class="sub-tag">FAUNA ◈</span>
                    </button>
                    <button type="button" class="lg-btn active" id="mBtnAudioMute">
                        <span>環境水聲</span>
                        <span class="sub-tag" id="mAudioStateTxt">PLAYING</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnWaveSpeed">
                        <span>水波流速</span>
                        <span class="sub-tag" id="mSpeedStateTxt">SLOW</span>
                    </button>
                    <button type="button" class="lg-btn active" id="mBtnToggleGlass">
                        <span>時鐘液態玻璃</span>
                        <span class="sub-tag" id="mGlassOnTxt">ON</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnOpenGlassLab">
                        <span>光學調校面板</span>
                        <span class="sub-tag">OPTICS ⊹</span>
                    </button>
                </div>
            </div>

            <!-- iOS 26 底部懸浮導航列 (專屬水境名稱：觀景 / 水域 / 時晷 / 生態 + 純單色極簡線條 SVG 圖示) -->
            <nav class="ios-bottom-dock" aria-label="Hydro Chrono Liquid Glass Navigation">
                <div class="ios-tab-capsule" id="iosTabTrack">
                    <!-- 在按鈕上方移動的高通透 + 周圍強折射橢圓形液態玻璃滑塊 -->
                    <div class="ios-sliding-pill" id="iosSlidingPill"></div>

                    <!-- 1. 觀景 (VIEW)：極簡山水日輪與水面波紋線條 -->
                    <button type="button" class="ios-tab-item active" data-page="today">
                        <svg viewBox="0 0 24 24">
                            <circle cx="17.5" cy="6.5" r="2.5"></circle>
                            <path d="M3 15.5l5.2-5.5 4.3 4.5 3.5-3.5 5 4.5"></path>
                            <path d="M2 19.5c2.5-1.2 5-1.2 7.5 0s5 1.2 7.5 0 3.5-1.2 5 0"></path>
                        </svg>
                        <span>觀景</span>
                    </button>

                    <!-- 2. 水域 (SCENES)：三層流動水波紋線條 -->
                    <button type="button" class="ios-tab-item" data-page="scenes">
                        <svg viewBox="0 0 24 24">
                            <path d="M2 7.5c2.5-1.8 5-1.8 7.5 0s5 1.8 7.5 0 3.5-1.8 5 0"></path>
                            <path d="M2 12.5c2.5-1.8 5-1.8 7.5 0s5 1.8 7.5 0 3.5-1.8 5 0"></path>
                            <path d="M2 17.5c2.5-1.8 5-1.8 7.5 0s5 1.8 7.5 0 3.5-1.8 5 0"></path>
                        </svg>
                        <span>水域</span>
                    </button>

                    <!-- 3. 時晷 (CHRONO)：精密日晷時鐘與日月軌道刻度 -->
                    <button type="button" class="ios-tab-item" data-page="chrono">
                        <svg viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="8.5"></circle>
                            <polyline points="12 7.5 12 12 15.2 13.8"></polyline>
                            <line x1="12" y1="1.5" x2="12" y2="3"></line>
                            <line x1="12" y1="21" x2="12" y2="22.5"></line>
                            <line x1="1.5" y1="12" x2="3" y2="12"></line>
                            <line x1="21" y1="12" x2="22.5" y2="12"></line>
                        </svg>
                        <span>時晷</span>
                    </button>

                    <!-- 4. 生態 (ECOLOGY)：極簡流線游魚剪影線條 -->
                    <button type="button" class="ios-tab-item" data-page="lab">
                        <svg viewBox="0 0 24 24">
                            <path d="M2 12s4-6 10.5-6c4.2 0 7.5 6 7.5 6s-3.3 6-7.5 6C6 18 2 12 2 12z"></path>
                            <path d="M20 12l3-3.5v7L20 12z"></path>
                            <circle cx="15.5" cy="10.8" r="0.8" fill="currentColor"></circle>
                        </svg>
                        <span>生態</span>
                    </button>
                </div>

                <!-- 右側獨立圓形液態玻璃按鈕：水滴激起同心漣漪圖示 (點按瞬間躍魚+激起水波) -->
                <button type="button" class="ios-action-orb" id="iosActionOrb" title="點按激起水波與錦鯉躍水">
                    <svg viewBox="0 0 24 24">
                        <path d="M12 3.2c0 0-4.2 4.8-4.2 7.6a4.2 4.2 0 0 0 8.4 0C16.2 8 12 3.2 12 3.2z"></path>
                        <path d="M4.5 17.5c1.8 1.9 4.5 3 7.5 3s5.7-1.1 7.5-3"></path>
                    </svg>
                </button>
            </nav>
        `;
        document.body.appendChild(wrap);
        ['pointerdown', 'wheel', 'click', 'touchstart', 'touchmove'].forEach(ev => {
            wrap.addEventListener(ev, e => e.stopPropagation(), { passive: true });
        });

        bindMobileControls();
        initMobileTabBarPhysics();
    }

    let syncChronoSheetFn = null;

    // 綁定零延遲觸控控制項 (固定按鈕使用 pointerdown 瞬發，滾動列表使用 Fast-Tap)
    function bindMobileControls() {
        const origSceneBtns = Array.from(document.querySelectorAll('#sceneListContainer .scene-item-btn'));
        const mSceneList = document.getElementById('mobileSceneList');
        if (mSceneList && origSceneBtns.length) {
            mSceneList.innerHTML = '';
            origSceneBtns.forEach((ob, idx) => {
                const nameSpan = ob.querySelector('span');
                const title = nameSpan ? nameSpan.textContent : ('SCENE 0' + (idx + 1));
                const mb = document.createElement('button');
                mb.type = 'button';
                mb.className = 'lg-btn m-scene-btn' + (ob.classList.contains('active') ? ' active' : '');
                mb.innerHTML = `<span>${title}</span><span class="sub-tag">0${idx + 1}</span>`;

                // Fast-Tap: 手指按下記錄座標，抬起時若位移 < 8px 則立即切換場景，不等待慢速 click
                let downX = 0, downY = 0;
                mb.addEventListener('pointerdown', (e) => {
                    downX = e.clientX;
                    downY = e.clientY;
                    mb.classList.remove('jelly-pop');
                    void mb.offsetWidth;
                    mb.classList.add('jelly-pop');
                });
                mb.addEventListener('pointerup', (e) => {
                    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 9) {
                        ob.click();
                        document.querySelectorAll('.m-scene-btn').forEach((b, k) => b.classList.toggle('active', k === idx));
                    }
                });
                mSceneList.appendChild(mb);
            });
        }

        const origSolar = document.getElementById('solarSlider');
        const mSolar = document.getElementById('mobileSolarSlider');
        const origSolarTxt = document.getElementById('solarTimeValue');
        const mSolarTxt = document.getElementById('mobileSolarTimeTxt');
        const origScale = document.getElementById('clockScaleSlider');
        const mScale = document.getElementById('mobileClockScaleSlider');
        const mScaleTxt = document.getElementById('mobileClockScaleTxt');

        syncChronoSheetFn = () => {
            if (origSolar && mSolar && document.activeElement !== mSolar) mSolar.value = origSolar.value;
            if (origSolarTxt && mSolarTxt) mSolarTxt.textContent = origSolarTxt.textContent;
            if (origScale && mScale && mScaleTxt) {
                mScale.value = origScale.value;
                mScaleTxt.textContent = parseFloat(origScale.value).toFixed(2) + '×';
            }
        };

        // 滑桿 RAF 合批節流：120Hz 觸控拖動時每幀最多更新一次
        if (origSolar && mSolar) {
            mSolar.value = origSolar.value;
            let solarRaf = 0;
            mSolar.addEventListener('pointerdown', () => origSolar.dispatchEvent(new PointerEvent('pointerdown')));
            mSolar.addEventListener('input', () => {
                if (solarRaf) return;
                solarRaf = requestAnimationFrame(() => {
                    solarRaf = 0;
                    origSolar.value = mSolar.value;
                    origSolar.dispatchEvent(new Event('input'));
                    if (origSolarTxt && mSolarTxt) mSolarTxt.textContent = origSolarTxt.textContent;
                });
            });
        }

        const mCycleGrid = document.getElementById('mobileCycleGrid');
        if (mCycleGrid) {
            const mPills = mCycleGrid.querySelectorAll('.lg-pill-mini');
            mPills.forEach(mp => {
                mp.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    mp.classList.remove('jelly-pop');
                    void mp.offsetWidth;
                    mp.classList.add('jelly-pop');
                    const sec = mp.getAttribute('data-sec');
                    const match = document.querySelector(`#cycleBtnGrid .chrono-cycle-btn[data-sec="${sec}"]`);
                    if (match) match.click();
                    mPills.forEach(p => p.classList.remove('active'));
                    mp.classList.add('active');
                });
            });
        }

        if (origScale && mScale) {
            mScale.value = origScale.value;
            if (mScaleTxt) mScaleTxt.textContent = parseFloat(origScale.value).toFixed(2) + '×';
            let scaleRaf = 0;
            mScale.addEventListener('input', () => {
                if (scaleRaf) return;
                scaleRaf = requestAnimationFrame(() => {
                    scaleRaf = 0;
                    origScale.value = mScale.value;
                    origScale.dispatchEvent(new Event('input'));
                    if (mScaleTxt) mScaleTxt.textContent = parseFloat(mScale.value).toFixed(2) + '×';
                });
            });
        }

        // 固定功能按鈕全部採用 pointerdown 瞬發觸發 (0ms 延遲)
        const proxyInstant = (mId, origId, afterFn) => {
            const mb = document.getElementById(mId);
            const ob = document.getElementById(origId);
            if (mb && ob) {
                mb.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    mb.classList.remove('jelly-pop');
                    void mb.offsetWidth;
                    mb.classList.add('jelly-pop');
                    ob.click();
                    if (afterFn) afterFn(mb, ob);
                });
            }
        };

        // 預設關閉時鐘 (加上 clock-hidden class)
        let isClockVisible = false;
        if (stage) stage.classList.add('clock-hidden');
        const mClockShowBtn = document.getElementById('mBtnToggleClockShow');
        const mClockShowTxt = document.getElementById('mClockShowTxt');
        const setClockVisible = (v) => {
            isClockVisible = !!v;
            if (stage) stage.classList.toggle('clock-hidden', !isClockVisible);
            if (mClockShowBtn) mClockShowBtn.classList.toggle('active', isClockVisible);
            if (mClockShowTxt) mClockShowTxt.textContent = isClockVisible ? 'ON' : 'OFF';
            if (isClockVisible) schedule();
        };
        if (mClockShowBtn) {
            mClockShowBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                mClockShowBtn.classList.remove('jelly-pop');
                void mClockShowBtn.offsetWidth;
                mClockShowBtn.classList.add('jelly-pop');
                setClockVisible(!isClockVisible);
            });
        }

        proxyInstant('mBtnCycleClock', 'btnCycleClock', () => {
            if (!isClockVisible) setClockVisible(true);
            const lbl = document.getElementById('clockFaceTagMini');
            const mTxt = document.getElementById('mClockFaceTxt');
            if (lbl && mTxt) mTxt.textContent = lbl.textContent.replace(/^\d+\s*/, '');
        });
        proxyInstant('mBtnSolarSweep', 'btnSolarTransition');
        proxyInstant('mBtnGlassShape', 'btnCycleGlassShape', () => {
            if (!isClockVisible) setClockVisible(true);
            const lbl = document.getElementById('glassShapeLabel');
            const mTxt = document.getElementById('mGlassShapeTxt');
            if (lbl && mTxt) mTxt.textContent = lbl.textContent.replace('SHAPE: ', '').split(' ')[0];
        });
        proxyInstant('mBtnResetClock', 'btnResetClockPos', () => {
            if (!isClockVisible) setClockVisible(true);
            if (syncChronoSheetFn) syncChronoSheetFn();
        });

        const origVol = document.getElementById('volumeSlider');
        const mVol = document.getElementById('mobileVolumeSlider');
        const mVolTxt = document.getElementById('mobileVolumeTxt');
        if (origVol && mVol) {
            mVol.value = origVol.value;
            let volRaf = 0;
            mVol.addEventListener('input', () => {
                if (volRaf) return;
                volRaf = requestAnimationFrame(() => {
                    volRaf = 0;
                    origVol.value = mVol.value;
                    origVol.dispatchEvent(new Event('input'));
                    if (mVolTxt) mVolTxt.textContent = Math.round(mVol.value * 100) + '%';
                });
            });
        }

        const mSfxBtn = document.getElementById('mBtnWildlifeSfx');
        const mSfxTxt = document.getElementById('mWildlifeSfxTxt');
        if (mSfxBtn) {
            const syncSfxBtn = (on) => {
                mSfxBtn.classList.toggle('active', !!on);
                if (mSfxTxt) mSfxTxt.textContent = on ? 'ON' : 'OFF';
            };
            if (window.HydroAudio && window.HydroAudio.isSfxEnabled) {
                syncSfxBtn(window.HydroAudio.isSfxEnabled());
            }
            mSfxBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                mSfxBtn.classList.remove('jelly-pop');
                void mSfxBtn.offsetWidth;
                mSfxBtn.classList.add('jelly-pop');
                if (window.HydroAudio && window.HydroAudio.toggleSfx) {
                    const nextOn = window.HydroAudio.toggleSfx();
                    syncSfxBtn(nextOn);
                }
            });
        }

        const mChirpBtn = document.getElementById('mBtnChirpToggle');
        const mChirpTxt = document.getElementById('mChirpStateTxt');
        if (mChirpBtn) {
            const syncChirpBtn = (on) => {
                mChirpBtn.classList.toggle('active', !!on);
                if (mChirpTxt) mChirpTxt.textContent = on ? 'ON' : 'OFF';
            };
            if (window.HydroAudio && window.HydroAudio.isChirpEnabled) {
                syncChirpBtn(window.HydroAudio.isChirpEnabled());
            }
            mChirpBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                mChirpBtn.classList.remove('jelly-pop');
                void mChirpBtn.offsetWidth;
                mChirpBtn.classList.add('jelly-pop');
                if (window.HydroAudio && window.HydroAudio.toggleChirp) {
                    const nextOn = window.HydroAudio.toggleChirp();
                    syncChirpBtn(nextOn);
                }
            });
        }

        proxyInstant('mBtnSpawnKoi', 'btnSpawnFish');
        proxyInstant('mBtnTriggerEco', 'btnTriggerEco');
        proxyInstant('mBtnAudioMute', 'btnAudioToggle', (mb) => {
            const lbl = document.getElementById('audioLabel');
            const mTxt = document.getElementById('mAudioStateTxt');
            const playing = lbl && lbl.textContent.includes('PLAYING');
            mb.classList.toggle('active', !!playing);
            if (mTxt) mTxt.textContent = playing ? 'PLAYING' : 'MUTED';
        });
        proxyInstant('mBtnWaveSpeed', 'btnSpeedToggle', () => {
            const lbl = document.getElementById('speedLabel');
            const mTxt = document.getElementById('mSpeedStateTxt');
            if (lbl && mTxt) mTxt.textContent = lbl.textContent.replace('SPEED: ', '');
        });
        proxyInstant('mBtnToggleGlass', 'btnToggleGlassBlur', (mb, ob) => {
            const on = ob.classList.contains('active');
            mb.classList.toggle('active', on);
            const mTxt = document.getElementById('mGlassOnTxt');
            if (mTxt) mTxt.textContent = on ? 'ON' : 'OFF';
        });

        const mLabBtn = document.getElementById('mBtnOpenGlassLab');
        if (mLabBtn) {
            mLabBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                mLabBtn.classList.remove('jelly-pop');
                void mLabBtn.offsetWidth;
                mLabBtn.classList.add('jelly-pop');
                toggle();
            });
        }
    }

    // 高剛性二階欠阻尼彈簧物理 + 手指拖曳直接跟手耦合 (Direct Finger Tracking)
    function initMobileTabBarPhysics() {
        const track = document.getElementById('iosTabTrack');
        const indicator = document.getElementById('iosSlidingPill');
        const tabs = track ? Array.from(track.querySelectorAll('.ios-tab-item')) : [];
        const sheets = Array.from(document.querySelectorAll('.ios-page-sheet'));
        const actionOrb = document.getElementById('iosActionOrb');
        if (!track || !indicator || !tabs.length) return;

        let activeIndex = 0;
        let currentX = 0;
        let targetX = 0;
        let velocityX = 0;
        let pillWidth = 82;
        let scaleX = 1;
        let scaleY = 1;
        let pressSquish = 0;
        let targetPressSquish = 0;
        let animId = 0;
        let lastTime = 0;
        let isDraggingTab = false;
        let tabCenters = [];
        let minTrackX = 5;
        let maxTrackX = 240;

        function cacheTabMetrics() {
            const tRect = track.getBoundingClientRect();
            tabCenters = tabs.map(btn => {
                const bRect = btn.getBoundingClientRect();
                return {
                    x: bRect.left - tRect.left,
                    w: bRect.width,
                    cx: (bRect.left - tRect.left) + bRect.width / 2
                };
            });
            if (tabCenters.length) {
                pillWidth = tabCenters[0].w;
                minTrackX = tabCenters[0].x;
                maxTrackX = tabCenters[tabCenters.length - 1].x;
                indicator.style.width = pillWidth.toFixed(1) + 'px';
            }
        }

        function setPage(idx, immediate, fromDrag) {
            if (!tabCenters.length) cacheTabMetrics();
            const prevIdx = activeIndex;
            activeIndex = clamp(idx, 0, tabs.length - 1);
            tabs.forEach((btn, i) => btn.classList.toggle('active', i === activeIndex));

            const pageId = tabs[activeIndex].getAttribute('data-page');
            if (pageId === 'chrono' && syncChronoSheetFn) syncChronoSheetFn();

            sheets.forEach(sh => {
                const match = sh.getAttribute('data-page-sheet') === pageId;
                sh.classList.toggle('open', match);
            });
            if (panel && panel.classList.contains('open') && pageId !== 'lab') {
                panel.classList.remove('open');
            }

            const m = tabCenters[activeIndex] || { x: 5, w: 82 };
            targetX = m.x;

            if (!immediate && prevIdx !== activeIndex && !fromDrag) {
                const dir = targetX > currentX ? 1 : -1;
                const dist = Math.abs(targetX - currentX);
                // 瞬發初速度脈衝：點擊第一幀立刻彈射並產生明顯水滴拉伸
                velocityX += dir * Math.min(720, 240 + dist * 2.2);
                pressSquish = 0.26;
            } else if (!immediate && prevIdx === activeIndex && !fromDrag) {
                if (pageId !== 'today') {
                    const targetSheet = sheets.find(sh => sh.getAttribute('data-page-sheet') === pageId);
                    if (targetSheet) targetSheet.classList.toggle('open');
                }
                velocityX += (Math.random() > 0.5 ? 1 : -1) * 140;
                pressSquish = 0.30;
            }

            if (immediate) {
                currentX = targetX;
                velocityX = 0;
                scaleX = 1;
                scaleY = 1;
                renderIndicator();
            } else {
                startLoop();
            }
        }

        function renderIndicator() {
            indicator.style.transform =
                `translate3d(${currentX.toFixed(2)}px, 0, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
        }

        function stepPhysics(now) {
            const dt = Math.min(0.028, Math.max(0.004, (now - lastTime) / 1000));
            lastTime = now;

            // 高剛性二階欠阻尼彈簧 (stiffness=460, damping=24)：起步反應快 60%，且保留一次乾淨俐落的 Q 彈果凍回彈
            const stiffness = isDraggingTab ? 680 : 460;
            const damping = isDraggingTab ? 34 : 24;
            const displacement = currentX - targetX;
            const accel = -stiffness * displacement - damping * velocityX;

            velocityX += accel * dt;
            currentX += velocityX * dt;
            pressSquish += (targetPressSquish - pressSquish) * Math.min(1, dt * 15);

            const speedNorm = clamp(Math.abs(velocityX) / 880, 0, 0.48);
            const brakeSquash = clamp(-displacement * Math.sign(velocityX || 1) * 0.003, -0.15, 0.15);
            const stretch = speedNorm * 0.95 + brakeSquash + pressSquish * 0.22;

            scaleX = clamp(1 + stretch, 0.80, 1.44);
            scaleY = clamp((1 / Math.pow(scaleX, 0.76)) + pressSquish * 0.06, 0.70, 1.22);

            renderIndicator();

            const stillMoving =
                isDraggingTab ||
                Math.abs(displacement) > 0.12 ||
                Math.abs(velocityX) > 1.0 ||
                Math.abs(scaleX - 1) > 0.0025 ||
                Math.abs(pressSquish - targetPressSquish) > 0.004;

            if (stillMoving) {
                animId = requestAnimationFrame(stepPhysics);
            } else {
                currentX = targetX;
                velocityX = 0;
                scaleX = 1;
                scaleY = 1;
                renderIndicator();
                animId = 0;
            }
        }

        function startLoop() {
            if (!animId) {
                lastTime = performance.now();
                animId = requestAnimationFrame(stepPhysics);
            }
        }

        let trackLeft = 0;
        tabs.forEach((btn, idx) => {
            btn.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                if (!tabCenters.length) cacheTabMetrics();
                trackLeft = track.getBoundingClientRect().left;
                isDraggingTab = true;
                targetPressSquish = 0.24;
                setPage(idx, false, false);
            });
        });

        track.addEventListener('pointerdown', (e) => {
            if (!tabCenters.length) cacheTabMetrics();
            trackLeft = track.getBoundingClientRect().left;
            isDraggingTab = true;
            targetPressSquish = 0.24;
            startLoop();
        });

        // 手指在導航列滑動時：橢圓玻璃滑塊直接跟手平滑位移，並在經過按鈕時即時切換分頁
        window.addEventListener('pointermove', (e) => {
            if (!isDraggingTab || !tabCenters.length) return;
            const relX = e.clientX - trackLeft;
            let bestIdx = activeIndex;
            let bestDist = Infinity;
            for (let i = 0; i < tabCenters.length; i++) {
                const d = Math.abs(relX - tabCenters[i].cx);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            if (bestIdx !== activeIndex) {
                setPage(bestIdx, false, true);
            }
            // 讓目標位置混合手指座標與吸附點，實現 0 延遲跟手拖拽感
            const fingerX = clamp(relX - pillWidth / 2, minTrackX - 6, maxTrackX + 6);
            const snapX = tabCenters[activeIndex].x;
            targetX = snapX * 0.45 + fingerX * 0.55;
            startLoop();
        }, { passive: true });

        const endPointer = () => {
            if (targetPressSquish !== 0 || isDraggingTab) {
                isDraggingTab = false;
                targetPressSquish = 0;
                if (tabCenters[activeIndex]) {
                    targetX = tabCenters[activeIndex].x;
                }
                startLoop();
            }
        };
        window.addEventListener('pointerup', endPointer);
        window.addEventListener('pointercancel', endPointer);

        const canvasEl = document.getElementById('canvas');
        if (canvasEl) {
            canvasEl.addEventListener('pointerdown', () => {
                if (activeIndex !== 0) {
                    setPage(0, false, false);
                }
                if (panel && panel.classList.contains('open')) {
                    panel.classList.remove('open');
                }
            });
        }

        // 右側獨立圓形水滴玻璃按鈕：pointerdown 零延遲瞬發躍魚與生態互動
        if (actionOrb) {
            actionOrb.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                actionOrb.classList.remove('jelly-pop');
                void actionOrb.offsetWidth;
                actionOrb.classList.add('jelly-pop');
                const spawnBtn = document.getElementById('btnSpawnFish');
                const ecoBtn = document.getElementById('btnTriggerEco');
                if (spawnBtn) spawnBtn.click();
                if (ecoBtn) ecoBtn.click();
            });
        }

        window.addEventListener('resize', () => {
            cacheTabMetrics();
            setPage(activeIndex, true, false);
        });

        requestAnimationFrame(() => {
            cacheTabMetrics();
            setPage(0, true, false);
        });
    }

    function init() {
        stage = document.getElementById('chronoClockStage');
        if (!stage) return;
        buildSvg();
        buildPanel();
        addButton();
        buildMobileInterface();
        new MutationObserver(schedule).observe(stage, { attributes: true, attributeFilter: ['class'] });
        if (window.ResizeObserver) new ResizeObserver(schedule).observe(stage);
        window.addEventListener('resize', schedule);
        window.addEventListener('keydown', e => {
            const t = e.target; if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
            if (e.key.toLowerCase() === 'l') toggle();
        });
        apply();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* ==========================================================================
 * glass.js — iOS 26 風格 Liquid Glass 時鐘玻璃 + 手機底部液態導航列與物理彈性膠囊
 *  - 10 種折射/扭曲效果 (以 canvas 即時生成位移貼圖 -> SVG feDisplacementMap)
 *  - 預設磨砂 = 0 (純光學凸透鏡折射 + RGB 稜鏡色散，不模糊)
 *  - 介面按鈕與底部導航全面採用預設同款 Liquid Glass (磨砂=0)
 *  - 點擊不同 Page 時，高通透且周圍有強折射效果的橢圓形玻璃在按鈕上移動，並模擬二階彈簧物理擠壓變形 (Q彈果凍觀感)
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
    let pillFeImg, pillDR, pillDG, pillDB;
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
            // iOS 26 底部導航移動橢圓膠囊專用：高通透中心 + 周圍強折射與色散濾鏡
            '<filter id="iosPillLensFilter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB" filterUnits="objectBoundingBox">' +
            '<feImage id="pillLensImg" x="0" y="0" width="128" height="68" preserveAspectRatio="none" result="pmap"/>' +
            '<feDisplacementMap id="pillDR" in="SourceGraphic" in2="pmap" scale="46" xChannelSelector="R" yChannelSelector="G" result="pdr"/>' +
            '<feColorMatrix in="pdr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="pcr"/>' +
            '<feDisplacementMap id="pillDG" in="SourceGraphic" in2="pmap" scale="56" xChannelSelector="R" yChannelSelector="G" result="pdg"/>' +
            '<feColorMatrix in="pdg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="pcg"/>' +
            '<feDisplacementMap id="pillDB" in="SourceGraphic" in2="pmap" scale="66" xChannelSelector="R" yChannelSelector="G" result="pdb"/>' +
            '<feColorMatrix in="pdb" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="pcb"/>' +
            '<feBlend in="pcr" in2="pcg" mode="screen" result="prg"/>' +
            '<feBlend in="prg" in2="pcb" mode="screen"/>' +
            '</filter>';
        document.body.appendChild(svg);
        feImg = svg.querySelector('#lgImg'); dR = svg.querySelector('#lgDR'); dG = svg.querySelector('#lgDG'); dB = svg.querySelector('#lgDB');
        pillFeImg = svg.querySelector('#pillLensImg'); pillDR = svg.querySelector('#pillDR'); pillDG = svg.querySelector('#pillDG'); pillDB = svg.querySelector('#pillDB');
        buildPillLensMap(128, 68);
    }

    // 為 iOS 26 移動橢圓膠囊生成「中心完全高通透、周圍橢圓邊緣強烈凸透鏡折射」的位移貼圖
    function buildPillLensMap(w, h) {
        if (!pillFeImg) return;
        cv.width = w; cv.height = h;
        const g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data;
        const hw = w / 2, hh = h / 2, R = hh, bz = hh * 0.65;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            const px = i + 0.5 - hw, py = j + 0.5 - hh;
            const qx = Math.abs(px) - (hw - R), qy = Math.abs(py) - (hh - R);
            const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
            const sd = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - R;
            let nx = 0, ny = 0;
            if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = Math.sign(px) * qx / l; ny = Math.sign(py) * qy / l; }
            else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
            const depth = clamp(-sd / bz, 0, 1);
            // 中心高通透無扭曲，周圍橢圓邊緣產生強烈水滴凸透鏡折射
            const m = Math.pow(1 - depth, 2.15);
            const oxVal = -nx * m;
            const oyVal = -ny * m;
            const k = (j * w + i) * 4;
            d[k] = clamp(128 + 127 * oxVal, 0, 255);
            d[k + 1] = clamp(128 + 127 * oyVal, 0, 255);
            d[k + 2] = 128; d[k + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        const url = cv.toDataURL('image/png');
        pillFeImg.setAttribute('width', w); pillFeImg.setAttribute('height', h);
        pillFeImg.setAttribute('href', url);
        pillFeImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
    }

    // 圓角矩形 SDF 位移貼圖
    function renderMap(w, h) {
        const S = Math.max(1, Math.min(1, 220 / Math.max(w, h)));
        const cw = Math.max(8, Math.round(w * S)), ch = Math.max(8, Math.round(h * S));
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
        return cv.toDataURL('image/png');
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
        const bf = 'url(#lgFilter) blur(' + P.frost + 'px) saturate(' + P.sat + '%) brightness(' + P.bright + '%)';

        // 同步更新全域所有按鈕與膠囊的同款 Liquid Glass 濾鏡 (預設磨砂=0)
        document.documentElement.style.setProperty('--lg-global-filter', bf);
        const pillBf = 'url(#iosPillLensFilter) blur(' + P.frost + 'px) saturate(' + Math.min(220, P.sat + 15) + '%) brightness(' + (P.bright + 3) + '%)';
        document.documentElement.style.setProperty('--lg-pill-filter', pillBf);

        if (!on) {
            props.forEach(p => stage.style.removeProperty(p));
            return;
        }
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
            'background:linear-gradient(135deg,rgba(255,255,255,0.10) 0%,rgba(255,255,255,0.025) 45%,rgba(0,0,0,0.16) 100%);' +
            'backdrop-filter:var(--lg-global-filter, url(#lgFilter) blur(0px) saturate(170%) brightness(105%));' +
            '-webkit-backdrop-filter:var(--lg-global-filter, url(#lgFilter) blur(0px) saturate(170%) brightness(105%));' +
            'box-shadow:inset 1.5px 2px 2px rgba(255,255,255,0.88),inset -1.5px -2px 2px rgba(var(--chrono-rgb,82,229,155),0.4),0 24px 60px rgba(0,0,0,0.65);' +
            'border:1.5px solid rgba(255,255,255,0.52);color:var(--chrono-text,#e2e8f0);font:11px/1.4 inherit;font-family:inherit;display:none;letter-spacing:1px}' +
            '#glassLab.open{display:block}#glassLab h4{margin:0 0 8px;font-size:12px;color:var(--chrono-pink,#52e59b);display:flex;justify-content:space-between;text-shadow:0 1px 4px rgba(0,0,0,0.85)}' +
            '#glassLab .fxg{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}' +
            '#glassLab .fxg button{font:inherit;font-size:10px;padding:8px 8px;border-radius:14px;border:1px solid rgba(255,255,255,.38);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;text-align:left;box-shadow:inset 1px 1px 1.5px rgba(255,255,255,0.65);text-shadow:0 1px 3px rgba(0,0,0,0.85)}' +
            '#glassLab .fxg button.on{background:rgba(var(--chrono-rgb,82,229,155),.28);border-color:var(--chrono-pink,#52e59b);color:var(--chrono-pink,#52e59b);font-weight:700}' +
            '#glassLab label{display:flex;justify-content:space-between;margin-top:7px;font-size:10.5px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.85)}#glassLab input[type=range]{width:100%;accent-color:var(--chrono-pink,#52e59b)}' +
            '#glassLab .rb{margin-top:10px;width:100%;font:inherit;padding:9px;border-radius:16px;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.10);color:#fff;cursor:pointer;box-shadow:inset 1px 1.5px 2px rgba(255,255,255,0.75);text-shadow:0 1px 3px rgba(0,0,0,0.85);font-weight:700}';
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

        panel.querySelectorAll('[data-fx]').forEach(b => b.addEventListener('click', () => { P.fx = +b.dataset.fx; sync(); save(); schedule(); }));
        panel.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => { P[inp.dataset.k] = parseFloat(inp.value); sync(); save(); schedule(); }));
        panel.querySelector('#glReset').addEventListener('click', () => { P = Object.assign({}, DEF); sync(); save(); schedule(); });
        panel.querySelector('#glClose').addEventListener('click', toggle);
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
    // iOS 26 手機操作介面 (Mobile Interface + 同款磨砂=0 液態玻璃按鈕 + 物理擠壓Q彈滑塊)
    // =========================================================================
    function buildMobileInterface() {
        const st = document.createElement('style');
        st.textContent = `
            :root {
                --lg-global-filter: url(#lgFilter) blur(0px) saturate(170%) brightness(105%);
                --lg-pill-filter: url(#iosPillLensFilter) blur(0px) saturate(185%) brightness(108%);
            }

            /* 隱藏舊式桌面側邊欄，全面改用 iOS 26 手機懸浮液態玻璃介面 */
            .chrono-hud,
            .scene-selector-hud,
            .hud-toggle-btn,
            .bottom-hint {
                display: none !important;
            }

            /* 頂部靈動狀態膠囊 (同款 Liquid Glass 磨砂=0) */
            .status-hud {
                position: fixed !important;
                top: max(14px, env(safe-area-inset-top, 14px)) !important;
                left: 50% !important;
                right: auto !important;
                transform: translateX(-50%) !important;
                opacity: 1 !important;
                display: flex !important;
                align-items: center;
                gap: 14px;
                padding: 8px 20px !important;
                border-radius: 999px !important;
                clip-path: none !important;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 45%, rgba(0, 0, 0, 0.14) 100%) !important;
                backdrop-filter: var(--lg-global-filter) !important;
                -webkit-backdrop-filter: var(--lg-global-filter) !important;
                border: 1.2px solid rgba(255, 255, 255, 0.52) !important;
                box-shadow:
                    inset 1px 1.5px 1.5px rgba(255, 255, 255, 0.88),
                    inset -1px -1.5px 1.5px rgba(var(--chrono-rgb, 82, 229, 155), 0.38),
                    0 10px 28px rgba(0, 0, 0, 0.42) !important;
                font-size: 10.5px !important;
                white-space: nowrap;
                z-index: 120 !important;
            }
            .status-hud > div:nth-child(n+3) {
                display: none !important;
            }

            /* 介面所有按鈕全部套用預設同款 Liquid Glass (磨砂=0 + 邊緣凸透鏡折射 + 菲涅爾高光) */
            .lg-btn {
                position: relative;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.11) 0%, rgba(255, 255, 255, 0.025) 45%, rgba(0, 0, 0, 0.12) 100%);
                backdrop-filter: var(--lg-global-filter);
                -webkit-backdrop-filter: var(--lg-global-filter);
                border: 1.2px solid rgba(255, 255, 255, 0.48);
                border-radius: 22px;
                color: var(--chrono-white, #ffffff);
                font-family: inherit;
                font-size: 12px;
                letter-spacing: 1.4px;
                padding: 12px 15px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                box-shadow:
                    inset 1px 1.5px 1.8px rgba(255, 255, 255, 0.86),
                    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
                    inset -1px -1.5px 2px rgba(var(--chrono-rgb, 82, 229, 155), 0.36),
                    0 8px 22px rgba(0, 0, 0, 0.34);
                text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
                transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.25s ease, box-shadow 0.25s ease, color 0.25s ease;
                overflow: hidden;
            }
            .lg-btn::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; height: 42%;
                background: linear-gradient(165deg, rgba(255, 255, 255, 0.20) 0%, rgba(255, 255, 255, 0) 75%);
                pointer-events: none;
            }
            .lg-btn:active {
                transform: scale(0.93, 0.96);
            }
            .lg-btn.active {
                border-color: var(--chrono-pink);
                color: var(--chrono-pink);
                font-weight: 700;
                box-shadow:
                    inset 1.5px 2px 2.2px rgba(255, 255, 255, 0.95),
                    inset 0 0 14px rgba(var(--chrono-rgb, 82, 229, 155), 0.34),
                    0 8px 24px rgba(0, 0, 0, 0.45),
                    0 0 16px rgba(var(--chrono-rgb, 82, 229, 155), 0.32);
            }
            .lg-btn .sub-tag {
                font-size: 10px;
                color: var(--chrono-pink);
                opacity: 0.95;
                font-weight: 700;
            }

            @keyframes jellyPopAnim {
                0%   { transform: scale(1, 1); }
                28%  { transform: scale(1.15, 0.85); }
                55%  { transform: scale(0.91, 1.09); }
                76%  { transform: scale(1.04, 0.97); }
                100% { transform: scale(1, 1); }
            }
            .jelly-pop {
                animation: jellyPopAnim 0.46s cubic-bezier(0.25, 1, 0.5, 1);
            }

            /* 手機分頁上彈卡片 (Page Sheets: 預設同款 Liquid Glass 磨砂=0) */
            .ios-page-sheet {
                position: fixed;
                left: 50%;
                bottom: calc(98px + env(safe-area-inset-bottom, 0px));
                transform: translate3d(-50%, 28px, 0) scale(0.94);
                width: min(92vw, 430px);
                max-height: 55vh;
                overflow-y: auto;
                scrollbar-width: none;
                padding: 16px 18px 18px 18px;
                border-radius: 34px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.085) 0%, rgba(255, 255, 255, 0.02) 42%, rgba(0, 0, 0, 0.15) 100%);
                backdrop-filter: var(--lg-global-filter);
                -webkit-backdrop-filter: var(--lg-global-filter);
                border: 1.5px solid rgba(255, 255, 255, 0.54);
                box-shadow:
                    inset 1.5px 2px 2px rgba(255, 255, 255, 0.88),
                    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
                    inset -1.5px -2px 2px rgba(255, 255, 255, 0.42),
                    inset 0 -8px 18px -6px rgba(var(--chrono-rgb, 82, 229, 155), 0.38),
                    0 24px 60px rgba(0, 0, 0, 0.55),
                    0 0 28px rgba(var(--chrono-rgb, 82, 229, 155), 0.22);
                z-index: 210;
                opacity: 0;
                pointer-events: none;
                transition:
                    transform 0.42s cubic-bezier(0.22, 1.35, 0.36, 1),
                    opacity 0.25s ease;
            }
            .ios-page-sheet::-webkit-scrollbar { display: none; }
            .ios-page-sheet.open {
                transform: translate3d(-50%, 0, 0) scale(1);
                opacity: 1;
                pointer-events: auto;
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

            /* 液態玻璃滑桿膠囊盒 (同款磨砂=0) */
            .lg-slider-card {
                padding: 11px 15px;
                border-radius: 22px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.09) 0%, rgba(0, 0, 0, 0.14) 100%);
                backdrop-filter: var(--lg-global-filter);
                -webkit-backdrop-filter: var(--lg-global-filter);
                border: 1px solid rgba(255, 255, 255, 0.42);
                box-shadow: inset 1px 1.5px 1.5px rgba(255, 255, 255, 0.72);
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
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, rgba(0, 0, 0, 0.12) 100%);
                backdrop-filter: var(--lg-global-filter);
                -webkit-backdrop-filter: var(--lg-global-filter);
                border: 1px solid rgba(255, 255, 255, 0.40);
                box-shadow: inset 0 1px 1.5px rgba(255, 255, 255, 0.72);
                cursor: pointer;
                text-align: center;
                text-shadow: 0 1px 3px rgba(0,0,0,0.85);
                transition: all 0.2s ease;
            }
            .lg-pill-mini.active {
                border-color: var(--chrono-pink);
                color: var(--chrono-pink);
                background: rgba(var(--chrono-rgb, 82, 229, 155), 0.24);
                font-weight: 700;
                box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.92), 0 0 12px var(--chrono-pink-glow);
            }

            /* ==================== 截圖同款 iOS 26 底部懸浮導航列 ==================== */
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

            /* 左側 4-Page 膠囊玻璃底座 (預設同款 Liquid Glass 磨砂=0) */
            .ios-tab-capsule {
                position: relative;
                flex: 1;
                height: 68px;
                padding: 5px;
                border-radius: 999px;
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                align-items: center;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 45%, rgba(0, 0, 0, 0.14) 100%);
                backdrop-filter: var(--lg-global-filter);
                -webkit-backdrop-filter: var(--lg-global-filter);
                border: 1.5px solid rgba(255, 255, 255, 0.50);
                box-shadow:
                    inset 1px 2px 2px rgba(255, 255, 255, 0.85),
                    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
                    inset -1px -2px 2px rgba(255, 255, 255, 0.42),
                    inset 0 -6px 14px -6px rgba(var(--chrono-rgb, 82, 229, 155), 0.35),
                    0 18px 45px rgba(0, 0, 0, 0.52),
                    0 0 24px rgba(var(--chrono-rgb, 82, 229, 155), 0.20);
                touch-action: none;
            }

            /* 在按鈕上方移動的「高通透 + 周圍強折射與色散」橢圓形液態玻璃滑塊 */
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
                will-change: transform, width;
                /* 中心極高通透，周圍橢圓邊緣具有凸透鏡折射與菲涅爾高光 */
                background: radial-gradient(
                    100% 100% at 50% 50%,
                    rgba(255, 255, 255, 0.02) 0%,
                    rgba(255, 255, 255, 0.06) 60%,
                    rgba(255, 255, 255, 0.22) 86%,
                    rgba(255, 255, 255, 0.42) 100%
                );
                backdrop-filter: var(--lg-pill-filter);
                -webkit-backdrop-filter: var(--lg-pill-filter);
                border: 1.5px solid rgba(255, 255, 255, 0.88);
                box-shadow:
                    /* 頂部與底部銳利凸透鏡邊緣折射高光 */
                    inset 1.5px 2.5px 2.5px rgba(255, 255, 255, 1),
                    inset -1.5px -2.5px 3px rgba(255, 255, 255, 0.7),
                    /* 橢圓周圍稜鏡色散光圈 (紅青色差 + 主題色折射) */
                    inset 3.5px 0 9px rgba(255, 105, 155, 0.34),
                    inset -3.5px 0 9px rgba(75, 210, 255, 0.40),
                    inset 0 0 16px rgba(var(--chrono-rgb, 82, 229, 155), 0.28),
                    0 6px 20px rgba(0, 0, 0, 0.34),
                    0 0 18px rgba(var(--chrono-rgb, 82, 229, 155), 0.30);
            }
            /* 橢圓玻璃頂部水滴高光弧 */
            .ios-sliding-pill::before {
                content: '';
                position: absolute;
                top: 2px;
                left: 14%;
                right: 14%;
                height: 35%;
                border-radius: 999px;
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.52) 0%, rgba(255, 255, 255, 0) 100%);
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
                gap: 3px;
                cursor: pointer;
                font-family: inherit;
                padding: 0;
                transition: color 0.22s ease, transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
                text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
            }
            .ios-tab-item svg {
                width: 22px;
                height: 22px;
                stroke: currentColor;
                fill: none;
                stroke-width: 1.9;
                stroke-linecap: round;
                stroke-linejoin: round;
                filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.65));
                transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), stroke 0.22s ease;
            }
            .ios-tab-item span {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.7px;
            }
            .ios-tab-item.active {
                color: var(--chrono-pink);
                text-shadow: 0 0 12px var(--chrono-pink-glow), 0 1px 3px rgba(0, 0, 0, 0.9);
            }
            .ios-tab-item.active svg {
                transform: translateY(-1px) scale(1.08);
                filter: drop-shadow(0 0 8px var(--chrono-pink-glow));
            }

            /* 右側獨立圓形液態玻璃按鈕 (完全還原截圖右側獨立圓形按鈕，磨砂=0) */
            .ios-action-orb {
                width: 66px;
                height: 66px;
                flex-shrink: 0;
                border-radius: 50%;
                background: radial-gradient(
                    100% 100% at 50% 50%,
                    rgba(255, 255, 255, 0.04) 0%,
                    rgba(255, 255, 255, 0.09) 62%,
                    rgba(255, 255, 255, 0.28) 100%
                );
                backdrop-filter: var(--lg-pill-filter);
                -webkit-backdrop-filter: var(--lg-pill-filter);
                border: 1.5px solid rgba(255, 255, 255, 0.74);
                color: var(--chrono-white, #ffffff);
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow:
                    inset 1.5px 2px 2.5px rgba(255, 255, 255, 0.95),
                    inset -1.5px -2px 2.5px rgba(var(--chrono-rgb, 82, 229, 155), 0.45),
                    inset 3px 0 8px rgba(255, 110, 155, 0.26),
                    inset -3px 0 8px rgba(80, 210, 255, 0.32),
                    0 18px 42px rgba(0, 0, 0, 0.52),
                    0 0 20px rgba(var(--chrono-rgb, 82, 229, 155), 0.25);
                transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.25s ease;
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
                width: 25px;
                height: 25px;
                stroke: var(--chrono-pink);
                fill: none;
                stroke-width: 2.1;
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
            <!-- Page 2: SCENES 水境場景選擇抽屜 -->
            <div class="ios-page-sheet" data-page-sheet="scenes">
                <div class="sheet-pill-handle"></div>
                <div class="sheet-header">
                    <span class="sheet-title">WATER ARCHIVES // 水境場景</span>
                    <span class="sheet-badge">7 SCENES</span>
                </div>
                <div class="sheet-scene-list" id="mobileSceneList"></div>
            </div>

            <!-- Page 3: CHRONO & SOLAR 時鐘與天象控制抽屜 -->
            <div class="ios-page-sheet" data-page-sheet="chrono">
                <div class="sheet-pill-handle"></div>
                <div class="sheet-header">
                    <span class="sheet-title">CHRONO &amp; SOLAR // 時鐘與天象</span>
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

            <!-- Page 4: ARCADE / LAB 生態互動、音效與光學調校抽屜 -->
            <div class="ios-page-sheet" data-page-sheet="lab">
                <div class="sheet-pill-handle"></div>
                <div class="sheet-header">
                    <span class="sheet-title">ECOLOGY &amp; LAB // 生態與光學</span>
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
                    <button type="button" class="lg-btn" id="mBtnSpawnKoi">
                        <span>錦鯉躍水</span>
                        <span class="sub-tag">KOI 🐟</span>
                    </button>
                    <button type="button" class="lg-btn" id="mBtnTriggerEco">
                        <span>驚動生態</span>
                        <span class="sub-tag">ECO 🐸</span>
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
                        <span class="sub-tag">LAB ⚙</span>
                    </button>
                </div>
            </div>

            <!-- iOS 26 底部懸浮導航列 (完全仿照參考圖：左側 4-Page 膠囊 + 高通透周圍折射 Q彈橢圓滑塊 + 右側獨立圓鈕) -->
            <nav class="ios-bottom-dock" aria-label="iOS 26 Liquid Glass Navigation">
                <div class="ios-tab-capsule" id="iosTabTrack">
                    <!-- 在按鈕上方移動的高通透 + 周圍強折射橢圓形液態玻璃滑塊 -->
                    <div class="ios-sliding-pill" id="iosSlidingPill"></div>

                    <button type="button" class="ios-tab-item active" data-page="today">
                        <svg viewBox="0 0 24 24">
                            <rect x="4" y="3" width="16" height="18" rx="3"></rect>
                            <line x1="8" y1="8" x2="16" y2="8"></line>
                            <rect x="8" y="12" width="8" height="5" rx="1"></rect>
                        </svg>
                        <span>Today</span>
                    </button>

                    <button type="button" class="ios-tab-item" data-page="scenes">
                        <svg viewBox="0 0 24 24">
                            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
                        </svg>
                        <span>Scenes</span>
                    </button>

                    <button type="button" class="ios-tab-item" data-page="chrono">
                        <svg viewBox="0 0 24 24">
                            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                            <polyline points="2 12 12 17 22 12"></polyline>
                            <polyline points="2 17 12 22 22 17"></polyline>
                        </svg>
                        <span>Apps</span>
                    </button>

                    <button type="button" class="ios-tab-item" data-page="lab">
                        <svg viewBox="0 0 24 24">
                            <line x1="12" y1="3" x2="12" y2="12"></line>
                            <circle cx="12" cy="3" r="1.5"></circle>
                            <path d="M5 12h14l2 5-9 4-9-4 2-5z"></path>
                        </svg>
                        <span>Arcade</span>
                    </button>
                </div>

                <!-- 右側獨立圓形液態玻璃按鈕 (點擊立即激發錦鯉躍水與水波互動) -->
                <button type="button" class="ios-action-orb" id="iosActionOrb" title="觸發錦鯉躍水與生態互動">
                    <svg viewBox="0 0 24 24">
                        <circle cx="11" cy="11" r="7"></circle>
                        <line x1="16.5" y1="16.5" x2="21" y2="21"></line>
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

    // 同步手機面板與原有 engine.js 控制項
    function bindMobileControls() {
        // 1. 生成 7 個場景液態玻璃按鈕
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
                mb.addEventListener('click', () => {
                    ob.click();
                    document.querySelectorAll('.m-scene-btn').forEach((b, k) => b.classList.toggle('active', k === idx));
                });
                mSceneList.appendChild(mb);
            });
        }

        // 2. 日照拉桿與週期按鈕同步
        const origSolar = document.getElementById('solarSlider');
        const mSolar = document.getElementById('mobileSolarSlider');
        const origSolarTxt = document.getElementById('solarTimeValue');
        const mSolarTxt = document.getElementById('mobileSolarTimeTxt');
        if (origSolar && mSolar) {
            mSolar.value = origSolar.value;
            mSolar.addEventListener('pointerdown', () => origSolar.dispatchEvent(new PointerEvent('pointerdown')));
            mSolar.addEventListener('input', () => {
                origSolar.value = mSolar.value;
                origSolar.dispatchEvent(new Event('input'));
                if (origSolarTxt && mSolarTxt) mSolarTxt.textContent = origSolarTxt.textContent;
            });
            // 定期同步自動推進的日照時間顯示
            setInterval(() => {
                if (document.activeElement !== mSolar) mSolar.value = origSolar.value;
                if (origSolarTxt && mSolarTxt) mSolarTxt.textContent = origSolarTxt.textContent;
            }, 200);
        }

        const mCycleGrid = document.getElementById('mobileCycleGrid');
        if (mCycleGrid) {
            const mPills = mCycleGrid.querySelectorAll('.lg-pill-mini');
            mPills.forEach(mp => {
                mp.addEventListener('click', () => {
                    const sec = mp.getAttribute('data-sec');
                    const match = document.querySelector(`#cycleBtnGrid .chrono-cycle-btn[data-sec="${sec}"]`);
                    if (match) match.click();
                    mPills.forEach(p => p.classList.remove('active'));
                    mp.classList.add('active');
                });
            });
        }

        // 3. 時鐘縮放拉桿與按鈕
        const origScale = document.getElementById('clockScaleSlider');
        const mScale = document.getElementById('mobileClockScaleSlider');
        const mScaleTxt = document.getElementById('mobileClockScaleTxt');
        if (origScale && mScale) {
            mScale.value = origScale.value;
            if (mScaleTxt) mScaleTxt.textContent = parseFloat(origScale.value).toFixed(2) + '×';
            mScale.addEventListener('input', () => {
                origScale.value = mScale.value;
                origScale.dispatchEvent(new Event('input'));
                if (mScaleTxt) mScaleTxt.textContent = parseFloat(mScale.value).toFixed(2) + '×';
            });
        }

        const proxyClick = (mId, origId, afterFn) => {
            const mb = document.getElementById(mId);
            const ob = document.getElementById(origId);
            if (mb && ob) {
                mb.addEventListener('click', () => {
                    ob.click();
                    if (afterFn) afterFn(mb, ob);
                });
            }
        };

        proxyClick('mBtnCycleClock', 'btnCycleClock', () => {
            const lbl = document.getElementById('clockFaceTagMini');
            const mTxt = document.getElementById('mClockFaceTxt');
            if (lbl && mTxt) mTxt.textContent = lbl.textContent.replace(/^\d+\s*/, '');
        });
        proxyClick('mBtnSolarSweep', 'btnSolarTransition');
        proxyClick('mBtnGlassShape', 'btnCycleGlassShape', () => {
            const lbl = document.getElementById('glassShapeLabel');
            const mTxt = document.getElementById('mGlassShapeTxt');
            if (lbl && mTxt) mTxt.textContent = lbl.textContent.replace('SHAPE: ', '').split(' ')[0];
        });
        proxyClick('mBtnResetClock', 'btnResetClockPos', () => {
            if (origScale && mScale && mScaleTxt) {
                mScale.value = origScale.value;
                mScaleTxt.textContent = parseFloat(origScale.value).toFixed(2) + '×';
            }
        });

        // 4. 生態與音效控制
        const origVol = document.getElementById('volumeSlider');
        const mVol = document.getElementById('mobileVolumeSlider');
        const mVolTxt = document.getElementById('mobileVolumeTxt');
        if (origVol && mVol) {
            mVol.value = origVol.value;
            mVol.addEventListener('input', () => {
                origVol.value = mVol.value;
                origVol.dispatchEvent(new Event('input'));
                if (mVolTxt) mVolTxt.textContent = Math.round(mVol.value * 100) + '%';
            });
        }

        proxyClick('mBtnSpawnKoi', 'btnSpawnFish');
        proxyClick('mBtnTriggerEco', 'btnTriggerEco');
        proxyClick('mBtnAudioMute', 'btnAudioToggle', (mb) => {
            const lbl = document.getElementById('audioLabel');
            const mTxt = document.getElementById('mAudioStateTxt');
            const playing = lbl && lbl.textContent.includes('PLAYING');
            mb.classList.toggle('active', !!playing);
            if (mTxt) mTxt.textContent = playing ? 'PLAYING' : 'MUTED';
        });
        proxyClick('mBtnWaveSpeed', 'btnSpeedToggle', () => {
            const lbl = document.getElementById('speedLabel');
            const mTxt = document.getElementById('mSpeedStateTxt');
            if (lbl && mTxt) mTxt.textContent = lbl.textContent.replace('SPEED: ', '');
        });
        proxyClick('mBtnToggleGlass', 'btnToggleGlassBlur', (mb, ob) => {
            const on = ob.classList.contains('active');
            mb.classList.toggle('active', on);
            const mTxt = document.getElementById('mGlassOnTxt');
            if (mTxt) mTxt.textContent = on ? 'ON' : 'OFF';
        });

        const mLabBtn = document.getElementById('mBtnOpenGlassLab');
        if (mLabBtn) {
            mLabBtn.addEventListener('click', () => {
                toggle();
            });
        }
    }

    // 二階欠阻尼彈簧物理：控制高通透折射橢圓形玻璃在導航按鈕上移動並產生 Q 彈擠壓拉伸變形
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
        let pillWidth = 80;
        let targetWidth = 80;
        let scaleX = 1;
        let scaleY = 1;
        let pressSquish = 0;
        let targetPressSquish = 0;
        let animId = 0;
        let lastTime = 0;
        let isDraggingTab = false;

        function measureTab(idx) {
            const btn = tabs[idx];
            if (!btn) return { x: 5, w: 80 };
            const tRect = track.getBoundingClientRect();
            const bRect = btn.getBoundingClientRect();
            return {
                x: bRect.left - tRect.left,
                w: bRect.width
            };
        }

        function setPage(idx, immediate, fromDrag) {
            const prevIdx = activeIndex;
            activeIndex = clamp(idx, 0, tabs.length - 1);
            tabs.forEach((btn, i) => btn.classList.toggle('active', i === activeIndex));

            const pageId = tabs[activeIndex].getAttribute('data-page');
            sheets.forEach(sh => {
                const match = sh.getAttribute('data-page-sheet') === pageId;
                sh.classList.toggle('open', match);
            });
            // 切換分頁時若打開了 GlassLab 面板則自動收起以免重疊
            if (panel && panel.classList.contains('open') && pageId !== 'lab') {
                panel.classList.remove('open');
            }

            const m = measureTab(activeIndex);
            targetX = m.x;
            targetWidth = m.w;

            // 點擊不同 Page 時注入初速度脈衝，觸發明顯的液態水滴拉伸與果凍回彈
            if (!immediate && prevIdx !== activeIndex && !fromDrag) {
                const dir = targetX > currentX ? 1 : -1;
                const dist = Math.abs(targetX - currentX);
                velocityX += dir * Math.min(540, 165 + dist * 1.75);
                pressSquish = 0.24;
            } else if (!immediate && prevIdx === activeIndex && !fromDrag) {
                // 點擊當前已選中的 Page：如果抽屜開著可切換收合，並觸發原地 Q彈果凍擠壓
                if (pageId !== 'today') {
                    const targetSheet = sheets.find(sh => sh.getAttribute('data-page-sheet') === pageId);
                    if (targetSheet) targetSheet.classList.toggle('open');
                }
                velocityX += (Math.random() > 0.5 ? 1 : -1) * 110;
                pressSquish = 0.28;
            }

            if (immediate) {
                currentX = targetX;
                pillWidth = targetWidth;
                velocityX = 0;
                scaleX = 1;
                scaleY = 1;
                renderIndicator();
            } else {
                startLoop();
            }
        }

        function renderIndicator() {
            indicator.style.width = pillWidth.toFixed(1) + 'px';
            indicator.style.transform =
                `translate3d(${currentX.toFixed(2)}px, 0, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
        }

        function stepPhysics(now) {
            const dt = Math.min(0.032, Math.max(0.004, (now - lastTime) / 1000));
            lastTime = now;

            // 二階欠阻尼彈簧物理 (Stiffness = 285, Damping = 17.5 -> 呈現 Q 彈過衝與果凍震盪)
            const stiffness = 285;
            const damping = 17.5;
            const displacement = currentX - targetX;
            const accel = -stiffness * displacement - damping * velocityX;

            velocityX += accel * dt;
            currentX += velocityX * dt;

            pillWidth += (targetWidth - pillWidth) * Math.min(1, dt * 16);
            pressSquish += (targetPressSquish - pressSquish) * Math.min(1, dt * 12);

            // 物理擠壓變形 (Squash & Stretch)：移動速度越快，橢圓水平拉伸越明顯、垂直擠壓變扁；抵達終點時反向回彈
            const speedNorm = clamp(Math.abs(velocityX) / 820, 0, 0.46);
            const brakeSquash = clamp(-displacement * Math.sign(velocityX || 1) * 0.0026, -0.14, 0.14);
            const stretch = speedNorm * 0.92 + brakeSquash + pressSquish * 0.20;

            scaleX = clamp(1 + stretch, 0.82, 1.42);
            // 保持液態水滴面積近似守恆：水平拉長時垂直壓扁，按壓時微幅外擴 Q 彈
            scaleY = clamp((1 / Math.pow(scaleX, 0.76)) + pressSquish * 0.06, 0.72, 1.20);

            // 移動過程中動態增強橢圓周圍的透鏡折射與色散
            if (pillDG && pillDR && pillDB) {
                const dynScale = Math.max(28, P.refract * 0.92) * (1 + speedNorm * 0.95);
                pillDR.setAttribute('scale', (dynScale * (1 - P.disp)).toFixed(1));
                pillDG.setAttribute('scale', dynScale.toFixed(1));
                pillDB.setAttribute('scale', (dynScale * (1 + P.disp)).toFixed(1));
            }

            renderIndicator();

            const stillMoving =
                Math.abs(displacement) > 0.12 ||
                Math.abs(velocityX) > 1.0 ||
                Math.abs(scaleX - 1) > 0.0025 ||
                Math.abs(pressSquish - targetPressSquish) > 0.004;

            if (stillMoving) {
                animId = requestAnimationFrame(stepPhysics);
            } else {
                currentX = targetX;
                pillWidth = targetWidth;
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

        tabs.forEach((btn, idx) => {
            btn.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                targetPressSquish = 0.22;
                setPage(idx, false, false);
            });
        });

        track.addEventListener('pointerdown', () => {
            isDraggingTab = true;
            targetPressSquish = 0.24;
            startLoop();
        });

        window.addEventListener('pointermove', (e) => {
            if (!isDraggingTab) return;
            const tRect = track.getBoundingClientRect();
            const relX = e.clientX - tRect.left;
            let bestIdx = activeIndex;
            let bestDist = Infinity;
            tabs.forEach((btn, i) => {
                const r = btn.getBoundingClientRect();
                const cx = (r.left - tRect.left) + r.width / 2;
                const d = Math.abs(relX - cx);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            });
            if (bestIdx !== activeIndex) {
                setPage(bestIdx, false, true);
            }
        });

        const endPointer = () => {
            if (targetPressSquish !== 0 || isDraggingTab) {
                isDraggingTab = false;
                targetPressSquish = 0;
                startLoop();
            }
        };
        window.addEventListener('pointerup', endPointer);
        window.addEventListener('pointercancel', endPointer);

        // 點擊畫布空白處時自動回到 Today 純淨觀景頁 (收起抽屜並讓橢圓玻璃彈回 Today)
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

        // 右側獨立圓形玻璃按鈕：點擊觸發躍魚 + 生態互動 + 果凍 Q 彈動畫
        if (actionOrb) {
            actionOrb.addEventListener('click', (e) => {
                e.stopPropagation();
                actionOrb.classList.remove('jelly-pop');
                void actionOrb.offsetWidth;
                actionOrb.classList.add('jelly-pop');
                const spawnBtn = document.getElementById('btnSpawnFish');
                const ecoBtn = document.getElementById('btnTriggerEco');
                if (spawnBtn) spawnBtn.click();
                if (ecoBtn) ecoBtn.click();
            });
        }

        // 所有液態玻璃按鈕點擊時觸發 Q彈果凍回饋
        document.querySelectorAll('.lg-btn, .lg-pill-mini').forEach(btn => {
            btn.addEventListener('pointerdown', () => {
                btn.classList.remove('jelly-pop');
                void btn.offsetWidth;
                btn.classList.add('jelly-pop');
            });
        });

        window.addEventListener('resize', () => {
            setPage(activeIndex, true, false);
        });

        requestAnimationFrame(() => {
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

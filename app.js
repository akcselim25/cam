// ===================================================================
// CAM - ÜST DÜZEY AKILLI KİŞİ TAKİP SİSTEMİ
// Mimari:
// 1. MediaPipe EfficientDet-Lite2 (GPU) + Gerçek İndirme Yüzdesi (%0-%100) + Kalıcı Önbellek
// 2. Çift Ölçekli Algılama: Geniş Açı + Uzak Hedefler İçin Yüksek Çözünürlüklü Sniper Crop Zoom
// 3. 3 Katmanlı Takip: Kalman Hız Tahmini + Üst/Alt Gövde Kimlik İmzası (Re-ID) + NCC Piksel Şablon Takibi
// 4. Çift Yönlü WebRTC (STUN + TURN + Dual-Handshake) ile Kesintisiz İzleyici Bağlantısı
// ===================================================================

import { ObjectDetector, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/latest/efficientdet_lite2.tflite';
const MODEL_SIZE_FALLBACK = 12138859;
const MODEL_CACHE = 'cam-ai-v2';
const PEER_PREFIX = 'cam-room-';
const IDLE_TEXT = 'Kişiye dokunarak kilitleyin';
const LOST_AFTER_MS = 1250;

// Farklı ağlarda (Wi-Fi <-> Mobil Veri 4.5G/5G) sorunsuz bağlantı için STUN + TURN sunucuları
const PEER_CONFIG = {
    debug: 0,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            {
                urls: [
                    'turn:openrelay.metered.ca:80',
                    'turn:openrelay.metered.ca:443',
                    'turn:openrelay.metered.ca:443?transport=tcp'
                ],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    }
};

// =================== DOM ===================
const vid = document.getElementById('vid');
const cvs = document.getElementById('cvs');
const ctx = cvs.getContext('2d');
const videoContainer = document.getElementById('video-container');
const focusRing = document.getElementById('focus-ring');
const alertBox = document.getElementById('alert');
const alertTitle = document.getElementById('alert-title');
const alertMsg = document.getElementById('alert-msg');
const cs = document.getElementById('cs');
const as_ = document.getElementById('as');
const cp = document.getElementById('cp');
const targetStatusText = document.getElementById('target-status-text');
const btnQuickUnlock = document.getElementById('btnQuickUnlock');
const bannerAiBar = document.getElementById('banner-ai-bar');
const menuAi = document.getElementById('menu-ai');
const menuAiFill = document.getElementById('menu-ai-fill');
const menuAiText = document.getElementById('menu-ai-text');

// =================== GENEL DURUM ===================
let peer = null;
let conn = null;
const activeConnections = new Set();
const activeCalls = new Set();
let isCamera = false;
let currentFacingMode = 'environment';
let localStream = null;
let precode = '';
let renderStarted = false;

// =================== YAPAY ZEKA DURUMU ===================
let videoDetector = null;
let imageDetector = null; // Yüksek çözünürlüklü Sniper Crop taraması için
let aiReady = false;
let aiFailed = false;
let aiProgress = 0;
let aiLoadPromise = null;
let lastInferTs = 0;
let lastVideoTime = -1;
let lastPersonCount = -1;
let lastSyncSendTs = 0;

let currentDetections = [];   // [{ normBox:[x,y,w,h], score, sig }]
let remoteDetections = [];    // Kameradan izleyiciye gelen anlık tespitler (yedek/destek)
let remoteDetectionsTs = 0;
let lockedTarget = null;      // { normBox, lerpBox, vx, vy, sig, tpl, score, lastSeen, lastUpdate, lost }
let pendingLock = null;
let statusFlashTimer = null;

// =================== YAPAY ZEKA YÜKLEME (GERÇEK YÜZDELİ) ===================
function renderAiStatus() {
    const pct = Math.max(0, Math.min(100, Math.round(aiProgress)));
    let text;
    if (aiFailed) text = 'Yapay zeka yüklenemedi — sayfayı yenileyin';
    else if (!aiReady) text = `Yapay zeka hazırlanıyor %${pct}`;
    else text = 'Yapay zeka hazır %100';

    if (menuAiText) menuAiText.textContent = text;
    if (menuAiFill) menuAiFill.style.width = pct + '%';
    if (bannerAiBar) bannerAiBar.style.width = pct + '%';

    if (aiReady) {
        if (bannerAiBar) bannerAiBar.style.opacity = '0';
        if (menuAi) {
            setTimeout(() => { menuAi.style.opacity = '0'; }, 700);
            setTimeout(() => { menuAi.style.display = 'none'; }, 1200);
        }
    }

    if (!lockedTarget && !statusFlashTimer) {
        targetStatusText.textContent = aiReady ? IDLE_TEXT : text;
    }
}

function setAiProgress(p) {
    if (p > aiProgress) {
        aiProgress = p;
        renderAiStatus();
    }
}

async function fetchModelWithProgress(onProgress) {
    try {
        if ('caches' in window) {
            const cache = await caches.open(MODEL_CACHE);
            const hit = await cache.match(MODEL_URL);
            if (hit) {
                const buf = new Uint8Array(await hit.arrayBuffer());
                onProgress(1);
                return buf;
            }
        }
    } catch (e) {}

    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error('Model indirilemedi: ' + res.status);

    let buf;
    if (res.body && res.body.getReader) {
        const total = Number(res.headers.get('content-length')) || MODEL_SIZE_FALLBACK;
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            onProgress(Math.min(1, received / total));
        }
        buf = new Uint8Array(received);
        let offset = 0;
        for (const c of chunks) { buf.set(c, offset); offset += c.length; }
    } else {
        buf = new Uint8Array(await res.arrayBuffer());
    }
    onProgress(1);

    try {
        if ('caches' in window) {
            const cache = await caches.open(MODEL_CACHE);
            await cache.put(MODEL_URL, new Response(buf.slice(), {
                headers: { 'Content-Type': 'application/octet-stream' }
            }));
        }
    } catch (e) {}

    return buf;
}

function createDetectorInstance(vision, modelBuf, delegate, runningMode, scoreThreshold) {
    return ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: modelBuf.slice(), delegate },
        runningMode,
        scoreThreshold,
        maxResults: 30,
        categoryAllowlist: ['person']
    });
}

function loadAI() {
    if (aiLoadPromise) return aiLoadPromise;
    aiFailed = false;
    aiLoadPromise = (async () => {
        let creep = null;
        try {
            setAiProgress(2);
            const visionPromise = FilesetResolver.forVisionTasks(WASM_URL);
            const modelBuf = await fetchModelWithProgress(f => setAiProgress(2 + f * 83));
            const vision = await visionPromise;

            creep = setInterval(() => setAiProgress(aiProgress + (99 - aiProgress) * 0.12), 120);
            try {
                videoDetector = await createDetectorInstance(vision, modelBuf, 'GPU', 'VIDEO', 0.18);
                imageDetector = await createDetectorInstance(vision, modelBuf, 'GPU', 'IMAGE', 0.15);
            } catch (gpuErr) {
                videoDetector = await createDetectorInstance(vision, modelBuf, 'CPU', 'VIDEO', 0.18);
                imageDetector = await createDetectorInstance(vision, modelBuf, 'CPU', 'IMAGE', 0.15);
            }

            aiReady = true;
            aiProgress = 100;
        } catch (e) {
            console.error('Yapay zeka yüklenemedi:', e);
            aiFailed = true;
            aiLoadPromise = null;
        } finally {
            if (creep) clearInterval(creep);
            renderAiStatus();
        }
    })();
    return aiLoadPromise;
}

// =================== ÇİFT BÖLGELİ KİMLİK İMZASI (RE-ID) + ŞABLON TAKİBİ ===================
const ANA_W = 320, ANA_H = 240;
const anaCanvas = document.createElement('canvas');
anaCanvas.width = ANA_W;
anaCanvas.height = ANA_H;
const anaCtx = anaCanvas.getContext('2d', { willReadFrequently: true });
let anaData = null;

// Uzak hedefler için yüksek çözünürlüklü Sniper Crop tuvali
const cropCanvas = document.createElement('canvas');
cropCanvas.width = 448;
cropCanvas.height = 448;
const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });

const HUE_BINS = 12, SAT_BINS = 3, GRAY_BINS = 4;
const ZONE_LEN = HUE_BINS * SAT_BINS + GRAY_BINS;
const SIG_LEN = ZONE_LEN * 2; // Üst gövde + Alt gövde
const TPL_W = 16, TPL_H = 24;

function sampleFrame() {
    try {
        anaCtx.drawImage(vid, 0, 0, ANA_W, ANA_H);
        anaData = anaCtx.getImageData(0, 0, ANA_W, ANA_H).data;
    } catch (e) {
        anaData = null;
    }
}

function accumulateZoneHist(x0, y0, x1, y1, out, offset) {
    let n = 0;
    for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
            const i = (yy * ANA_W + xx) * 4;
            const r = anaData[i], g = anaData[i + 1], b = anaData[i + 2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const v = max / 255;
            const s = max === 0 ? 0 : (max - min) / max;
            let bin;
            if (s < 0.18 || v < 0.14) {
                bin = HUE_BINS * SAT_BINS + Math.min(GRAY_BINS - 1, Math.floor(v * GRAY_BINS));
            } else {
                const d = max - min;
                let hue;
                if (max === r) hue = ((g - b) / d) % 6;
                else if (max === g) hue = (b - r) / d + 2;
                else hue = (r - g) / d + 4;
                hue = (hue * 60 + 360) % 360;
                const hb = Math.floor(hue / 360 * HUE_BINS) % HUE_BINS;
                const sb = Math.min(SAT_BINS - 1, Math.floor((s - 0.18) / 0.82 * SAT_BINS));
                bin = hb * SAT_BINS + sb;
            }
            out[offset + bin]++;
            n++;
        }
    }
    if (n > 0) {
        for (let i = 0; i < ZONE_LEN; i++) out[offset + i] /= n;
    }
}

// Kişinin üst gövde (tişört/ceket) ve alt gövde (pantolon) imzasını ayrı ayrı çıkarır
function computeSignature(normBox) {
    if (!anaData) return null;
    const [x, y, w, h] = normBox;
    const x0 = Math.max(0, Math.floor((x + w * 0.18) * ANA_W));
    const x1 = Math.min(ANA_W, Math.ceil((x + w * 0.82) * ANA_W));
    const yTop0 = Math.max(0, Math.floor((y + h * 0.14) * ANA_H));
    const yMid = Math.min(ANA_H, Math.max(yTop0 + 1, Math.floor((y + h * 0.50) * ANA_H)));
    const yBot1 = Math.min(ANA_H, Math.ceil((y + h * 0.85) * ANA_H));
    if (x1 - x0 < 2 || yBot1 - yTop0 < 4) return null;

    const sig = new Float32Array(SIG_LEN);
    accumulateZoneHist(x0, yTop0, x1, yMid, sig, 0);
    accumulateZoneHist(x0, yMid, x1, yBot1, sig, ZONE_LEN);
    return sig;
}

function sigSim(a, b) {
    if (!a || !b) return 0.55;
    let s1 = 0, s2 = 0;
    for (let i = 0; i < ZONE_LEN; i++) {
        s1 += Math.sqrt(a[i] * b[i]);
        s2 += Math.sqrt(a[ZONE_LEN + i] * b[ZONE_LEN + i]);
    }
    return s1 * 0.58 + s2 * 0.42;
}

// Kişinin 16x24 normalize parlaklık/renk şablonunu çıkarır (NCC piksel takibi için)
function extractTemplate(normBox) {
    if (!anaData) return null;
    const [x, y, w, h] = normBox;
    if (w <= 0.004 || h <= 0.008) return null;
    const tpl = new Float32Array(TPL_W * TPL_H);
    let sum = 0;
    for (let ty = 0; ty < TPL_H; ty++) {
        const py = Math.min(ANA_H - 1, Math.max(0, Math.floor((y + (ty + 0.5) / TPL_H * h) * ANA_H)));
        for (let tx = 0; tx < TPL_W; tx++) {
            const px = Math.min(ANA_W - 1, Math.max(0, Math.floor((x + (tx + 0.5) / TPL_W * w) * ANA_W)));
            const idx = (py * ANA_W + px) * 4;
            const lum = 0.299 * anaData[idx] + 0.587 * anaData[idx + 1] + 0.114 * anaData[idx + 2];
            tpl[ty * TPL_W + tx] = lum;
            sum += lum;
        }
    }
    const mean = sum / (TPL_W * TPL_H);
    let norm = 0;
    for (let i = 0; i < tpl.length; i++) {
        tpl[i] -= mean;
        norm += tpl[i] * tpl[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < tpl.length; i++) tpl[i] /= norm;
    return tpl;
}

// Şablon eşleştirme (Normalized Cross-Correlation) ile kısa kayıplarda piksel takibi
function searchTemplate(tpl, predBox) {
    if (!tpl || !anaData) return null;
    const [, , w, h] = predBox;
    const cx = predBox[0] + w / 2;
    const cy = predBox[1] + h / 2;
    const stepX = Math.max(0.008, w * 0.14);
    const stepY = Math.max(0.008, h * 0.14);

    let bestScore = -1, bestBox = null;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx * stepX - w / 2;
            const ny = cy + dy * stepY - h / 2;
            if (nx < -0.05 || ny < -0.05 || nx + w > 1.05 || ny + h > 1.05) continue;
            const cand = extractTemplate([nx, ny, w, h]);
            if (!cand) continue;
            let dot = 0;
            for (let i = 0; i < tpl.length; i++) dot += tpl[i] * cand[i];
            if (dot > bestScore) {
                bestScore = dot;
                bestBox = [nx, ny, w, h];
            }
        }
    }
    return (bestScore > 0.68 && bestBox) ? { normBox: bestBox, score: bestScore } : null;
}

// =================== UZAK HEDEFLER İÇİN SNIPER CROP TARAMASI ===================
// Belirli bir noktanın etrafını orijinal yüksek çözünürlüklü videodan kırparak tarar
function detectZoomedRegion(centerX, centerY, cropFraction = 0.36) {
    if (!imageDetector || vid.readyState < 2 || !vid.videoWidth) return [];
    const vw = vid.videoWidth, vh = vid.videoHeight;
    const cw = Math.max(0.18, Math.min(0.65, cropFraction));
    const ch = cw;
    const x0 = Math.max(0, Math.min(1 - cw, centerX - cw / 2));
    const y0 = Math.max(0, Math.min(1 - ch, centerY - ch / 2));

    try {
        cropCtx.drawImage(
            vid,
            x0 * vw, y0 * vh, cw * vw, ch * vh,
            0, 0, cropCanvas.width, cropCanvas.height
        );
        const res = imageDetector.detect(cropCanvas);
        return (res.detections || []).map(d => {
            const bb = d.boundingBox;
            const nx = x0 + (bb.originX / cropCanvas.width) * cw;
            const ny = y0 + (bb.originY / cropCanvas.height) * ch;
            const nw = (bb.width / cropCanvas.width) * cw;
            const nh = (bb.height / cropCanvas.height) * ch;
            return {
                normBox: [nx, ny, nw, nh],
                score: d.categories && d.categories[0] ? d.categories[0].score : 0.25,
                sig: null
            };
        }).filter(d => d.normBox[2] > 0.003 && d.normBox[3] > 0.008);
    } catch (e) {
        return [];
    }
}

// =================== GEOMETRİ ===================
const center = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
const area = (b) => Math.max(1e-6, b[2] * b[3]);

function computeIoU(b1, b2) {
    const xA = Math.max(b1[0], b2[0]);
    const yA = Math.max(b1[1], b2[1]);
    const xB = Math.min(b1[0] + b1[2], b2[0] + b2[2]);
    const yB = Math.min(b1[1] + b1[3], b2[1] + b2[3]);
    const inter = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    return inter / (area(b1) + area(b2) - inter + 1e-6);
}

function pointToBoxDist(px, py, b) {
    const dx = Math.max(b[0] - px, 0, px - (b[0] + b[2]));
    const dy = Math.max(b[1] - py, 0, py - (b[1] + b[3]));
    return Math.hypot(dx, dy);
}

function getRenderGeometry() {
    const rect = cvs.getBoundingClientRect();
    const cw = rect.width, ch = rect.height;
    const vw = vid.videoWidth || 640, vh = vid.videoHeight || 480;
    const va = vw / vh, ca = cw / ch;
    let rw, rh, ox, oy;
    if (ca > va) { rw = cw; rh = cw / va; ox = 0; oy = (rh - ch) / 2; }
    else { rh = ch; rw = ch * va; oy = 0; ox = (rw - cw) / 2; }
    return { rect, rw, rh, ox, oy };
}

function getNormalizedVideoCoords(clientX, clientY) {
    const { rect, rw, rh, ox, oy } = getRenderGeometry();
    let nx = ((clientX - rect.left) + ox) / rw;
    const ny = ((clientY - rect.top) + oy) / rh;
    if (isCamera && currentFacingMode === 'user') nx = 1 - nx;
    return { normX: Math.max(0, Math.min(1, nx)), normY: Math.max(0, Math.min(1, ny)) };
}

function normBoxToScreen(b) {
    const { rw, rh, ox, oy } = getRenderGeometry();
    let [nx, ny, nw, nh] = b;
    if (isCamera && currentFacingMode === 'user') nx = 1 - (nx + nw);
    return [nx * rw - ox, ny * rh - oy, nw * rw, nh * rh];
}

// Çakışan kutuları birleştir (NMS)
function mergeDetections(primary, secondary) {
    const out = primary.slice();
    for (const s of secondary) {
        let duplicate = false;
        for (const p of out) {
            if (computeIoU(p.normBox, s.normBox) > 0.45) {
                duplicate = true;
                break;
            }
        }
        if (!duplicate) out.push(s);
    }
    return out;
}

// =================== TESPİT VE TAKİP DÖNGÜSÜ ===================
function runDetection(now) {
    if (vid.readyState < 2 || !vid.videoWidth) return;

    // Model hazır değilse izleyicide kameradan gelen canlı tespitleri kullan
    if (!videoDetector) {
        if (!isCamera && now - remoteDetectionsTs < 600) {
            currentDetections = remoteDetections;
        }
        return;
    }

    if (now - lastInferTs < 42) return;
    if (vid.currentTime === lastVideoTime) return;
    lastVideoTime = vid.currentTime;
    lastInferTs = now;

    let result;
    try {
        result = videoDetector.detectForVideo(vid, performance.now());
    } catch (e) {
        return;
    }

    const vw = vid.videoWidth, vh = vid.videoHeight;
    sampleFrame();

    let dets = (result.detections || []).map(d => {
        const bb = d.boundingBox;
        return {
            normBox: [bb.originX / vw, bb.originY / vh, bb.width / vw, bb.height / vh],
            score: d.categories && d.categories[0] ? d.categories[0].score : 0,
            sig: null
        };
    }).filter(d => d.normBox[2] > 0.003 && d.normBox[3] > 0.008);

    // Kilitli hedef uzaktaysa (küçükse) veya anlık kaçırıldıysa Sniper Crop ile o bölgeyi yakınlaştırıp tara
    if (lockedTarget && !lockedTarget.lost) {
        const tc = center(lockedTarget.normBox);
        const isSmall = lockedTarget.normBox[3] < 0.22;
        const hasNearby = dets.some(d => computeIoU(d.normBox, lockedTarget.normBox) > 0.2);
        if (isSmall || !hasNearby) {
            const zoomCrop = Math.max(0.24, Math.min(0.50, Math.max(lockedTarget.normBox[2], lockedTarget.normBox[3]) * 2.6));
            const zoomDets = detectZoomedRegion(tc[0], tc[1], zoomCrop);
            if (zoomDets.length > 0) dets = mergeDetections(dets, zoomDets);
        }
    }

    // İzleyicide kameradan gelen uzak tespitlerle birleştir
    if (!isCamera && now - remoteDetectionsTs < 450 && remoteDetections.length > 0) {
        dets = mergeDetections(dets, remoteDetections);
    }

    currentDetections = dets;

    if (currentDetections.length !== lastPersonCount) {
        lastPersonCount = currentDetections.length;
        as_.textContent = lastPersonCount > 0 ? `${lastPersonCount} Kişi Algılandı` : 'Kişi Yok';
    }

    updateTracking(now);
    tryPendingLock(now);

    // Kamera tespitleri ve kilit durumunu bağlı izleyicilere düzenli aktarır
    if (isCamera && activeConnections.size > 0 && now - lastSyncSendTs > 80) {
        lastSyncSendTs = now;
        broadcastToPeers({
            type: 'sync_state',
            boxes: currentDetections.map(d => ({ normBox: d.normBox, score: d.score })),
            locked: lockedTarget ? {
                normBox: lockedTarget.normBox,
                lost: lockedTarget.lost,
                score: lockedTarget.score
            } : null
        });
    }
}

function updateTracking(now) {
    const t = lockedTarget;
    if (!t) return;

    const dt = Math.max(1, now - t.lastUpdate);
    const pred = [
        t.normBox[0] + t.vx * dt,
        t.normBox[1] + t.vy * dt,
        t.normBox[2],
        t.normBox[3]
    ];
    const diag = Math.hypot(t.normBox[2], t.normBox[3]);

    let best = null, bestScore = -Infinity, bestIoU = 0;
    for (const d of currentDetections) {
        const iou = computeIoU(pred, d.normBox);
        const pc = center(pred), dc = center(d.normBox);
        const dist = Math.hypot(pc[0] - dc[0], pc[1] - dc[1]);
        const sizeRatio = Math.min(area(d.normBox) / area(t.normBox), area(t.normBox) / area(d.normBox));
        if (!d.sig) d.sig = computeSignature(d.normBox);
        const app = sigSim(t.sig, d.sig);

        let score;
        if (!t.lost) {
            const gate = Math.max(0.15, diag * 1.35);
            if (dist > gate && iou < 0.04) continue;
            if (app < 0.36 && iou < 0.28) continue;
            score = iou * 2.2 + app * 1.6 - (dist / Math.max(0.04, diag)) * 0.45 + sizeRatio * 0.35;
        } else {
            if (app < 0.70 || sizeRatio < 0.22) continue;
            score = app * 2.2 + sizeRatio * 0.35 - dist * 0.45;
        }

        if (score > bestScore) { bestScore = score; best = d; bestIoU = iou; }
    }

    // Yapay zeka bu karede kaçırdıysa NCC Piksel Şablon Takibi devreye girsin
    if (!best && !t.lost && now - t.lastSeen < 420 && t.tpl) {
        const tplHit = searchTemplate(t.tpl, pred);
        if (tplHit) {
            best = { normBox: tplHit.normBox, score: t.score, sig: null, fromTemplate: true };
            bestIoU = 0.5;
        }
    }

    if (best) {
        const cPrev = center(t.normBox), cNew = center(best.normBox);
        if (!t.lost) {
            t.vx = t.vx * 0.62 + ((cNew[0] - cPrev[0]) / dt) * 0.38;
            t.vy = t.vy * 0.62 + ((cNew[1] - cPrev[1]) / dt) * 0.38;
        } else {
            t.vx = 0; t.vy = 0;
            t.lerpBox = best.normBox.slice();
        }
        t.normBox = best.normBox.slice();
        if (!best.fromTemplate) {
            t.score = best.score;
            t.lastSeen = now;
        }
        t.lastUpdate = now;

        if (!best.fromTemplate && best.sig && (bestIoU > 0.42 || !t.sig)) {
            if (!t.sig) t.sig = best.sig;
            else for (let i = 0; i < SIG_LEN; i++) t.sig[i] = t.sig[i] * 0.92 + best.sig[i] * 0.08;
            t.tpl = extractTemplate(t.normBox) || t.tpl;
        }

        if (t.lost) {
            t.lost = false;
            targetStatusText.textContent = 'Kilitli: Kişi';
            dismissAlert(isCamera);
        }
    } else {
        if (!t.lost && now - t.lastSeen < 480) {
            t.normBox = [
                Math.max(-0.2, Math.min(1, pred[0])),
                Math.max(-0.2, Math.min(1, pred[1])),
                pred[2], pred[3]
            ];
            t.lastUpdate = now;
        }
        t.vx *= 0.78;
        t.vy *= 0.78;

        if (!t.lost && now - t.lastSeen > LOST_AFTER_MS) {
            t.lost = true;
            targetStatusText.textContent = 'Kayıp: Kişi';
            triggerTargetLostAlert();
        }
    }
}

// =================== KİŞİ SEÇME VE KİLİTLEME ===================
function flashStatus(text, ms = 1600) {
    if (lockedTarget) return;
    targetStatusText.textContent = text;
    clearTimeout(statusFlashTimer);
    statusFlashTimer = setTimeout(() => {
        statusFlashTimer = null;
        if (!lockedTarget) renderAiStatus();
    }, ms);
}

function findPersonAt(normX, normY, list = currentDetections) {
    let best = null, bestDist = Infinity, bestArea = Infinity;
    for (const d of list) {
        const dist = pointToBoxDist(normX, normY, d.normBox);
        const a = area(d.normBox);
        if (dist < bestDist - 1e-4 || (Math.abs(dist - bestDist) < 1e-4 && a < bestArea)) {
            best = d; bestDist = dist; bestArea = a;
        }
    }
    return (best && bestDist < 0.09) ? best : null;
}

function lockAt(normX, normY, fromPeer = false, fallbackBox = null) {
    sampleFrame();

    // 1. Mevcut tespitlerde ara
    let person = findPersonAt(normX, normY, currentDetections);

    // 2. Bulunamadıysa ve Sniper Crop hazırsa dokunulan noktayı yüksek çözünürlükte yakınlaştırıp tara (uzaktaki kişiler için!)
    if (!person && imageDetector) {
        const zoomed = detectZoomedRegion(normX, normY, 0.34);
        if (zoomed.length > 0) {
            currentDetections = mergeDetections(currentDetections, zoomed);
            person = findPersonAt(normX, normY, zoomed);
        }
    }

    // 3. Karşı cihazdan hazır kutu geldiyse onu kullan
    if (!person && fallbackBox) {
        person = { normBox: fallbackBox.slice(), score: 0.85, sig: null };
    }

    if (!person) {
        if (!aiReady && !fromPeer) {
            // İzleyici henüz modeli yüklerken kameraya kilit isteği gönder
            if (!isCamera && conn && conn.open) {
                conn.send({ type: 'lock_at', normX, normY });
                flashStatus('Kamerada kişi aranıyor…');
                return false;
            }
            flashStatus(`Yapay zeka hazırlanıyor %${Math.round(aiProgress)}`);
            return false;
        }
        if (fromPeer) {
            pendingLock = { normX, normY, until: performance.now() + 2500 };
        } else {
            // İzleyici dokunduysa kameranın da kendi yüksek çözünürlüklü akışında aramasını sağla
            if (!isCamera && conn && conn.open) {
                conn.send({ type: 'lock_at', normX, normY });
            }
            flashStatus('Burada kişi yok — bir kişiye dokunun');
        }
        return false;
    }

    const now = performance.now();
    lockedTarget = {
        normBox: person.normBox.slice(),
        lerpBox: person.normBox.slice(),
        vx: 0, vy: 0,
        sig: person.sig || computeSignature(person.normBox),
        tpl: extractTemplate(person.normBox),
        score: person.score || 0.85,
        lastSeen: now,
        lastUpdate: now,
        lost: false
    };
    pendingLock = null;
    clearTimeout(statusFlashTimer);
    statusFlashTimer = null;

    playHapticBeep();
    if (navigator.vibrate) navigator.vibrate(15);
    targetStatusText.textContent = 'Kilitli: Kişi';
    btnQuickUnlock.style.display = 'inline-block';
    dismissAlert(false);

    if (!fromPeer) {
        broadcastToPeers({
            type: 'lock_at',
            normX,
            normY,
            normBox: lockedTarget.normBox
        });
    }
    return true;
}

function tryPendingLock(now) {
    if (!pendingLock || lockedTarget) return;
    if (now > pendingLock.until) { pendingLock = null; return; }
    const person = findPersonAt(pendingLock.normX, pendingLock.normY);
    if (person) lockAt(pendingLock.normX, pendingLock.normY, true, person.normBox);
}

function unlockTarget(notifyPeer = true) {
    pendingLock = null;
    if (!lockedTarget) return;
    lockedTarget = null;
    btnQuickUnlock.style.display = 'none';
    targetStatusText.textContent = aiReady ? IDLE_TEXT : targetStatusText.textContent;
    dismissAlert(false);
    if (notifyPeer) broadcastToPeers({ type: 'unlock' });
}

btnQuickUnlock.addEventListener('click', (e) => {
    e.stopPropagation();
    unlockTarget(true);
});

// =================== SES, TİTREŞİM VE ALARM ===================
let audioCtx = null;
let alarmOsc1 = null, alarmOsc2 = null, alarmGain = null;
let isAlarmPlaying = false;
let alarmTimer = null;
let vibInterval = null;

function initAudio() {
    if (!audioCtx) {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (AudioClass) audioCtx = new AudioClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function startAlarmSound() {
    if (isAlarmPlaying) return;
    initAudio();
    if (!audioCtx) return;
    try {
        isAlarmPlaying = true;
        alarmGain = audioCtx.createGain();
        alarmGain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        alarmGain.connect(audioCtx.destination);

        alarmOsc1 = audioCtx.createOscillator();
        alarmOsc2 = audioCtx.createOscillator();
        alarmOsc1.type = 'sine';
        alarmOsc2.type = 'triangle';
        alarmOsc1.connect(alarmGain);
        alarmOsc2.connect(alarmGain);

        let toggle = false;
        alarmTimer = setInterval(() => {
            if (!isAlarmPlaying || !audioCtx) return;
            const t = audioCtx.currentTime;
            toggle = !toggle;
            if (alarmOsc1) alarmOsc1.frequency.setValueAtTime(toggle ? 750 : 980, t);
            if (alarmOsc2) alarmOsc2.frequency.setValueAtTime(toggle ? 1100 : 1350, t);
        }, 280);

        alarmOsc1.start();
        alarmOsc2.start();
    } catch (e) {}
}

function stopAlarmSound() {
    if (!isAlarmPlaying) return;
    isAlarmPlaying = false;
    if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
    try {
        if (alarmOsc1) { alarmOsc1.stop(); alarmOsc1.disconnect(); alarmOsc1 = null; }
        if (alarmOsc2) { alarmOsc2.stop(); alarmOsc2.disconnect(); alarmOsc2 = null; }
        if (alarmGain) { alarmGain.disconnect(); alarmGain = null; }
    } catch (e) {}
}

function playHapticBeep() {
    initAudio();
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1300, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1750, audioCtx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {}
}

function triggerFocusRing(clientX, clientY) {
    const rect = videoContainer.getBoundingClientRect();
    focusRing.style.left = `${clientX - rect.left}px`;
    focusRing.style.top = `${clientY - rect.top}px`;
    focusRing.classList.remove('active');
    void focusRing.offsetWidth;
    focusRing.classList.add('active');
    setTimeout(() => focusRing.classList.remove('active'), 400);
}

function triggerTargetLostAlert() {
    alertTitle.textContent = 'Hedef Kadrajdan Çıktı';
    alertMsg.textContent = 'Kilitlenen kişi görüş alanından ayrıldı.';
    alertBox.style.display = 'flex';
    startAlarmSound();

    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    if (vibInterval) clearInterval(vibInterval);
    vibInterval = setInterval(() => {
        if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    }, 1400);

    if (isCamera) broadcastToPeers({ type: 'target_lost' });
}

function dismissAlert(notifyPeer = false) {
    const wasShowing = alertBox.style.display === 'flex' || isAlarmPlaying;
    alertBox.style.display = 'none';
    stopAlarmSound();
    if (vibInterval) { clearInterval(vibInterval); vibInterval = null; }
    if (navigator.vibrate) navigator.vibrate(0);
    if (notifyPeer && wasShowing) broadcastToPeers({ type: 'alert_dismissed' });
}

document.getElementById('btnDismissAlert').addEventListener('click', () => dismissAlert(true));

// =================== ÇİZİM (APPLE VİZÖR) ===================
function drawIdlePerson(b) {
    const [x, y, w, h] = normBoxToScreen(b);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(8, w / 4, h / 4));
    ctx.stroke();

    if (w > 18) {
        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
        const label = 'Kişi';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(28, 28, 30, 0.78)';
        ctx.beginPath();
        ctx.roundRect(x, Math.max(0, y - 20), tw + 12, 17, 8.5);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + 6, Math.max(8.5, y - 11.5));
    }
    ctx.restore();
}

function drawLockedTarget(b, isLost) {
    const [x, y, w, h] = normBoxToScreen(b);
    const color = isLost ? '#ff453a' : '#ffffff';
    const corner = Math.max(8, Math.min(w, h) * 0.22);
    const r = Math.min(6, corner / 2);

    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const corners = [
        [x, y + corner, x, y, x + corner, y],
        [x + w - corner, y, x + w, y, x + w, y + corner],
        [x, y + h - corner, x, y + h, x + corner, y + h],
        [x + w - corner, y + h, x + w, y + h, x + w, y + h - corner]
    ];
    for (const [ax, ay, cx, cy, bx, by] of corners) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.arcTo(cx, cy, bx, by, r);
        ctx.lineTo(bx, by);
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    const tag = isLost ? 'Kayıp: Kişi' : 'Kilitli: Kişi';
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
    const tw = ctx.measureText(tag).width;
    const bw = tw + 18, bh = 22;
    const bx = x + (w - bw) / 2;
    const by = Math.max(8, y - bh - 6);
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 11);
    ctx.fillStyle = isLost ? 'rgba(255, 69, 58, 0.92)' : 'rgba(28, 28, 30, 0.88)';
    ctx.fill();
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = isLost ? 'rgba(255, 69, 58, 0.4)' : 'rgba(255, 255, 255, 0.16)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, bx + bw / 2, by + bh / 2);
    ctx.restore();
}

let lastFrameTs = performance.now();

function renderLoop(now) {
    now = now || performance.now();
    const dt = Math.min(100, now - lastFrameTs);
    lastFrameTs = now;

    const dpr = window.devicePixelRatio || 1;
    const cssW = cvs.clientWidth || window.innerWidth;
    const cssH = cvs.clientHeight || window.innerHeight;
    if (cvs.width !== Math.round(cssW * dpr) || cvs.height !== Math.round(cssH * dpr)) {
        cvs.width = Math.round(cssW * dpr);
        cvs.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    runDetection(now);

    if (vid.readyState >= 2) {
        if (lockedTarget) {
            const a = 1 - Math.exp(-dt / 65);
            const lb = lockedTarget.lerpBox, nb = lockedTarget.normBox;
            for (let i = 0; i < 4; i++) lb[i] += (nb[i] - lb[i]) * a;
            drawLockedTarget(lb, lockedTarget.lost);
        } else {
            const list = currentDetections.length > 0 ? currentDetections : remoteDetections;
            for (const d of list) drawIdlePerson(d.normBox);
        }
    }

    requestAnimationFrame(renderLoop);
}

function startRenderLoop() {
    if (renderStarted) return;
    renderStarted = true;
    requestAnimationFrame(renderLoop);
}

// =================== DOKUNARAK KİLİTLEME ===================
cvs.addEventListener('pointerdown', (e) => {
    initAudio();
    triggerFocusRing(e.clientX, e.clientY);
    const { normX, normY } = getNormalizedVideoCoords(e.clientX, e.clientY);
    lockAt(normX, normY, false);
});

// =================== WEBRTC BAĞLANTI VE MESAJLAŞMA ===================
function broadcastToPeers(payload) {
    if (isCamera) {
        for (const c of activeConnections) {
            if (c && c.open) {
                try { c.send(payload); } catch (e) {}
            }
        }
    } else if (conn && conn.open) {
        try { conn.send(payload); } catch (e) {}
    }
}

// İzleyicinin kamerayı arayabilmesi için boş medya akışı (Çift Yönlü WebRTC El Sıkışma)
function createViewerDummyStream() {
    try {
        const c = document.createElement('canvas');
        c.width = 2; c.height = 2;
        return c.captureStream(1);
    } catch (e) {
        return null;
    }
}

function callViewerPeer(targetPeerId, forceNew = false) {
    if (!isCamera || !localStream || !peer || peer.destroyed || !targetPeerId) return;
    if (!forceNew) {
        for (const mc of activeCalls) {
            if (mc && mc.peer === targetPeerId && mc.open) return;
        }
    }
    try {
        const mediaCall = peer.call(targetPeerId, localStream);
        if (mediaCall) activeCalls.add(mediaCall);
    } catch (e) {}
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            await navigator.wakeLock.request('screen');
        }
    } catch (e) {}
}

async function openCameraStream() {
    try {
        return await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
    } catch (e) {
        return await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: false
        });
    }
}

function handlePeerData(d, senderConn) {
    if (!d || !d.type) return;
    switch (d.type) {
        case 'viewer_ready':
            if (isCamera && senderConn) {
                callViewerPeer(senderConn.peer, Boolean(d.force));
            }
            break;
        case 'sync_state':
            if (!isCamera) {
                remoteDetections = (d.boxes || []).map(b => ({ normBox: b.normBox, score: b.score, sig: null }));
                remoteDetectionsTs = performance.now();
                if (!videoDetector) {
                    as_.textContent = remoteDetections.length > 0 ? `${remoteDetections.length} Kişi Algılandı` : 'Kişi Yok';
                }
                if (d.locked) {
                    if (!lockedTarget) {
                        const now = performance.now();
                        lockedTarget = {
                            normBox: d.locked.normBox.slice(),
                            lerpBox: d.locked.normBox.slice(),
                            vx: 0, vy: 0,
                            sig: null, tpl: null,
                            score: d.locked.score || 0.85,
                            lastSeen: now, lastUpdate: now,
                            lost: Boolean(d.locked.lost)
                        };
                        btnQuickUnlock.style.display = 'inline-block';
                        targetStatusText.textContent = d.locked.lost ? 'Kayıp: Kişi' : 'Kilitli: Kişi';
                    } else if (!videoDetector) {
                        lockedTarget.normBox = d.locked.normBox.slice();
                        lockedTarget.lost = Boolean(d.locked.lost);
                        lockedTarget.lastUpdate = performance.now();
                    }
                }
            }
            break;
        case 'lock_at':
            lockAt(d.normX, d.normY, true, d.normBox || null);
            break;
        case 'unlock':
            unlockTarget(false);
            break;
        case 'target_lost':
            if (!isCamera) {
                if (lockedTarget) {
                    lockedTarget.lost = true;
                    targetStatusText.textContent = 'Kayıp: Kişi';
                }
                triggerTargetLostAlert();
            }
            break;
        case 'alert_dismissed':
            dismissAlert(false);
            break;
    }
}

// =================== KAMERA MODU ===================
document.getElementById('btnCam').addEventListener('click', startCamera);

async function startCamera() {
    const raw = (document.getElementById('username').value || '').trim();
    const code = raw.replace(/[^0-9]/g, '');
    if (code.length !== 5) {
        alert('Şifre 5 haneli rakamlardan oluşmalıdır.');
        return;
    }

    initAudio();
    requestWakeLock();
    localStorage.setItem('cam_username', code);
    precode = code;
    isCamera = true;

    document.getElementById('role').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    document.getElementById('cc').style.display = 'block';
    document.getElementById('lc').style.display = 'none';
    updateMirroring();

    try {
        localStream = await openCameraStream();
    } catch (e) {
        alert('Kamera başlatılamadı: ' + e.name);
        location.reload();
        return;
    }

    vid.srcObject = localStream;
    vid.muted = true;
    vid.play().catch(() => {});

    loadAI();
    renderAiStatus();
    setupStealthMode();
    setupToggleButton();
    startRenderLoop();

    document.getElementById('mc').textContent = precode;
    initCameraPeer(0);
}

function initCameraPeer(retryCount) {
    if (peer) { try { peer.destroy(); } catch (e) {} }
    cs.textContent = 'Sunucuya Bağlanıyor...';

    peer = new Peer(PEER_PREFIX + precode, PEER_CONFIG);

    peer.on('open', () => {
        cs.textContent = 'İzleyici Bekleniyor';
        cp.className = 'status-dot active';
    });

    // İzleyici doğrudan medya araması başlatırsa kamera akışıyla cevapla
    peer.on('call', (incomingCall) => {
        if (localStream) {
            incomingCall.answer(localStream);
            activeCalls.add(incomingCall);
            cs.textContent = 'İzleyici Bağlandı';
            cp.className = 'status-dot active';
        }
    });

    peer.on('connection', (c) => {
        conn = c;
        activeConnections.add(c);

        c.on('open', () => {
            cs.textContent = 'İzleyici Bağlandı';
            cp.className = 'status-dot active';
            callViewerPeer(c.peer, false);
            if (lockedTarget) {
                const cc = center(lockedTarget.normBox);
                c.send({ type: 'lock_at', normX: cc[0], normY: cc[1], normBox: lockedTarget.normBox });
            }
        });

        c.on('data', (d) => handlePeerData(d, c));

        c.on('close', () => {
            activeConnections.delete(c);
            if (activeConnections.size === 0) {
                cs.textContent = 'İzleyici Bekleniyor';
                conn = null;
            }
        });

        c.on('error', () => {
            activeConnections.delete(c);
        });
    });

    peer.on('disconnected', () => {
        if (peer && !peer.destroyed) {
            try { peer.reconnect(); } catch (e) {}
        }
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            if (retryCount < 3) {
                cs.textContent = 'Oda yenileniyor...';
                setTimeout(() => initCameraPeer(retryCount + 1), 1500);
            } else {
                alert('Bu şifre şu anda başka bir kamerada açık. Lütfen farklı bir 5 haneli şifre girin.');
                location.reload();
            }
        } else {
            cs.textContent = 'Bağlantı yenileniyor...';
            setTimeout(() => {
                if (peer && peer.disconnected && !peer.destroyed) {
                    try { peer.reconnect(); } catch (e) {}
                }
            }, 1500);
        }
    });
}

// =================== İZLEYİCİ MODU ===================
function launchViewerWithCode(code) {
    initAudio();
    requestWakeLock();
    localStorage.setItem('cam_username', code);
    isCamera = false;

    document.getElementById('role').style.display = 'none';
    document.getElementById('vs').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    document.getElementById('lc').style.display = 'block';
    document.getElementById('cc').style.display = 'none';

    vid.muted = true;
    cs.textContent = 'Kameraya Bağlanılıyor...';
    cp.className = 'status-dot';

    loadAI();
    renderAiStatus();
    setupToggleButton();
    startRenderLoop();

    connectToCamera(code, 0);
}

document.getElementById('btnView').addEventListener('click', () => {
    const typedCode = (document.getElementById('username').value || '').trim().replace(/[^0-9]/g, '');
    if (typedCode.length === 5) {
        launchViewerWithCode(typedCode);
        return;
    }
    document.getElementById('role').style.display = 'none';
    document.getElementById('vs').style.display = 'flex';
    const savedCode = typedCode || localStorage.getItem('cam_username') || '';
    const jcInput = document.getElementById('jc');
    if (savedCode && jcInput && !jcInput.value) jcInput.value = savedCode;
});

document.getElementById('btnConn').addEventListener('click', () => {
    const code = (document.getElementById('jc').value || '').trim().replace(/[^0-9]/g, '');
    if (code.length !== 5) { alert('Lütfen 5 haneli şifreyi girin.'); return; }
    launchViewerWithCode(code);
});

function attachRemoteStream(rs) {
    if (!rs) return;
    if (vid.srcObject !== rs) {
        vid.srcObject = rs;
    }
    vid.muted = true;
    vid.play().catch(() => {});
    cs.textContent = 'Canlı Yayın';
    cp.className = 'status-dot active';
}

function connectToCamera(code, attempt) {
    if (peer) { try { peer.destroy(); } catch (e) {} }
    const hostId = PEER_PREFIX + code;
    let streamReceived = false;
    let fallbackCallTimer = null;

    peer = new Peer(PEER_CONFIG);

    // Kamera izleyiciyi aradığında yanıtla (stream dinleyicisi answer'dan önce tanımlanır)
    peer.on('call', (ic) => {
        ic.on('stream', (rs) => {
            streamReceived = true;
            if (fallbackCallTimer) clearTimeout(fallbackCallTimer);
            attachRemoteStream(rs);
        });
        ic.answer();
    });

    peer.on('open', () => {
        cs.textContent = 'Odaya Giriliyor...';
        conn = peer.connect(hostId, { reliable: true });

        conn.on('open', () => {
            cs.textContent = 'Görüntü Alınıyor...';
            cp.className = 'status-dot active';
            conn.send({ type: 'viewer_ready', force: false });

            // Eğer 1.8 saniye içinde kameradan akış gelmezse çift yönlü yedek aramayı tetikle
            fallbackCallTimer = setTimeout(() => {
                if (!streamReceived && peer && !peer.destroyed) {
                    if (conn && conn.open) conn.send({ type: 'viewer_ready', force: true });
                    const dummy = createViewerDummyStream();
                    if (dummy) {
                        const outCall = peer.call(hostId, dummy);
                        if (outCall) {
                            outCall.on('stream', (rs) => {
                                streamReceived = true;
                                attachRemoteStream(rs);
                            });
                        }
                    }
                }
            }, 1800);
        });

        conn.on('data', (d) => handlePeerData(d, conn));

        conn.on('close', () => {
            if (fallbackCallTimer) clearTimeout(fallbackCallTimer);
            cs.textContent = 'Yeniden Bağlanılıyor...';
            cp.className = 'status-dot';
            setTimeout(() => {
                if (!isCamera) connectToCamera(code, 0);
            }, 1500);
        });
    });

    peer.on('error', (e) => {
        if (fallbackCallTimer) clearTimeout(fallbackCallTimer);
        if (e.type === 'peer-unavailable') {
            if (attempt < 4) {
                cs.textContent = `Kamera aranıyor (${attempt + 1}/4)...`;
                setTimeout(() => connectToCamera(code, attempt + 1), 1400);
            } else {
                alert('Kamera bulunamadı. Diğer cihazda aynı 5 haneli şifreyle "Kamera Ol" modunun açık olduğundan emin olun.');
                location.reload();
            }
        } else {
            if (attempt < 3) {
                setTimeout(() => connectToCamera(code, attempt + 1), 1400);
            } else {
                alert('Bağlantı kurulamadı: ' + e.type);
                location.reload();
            }
        }
    });
}

// =================== KAMERA YARDIMCILARI ===================
function updateMirroring() {
    vid.classList.toggle('mirror', currentFacingMode === 'user');
}

function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    vid.srcObject = null;
}

async function flipCamera() {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    stopCamera();
    updateMirroring();
    unlockTarget(true);

    try {
        localStream = await openCameraStream();
        vid.srcObject = localStream;
        vid.muted = true;
        vid.play().catch(() => {});
        lastVideoTime = -1;

        for (const mc of activeCalls) {
            try { mc.close(); } catch (e) {}
        }
        activeCalls.clear();

        for (const c of activeConnections) {
            if (c && c.open) {
                callViewerPeer(c.peer, true);
            }
        }
    } catch (e) {
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        updateMirroring();
    }
}

document.getElementById('btnFlipCamera').addEventListener('click', flipCamera);

// =================== EKRANI KARART ===================
function setupStealthMode() {
    const stealth = document.getElementById('stealth');
    const stealthUi = document.getElementById('stealth-ui');
    const pin = document.getElementById('stealth-pin');

    document.getElementById('btnHide').onclick = () => {
        stealth.style.display = 'flex';
        pin.value = '';
        stealthUi.style.display = 'none';
    };

    stealth.onclick = (e) => {
        if (e.target.id === 'stealth') {
            stealthUi.style.display = 'flex';
            pin.focus();
        }
    };

    document.getElementById('stealth-unlock').onclick = () => {
        if (pin.value === '7693') {
            stealth.style.display = 'none';
            stealthUi.style.display = 'none';
        } else {
            alert('Hatalı PIN!');
            pin.value = '';
            stealthUi.style.display = 'none';
        }
    };
}

// =================== ARAYÜZÜ GİZLE / GÖSTER ===================
function setupToggleButton() {
    const container = document.getElementById('controls-container');
    const bar = document.getElementById('bar');
    const btn = document.getElementById('btnToggleUI');

    container.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    container.style.maxHeight = '500px';
    container.style.opacity = '1';
    bar.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

    btn.style.display = 'flex';
    btn.style.opacity = '1';
    let hidden = false;

    btn.onclick = () => {
        hidden = !hidden;
        container.style.maxHeight = hidden ? '0px' : '500px';
        container.style.opacity = hidden ? '0' : '1';
        container.style.pointerEvents = hidden ? 'none' : 'auto';
        bar.style.opacity = hidden ? '0' : '1';
        bar.style.pointerEvents = hidden ? 'none' : 'auto';
        btn.style.opacity = hidden ? '0.4' : '1';
    };
}

// =================== BAŞLANGIÇ ===================
window.addEventListener('beforeunload', () => {
    stopCamera();
    stopAlarmSound();
    if (peer) { try { peer.destroy(); } catch (e) {} }
});

const savedUser = localStorage.getItem('cam_username');
if (savedUser) document.getElementById('username').value = savedUser;

// Yapay zekayı sayfa açılır açılmaz indirmeye başla (%0 -> %100)
renderAiStatus();
loadAI();

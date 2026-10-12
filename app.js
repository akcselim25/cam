// ===================================================================
// CAM - ULTRA HIZLI VE PÜRÜZSÜZ AI HEDEF TAKİP MOTORU
// ===================================================================

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

let peer = null, conn = null, call = null;
let isCamera = false;
let currentFacingMode = 'environment';
let localStream = null;

// =================== TÜRKÇE NESNE SÖZLÜĞÜ ===================
const LABELS_TR = {
    'person': 'Kişi',
    'cat': 'Kedi',
    'dog': 'Köpek',
    'car': 'Araç',
    'motorcycle': 'Motosiklet',
    'bicycle': 'Bisiklet',
    'backpack': 'Çanta',
    'handbag': 'El Çantası',
    'cell phone': 'Telefon',
    'laptop': 'Dizüstü Bilgisayar',
    'bottle': 'Şişe',
    'cup': 'Bardak',
    'chair': 'Sandalye'
};

// =================== YAPAY ZEKA MODELİ VE MOTORU ===================
let aiModel = null;
let isAiLoading = false;
let isDetecting = false;

// Optimize çıkarım canvas'ı (Hız ve FPS artışı için)
const inferCanvas = document.createElement('canvas');
inferCanvas.width = 384;
inferCanvas.height = 288;
const inferCtx = inferCanvas.getContext('2d', { willReadFrequently: true });

// Algılanan nesneler: normalize [normX, normY, normW, normH]
let currentDetections = [];

// Kilitli Hedef Verisi
let lockedTarget = null;
/*
{
  class: 'person',
  label: 'Kişi',
  normBox: [x, y, w, h], // Gerçek AI hedefi
  lerpBox: [x, y, w, h], // 60 FPS yumuşatılmış vizör
  score: 0.95,
  lastSeen: Date.now(),
  lost: false
}
*/

// =================== SES VE ALARM SİSTEMİ ===================
let audioCtx = null;
let alarmOsc1 = null;
let alarmOsc2 = null;
let alarmGain = null;
let isAlarmPlaying = false;
let vibInterval = null;

function initAudio() {
    if (!audioCtx) {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (AudioClass) audioCtx = new AudioClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
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
        window._alarmTimer = setInterval(() => {
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
    if (window._alarmTimer) {
        clearInterval(window._alarmTimer);
        window._alarmTimer = null;
    }
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

// Dokunma Odak Halkası Efekti
function triggerFocusRing(clientX, clientY) {
    if (!focusRing) return;
    const rect = videoContainer.getBoundingClientRect();
    focusRing.style.left = `${clientX - rect.left}px`;
    focusRing.style.top = `${clientY - rect.top}px`;
    focusRing.classList.remove('active');
    void focusRing.offsetWidth;
    focusRing.classList.add('active');

    setTimeout(() => {
        focusRing.classList.remove('active');
    }, 400);
}

// Alarmı Tetikleme
function triggerTargetLostAlert(targetLabel) {
    alertTitle.innerText = "Hedef Kadrajdan Çıktı";
    alertMsg.innerText = `Kilitlenen ${targetLabel} görüş açısından ayrıldı.`;
    alertBox.style.display = 'flex';

    startAlarmSound();

    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    if (vibInterval) clearInterval(vibInterval);
    vibInterval = setInterval(() => {
        if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    }, 1400);

    if (conn && conn.open) {
        conn.send({ type: 'target_lost', targetLabel });
    }
}

function dismissAlert() {
    alertBox.style.display = 'none';
    stopAlarmSound();
    if (vibInterval) {
        clearInterval(vibInterval);
        vibInterval = null;
    }
    if (conn && conn.open) {
        conn.send({ type: 'alert_dismissed' });
    }
}

document.getElementById('btnDismissAlert').addEventListener('click', dismissAlert);

// =================== MODEL YÜKLEME (WEBGL DONANIM İVMELİ) ===================
async function loadAI() {
    if (aiModel || isAiLoading) return;
    isAiLoading = true;
    targetStatusText.innerText = "Yapay zeka hazırlanıyor...";

    try {
        if (window.tf) {
            try { await tf.setBackend('webgl'); } catch (err) {}
            await tf.ready();
            console.log("TensorFlow Backend:", tf.getBackend());
        }
        aiModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        targetStatusText.innerText = "Kişiye dokunarak kilitleyin";
        console.log("COCO-SSD Modeli başarıyla yüklendi.");
    } catch (e) {
        console.error("Model yükleme hatası:", e);
        targetStatusText.innerText = "Model yüklenemedi";
    } finally {
        isAiLoading = false;
    }
}

// =================== KOORDİNAT DÖNÜŞTÜRÜCÜ (OBJECT-FIT COVER UYUMLU) ===================
function getNormalizedVideoCoords(clientX, clientY) {
    const rect = cvs.getBoundingClientRect();
    const containerW = rect.width;
    const containerH = rect.height;
    const videoW = vid.videoWidth || 640;
    const videoH = vid.videoHeight || 480;

    const videoAspect = videoW / videoH;
    const containerAspect = containerW / containerH;

    let renderW, renderH, offsetX, offsetY;
    if (containerAspect > videoAspect) {
        renderW = containerW;
        renderH = containerW / videoAspect;
        offsetX = 0;
        offsetY = (renderH - containerH) / 2;
    } else {
        renderH = containerH;
        renderW = containerH * videoAspect;
        offsetY = 0;
        offsetX = (renderW - containerW) / 2;
    }

    let clickXOnRender = (clientX - rect.left) + offsetX;
    let clickYOnRender = (clientY - rect.top) + offsetY;

    let normX = clickXOnRender / renderW;
    let normY = clickYOnRender / renderH;

    // Ön kamerada aynalama varsa X eksenini çevir
    if (isCamera && currentFacingMode === 'user') {
        normX = 1 - normX;
    }

    return {
        normX: Math.max(0, Math.min(1, normX)),
        normY: Math.max(0, Math.min(1, normY))
    };
}

// Normalize [normX, normY, normW, normH] kutusunu ekrandaki piksel koordinatına çevirir
function normBoxToScreenCoords(normBox) {
    const rect = cvs.getBoundingClientRect();
    const containerW = rect.width;
    const containerH = rect.height;
    const videoW = vid.videoWidth || 640;
    const videoH = vid.videoHeight || 480;

    const videoAspect = videoW / videoH;
    const containerAspect = containerW / containerH;

    let renderW, renderH, offsetX, offsetY;
    if (containerAspect > videoAspect) {
        renderW = containerW;
        renderH = containerW / videoAspect;
        offsetX = 0;
        offsetY = (renderH - containerH) / 2;
    } else {
        renderH = containerH;
        renderW = containerH * videoAspect;
        offsetY = 0;
        offsetX = (renderW - containerW) / 2;
    }

    let [nx, ny, nw, nh] = normBox;

    // Ön kamera aynalama
    if (isCamera && currentFacingMode === 'user') {
        nx = 1 - (nx + nw);
    }

    const screenX = (nx * renderW) - offsetX;
    const screenY = (ny * renderH) - offsetY;
    const screenW = nw * renderW;
    const screenH = nh * renderH;

    return [screenX, screenY, screenW, screenH];
}

// =================== KİŞİ VE HEDEF KİLİTLEME ===================
function lockTargetAtNormCoords(normX, normY) {
    initAudio();

    let personMatch = null;
    let minDistance = Infinity;

    // Sadece algılanan kişiler (person) taranır
    for (const det of currentDetections) {
        if (det.class !== 'person') continue;

        const [x, y, w, h] = det.normBox;
        const inside = (normX >= x && normX <= x + w && normY >= y && normY <= y + h);

        if (inside) {
            personMatch = det;
            break;
        }

        const cx = x + w / 2;
        const cy = y + h / 2;
        const dist = Math.hypot(normX - cx, normY - cy);
        if (dist < minDistance && dist < 0.22) {
            minDistance = dist;
            personMatch = det;
        }
    }

    if (personMatch) {
        playHapticBeep();
        lockedTarget = {
            class: 'person',
            label: 'Kişi',
            normBox: [...personMatch.normBox],
            lerpBox: [...personMatch.normBox],
            score: personMatch.score,
            lastSeen: Date.now(),
            lost: false
        };
        targetStatusText.innerText = `Kilitli: Kişi`;
        btnQuickUnlock.style.display = 'inline-block';
        dismissAlert();

        // İzleyiciye ve kameraya anında hedef güncellemesi gönder
        if (conn && conn.open) {
            conn.send({
                type: 'target_locked',
                target: {
                    class: 'person',
                    label: 'Kişi',
                    normBox: lockedTarget.normBox
                }
            });
        }
    } else {
        // Kişi bulunamadıysa alan kilitleme YAPMA!
        targetStatusText.innerText = "Kişi bulunamadı — Bir kişiye dokunun";
        setTimeout(() => {
            if (!lockedTarget) {
                targetStatusText.innerText = "Kişiye dokunarak kilitleyin";
            }
        }, 1500);
    }
}

function unlockTarget(notifyPeer = true) {
    if (!lockedTarget) return;
    lockedTarget = null;
    btnQuickUnlock.style.display = 'none';
    targetStatusText.innerText = "Kişiye dokunarak kilitleyin";
    dismissAlert();

    if (notifyPeer && conn && conn.open) {
        conn.send({ type: 'target_unlocked' });
    }
}

btnQuickUnlock.addEventListener('click', () => unlockTarget(true));

// =================== ULTRA HIZLI AI TESPİT DÖNGÜSÜ ===================
async function runAiDetection() {
    if (!isCamera || !aiModel || vid.readyState < 2 || isDetecting) return;
    isDetecting = true;

    try {
        // 384x288 inferCanvas üzerine çizerek 3 kat hızlandır
        inferCtx.drawImage(vid, 0, 0, inferCanvas.width, inferCanvas.height);
        const predictions = await aiModel.detect(inferCanvas, 8, 0.45);

        // Sadece insan/kişi (person) tespitlerini al
        const persons = predictions.filter(p => p.class === 'person');
        currentDetections = persons.map(p => {
            const [x, y, w, h] = p.bbox;
            return {
                class: 'person',
                score: p.score,
                normBox: [
                    x / inferCanvas.width,
                    y / inferCanvas.height,
                    w / inferCanvas.width,
                    h / inferCanvas.height
                ]
            };
        });

        // Hedef takibi ve eşleştirme
        if (lockedTarget) {
            let bestMatch = null;
            let highestIoU = 0;
            const prevCenter = [
                lockedTarget.normBox[0] + lockedTarget.normBox[2] / 2,
                lockedTarget.normBox[1] + lockedTarget.normBox[3] / 2
            ];

            for (const det of currentDetections) {
                const iou = computeIoU(lockedTarget.normBox, det.normBox);
                const curCenter = [
                    det.normBox[0] + det.normBox[2] / 2,
                    det.normBox[1] + det.normBox[3] / 2
                ];
                const dist = Math.hypot(prevCenter[0] - curCenter[0], prevCenter[1] - curCenter[1]);

                if (iou > highestIoU || (dist < 0.25 && highestIoU < 0.2)) {
                    highestIoU = iou;
                    bestMatch = det;
                }
            }

            if (bestMatch) {
                lockedTarget.normBox = bestMatch.normBox;
                lockedTarget.score = bestMatch.score;
                lockedTarget.lastSeen = Date.now();

                if (lockedTarget.lost) {
                    lockedTarget.lost = false;
                    targetStatusText.innerText = `Kilitli: ${lockedTarget.label}`;
                    dismissAlert();
                }
            } else {
                const now = Date.now();
                if (now - lockedTarget.lastSeen > 1200) {
                    if (!lockedTarget.lost) {
                        lockedTarget.lost = true;
                        targetStatusText.innerText = `Kayıp: ${lockedTarget.label}`;
                        triggerTargetLostAlert(lockedTarget.label);
                    }
                }
            }

            // İzleyiciye hedef koordinatlarını ilet
            if (conn && conn.open) {
                conn.send({
                    type: 'tracking_sync',
                    normBox: lockedTarget.normBox,
                    lost: lockedTarget.lost,
                    label: lockedTarget.label
                });
            }
        }
    } catch (err) {
        console.warn("AI hatası:", err);
    } finally {
        isDetecting = false;
    }
}

function computeIoU(b1, b2) {
    const xA = Math.max(b1[0], b2[0]);
    const yA = Math.max(b1[1], b2[1]);
    const xB = Math.min(b1[0] + b1[2], b2[0] + b2[2]);
    const yB = Math.min(b1[1] + b1[3], b2[1] + b2[3]);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const box1Area = b1[2] * b1[3];
    const box2Area = b2[2] * b2[3];

    return interArea / (box1Area + box2Area - interArea + 0.0001);
}

// =================== APPLE VİZÖR ÇİZİMİ (60 FPS LERP SMOOTHING) ===================
function drawAppleTarget(x, y, w, h, isLost, label) {
    const strokeColor = isLost ? '#ff453a' : '#ffffff';
    const cornerLen = Math.min(w, h, 28) * 0.45;
    const radius = 6;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = strokeColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 4 Köşe Vizör
    // Sol Üst
    ctx.beginPath();
    ctx.moveTo(x, y + cornerLen);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.lineTo(x + cornerLen, y);
    ctx.stroke();

    // Sağ Üst
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + cornerLen);
    ctx.stroke();

    // Sol Alt
    ctx.beginPath();
    ctx.moveTo(x, y + h - cornerLen);
    ctx.lineTo(x, y + h - radius);
    ctx.arcTo(x, y + h, x + radius, y + h, radius);
    ctx.lineTo(x + cornerLen, y + h);
    ctx.stroke();

    // Sağ Alt
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y + h);
    ctx.lineTo(x + w - radius, y + h);
    ctx.arcTo(x + w, y + h, x + w, y + h - radius, radius);
    ctx.lineTo(x + w, y + cornerLen);
    ctx.stroke();

    // Merkez Odak Noktası
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();

    // Apple Kapsül Etiketi
    const tagText = isLost ? `Kayıp: ${label}` : label;
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = ctx.measureText(tagText).width;
    const badgeH = 22;
    const badgeW = textW + 16;
    const badgeX = x + (w - badgeW) / 2;
    const badgeY = Math.max(8, y - badgeH - 6);

    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 11);
    ctx.fillStyle = isLost ? 'rgba(255, 69, 58, 0.92)' : 'rgba(28, 28, 30, 0.88)';
    ctx.fill();
    ctx.strokeStyle = isLost ? 'rgba(255, 69, 58, 0.4)' : 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, badgeX + badgeW / 2, badgeY + badgeH / 2);

    ctx.restore();
}

// =================== 60 FPS RENDER DÖNGÜSÜ ===================
function renderLoop() {
    if (cvs.width !== window.innerWidth || cvs.height !== window.innerHeight) {
        cvs.width = window.innerWidth;
        cvs.height = window.innerHeight;
    }

    ctx.clearRect(0, 0, cvs.width, cvs.height);

    if (isCamera) {
        // Kilit yokken algılanan kişilerin üzerine hafif vizör braketleri koy
        if (!lockedTarget) {
            for (const det of currentDetections) {
                const [sx, sy, sw, sh] = normBoxToScreenCoords(det.normBox);
                const trName = LABELS_TR[det.class] || det.class;

                ctx.save();
                ctx.strokeStyle = (det.class === 'person') ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(sx, sy, sw, sh, 8);
                ctx.stroke();

                ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
                const tw = ctx.measureText(trName).width;
                ctx.fillStyle = 'rgba(28, 28, 30, 0.75)';
                ctx.beginPath();
                ctx.roundRect(sx, Math.max(0, sy - 18), tw + 10, 16, 8);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.fillText(trName, sx + 5, Math.max(12, sy - 6));
                ctx.restore();
            }
        }

        // Kilitli hedef varsa LERP ile yağ gibi pürüzsüz takip et
        if (lockedTarget) {
            // LERP Enterpolasyonu
            const factor = 0.35;
            lockedTarget.lerpBox[0] += (lockedTarget.normBox[0] - lockedTarget.lerpBox[0]) * factor;
            lockedTarget.lerpBox[1] += (lockedTarget.normBox[1] - lockedTarget.lerpBox[1]) * factor;
            lockedTarget.lerpBox[2] += (lockedTarget.normBox[2] - lockedTarget.lerpBox[2]) * factor;
            lockedTarget.lerpBox[3] += (lockedTarget.normBox[3] - lockedTarget.lerpBox[3]) * factor;

            const [sx, sy, sw, sh] = normBoxToScreenCoords(lockedTarget.lerpBox);
            drawAppleTarget(sx, sy, sw, sh, lockedTarget.lost, lockedTarget.label);
        }
    } else {
        // İzleyici Ekranı Çizimi
        if (viewerTarget) {
            const factor = 0.35;
            viewerTarget.lerpBox[0] += (viewerTarget.normBox[0] - viewerTarget.lerpBox[0]) * factor;
            viewerTarget.lerpBox[1] += (viewerTarget.normBox[1] - viewerTarget.lerpBox[1]) * factor;
            viewerTarget.lerpBox[2] += (viewerTarget.normBox[2] - viewerTarget.lerpBox[2]) * factor;
            viewerTarget.lerpBox[3] += (viewerTarget.normBox[3] - viewerTarget.lerpBox[3]) * factor;

            const [sx, sy, sw, sh] = normBoxToScreenCoords(viewerTarget.lerpBox);
            drawAppleTarget(sx, sy, sw, sh, viewerTarget.lost, viewerTarget.label);
        }
    }

    requestAnimationFrame(renderLoop);
}

// 70ms aralıkla AI çıkarımı yap
setInterval(() => {
    if (isCamera) runAiDetection();
}, 70);

// =================== EKRANA DOKUNMA VE KİLİTLEME DİNLENMESİ ===================
cvs.addEventListener('pointerdown', (e) => {
    triggerFocusRing(e.clientX, e.clientY);
    const { normX, normY } = getNormalizedVideoCoords(e.clientX, e.clientY);

    if (isCamera) {
        // Kameracı ekrana dokununca anında kilitler
        lockTargetAtNormCoords(normX, normY);
    } else {
        // İzleyici ekrana dokununca kameraya kilitleme isteği gönderir
        playHapticBeep();
        if (conn && conn.open) {
            conn.send({
                type: 'tap_to_lock',
                normX,
                normY
            });
        }
    }
});

// =================== KAMERA BAŞLATMA ===================
document.getElementById('btnCam').addEventListener('click', startCamera);

async function startCamera() {
    const usernameInput = document.getElementById('username');
    const rawUsername = usernameInput ? usernameInput.value.trim() : '';
    if (!rawUsername) {
        alert('Lütfen 5 haneli bir şifre girin.');
        return;
    }
    const cleanUsername = rawUsername.replace(/[^0-9]/g, '');
    if (cleanUsername.length !== 5) {
        alert('Şifre 5 haneli rakamlardan oluşmalıdır.');
        return;
    }

    localStorage.setItem('cam_username', rawUsername);
    precode = cleanUsername;

    isCamera = true;
    document.getElementById('role').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    document.getElementById('cc').style.display = 'block';
    document.getElementById('lc').style.display = 'none';

    updateMirroring();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
    } catch (e) {
        alert('Kamera başlatılamadı: ' + e.name);
        location.reload();
        return;
    }

    vid.srcObject = localStream;
    vid.muted = true;

    loadAI();
    setupStealthMode();
    setupToggleButton();
    renderLoop();

    if (prepeer) {
        try { prepeer.destroy(); } catch(e) {}
    }
    prepeer = new Peer('cam-' + precode, { debug: 0 });

    prepeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            alert('Bu şifre kullanımda. Lütfen başka bir 5 haneli şifre girin.');
            location.reload();
        } else {
            cs.innerText = 'Hata: ' + err.type;
            cp.className = 'status-dot';
        }
    });

    document.getElementById('mc').innerText = precode;
    peer = prepeer;

    peer.on('open', () => {
        cs.innerText = 'İzleyici Bekleniyor';
        cp.className = 'status-dot active';
    });

    peer.on('connection', (c) => {
        conn = c;
        cs.innerText = 'İzleyici Bağlandı';

        c.on('data', (d) => {
            if (d.type === 'viewer_ready') {
                peer.call(c.peer, localStream);
            } else if (d.type === 'tap_to_lock') {
                // İzleyici bir kişiye dokundu! Anında o koordinatı kilitle!
                lockTargetAtNormCoords(d.normX, d.normY);
            } else if (d.type === 'unlock_request') {
                unlockTarget(false);
            } else if (d.type === 'alert_dismissed') {
                dismissAlert();
            }
        });

        c.on('close', () => {
            cs.innerText = 'İzleyici Ayrıldı';
            cp.className = 'status-dot';
        });

        c.on('error', () => {
            cs.innerText = 'Bağlantı Kesildi';
            cp.className = 'status-dot';
        });
    });
}

// =================== İZLEYİCİ MODU ===================
document.getElementById('btnView').addEventListener('click', () => {
    if (prepeer && !prepeer.destroyed) prepeer.destroy();
    document.getElementById('role').style.display = 'none';
    document.getElementById('vs').style.display = 'flex';
});

let viewerTarget = null;

document.getElementById('btnConn').addEventListener('click', () => {
    const rawCode = document.getElementById('jc').value.trim();
    const code = rawCode.replace(/[^0-9]/g, '');
    if (code.length !== 5) { alert('Lütfen 5 haneli şifreyi girin.'); return; }

    initAudio();

    document.getElementById('vs').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    document.getElementById('lc').style.display = 'block';
    document.getElementById('cc').style.display = 'none';

    isCamera = false;
    vid.muted = true;
    cs.innerText = 'Bağlanılıyor...';
    as_.innerText = 'Görüntü Bekleniyor';
    cp.className = 'status-dot';

    setupToggleButton();
    renderLoop();

    peer = new Peer({ debug: 0 });

    peer.on('open', () => {
        conn = peer.connect('cam-' + code);

        conn.on('open', () => {
            cs.innerText = 'Bağlandı';
            cp.className = 'status-dot active';
            as_.innerText = 'Canlı Yayın';
            targetStatusText.innerText = 'Kişiye dokunarak kilitleyin';

            conn.send({ type: 'viewer_ready' });
        });

        conn.on('data', (d) => {
            if (d.type === 'target_locked') {
                viewerTarget = {
                    class: d.target.class,
                    label: d.target.label,
                    normBox: [...d.target.normBox],
                    lerpBox: [...d.target.normBox],
                    lost: false
                };
                btnQuickUnlock.style.display = 'inline-block';
                targetStatusText.innerText = `Kilitli: ${viewerTarget.label}`;
                dismissAlert();
            } else if (d.type === 'tracking_sync') {
                if (viewerTarget) {
                    viewerTarget.normBox = d.normBox;
                    viewerTarget.lost = d.lost;
                    if (d.lost) {
                        targetStatusText.innerText = `Kayıp: ${viewerTarget.label}`;
                    } else {
                        targetStatusText.innerText = `Kilitli: ${viewerTarget.label}`;
                    }
                }
            } else if (d.type === 'target_lost') {
                triggerTargetLostAlert(d.targetLabel);
            } else if (d.type === 'target_unlocked') {
                viewerTarget = null;
                btnQuickUnlock.style.display = 'none';
                targetStatusText.innerText = 'Kişiye dokunarak kilitleyin';
                dismissAlert();
            } else if (d.type === 'alert_dismissed') {
                dismissAlert();
            }
        });

        conn.on('close', () => {
            cs.innerText = 'Bağlantı Kesildi';
            cp.className = 'status-dot';
            dismissAlert();
            alert('Kamera bağlantısı kapandı.');
            location.reload();
        });

        conn.on('error', () => {
            alert('Bağlantı hatası oluştu.');
            location.reload();
        });
    });

    peer.on('call', (ic) => {
        call = ic;
        ic.answer();
        ic.on('stream', (rs) => {
            if (!vid.srcObject) {
                vid.srcObject = rs;
                as_.innerText = 'Canlı Yayın';
            }
        });
    });

    peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') {
            alert('Kamera bulunamadı. Şifreyi kontrol edin.');
        } else {
            alert('Bağlantı kurulamadı: ' + e.type);
        }
        location.reload();
    });
});

btnQuickUnlock.addEventListener('click', () => {
    if (!isCamera && conn && conn.open) {
        conn.send({ type: 'unlock_request' });
        viewerTarget = null;
        btnQuickUnlock.style.display = 'none';
        targetStatusText.innerText = 'Kişiye dokunarak kilitleyin';
        dismissAlert();
    }
});

// =================== YARDIMCI VE ARAYÜZ FONKSİYONLARI ===================
function updateMirroring() {
    const shouldMirror = (currentFacingMode === 'user');
    vid.classList.toggle('mirror', shouldMirror);
}

async function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    vid.srcObject = null;
}

async function flipCamera() {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    await stopCamera();
    updateMirroring();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        vid.srcObject = localStream;
        vid.muted = true;

        if (conn && conn.open) {
            if (call) { try { call.close(); } catch(err) {} }
            call = peer.call(conn.peer, localStream);
        }
    } catch (e) {
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        updateMirroring();
    }
}

const btnFlipCamera = document.getElementById('btnFlipCamera');
if (btnFlipCamera) btnFlipCamera.addEventListener('click', flipCamera);

function setupStealthMode() {
    const stealthLogic = () => {
        document.getElementById('stealth').style.display = 'flex';
        document.getElementById('stealth-pin').value = '';
        document.getElementById('stealth-ui').style.display = 'none';
    };
    document.getElementById('btnHide').onclick = stealthLogic;

    document.getElementById('stealth').onclick = (e) => {
        if (e.target.id === 'stealth') {
            document.getElementById('stealth-ui').style.display = 'flex';
            document.getElementById('stealth-pin').focus();
        }
    };

    document.getElementById('stealth-unlock').onclick = () => {
        if (document.getElementById('stealth-pin').value === '7693') {
            document.getElementById('stealth').style.display = 'none';
            document.getElementById('stealth-ui').style.display = 'none';
        } else {
            alert('Hatalı PIN!');
            document.getElementById('stealth-pin').value = '';
            document.getElementById('stealth-ui').style.display = 'none';
        }
    };
}

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
    let uiHidden = false;

    btn.onclick = () => {
        uiHidden = !uiHidden;
        if (uiHidden) {
            container.style.maxHeight = '0px';
            container.style.opacity = '0';
            container.style.pointerEvents = 'none';
            bar.style.opacity = '0';
            bar.style.pointerEvents = 'none';
            btn.style.opacity = '0.4';
        } else {
            container.style.maxHeight = '500px';
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
            bar.style.opacity = '1';
            bar.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
        }
    };
}

let precode = '';
let prepeer = null;

window.onbeforeunload = () => {
    stopCamera();
    stopAlarmSound();
};

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('cam_username');
    if (savedUser && document.getElementById('username')) {
        document.getElementById('username').value = savedUser;
    }
});

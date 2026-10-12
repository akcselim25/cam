// ===================================================================
// CAM - AKILLI HEDEF TAKİP VE KAMERA SİSTEMİ (APPLE DESIGN)
// ===================================================================

const vid = document.getElementById('vid');
const cvs = document.getElementById('cvs');
const ctx = cvs.getContext('2d');
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

// =================== TÜRKÇE NESNE SÖZLÜĞÜ (COCO-SSD) ===================
const LABELS_TR = {
    'person': 'Kişi',
    'bicycle': 'Bisiklet',
    'car': 'Araç',
    'motorcycle': 'Motosiklet',
    'airplane': 'Uçak',
    'bus': 'Otobüs',
    'train': 'Tren',
    'truck': 'Kamyon',
    'boat': 'Tekne',
    'traffic light': 'Trafik Işığı',
    'fire hydrant': 'Yangın Musluğu',
    'stop sign': 'Dur Levhası',
    'bench': 'Bank',
    'bird': 'Kuş',
    'cat': 'Kedi',
    'dog': 'Köpek',
    'horse': 'At',
    'sheep': 'Koyun',
    'cow': 'İnek',
    'backpack': 'Sırt Çantası',
    'umbrella': 'Şemsiye',
    'handbag': 'Çanta',
    'suitcase': 'Bavul',
    'sports ball': 'Top',
    'bottle': 'Şişe',
    'cup': 'Bardak',
    'chair': 'Sandalye',
    'couch': 'Koltuk',
    'potted plant': 'Bitki',
    'bed': 'Yatak',
    'dining table': 'Masa',
    'tv': 'Ekran',
    'laptop': 'Dizüstü Bilgisayar',
    'mouse': 'Fare',
    'remote': 'Kumanda',
    'keyboard': 'Klavye',
    'cell phone': 'Telefon',
    'book': 'Kitap',
    'clock': 'Saat',
    'teddy bear': 'Oyuncak Ayı'
};

// =================== YAPAY ZEKA VE HEDEF KİLİTLEME ===================
let aiModel = null;
let isAiLoading = false;
let currentDetections = [];
let lockedTarget = null;
let isDetecting = false;

// Web Audio API Alarm ve Ton Sentezleyicisi
let audioCtx = null;
let alarmOsc1 = null;
let alarmOsc2 = null;
let alarmGain = null;
let isAlarmPlaying = false;
let vibInterval = null;

function initAudio() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Apple Radar / İkaz Tonu
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
    } catch (e) {
        console.warn("Ses çalınamadı:", e);
    }
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

// Zarif Haptic / Bip Sesi
function playLockSound() {
    initAudio();
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1600, audioCtx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {}
}

// Alarm ve Uyarı Tetikleme
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
        conn.send({ type: 'target_lost', targetLabel: targetLabel });
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

// =================== YAPAY ZEKA MODELİ YÜKLEME ===================
async function loadAI() {
    if (aiModel || isAiLoading) return;
    isAiLoading = true;
    targetStatusText.innerText = "Yapay Zeka hazırlanıyor...";
    try {
        aiModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        targetStatusText.innerText = "Hedefe dokunarak kilitleyin";
    } catch (e) {
        console.error("Yapay Zeka hatası:", e);
        targetStatusText.innerText = "Model yüklenemedi";
    } finally {
        isAiLoading = false;
    }
}

// =================== KAMERA YÖNETİMİ ===================
async function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    vid.srcObject = null;
}

function updateMirroring() {
    const shouldMirror = (currentFacingMode === 'user');
    vid.classList.toggle('mirror', shouldMirror);
    cvs.classList.toggle('mirror', shouldMirror);
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

// =================== HEDEF KİLİTLEME ===================
function unlockTarget(notifyPeer = true) {
    if (!lockedTarget) return;
    lockedTarget = null;
    btnQuickUnlock.style.display = 'none';
    targetStatusText.innerText = "Hedefe dokunarak kilitleyin";
    dismissAlert();

    if (notifyPeer && conn && conn.open) {
        conn.send({ type: 'target_unlocked' });
    }
}

btnQuickUnlock.addEventListener('click', () => unlockTarget(true));

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

function handleCanvasClick(clientX, clientY) {
    initAudio();
    const rect = cvs.getBoundingClientRect();
    const scaleX = cvs.width / rect.width;
    const scaleY = cvs.height / rect.height;

    let clickX = (clientX - rect.left) * scaleX;
    let clickY = (clientY - rect.top) * scaleY;

    if (currentFacingMode === 'user') {
        clickX = cvs.width - clickX;
    }

    let matched = null;
    let minDistance = Infinity;

    for (const det of currentDetections) {
        const [x, y, w, h] = det.bbox;
        if (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h) {
            matched = det;
            break;
        }
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        const dist = Math.hypot(clickX - centerX, clickY - centerY);
        if (dist < minDistance && dist < 140 * scaleX) {
            minDistance = dist;
            matched = det;
        }
    }

    if (matched) {
        const trName = LABELS_TR[matched.class] || matched.class;
        lockedTarget = {
            class: matched.class,
            label: trName,
            bbox: [...matched.bbox],
            score: matched.score,
            lastSeen: Date.now(),
            lost: false
        };
        playLockSound();
        targetStatusText.innerText = `Kilitli: ${trName}`;
        btnQuickUnlock.style.display = 'inline-block';
        dismissAlert();

        if (conn && conn.open) {
            conn.send({
                type: 'target_locked',
                target: {
                    class: matched.class,
                    label: trName,
                    bbox: matched.bbox,
                    score: matched.score
                }
            });
        }
    } else {
        const boxSize = Math.min(cvs.width, cvs.height) * 0.22;
        const bbox = [
            Math.max(0, clickX - boxSize / 2),
            Math.max(0, clickY - boxSize / 2),
            boxSize,
            boxSize
        ];
        lockedTarget = {
            class: 'custom',
            label: 'Seçili Alan',
            bbox: bbox,
            score: 1.0,
            lastSeen: Date.now(),
            lost: false
        };
        playLockSound();
        targetStatusText.innerText = `Kilitli: Hedef`;
        btnQuickUnlock.style.display = 'inline-block';
        dismissAlert();

        if (conn && conn.open) {
            conn.send({ type: 'target_locked', target: lockedTarget });
        }
    }
}

cvs.addEventListener('pointerdown', (e) => {
    handleCanvasClick(e.clientX, e.clientY);
});

// =================== AI TESPİT DÖNGÜSÜ ===================
async function runAiDetection() {
    if (!isCamera || !aiModel || vid.readyState < 2 || isDetecting) return;
    isDetecting = true;

    try {
        const predictions = await aiModel.detect(vid);
        currentDetections = predictions;

        if (lockedTarget) {
            let bestMatch = null;
            let highestIoU = 0;
            const prevCenter = [
                lockedTarget.bbox[0] + lockedTarget.bbox[2] / 2,
                lockedTarget.bbox[1] + lockedTarget.bbox[3] / 2
            ];

            for (const p of predictions) {
                const iou = computeIoU(lockedTarget.bbox, p.bbox);
                const curCenter = [p.bbox[0] + p.bbox[2] / 2, p.bbox[1] + p.bbox[3] / 2];
                const dist = Math.hypot(prevCenter[0] - curCenter[0], prevCenter[1] - curCenter[1]);

                if (p.class === lockedTarget.class) {
                    if (iou > highestIoU || (dist < 160 && highestIoU < 0.2)) {
                        highestIoU = iou;
                        bestMatch = p;
                    }
                } else if (lockedTarget.class === 'custom' && iou > 0.25) {
                    if (iou > highestIoU) {
                        highestIoU = iou;
                        bestMatch = p;
                    }
                }
            }

            if (bestMatch) {
                lockedTarget.bbox = bestMatch.bbox;
                lockedTarget.score = bestMatch.score;
                lockedTarget.lastSeen = Date.now();

                if (lockedTarget.lost) {
                    lockedTarget.lost = false;
                    targetStatusText.innerText = `Kilitli: ${lockedTarget.label}`;
                    dismissAlert();
                }
            } else {
                const now = Date.now();
                if (now - lockedTarget.lastSeen > 1500) {
                    if (!lockedTarget.lost) {
                        lockedTarget.lost = true;
                        targetStatusText.innerText = `Kayıp: ${lockedTarget.label}`;
                        triggerTargetLostAlert(lockedTarget.label);
                    }
                }
            }

            if (conn && conn.open) {
                conn.send({
                    type: 'tracking_update',
                    target: lockedTarget
                });
            }
        }
    } catch (err) {
        console.warn("AI tespit hatası:", err);
    } finally {
        isDetecting = false;
    }
}

// =================== APPLE VİZÖR STİLİ HEDEF ÇİZİMİ ===================
function drawAppleTarget(x, y, w, h, isLost, label) {
    const strokeColor = isLost ? '#ff453a' : '#ffffff';
    const cornerLen = Math.min(w, h, 28) * 0.45;
    const radius = 6;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = strokeColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 4 Köşe Vizör Çizgileri
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
    ctx.lineTo(x + w, y + h - cornerLen);
    ctx.stroke();

    // Merkez Nokta
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();

    // Apple Tarzı Etiket Kapsülü (Pill Badge)
    const tagText = isLost ? `Kayıp: ${label}` : label;
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = ctx.measureText(tagText).width;
    const badgeH = 22;
    const badgeW = textW + 16;
    const badgeX = x + (w - badgeW) / 2;
    const badgeY = Math.max(8, y - badgeH - 6);

    // Kapsül arka planı
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 11);
    ctx.fillStyle = isLost ? 'rgba(255, 69, 58, 0.9)' : 'rgba(28, 28, 30, 0.85)';
    ctx.fill();
    ctx.strokeStyle = isLost ? 'rgba(255, 69, 58, 0.3)' : 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Kapsül metni
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, badgeX + badgeW / 2, badgeY + badgeH / 2);

    ctx.restore();
}

// =================== ÇİZİM DÖNGÜSÜ ===================
function drawLoop() {
    if (!isCamera) return;

    if (vid.readyState >= 2) {
        if (cvs.width !== vid.videoWidth || cvs.height !== vid.videoHeight) {
            cvs.width = vid.videoWidth || 640;
            cvs.height = vid.videoHeight || 480;
        }

        ctx.clearRect(0, 0, cvs.width, cvs.height);

        // Kilit yokken algılanan diğer nesneler ince görünür
        if (!lockedTarget) {
            for (const det of currentDetections) {
                const [x, y, w, h] = det.bbox;
                const trName = LABELS_TR[det.class] || det.class;

                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(x, y, w, h, 8);
                ctx.stroke();

                ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
                const tw = ctx.measureText(trName).width;
                ctx.fillStyle = 'rgba(28, 28, 30, 0.7)';
                ctx.beginPath();
                ctx.roundRect(x, Math.max(0, y - 18), tw + 10, 16, 8);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.fillText(trName, x + 5, Math.max(12, y - 6));
                ctx.restore();
            }
        }

        // Kilitli hedef
        if (lockedTarget) {
            const [x, y, w, h] = lockedTarget.bbox;
            drawAppleTarget(x, y, w, h, lockedTarget.lost, lockedTarget.label);
        }
    }

    requestAnimationFrame(drawLoop);
}

setInterval(() => {
    if (isCamera) runAiDetection();
}, 120);

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

    // Ekranı Karart
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

    setupToggleButton();

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

    const setupHost = () => {
        cs.innerText = 'İzleyici Bekleniyor';
        cp.className = 'status-dot active';
        drawLoop();
    };

    if (peer.open) {
        setupHost();
    } else {
        cs.innerText = 'Bağlanıyor...';
        peer.on('open', setupHost);
    }

    peer.on('connection', (c) => {
        conn = c;
        cs.innerText = 'İzleyici Bağlandı';

        c.on('data', (d) => {
            if (d.type === 'viewer_ready') {
                peer.call(c.peer, localStream);
            } else if (d.type === 'tap_lock') {
                const x = d.xRatio * cvs.width;
                const y = d.yRatio * cvs.height;
                handleCanvasClick(x, y);
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

    peer = new Peer({ debug: 0 });

    peer.on('open', () => {
        conn = peer.connect('cam-' + code);

        conn.on('open', () => {
            cs.innerText = 'Bağlandı';
            cp.className = 'status-dot active';
            as_.innerText = 'Canlı Yayın';
            targetStatusText.innerText = 'Hedefe dokunarak kilitleyin';

            conn.send({ type: 'viewer_ready' });
            viewerDrawLoop();
        });

        conn.on('data', handleViewerData);

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

let viewerLockedTarget = null;
function handleViewerData(d) {
    if (d.type === 'tracking_update') {
        viewerLockedTarget = d.target;
        if (viewerLockedTarget) {
            btnQuickUnlock.style.display = 'inline-block';
            if (viewerLockedTarget.lost) {
                targetStatusText.innerText = `Kayıp: ${viewerLockedTarget.label}`;
            } else {
                targetStatusText.innerText = `Kilitli: ${viewerLockedTarget.label}`;
            }
        } else {
            btnQuickUnlock.style.display = 'none';
            targetStatusText.innerText = 'Hedefe dokunarak kilitleyin';
        }
    } else if (d.type === 'target_lost') {
        triggerTargetLostAlert(d.targetLabel);
    } else if (d.type === 'alert_dismissed') {
        dismissAlert();
    } else if (d.type === 'target_unlocked') {
        viewerLockedTarget = null;
        btnQuickUnlock.style.display = 'none';
        targetStatusText.innerText = 'Hedefe dokunarak kilitleyin';
        dismissAlert();
    }
}

function viewerDrawLoop() {
    if (isCamera) return;

    if (vid.readyState >= 2) {
        if (cvs.width !== vid.videoWidth || cvs.height !== vid.videoHeight) {
            cvs.width = vid.videoWidth || 640;
            cvs.height = vid.videoHeight || 480;
        }

        ctx.clearRect(0, 0, cvs.width, cvs.height);

        if (viewerLockedTarget) {
            const [x, y, w, h] = viewerLockedTarget.bbox;
            drawAppleTarget(x, y, w, h, viewerLockedTarget.lost, viewerLockedTarget.label);
        }
    }

    requestAnimationFrame(viewerDrawLoop);
}

cvs.addEventListener('click', (e) => {
    if (!isCamera && conn && conn.open) {
        const rect = cvs.getBoundingClientRect();
        const xRatio = (e.clientX - rect.left) / rect.width;
        const yRatio = (e.clientY - rect.top) / rect.height;
        conn.send({ type: 'tap_lock', xRatio, yRatio });
    }
});

btnQuickUnlock.addEventListener('click', () => {
    if (!isCamera && conn && conn.open) {
        conn.send({ type: 'unlock_request' });
        viewerLockedTarget = null;
        btnQuickUnlock.style.display = 'none';
        targetStatusText.innerText = 'Hedefe dokunarak kilitleyin';
        dismissAlert();
    }
});

// Arayüz Göster / Gizle Butonu
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

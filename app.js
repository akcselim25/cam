// ===================================================================
// NURSENA AI CAM - AKILLI HEDEF TAKİP VE GÜVENLİK SİSTEMİ
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
let currentFacingMode = 'environment'; // Varsayılan arka kamera
let localStream = null;

// =================== TÜRKÇE NESNE SÖZLÜĞÜ (COCO-SSD 80 SINIF) ===================
const LABELS_TR = {
    'person': 'İnsan / Kişi',
    'bicycle': 'Bisiklet',
    'car': 'Araba',
    'motorcycle': 'Motosiklet',
    'airplane': 'Uçak',
    'bus': 'Otobüs',
    'train': 'Tren',
    'truck': 'Kamyon',
    'boat': 'Tekne',
    'traffic light': 'Trafik Işığı',
    'fire hydrant': 'Yangın Musluğu',
    'stop sign': 'Dur Levhası',
    'parking meter': 'Parkmetresi',
    'bench': 'Bank',
    'bird': 'Kuş',
    'cat': 'Kedi',
    'dog': 'Köpek',
    'horse': 'At',
    'sheep': 'Koyun',
    'cow': 'İnek',
    'elephant': 'Fil',
    'bear': 'Ayı',
    'zebra': 'Zebra',
    'giraffe': 'Zürafa',
    'backpack': 'Sırt Çantası',
    'umbrella': 'Şemsiye',
    'handbag': 'El Çantası',
    'tie': 'Kravat',
    'suitcase': 'Bavul',
    'frisbee': 'Frizbi',
    'skis': 'Kayak',
    'snowboard': 'Snowboard',
    'sports ball': 'Top',
    'kite': 'Uçurtma',
    'baseball bat': 'Beyzbol Sopası',
    'baseball glove': 'Beyzbol Eldiveni',
    'skateboard': 'Kaykay',
    'surfboard': 'Sörf Tahtası',
    'tennis racket': 'Tenis Raketi',
    'bottle': 'Şişe',
    'wine glass': 'Kadeh',
    'cup': 'Fincan / Bardak',
    'fork': 'Çatal',
    'knife': 'Bıçak',
    'spoon': 'Kaşık',
    'bowl': 'Kase',
    'banana': 'Muz',
    'apple': 'Elma',
    'sandwich': 'Sandviç',
    'orange': 'Portakal',
    'broccoli': 'Brokoli',
    'carrot': 'Havuç',
    'hot dog': 'Sosisli',
    'pizza': 'Pizza',
    'donut': 'Donut',
    'cake': 'Pasta / Kek',
    'chair': 'Sandalye',
    'couch': 'Koltuk / Kanepe',
    'potted plant': 'Saksı Bitkisi',
    'bed': 'Yatak',
    'dining table': 'Yemek Masası',
    'toilet': 'Tuvalet',
    'tv': 'Televizyon / Monitör',
    'laptop': 'Dizüstü Bilgisayar',
    'mouse': 'Fare',
    'remote': 'Uzaktan Kumanda',
    'keyboard': 'Klavye',
    'cell phone': 'Cep Telefonu',
    'microwave': 'Mikrodalga',
    'oven': 'Fırın',
    'toaster': 'Tost Makinesi',
    'sink': 'Lavabo',
    'refrigerator': 'Buzdolabı',
    'book': 'Kitap',
    'clock': 'Saat',
    'vase': 'Vazo',
    'scissors': 'Makas',
    'teddy bear': 'Oyuncak Ayı',
    'hair drier': 'Saç Kurutma Makinesi',
    'toothbrush': 'Diş Fırçası'
};

// =================== YAPAY ZEKA VE HEDEF KİLİTLEME ===================
let aiModel = null;
let isAiLoading = false;
let currentDetections = [];
let lockedTarget = null; // { class, label, bbox: [x,y,w,h], score, lastSeen, lost: false }
let isDetecting = false;

// Web Audio API Alarm Siren Sentezleyicisi
let audioCtx = null;
let sirenOsc1 = null;
let sirenOsc2 = null;
let sirenGain = null;
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

// Güçlü Çift Tonlu Güvenlik Sireni
function startAlarmSound() {
    if (isAlarmPlaying) return;
    initAudio();
    if (!audioCtx) return;

    try {
        isAlarmPlaying = true;
        sirenGain = audioCtx.createGain();
        sirenGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        sirenGain.connect(audioCtx.destination);

        sirenOsc1 = audioCtx.createOscillator();
        sirenOsc2 = audioCtx.createOscillator();
        sirenOsc1.type = 'sawtooth';
        sirenOsc2.type = 'square';

        sirenOsc1.connect(sirenGain);
        sirenOsc2.connect(sirenGain);

        // Periyodik siren modülasyonu
        const now = audioCtx.currentTime;
        sirenOsc1.frequency.setValueAtTime(800, now);
        sirenOsc2.frequency.setValueAtTime(1200, now);

        let toggle = false;
        window._sirenTimer = setInterval(() => {
            if (!isAlarmPlaying || !audioCtx) return;
            const t = audioCtx.currentTime;
            toggle = !toggle;
            if (sirenOsc1) sirenOsc1.frequency.setValueAtTime(toggle ? 600 : 1000, t);
            if (sirenOsc2) sirenOsc2.frequency.setValueAtTime(toggle ? 900 : 1400, t);
        }, 300);

        sirenOsc1.start();
        sirenOsc2.start();
    } catch (e) {
        console.warn("Alarm sesi başlatılamadı:", e);
    }
}

function stopAlarmSound() {
    if (!isAlarmPlaying) return;
    isAlarmPlaying = false;
    if (window._sirenTimer) {
        clearInterval(window._sirenTimer);
        window._sirenTimer = null;
    }
    try {
        if (sirenOsc1) { sirenOsc1.stop(); sirenOsc1.disconnect(); sirenOsc1 = null; }
        if (sirenOsc2) { sirenOsc2.stop(); sirenOsc2.disconnect(); sirenOsc2 = null; }
        if (sirenGain) { sirenGain.disconnect(); sirenGain = null; }
    } catch (e) {}
}

// Hafif kilit bip sesi
function playLockBeep() {
    initAudio();
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1800, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
    } catch (e) {}
}

// Alarmı ve titreşimi başlat
function triggerTargetLostAlert(targetLabel) {
    alertTitle.innerText = "🚨 HEDEF KADRAJDAN ÇIKTI!";
    alertMsg.innerText = `Kilitlenen hedef (${targetLabel}) görüş alanından ayrıldı!`;
    alertBox.style.display = 'flex';

    startAlarmSound();

    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
    if (vibInterval) clearInterval(vibInterval);
    vibInterval = setInterval(() => {
        if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
    }, 1500);

    if (conn && conn.open) {
        conn.send({ type: 'target_lost', targetLabel: targetLabel });
    }
}

// Alarmı kapat
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

// =================== YAPAY ZEKA MODELİNİ YÜKLEME ===================
async function loadAI() {
    if (aiModel || isAiLoading) return;
    isAiLoading = true;
    targetStatusText.innerText = "🤖 Yapay Zeka modeli yükleniyor...";
    try {
        // En yüksek doğruluk ve hız için lite mobilenet v2
        aiModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        targetStatusText.innerText = "🎯 Hedefe dokunarak kilitleyin";
        console.log("Yapay Zeka (COCO-SSD) başarıyla yüklendi.");
    } catch (e) {
        console.error("Yapay Zeka yüklenirken hata:", e);
        targetStatusText.innerText = "⚠️ Yapay Zeka yüklenemedi!";
    } finally {
        isAiLoading = false;
    }
}

// =================== KAMERA HAREKET & YÖN YÖNETİMİ ===================
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
        console.error("Kamera çevrilemedi:", e);
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        updateMirroring();
    }
}

const btnFlipCamera = document.getElementById('btnFlipCamera');
if (btnFlipCamera) btnFlipCamera.addEventListener('click', flipCamera);

// =================== HEDEF KİLİTLEME & KİLİT ÇÖZME ===================
function unlockTarget(notifyPeer = true) {
    if (!lockedTarget) return;
    lockedTarget = null;
    btnQuickUnlock.style.display = 'none';
    targetStatusText.innerText = "🎯 Hedefe dokunarak kilitleyin";
    dismissAlert();

    if (notifyPeer && conn && conn.open) {
        conn.send({ type: 'target_unlocked' });
    }
}

btnQuickUnlock.addEventListener('click', () => unlockTarget(true));

// İki kutu arasındaki IoU (Kesişim / Birleşim Oranı)
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

// Ekrana tıklandığında hedef kilitleme
function handleCanvasClick(clientX, clientY) {
    initAudio();
    const rect = cvs.getBoundingClientRect();
    const scaleX = cvs.width / rect.width;
    const scaleY = cvs.height / rect.height;

    // Tıklanan gerçek canvas koordinatı
    let clickX = (clientX - rect.left) * scaleX;
    let clickY = (clientY - rect.top) * scaleY;

    // Ön kamera açıksa ve aynalama varsa X eksenini ters çevir
    if (currentFacingMode === 'user') {
        clickX = cvs.width - clickX;
    }

    // 1. Tıklanan noktanın içinde kaldığı bir AI tespiti var mı?
    let matched = null;
    let minDistance = Infinity;

    for (const det of currentDetections) {
        const [x, y, w, h] = det.bbox;
        if (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h) {
            matched = det;
            break;
        }
        // İçinde değilse en yakın nesnenin merkezine mesafeyi kontrol et
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        const dist = Math.hypot(clickX - centerX, clickY - centerY);
        if (dist < minDistance && dist < 120 * scaleX) {
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
        playLockBeep();
        targetStatusText.innerText = `🔒 KİLİTLİ: ${trName}`;
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
        // Tıklanan yerde hazır nesne yoksa serbest hedef kutusu oluştur
        const boxSize = Math.min(cvs.width, cvs.height) * 0.22;
        const bbox = [
            Math.max(0, clickX - boxSize / 2),
            Math.max(0, clickY - boxSize / 2),
            boxSize,
            boxSize
        ];
        lockedTarget = {
            class: 'custom',
            label: 'Özel Hedef',
            bbox: bbox,
            score: 1.0,
            lastSeen: Date.now(),
            lost: false
        };
        playLockBeep();
        targetStatusText.innerText = `🔒 KİLİTLİ: Özel Hedef`;
        btnQuickUnlock.style.display = 'inline-block';
        dismissAlert();

        if (conn && conn.open) {
            conn.send({
                type: 'target_locked',
                target: lockedTarget
            });
        }
    }
}

cvs.addEventListener('pointerdown', (e) => {
    handleCanvasClick(e.clientX, e.clientY);
});

// =================== YAPAY ZEKA TESPİT VE TAKİP DÖNGÜSÜ ===================
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

            // Önce aynı sınıfa ve en yüksek örtüşmeye/yakınlığa sahip tespiti ara
            for (const p of predictions) {
                const iou = computeIoU(lockedTarget.bbox, p.bbox);
                const curCenter = [p.bbox[0] + p.bbox[2] / 2, p.bbox[1] + p.bbox[3] / 2];
                const dist = Math.hypot(prevCenter[0] - curCenter[0], prevCenter[1] - curCenter[1]);

                if (p.class === lockedTarget.class) {
                    if (iou > highestIoU || (dist < 150 && highestIoU < 0.2)) {
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
                // Hedef başarıyla bulundu ve takip ediliyor
                lockedTarget.bbox = bestMatch.bbox;
                lockedTarget.score = bestMatch.score;
                lockedTarget.lastSeen = Date.now();

                if (lockedTarget.lost) {
                    // Hedef tekrar kadraja girdi!
                    lockedTarget.lost = false;
                    targetStatusText.innerText = `🔒 KİLİTLİ: ${lockedTarget.label}`;
                    dismissAlert();
                }
            } else {
                // Hedef son 1.5 saniyedir tespit edilemediyse ALARM VER!
                const now = Date.now();
                if (now - lockedTarget.lastSeen > 1500) {
                    if (!lockedTarget.lost) {
                        lockedTarget.lost = true;
                        targetStatusText.innerText = `🚨 KAYIP: ${lockedTarget.label} (KADRAJDAN ÇIKTI!)`;
                        triggerTargetLostAlert(lockedTarget.label);
                    }
                }
            }

            // İzleyiciye senkron hedef durumu ilet
            if (conn && conn.open) {
                conn.send({
                    type: 'tracking_update',
                    target: lockedTarget,
                    videoW: vid.videoWidth,
                    videoH: vid.videoHeight
                });
            }
        }
    } catch (err) {
        console.warn("AI tespit hatası:", err);
    } finally {
        isDetecting = false;
    }
}

// =================== FÜTÜRİSTİK SİBER HEDEF NİŞANGAH ÇİZİMİ ===================
function drawFuturisticCrosshair(x, y, w, h, isLost, label, score) {
    const color = isLost ? '#ff0055' : '#00ffff';
    const corner = Math.min(w, h) * 0.25;

    ctx.save();
    ctx.lineWidth = isLost ? 3 : 2.5;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;

    // 4 Köşe L Çizgileri
    // Sol Üst
    ctx.beginPath();
    ctx.moveTo(x, y + corner);
    ctx.lineTo(x, y);
    ctx.lineTo(x + corner, y);
    ctx.stroke();

    // Sağ Üst
    ctx.beginPath();
    ctx.moveTo(x + w - corner, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + corner);
    ctx.stroke();

    // Sol Alt
    ctx.beginPath();
    ctx.moveTo(x, y + h - corner);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + corner, y + h);
    ctx.stroke();

    // Sağ Alt
    ctx.beginPath();
    ctx.moveTo(x + w - corner, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - corner);
    ctx.stroke();

    // Merkez Artı (+) İşareti
    const cx = x + w / 2;
    const cy = y + h / 2;
    const cSize = 10;
    ctx.beginPath();
    ctx.moveTo(cx - cSize, cy);
    ctx.lineTo(cx + cSize, cy);
    ctx.moveTo(cx, cy - cSize);
    ctx.lineTo(cx, cy + cSize);
    ctx.stroke();

    // Hedef Bilgi Etiketi
    ctx.fillStyle = isLost ? 'rgba(255, 0, 85, 0.85)' : 'rgba(0, 255, 255, 0.85)';
    const text = isLost 
        ? `⚠️ [HEDEF KAYIP: ${label.toUpperCase()}]` 
        : `🔒 [KİLİTLİ: ${label.toUpperCase()} %${Math.round((score || 1) * 100)}]`;
    
    ctx.font = 'bold 12px "Outfit", sans-serif';
    const textWidth = ctx.measureText(text).width;
    const tagH = 20;
    const tagY = Math.max(0, y - tagH - 4);

    ctx.fillRect(x, tagY, textWidth + 14, tagH);

    ctx.fillStyle = '#000';
    ctx.fillText(text, x + 7, tagY + 14);

    ctx.restore();
}

// =================== ÇİZİM VE RENDER DÖNGÜSÜ ===================
function drawLoop() {
    if (!isCamera) return;

    if (vid.readyState >= 2) {
        if (cvs.width !== vid.videoWidth || cvs.height !== vid.videoHeight) {
            cvs.width = vid.videoWidth || 640;
            cvs.height = vid.videoHeight || 480;
        }

        ctx.clearRect(0, 0, cvs.width, cvs.height);

        // Yapay zekanın algıladığı diğer nesneleri ince çerçeveyle göster
        if (!lockedTarget) {
            for (const det of currentDetections) {
                const [x, y, w, h] = det.bbox;
                const trName = LABELS_TR[det.class] || det.class;

                ctx.save();
                ctx.strokeStyle = 'rgba(0, 255, 255, 0.35)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x, y, w, h);

                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                const tag = `${trName} %${Math.round(det.score * 100)}`;
                ctx.font = '11px "Outfit", sans-serif';
                const tw = ctx.measureText(tag).width;
                ctx.fillRect(x, Math.max(0, y - 16), tw + 8, 16);

                ctx.fillStyle = '#00ffff';
                ctx.fillText(tag, x + 4, Math.max(12, y - 4));
                ctx.restore();
            }
        }

        // Kilitli hedefi fütüristik nişangah ile çiz
        if (lockedTarget) {
            const [x, y, w, h] = lockedTarget.bbox;
            drawFuturisticCrosshair(x, y, w, h, lockedTarget.lost, lockedTarget.label, lockedTarget.score);
        }
    }

    requestAnimationFrame(drawLoop);
}

// Düzenli aralıklarla AI tespitini tetikle (120ms)
setInterval(() => {
    if (isCamera) runAiDetection();
}, 120);

// =================== KAMERA BAŞLATMA ===================
document.getElementById('btnCam').addEventListener('click', startCamera);

async function startCamera() {
    const usernameInput = document.getElementById('username');
    const rawUsername = usernameInput ? usernameInput.value.trim() : '';
    if (!rawUsername) {
        alert('Lütfen 5 haneli bir şifre girin!');
        return;
    }
    const cleanUsername = rawUsername.replace(/[^0-9]/g, '');
    if (cleanUsername.length !== 5) {
        alert('Şifre tam olarak 5 haneli rakamlardan oluşmalıdır!');
        return;
    }

    localStorage.setItem('nursena_username', rawUsername);
    precode = cleanUsername;

    isCamera = true;
    document.getElementById('role').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    document.getElementById('cc').style.display = 'block';
    document.getElementById('lc').style.display = 'none';

    updateMirroring();

    // Kamerayı aç
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
    } catch (e) {
        alert('Kamera açılamadı: ' + e.name);
        location.reload();
        return;
    }

    vid.srcObject = localStream;
    vid.muted = true;

    // Yapay Zeka Modelini Başlat
    loadAI();

    // Ekranı Karart (Gizli Mod) Butonu
    const stealthLogic = () => {
        document.getElementById('stealth').style.display = 'flex';
        document.getElementById('stealth-pin').value = '';
        document.getElementById('stealth-ui').style.display = 'none';
    };
    document.getElementById('btnHide').onclick = stealthLogic;

    // Simsiyah ekrana tıklayınca şifre sorma alanını aç
    document.getElementById('stealth').onclick = (e) => {
        if (e.target.id === 'stealth') {
            document.getElementById('stealth-ui').style.display = 'flex';
            document.getElementById('stealth-pin').focus();
        }
    };

    // Şifre kontrol tuşu (7693)
    document.getElementById('stealth-unlock').onclick = () => {
        if (document.getElementById('stealth-pin').value === '7693') {
            document.getElementById('stealth').style.display = 'none';
            document.getElementById('stealth-ui').style.display = 'none';
        } else {
            alert('Yanlış Şifre!');
            document.getElementById('stealth-pin').value = '';
            document.getElementById('stealth-ui').style.display = 'none';
        }
    };

    // Sağ üst arayüz gizle/göster butonu
    setupToggleButton();

    // Peer nesnesi oluştur
    if (prepeer) {
        try { prepeer.destroy(); } catch(e) {}
    }
    prepeer = new Peer('phtrck-' + precode, { debug: 0 });

    prepeer.on('error', (err) => {
        console.error("Peer hatası:", err);
        if (err.type === 'unavailable-id') {
            alert('Bu şifre şu an kullanımda! Lütfen başka bir 5 haneli şifre girin.');
            location.reload();
        } else {
            cs.innerText = 'Hata: ' + err.type;
            cp.className = 'p';
        }
    });

    document.getElementById('mc').innerText = precode;
    peer = prepeer;

    const setupHost = () => {
        cs.innerText = 'Hazır — İzleyici bekleniyor';
        cp.className = 'p g';
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
        cs.innerText = 'İzleyici bağlandı!';

        c.on('data', (d) => {
            if (d.type === 'viewer_ready') {
                peer.call(c.peer, localStream);
            } else if (d.type === 'tap_lock') {
                // İzleyici de ekrana dokunarak hedef kilitleyebilir
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
            cs.innerText = 'İzleyici ayrıldı';
            cp.className = 'p';
        });

        c.on('error', (err) => {
            cs.innerText = 'Bağlantı koptu';
            cp.className = 'p';
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
    if (code.length !== 5) { alert('Lütfen 5 haneli şifreyi girin!'); return; }

    initAudio();

    document.getElementById('vs').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    document.getElementById('lc').style.display = 'block';
    document.getElementById('cc').style.display = 'none';

    isCamera = false;
    vid.muted = true;
    cs.innerText = 'Bağlanılıyor...';
    as_.innerText = 'Görüntü bekleniyor';
    cp.className = 'p';

    setupToggleButton();

    peer = new Peer({ debug: 0 });

    peer.on('open', () => {
        conn = peer.connect('phtrck-' + code);

        conn.on('open', () => {
            cs.innerText = 'Kameraya Bağlandı!';
            cp.className = 'p g';
            as_.innerText = 'CANLI İZLENİYOR';
            targetStatusText.innerText = '🎯 Ekrana dokunarak hedef kilitleyebilirsiniz';

            conn.send({ type: 'viewer_ready' });
            viewerDrawLoop();
        });

        conn.on('data', handleViewerData);

        conn.on('close', () => {
            cs.innerText = 'Bağlantı koptu!';
            cp.className = 'p';
            dismissAlert();
            alert('Kamera bağlantısı kapandı! Ana menüye dönülüyor.');
            location.reload();
        });

        conn.on('error', (err) => {
            alert('Bağlantıda bir hata oluştu!');
            location.reload();
        });
    });

    peer.on('call', (ic) => {
        call = ic;
        ic.answer();
        ic.on('stream', (rs) => {
            if (!vid.srcObject) {
                vid.srcObject = rs;
                as_.innerText = '✅ Canlı İzleniyor';
                as_.style.color = '#00ffff';
            }
        });
    });

    peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') {
            alert('Kamera bulunamadı! 5 haneli şifreyi doğru girdiğinizden emin olun.');
        } else {
            alert('Bağlantı kurulamadı: ' + e.type);
        }
        location.reload();
    });
});

// İzleyici veri dinleyicisi
let viewerLockedTarget = null;
function handleViewerData(d) {
    if (d.type === 'tracking_update') {
        viewerLockedTarget = d.target;
        if (viewerLockedTarget) {
            btnQuickUnlock.style.display = 'inline-block';
            if (viewerLockedTarget.lost) {
                targetStatusText.innerText = `🚨 KAYIP: ${viewerLockedTarget.label}`;
            } else {
                targetStatusText.innerText = `🔒 KİLİTLİ: ${viewerLockedTarget.label}`;
            }
        } else {
            btnQuickUnlock.style.display = 'none';
            targetStatusText.innerText = '🎯 Ekrana dokunarak hedef kilitleyebilirsiniz';
        }
    } else if (d.type === 'target_lost') {
        triggerTargetLostAlert(d.targetLabel);
    } else if (d.type === 'alert_dismissed') {
        dismissAlert();
    } else if (d.type === 'target_unlocked') {
        viewerLockedTarget = null;
        btnQuickUnlock.style.display = 'none';
        targetStatusText.innerText = '🎯 Ekrana dokunarak hedef kilitleyebilirsiniz';
        dismissAlert();
    }
}

// İzleyici ekranı çizim döngüsü
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
            drawFuturisticCrosshair(
                x, y, w, h,
                viewerLockedTarget.lost,
                viewerLockedTarget.label,
                viewerLockedTarget.score
            );
        }
    }

    requestAnimationFrame(viewerDrawLoop);
}

// İzleyici canvas tıklaması ile kameraya kilit isteği gönderme
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
        targetStatusText.innerText = '🎯 Ekrana dokunarak hedef kilitleyebilirsiniz';
        dismissAlert();
    }
});

// =================== ARAYÜZ GİZLE / GÖSTER GÖZ BUTONU ===================
function setupToggleButton() {
    const container = document.getElementById('controls-container');
    const bar = document.getElementById('bar');
    const btn = document.getElementById('btnToggleUI');

    container.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    container.style.maxHeight = '500px';
    container.style.opacity = '1';

    bar.style.transition = 'all 0.4s ease';

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
            btn.style.opacity = '0.5';
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
    const savedUser = localStorage.getItem('nursena_username');
    if (savedUser && document.getElementById('username')) {
        document.getElementById('username').value = savedUser;
    }
});

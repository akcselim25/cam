// ===================================================================
// NURSENA CAM - YÜKSEK PERFORMANSLI KAMERA & BEBEK TAKİP SİSTEMİ
// ===================================================================

const vid = document.getElementById('vid');
const cvs = document.getElementById('cvs');
const ctx = cvs.getContext('2d');
const alertBox = document.getElementById('alert');
const cs = document.getElementById('cs');
const as_ = document.getElementById('as');
const cp = document.getElementById('cp');

let peer = null, conn = null, call = null;
let isCamera = false;
let isBabyMode = false;
let currentFacingMode = 'environment'; // Varsayılan arka kamera
let localStream = null;

let isAlerting = false;
let vibInt = null;
let currentFilter = 'none'; // 'none', 'thermal', 'night'

// =================== KAMERA HAREKET & YÖN YÖNETİMİ ===================

async function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    vid.srcObject = null;
}

// Aynalama (mirror) sınıfını kameranın yönüne göre güncelle
function updateMirroring() {
    const shouldMirror = (currentFacingMode === 'user');
    vid.classList.toggle('mirror', shouldMirror);
    cvs.classList.toggle('mirror', shouldMirror);
}

async function flipCamera() {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    console.log("Kamera yönü değiştiriliyor:", currentFacingMode);
    
    // Hızlı geçiş için mevcut akışı durdur
    await stopCamera();
    
    // Aynalama ayarını hemen güncelle
    updateMirroring();
    
    // Kamerayı yeni yönle tekrar başlat
    try {
        let constraints = {
            video: { 
                facingMode: currentFacingMode, 
                width: { ideal: 640 }, 
                height: { ideal: 480 } 
            },
            audio: isBabyMode
        };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        vid.srcObject = localStream;
        vid.muted = true;
        
        // Eğer bebek modu aktifse, ses/hareket izleyicilerini de yeni akışa bağlayalım
        if (isBabyMode) {
            startAudioMonitoring(localStream);
        }
        
        console.log("Kamera başarıyla çevrildi.");
            
        // Eğer aktif bir izleyici varsa yeni stream ile aramayı yenileyelim (Donmayı önlemek için)
        if (conn && conn.open) {
            console.log("İzleyiciye yeni akış gönderiliyor...");
            if (call) {
                try { call.close(); } catch(err) {}
            }
            call = peer.call(conn.peer, localStream);
        }
    } catch (e) {
        console.error("Kamera çevrilirken hata oluştu:", e);
        // Hata durumunda diğer yönü dene
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        updateMirroring();
        alert("Kamera çevrilemedi: " + e.message);
    }
}

// Buton dinleyicilerini bağla
const btnFlipCamera = document.getElementById('btnFlipCamera');
if (btnFlipCamera) btnFlipCamera.addEventListener('click', flipCamera);

const btnFlipCameraBaby = document.getElementById('btnFlipCameraBaby');
if (btnFlipCameraBaby) btnFlipCameraBaby.addEventListener('click', flipCamera);

// =================== ÇİZİM VE İZLEYİCİYE GÖNDERİM DÖNGÜSÜ ===================
let lastSendTime = 0;

function drawLoop() {
    if (!isCamera) return;
    
    if (vid.readyState >= 4) {
        if (cvs.width !== vid.videoWidth && vid.videoWidth > 0) {
            cvs.width = vid.videoWidth;
            cvs.height = vid.videoHeight;
        }

        ctx.clearRect(0, 0, cvs.width, cvs.height);
        
        const now = Date.now();
        if (conn && conn.open && now - lastSendTime > 200) {
            lastSendTime = now;
            conn.send({
                type: 'ping',
                isBabyMode: isBabyMode
            });
        }
    }
    requestAnimationFrame(drawLoop);
}

// =================== ALARM SİSTEMİ ===================

function triggerAlert(type, message) {
    if (isAlerting) return;
    isAlerting = true;
    
    const icon = document.getElementById('alert-icon');
    const title = document.getElementById('alert-title');
    const msg = document.getElementById('alert-msg');
    
    if (icon) icon.innerText = type === 'sound' ? '👶🔊' : '👶🚼';
    if (title) title.innerText = 'NURSENA CAM UYARI';
    if (msg) msg.innerText = message;
    
    alertBox.style.display = 'flex';
    
    if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
    vibInt = setInterval(() => {
        if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
    }, 1500);
}

function clearAlertDisplay() {
    if (!isAlerting) return;
    isAlerting = false;
    alertBox.style.display = 'none';
    if (vibInt) {
        clearInterval(vibInt);
        vibInt = null;
    }
}

const btnDismissAlert = document.getElementById('btnDismissAlert');
if (btnDismissAlert) {
    btnDismissAlert.onclick = () => {
        clearAlertDisplay();
        if (conn && conn.open) conn.send({ type: 'baby_alert_dismiss' });
    };
}

document.getElementById('btnCam').addEventListener('click', () => startCamera(false));
document.getElementById('btnBaby').addEventListener('click', () => startCamera(true));

async function startCamera(babyMode) {
    const usernameInput = document.getElementById('username');
    const rawUsername = usernameInput ? usernameInput.value.trim() : '';
    if (!rawUsername) {
        alert('Lütfen 5 haneli bir şifre girin!');
        return;
    }
    const cleanUsername = rawUsername.replace(/[^0-9]/g, '');
    if (cleanUsername.length !== 5) {
        alert('Şifre tam olarak 5 haneli ve sadece rakamlardan oluşmalıdır!');
        return;
    }
    
    localStorage.setItem('nursena_username', rawUsername);
    precode = cleanUsername;

    isCamera = true;
    isBabyMode = babyMode;
    document.getElementById('role').style.display = 'none';
    document.getElementById('main').style.display = 'block';

    if (babyMode) {
        document.getElementById('baby-controls').style.display = 'block';
    } else {
        document.getElementById('cc').style.display = 'block';
        document.getElementById('lc').style.display = 'block';
    }

    // Aynalama ayarını başlangıçta ayarla
    updateMirroring();

    // Kamerayı aç
    let audioEnabled = false;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
            audio: babyMode
        });
        audioEnabled = babyMode;
    } catch (e) {
        if (babyMode) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: currentFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
                    audio: false
                });
                alert("Mikrofon izni reddedildi! Bebek kamerasında sadece hareket algılama çalışacak.");
            } catch (fallbackErr) {
                alert('Kamera açılamadı: ' + fallbackErr.name);
                location.reload();
                return;
            }
        } else {
            alert('Kamera açılamadı: ' + e.name);
            location.reload();
            return;
        }
    }

    vid.srcObject = localStream;
    vid.muted = true;
    
    if (babyMode) {
        if (audioEnabled) startAudioMonitoring(localStream);
        else document.getElementById('baby-sound').innerText = 'Ses: KAPALI';
        
        startMotionMonitoring();
    }

    // Stealth (Karartma) Modu Butonu
    const stealthLogic = () => {
        document.getElementById('stealth').style.display = 'flex';
        document.getElementById('stealth-pin').value = '';
        document.getElementById('stealth-ui').style.display = 'none';
    };
    
    document.getElementById('btnHide').onclick = stealthLogic;
    const btnHideBaby = document.getElementById('btnHideBaby');
    if (btnHideBaby) btnHideBaby.onclick = stealthLogic;

    // Geri Dön butonu güncellendi (Kamerayı kapatıp ana menüye döner)
    const backToMainLogic = () => {
        sessionStorage.clear();
        stopCamera();
        location.reload();
    };
    
    document.getElementById('btnBackBaby').onclick = backToMainLogic;
    const btnBackMain = document.getElementById('btnBackMain');
    if (btnBackMain) btnBackMain.onclick = backToMainLogic;

    // Simsiyah ekrana tıklayınca şifre sorma alanını aç
    document.getElementById('stealth').onclick = (e) => {
        if(e.target.id === 'stealth') {
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

    // Filtre Ayarları
    const setFilter = (filterName) => {
        currentFilter = filterName;
        vid.className = 'filter-' + filterName;
        cvs.className = 'filter-' + filterName;
        // Aynalamayı korumak için sınıfı tekrar kontrol et
        updateMirroring();
        
        if (conn && conn.open) {
            conn.send({ type: 'set_filter', filter: filterName });
        }
    };

    document.getElementById('btnThermal').onclick = () => {
        setFilter(currentFilter === 'thermal' ? 'none' : 'thermal');
    };

    document.getElementById('btnNight').onclick = () => {
        setFilter(currentFilter === 'night' ? 'none' : 'night');
    };

    // UI Gizle/Göster Butonu (Sağ üst sabit göz butonu)
    const container = document.getElementById('controls-container');
    const bar = document.getElementById('bar');
    const btn = document.getElementById('btnToggleUI');
    
    container.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    container.style.maxHeight = '500px';
    container.style.opacity = '1';
    container.style.overflow = 'hidden';
    container.style.transform = 'scale(1)';
    
    bar.style.transition = 'all 0.4s ease';
    
    // btnToggleUI dairesel bir buton olduğu için içerisindeki simge 👁️ olarak kalır.
    btn.style.display = 'flex';
    btn.style.opacity = '1';
    let uiHidden = false;
    btn.onclick = () => {
        uiHidden = !uiHidden;
        if(uiHidden) {
            container.style.maxHeight = '0px';
            container.style.opacity = '0';
            container.style.pointerEvents = 'none';
            container.style.transform = 'scale(0.95)';
            bar.style.opacity = '0';
            bar.style.pointerEvents = 'none';
            btn.style.opacity = '0.5';
        } else {
            container.style.maxHeight = '500px';
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
            container.style.transform = 'scale(1)';
            bar.style.opacity = '1';
            bar.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
        }
    };

    // Kamerayı başlatırken Peer nesnesi oluştur
    if (prepeer) {
        try { prepeer.destroy(); } catch(e) {}
    }
    console.log("Kamera Peer nesnesi oluşturuluyor. İsim:", precode);
    prepeer = new Peer('phtrck-' + precode, { debug: 0 });
    
    prepeer.on('error', (err) => {
        console.error("Peer hatası:", err);
        if (err.type === 'unavailable-id') {
            alert('Bu kullanıcı adı şu an kullanımda! Lütfen başka bir isim girin.');
            location.reload();
        } else {
            cs.innerText = 'Hata: ' + err.type;
            cp.className = 'p';
        }
    });

    const displayName = document.getElementById('username') ? document.getElementById('username').value.trim() : precode;
    if (babyMode) {
        document.getElementById('mc-baby').innerText = displayName;
    } else {
        document.getElementById('mc').innerText = displayName;
    }

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
        if (babyMode) conn.send({ type: 'mode_baby' });
        
        c.on('data', (d) => {
            if (d.type === 'viewer_ready') {
                peer.call(c.peer, localStream);
            } else if (d.type === 'baby_alert_dismiss') {
                clearAlertDisplay();
            }
        });
        
        c.on('close', () => { 
            cs.innerText = 'İzleyici ayrıldı'; 
            cp.className = 'p';
        });
        
        c.on('error', (err) => {
            console.error('Bağlantı hatası:', err);
            cs.innerText = 'Bağlantı koptu (Hata)';
            cp.className = 'p';
        });
    });
}

// =================== İZLEYİCİ MODU ===================

document.getElementById('btnView').addEventListener('click', () => {
    if(prepeer && !prepeer.destroyed) prepeer.destroy();
    document.getElementById('role').style.display = 'none';
    document.getElementById('vs').style.display = 'flex';
});

document.getElementById('btnConn').addEventListener('click', () => {
    const rawCode = document.getElementById('jc').value.trim();
    const code = rawCode.replace(/[^0-9]/g, '');
    if (code.length !== 5) { alert('Lütfen 5 haneli şifreyi girin!'); return; }

    sessionStorage.setItem('nursena_role', 'viewer');
    sessionStorage.setItem('nursena_viewer_code', code);
    document.getElementById('vs').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    document.getElementById('lc').style.display = 'block';
    isCamera = false;
    vid.muted = true;
    cs.innerText = 'Bağlanılıyor...';
    as_.innerText = 'Görüntü bekleniyor';
    cp.className = 'p';

    peer = new Peer({ debug: 0 });

    peer.on('open', () => {
        conn = peer.connect('phtrck-' + code);
        
        conn.on('open', () => {
            cs.innerText = 'Bağlandı!';
            cp.className = 'p g';
            const container = document.getElementById('controls-container');
            const bar = document.getElementById('bar');
            const btn = document.getElementById('btnToggleUI');
            
            container.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
            container.style.maxHeight = '500px';
            container.style.opacity = '1';
            container.style.overflow = 'hidden';
            container.style.transform = 'scale(1)';
            
            bar.style.transition = 'all 0.4s ease';
            
            btn.style.display = 'flex';
            btn.style.opacity = '1';
            let uiHidden = false;
            btn.onclick = () => {
                uiHidden = !uiHidden;
                if(uiHidden) {
                    container.style.maxHeight = '0px';
                    container.style.opacity = '0';
                    container.style.pointerEvents = 'none';
                    container.style.transform = 'scale(0.95)';
                    bar.style.opacity = '0';
                    bar.style.pointerEvents = 'none';
                    btn.style.opacity = '0.5';
                } else {
                    container.style.maxHeight = '500px';
                    container.style.opacity = '1';
                    container.style.pointerEvents = 'auto';
                    container.style.transform = 'scale(1)';
                    bar.style.opacity = '1';
                    bar.style.pointerEvents = 'auto';
                    btn.style.opacity = '1';
                }
            };
            
            conn.send({ type: 'viewer_ready' });
            viewerDraw();
        });
        
        conn.on('data', handleViewerData);
        
        conn.on('close', () => {
            cs.innerText = 'Bağlantı koptu!';
            cp.className = 'p';
            clearAlertDisplay();
            alert('Bağlantı koptu! Ana menüye dönülüyor.');
            location.reload();
        });
        
        conn.on('error', (err) => {
            console.error("Bağlantı hatası:", err);
            alert("Bağlantıda bir hata oluştu!");
            location.reload();
        });
    });

    peer.on('call', (ic) => {
        call = ic;
        ic.answer();
        ic.on('stream', (rs) => {
            if (!vid.srcObject) {
                vid.srcObject = rs;
                as_.innerText = '✅ Canlı izleniyor';
                as_.style.color = '#4CAF50';
            }
        });
        
        ic.on('close', () => {
            console.log("Görüntü akışı kapandı");
        });
    });

    peer.on('error', (e) => {
        console.error("PeerJS Hatası:", e);
        if (e.type === 'peer-unavailable') {
            alert('Kamera bulunamadı! Kodu doğru girdiğinizden emin olun.');
        } else {
            alert('Bağlantı kurulamadı: ' + e.type);
        }
        location.reload();
    });
});

// =================== İZLEYİCİ VERİ HESAPLAMALARI ===================

function handleViewerData(d) {
    if (d.type === 'mode_baby') {
        isBabyMode = true;
        document.getElementById('lc').style.display = 'block';
        document.getElementById('as').innerText = '👶 BEBEK İZLENİYOR';
        document.getElementById('as').style.color = '#ff9a9e';
        document.getElementById('btnToggleUI').style.display = 'block';
    }
    else if (d.type === 'baby_alert') {
        if (d.alert === 'sound_start' || d.alert === 'motion_start') {
            const msgText = d.alert === 'sound_start' 
                ? 'BEBEK SES ÇIKARIYOR / AĞLIYOR!' 
                : 'BEBEK HAREKET ETTİ!';
            triggerAlert(d.alert === 'sound_start' ? 'sound' : 'motion', msgText);
        }
    }
    else if (d.type === 'baby_alert_dismiss') {
        clearAlertDisplay();
    }
    else if (d.type === 'set_filter') {
        vid.className = 'filter-' + d.filter;
        cvs.className = 'filter-' + d.filter;
    }
}

function viewerDraw() {
    if (isCamera) return;
    requestAnimationFrame(viewerDraw);
}

let precode = '';
let prepeer = null;

// Hata durumunda prepeer'ı sıfırla
if (prepeer) {
    prepeer.on('error', (err) => {
        console.error("Prepeer hatası:", err);
        prepeer.destroy();
    });
}

window.onbeforeunload = () => {
    stopCamera();
};

window.unlockTarget = () => {};

// =================== BEBEK İZLEME - GELİŞTİRİLMİŞ ALGORİTMALAR ===================

let babyAudioAlert = false;
let babyMotionAlert = false;

// 1. Geliştirilmiş Ses (Ağlama) Algılaması
function startAudioMonitoring(stream) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const binWidth = audioContext.sampleRate / analyser.fftSize;
    
    // Ağlama Frekans Aralıkları (Temel: 350-550 Hz, Harmonik: 1000-2000 Hz, Kalın gürültüler: <150 Hz)
    const lowEndBin = Math.round(150 / binWidth);
    const babyStartBin = Math.round(350 / binWidth);
    const babyEndBin = Math.round(550 / binWidth);
    const harmonicStartBin = Math.round(1000 / binWidth);
    const harmonicEndBin = Math.round(2000 / binWidth);
    
    let cryMatchBuffer = [];
    const BUFFER_SIZE = 15; // 1.5 saniye analiz penceresi
    
    function monitor() {
        if (!isBabyMode || !localStream) {
            audioContext.close();
            return;
        }
        analyser.getByteFrequencyData(dataArray);
        
        let lowSum = 0, lowCount = 0;
        for (let i = 0; i <= lowEndBin; i++) {
            lowSum += dataArray[i];
            lowCount++;
        }
        const lowAvg = lowCount > 0 ? lowSum / lowCount : 1;

        let babySum = 0, babyCount = 0;
        for (let i = babyStartBin; i <= babyEndBin; i++) {
            babySum += dataArray[i];
            babyCount++;
        }
        const babyAvg = babyCount > 0 ? babySum / babyCount : 0;
        
        let harmonicSum = 0, harmonicCount = 0;
        for (let i = harmonicStartBin; i <= harmonicEndBin; i++) {
            harmonicSum += dataArray[i];
            harmonicCount++;
        }
        const harmonicAvg = harmonicCount > 0 ? harmonicSum / harmonicCount : 0;
        
        let totalSum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            totalSum += dataArray[i];
        }
        const totalAvg = totalSum / dataArray.length;

        // İYİLEŞTİRİLMİŞ BEBEK AĞLAMA ŞARTLARI:
        const isCryPattern = (babyAvg > 20) && (babyAvg > lowAvg * 1.25) && (harmonicAvg > 8) && (totalAvg > 12);
        
        cryMatchBuffer.push(isCryPattern);
        if (cryMatchBuffer.length > BUFFER_SIZE) {
            cryMatchBuffer.shift();
        }
        
        const cryMatches = cryMatchBuffer.filter(Boolean).length;
        const cryRatio = cryMatches / BUFFER_SIZE;
        
        if (cryMatchBuffer.length >= 10 && cryRatio > 0.6) {
            if (!babyAudioAlert) {
                babyAudioAlert = true;
                document.getElementById('baby-sound').innerText = 'Ses: 🔴 AĞLIYOR!';
                document.getElementById('baby-sound').style.background = 'rgba(255,0,0,0.5)';
                
                triggerAlert('sound', 'BEBEK SES ÇIKARIYOR / AĞLIYOR!');
                if (conn && conn.open) conn.send({ type: 'baby_alert', alert: 'sound_start' });
            }
        } else {
            if (babyAudioAlert && cryRatio < 0.2) {
                babyAudioAlert = false;
                document.getElementById('baby-sound').innerText = 'Ses: 🟢';
                document.getElementById('baby-sound').style.background = 'rgba(0,0,0,0.5)';
            }
        }
        
        setTimeout(monitor, 100);
    }
    
    setTimeout(monitor, 200);
}

// 2. Geliştirilmiş Grid-Tabanlı ve Filtreli Hareket Algılaması
function startMotionMonitoring() {
    const motionCanvas = document.createElement('canvas');
    const motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
    let prevFrame = null;
    
    const width = 32;  
    const height = 24; 
    
    setInterval(() => {
        if (!isBabyMode || !vid.videoWidth || !localStream) return;
        
        motionCanvas.width = width;
        motionCanvas.height = height;
        motionCtx.drawImage(vid, 0, 0, width, height);
        
        const currentFrame = motionCtx.getImageData(0, 0, width, height).data;
        
        if (prevFrame) {
            const gridRows = 6;
            const gridCols = 8;
            const cellW = 4;
            const cellH = 4;
            
            let activeGridsCount = 0;
            
            for (let gy = 0; gy < gridRows; gy++) {
                for (let gx = 0; gx < gridCols; gx++) {
                    let changedPixelsInCell = 0;
                    const totalPixelsInCell = cellW * cellH; // 16 piksel
                    
                    for (let cy = 0; cy < cellH; cy++) {
                        for (let cx = 0; cx < cellW; cx++) {
                            const px = gx * cellW + cx;
                            const py = gy * cellH + cy;
                            const idx = (py * width + px) * 4;
                            
                            const diffR = Math.abs(currentFrame[idx] - prevFrame[idx]);
                            const diffG = Math.abs(currentFrame[idx + 1] - prevFrame[idx + 1]);
                            const diffB = Math.abs(currentFrame[idx + 2] - prevFrame[idx + 2]);
                            
                            if ((diffR + diffG + diffB) > 55) {
                                changedPixelsInCell++;
                            }
                        }
                    }
                    
                    if (changedPixelsInCell / totalPixelsInCell > 0.20) {
                        activeGridsCount++;
                    }
                }
            }
            
            const isRealMotion = (activeGridsCount >= 1 && activeGridsCount <= 16);
            
            if (isRealMotion && !babyMotionAlert) { 
                babyMotionAlert = true;
                document.getElementById('baby-motion').innerText = 'Hareket: 🔴 HAREKET!';
                document.getElementById('baby-motion').style.background = 'rgba(255,0,0,0.5)';
                
                triggerAlert('motion', 'BEBEK HAREKET ETTİ!');
                if (conn && conn.open) conn.send({ type: 'baby_alert', alert: 'motion_start' });
                
                setTimeout(() => {
                    babyMotionAlert = false;
                    document.getElementById('baby-motion').innerText = 'Hareket: 🟢';
                    document.getElementById('baby-motion').style.background = 'rgba(0,0,0,0.5)';
                }, 4000);
            }
        }
        
        prevFrame = currentFrame;
    }, 400);
}

// Sayfa yüklendiğinde son girilen kullanıcı adını kutuya otomatik doldur
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('nursena_username');
    if (savedUser && document.getElementById('username')) {
        document.getElementById('username').value = savedUser;
    }
});

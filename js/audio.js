/**
 * audio.js - 音関連
 */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;
let masterGain;
let isAudioInit = false;
let globalVolume = 0.3;

let bgmState = {
    nextNoteTime: 0,
    beatCount: 0,
    isChase: false,
    tempo: 0.5,
    osc: null
};

function initAudio() {
    if (isAudioInit) return;
    try {
        audioCtx = new AudioCtx();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = globalVolume;
        masterGain.connect(audioCtx.destination);
        isAudioInit = true;
        bgmState.nextNoteTime = audioCtx.currentTime;
    } catch (e) {
        console.error("Audio init failed", e);
    }
}

function setVolume(val) {
    globalVolume = val;
    if (masterGain) {
        masterGain.gain.setTargetAtTime(globalVolume, audioCtx.currentTime, 0.1);
    }
}

function playSE(type) {
    if (!isAudioInit) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(masterGain);

    if (type === "item_get") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(1600, t + 0.1);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    } else if (type === "item_use") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.linearRampToValueAtTime(800, t + 0.3);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.3);
    } else if (type === "item_drop") {
        osc.type = "noise";
        osc.frequency.setValueAtTime(100, t);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    } else if (type === "camera_detect") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.linearRampToValueAtTime(800, t + 0.3);

        const lfo = audioCtx.createOscillator();
        lfo.type = "square";
        lfo.frequency.value = 15;
        lfo.connect(gain.gain);
        lfo.start(t);
        lfo.stop(t + 0.3);

        gain.gain.setValueAtTime(0.4, t);
        gain.gain.linearRampToValueAtTime(0.01, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.3);
    } else if (type === "error") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.linearRampToValueAtTime(100, t + 0.1);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    } else if (type === "alert") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.2);
        gain.gain.setValueAtTime(0.8, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        osc.start(t);
        osc.stop(t + 0.2);
    } else if (type === "goal") {
        osc.type = "square";
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = "triangle";
            o.frequency.value = freq;
            o.connect(g);
            g.connect(masterGain);
            g.gain.setValueAtTime(0.3, t + i * 0.05);
            g.gain.exponentialRampToValueAtTime(0.01, t + i * 0.05 + 0.3);
            o.start(t + i * 0.05);
            o.stop(t + i * 0.05 + 0.3);
        });
    } else if (type === "gameover") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
    } else if (type === "stun_fire") {
        osc.type = "square";
        osc.frequency.setValueAtTime(1500, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.15);
        gain.gain.setValueAtTime(0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        osc.start(t);
        osc.stop(t + 0.15);
    } else if (type === "stun_hit") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.linearRampToValueAtTime(50, t + 0.4);
        const lfo = audioCtx.createOscillator();
        lfo.type = "square";
        lfo.frequency.value = 60;
        lfo.connect(gain.gain);
        lfo.start(t);
        lfo.stop(t + 0.4);

        gain.gain.setValueAtTime(0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.4);
    }
}

function updateBGM() {
    if (!isAudioInit || gameState !== "PLAYING") return;
    while (bgmState.nextNoteTime < audioCtx.currentTime + 0.1) {
        scheduleNote(bgmState.nextNoteTime, bgmState.isChase);
        const tempo = bgmState.isChase ? 0.15 : 0.6;
        bgmState.nextNoteTime += tempo;
        bgmState.beatCount++;
    }
}

function scheduleNote(time, isChase) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    if (isChase) {
        osc.type = "sawtooth";
        filter.frequency.value = 800 + Math.random() * 500;
        const freq = (bgmState.beatCount % 4 === 0) ? 110 : 220;
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
        osc.start(time);
        osc.stop(time + 0.1);
    } else {
        osc.type = "triangle";
        filter.frequency.value = 400;
        if (bgmState.beatCount % 4 === 0) {
            osc.frequency.setValueAtTime(55, time);
            gain.gain.setValueAtTime(0.3, time);
            gain.gain.linearRampToValueAtTime(0.01, time + 1.5);
            osc.start(time);
            osc.stop(time + 1.5);
        } else if (Math.random() < 0.2) {
            const highOsc = audioCtx.createOscillator();
            const highGain = audioCtx.createGain();
            highOsc.type = "sine";
            highOsc.frequency.setValueAtTime(1000 + Math.random() * 500, time);
            highOsc.connect(highGain);
            highGain.connect(masterGain);
            highGain.gain.setValueAtTime(0.05, time);
            highGain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
            highOsc.start(time);
            highOsc.stop(time + 0.5);
        }
    }
}

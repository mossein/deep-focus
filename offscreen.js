let audioContext = null;
let soundSource = null;
let gainNode = null;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === "handleSound") {
    await handleSoundscape(message.soundType);
  }
});

async function handleSoundscape(type) {
  try {
    if (soundSource) {
      soundSource.stop();
      soundSource = null;
    }

    if (!audioContext) {
      audioContext = new AudioContext();
      gainNode = audioContext.createGain();
      gainNode.connect(audioContext.destination);
    }

    if (type !== "none") {
      const soundUrl = chrome.runtime.getURL(`sounds/${type}.mp3`);
      
      try {
        const response = await fetch(soundUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        soundSource = audioContext.createBufferSource();
        soundSource.buffer = audioBuffer;
        soundSource.loop = true;
        
        gainNode.gain.value = 0.3;
        soundSource.connect(gainNode);
        
        soundSource.start();
      } catch (error) {
        console.error('Error loading or playing sound:', error);
        chrome.runtime.sendMessage({ 
          type: "soundError", 
          error: "Failed to load sound" 
        });
      }
    }
  } catch (error) {
    console.error('Error initializing audio context:', error);
    chrome.runtime.sendMessage({ 
      type: "soundError", 
      error: "Failed to initialize audio" 
    });
  }
} 
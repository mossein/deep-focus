let focusStartTime = null;
let pomodoroTimer = null;
let isBreakTime = false;

let dailyStats = {
  focusTime: 0,
  tabSwitches: 0,
  pomodorosCompleted: 0,
  distractions: 0
};

chrome.storage.sync.get(['dailyStats'], (data) => {
  if (data.dailyStats) {
    dailyStats = data.dailyStats;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'startPomodoro':
      startPomodoroTimer(message.workDuration, message.breakDuration);
      break;
    case 'stopPomodoro':
      clearPomodoroTimer();
      break;
    case 'tabSwitch':
      handleTabSwitch();
      break;
    case 'getStats':
      sendResponse(dailyStats);
      break;
  }
});

function startPomodoroTimer(workDuration, breakDuration) {
  clearPomodoroTimer();
  
  const workMs = workDuration * 60 * 1000;
  const breakMs = breakDuration * 60 * 1000;
  
  function pomodoroLoop() {
    isBreakTime = !isBreakTime;
    const duration = isBreakTime ? breakMs : workMs;
    
    if (!isBreakTime) {
      dailyStats.pomodorosCompleted++;
      updateStats();
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon.png',
        title: 'Pomodoro Complete!',
        message: 'Time for a break. Great work!',
      });
    }
    
    pomodoroTimer = setTimeout(pomodoroLoop, duration);
    
    chrome.runtime.sendMessage({
      type: 'pomodoroUpdate',
      isBreak: isBreakTime,
      timeRemaining: duration
    });
  }
  
  pomodoroLoop();
}

function clearPomodoroTimer() {
  if (pomodoroTimer) {
    clearTimeout(pomodoroTimer);
    pomodoroTimer = null;
  }
}

function handleTabSwitch() {
  dailyStats.tabSwitches++;
  dailyStats.distractions++;
  updateStats();
}

function updateStats() {
  chrome.storage.sync.set({ dailyStats });
  
  const focusScore = calculateFocusScore();
  
  chrome.runtime.sendMessage({
    type: 'statsUpdate',
    stats: dailyStats,
    focusScore
  });
}

function calculateFocusScore() {
  const baseScore = 100;
  const tabSwitchPenalty = 2;
  const distractionPenalty = 5;
  
  let score = baseScore;
  score -= (dailyStats.tabSwitches * tabSwitchPenalty);
  score -= (dailyStats.distractions * distractionPenalty);
  
  return Math.max(0, Math.min(100, score));
}

function resetDailyStats() {
  dailyStats = {
    focusTime: 0,
    tabSwitches: 0,
    pomodorosCompleted: 0,
    distractions: 0
  };
  updateStats();
}

setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    resetDailyStats();
  }
}, 60000);
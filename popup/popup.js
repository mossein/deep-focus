document.addEventListener("DOMContentLoaded", function () {
  const focusModeToggle = document.getElementById("focusMode");
  const filterLevel = document.getElementById("filterLevel");
  const workDuration = document.getElementById("workDuration");
  const breakDuration = document.getElementById("breakDuration");
  const startPomodoroBtn = document.getElementById("startPomodoro");
  const soundscape = document.getElementById("soundscape");

  const focusTimeEl = document.getElementById("focusTime");
  const tabSwitchesEl = document.getElementById("tabSwitches");
  const focusScoreEl = document.getElementById("focusScore");

  let pomodoroActive = false;
  let soundPlayer = null;

  chrome.storage.sync.get(
    ["focusMode", "filterLevel", "workDuration", "breakDuration", "soundscape"],
    function (data) {
      focusModeToggle.checked = data.focusMode || false;
      filterLevel.value = data.filterLevel || "none";
      workDuration.value = data.workDuration || 25;
      breakDuration.value = data.breakDuration || 5;
      soundscape.value = data.soundscape || "none";

      if (data.soundscape !== "none") {
        initializeSoundscape(data.soundscape);
      }
    }
  );

  updateStats();

  focusModeToggle.addEventListener("change", function () {
    chrome.storage.sync.set({ focusMode: this.checked });
    sendMessageToActiveTab({
      type: "toggleFocusMode",
      enabled: this.checked,
    });
  });

  filterLevel.addEventListener("change", function () {
    chrome.storage.sync.set({ filterLevel: this.value });
    sendMessageToActiveTab({
      type: "setFilterLevel",
      level: this.value,
    });
  });

  startPomodoroBtn.addEventListener("click", function () {
    if (!pomodoroActive) {
      chrome.runtime.sendMessage({
        type: "startPomodoro",
        workDuration: parseInt(workDuration.value),
        breakDuration: parseInt(breakDuration.value),
      });
      this.textContent = "Stop";
      pomodoroActive = true;
    } else {
      chrome.runtime.sendMessage({ type: "stopPomodoro" });
      this.textContent = "Start";
      pomodoroActive = false;
    }
  });

  soundscape.addEventListener("change", function () {
    chrome.storage.sync.set({ soundscape: this.value });
    initializeSoundscape(this.value);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "pomodoroUpdate":
        updatePomodoroUI(message);
        break;
      case "statsUpdate":
        updateStatsUI(message.stats, message.focusScore);
        break;
    }
  });

  function updateStats() {
    chrome.runtime.sendMessage({ type: "getStats" }, function (stats) {
      if (stats) {
        updateStatsUI(stats);
      }
    });
  }

  function updateStatsUI(stats, focusScore) {
    focusTimeEl.textContent = stats.focusTime;
    tabSwitchesEl.textContent = stats.tabSwitches;
    focusScoreEl.textContent = focusScore || calculateFocusScore(stats);
  }

  function updatePomodoroUI(data) {
    const timeRemaining = Math.floor(data.timeRemaining / 1000 / 60);
    startPomodoroBtn.textContent = `${
      data.isBreak ? "Break" : "Work"
    }: ${timeRemaining}m`;
  }

  function initializeSoundscape(type) {
    if (soundPlayer) {
      soundPlayer.pause();
      soundPlayer = null;
    }

    if (type !== "none") {
      soundPlayer = new Audio(`../sounds/${type}.mp3`);
      soundPlayer.loop = true;
      soundPlayer.volume = 0.3;
      soundPlayer.play();
    }
  }

  function sendMessageToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message);
      }
    });
  }
});

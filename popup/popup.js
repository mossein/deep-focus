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

  const newSiteInput = document.getElementById("newSite");
  const addSiteButton = document.getElementById("addSite");
  const blockedSitesList = document.getElementById("blockedSitesList");

  const dimmingLevel = document.getElementById("dimmingLevel");

  const grayModeToggle = document.getElementById("grayMode");

  let pomodoroActive = false;
  let soundPlayer = null;

  const STORAGE_DEBOUNCE_TIME = 1000; // 1 second
  let pendingStorageUpdates = {};
  let storageUpdateTimeout = null;

  function batchStorageUpdate(key, value) {
    pendingStorageUpdates[key] = value;

    if (storageUpdateTimeout) {
      clearTimeout(storageUpdateTimeout);
    }

    storageUpdateTimeout = setTimeout(() => {
      chrome.storage.sync.set(pendingStorageUpdates);
      pendingStorageUpdates = {};
      storageUpdateTimeout = null;
    }, STORAGE_DEBOUNCE_TIME);
  }

  function sendMessageToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]?.id) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
        } catch (error) {}
      }
    });
  }

  function sendMessageToAllTabs(message) {
    chrome.tabs.query({}, function (tabs) {
      tabs.forEach((tab) => {
        if (tab.id) {
          try {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {});
          } catch (error) {}
        }
      });
    });
  }

  chrome.storage.sync.get(
    [
      "focusMode",
      "filterLevel",
      "workDuration",
      "breakDuration",
      "soundscape",
      "dimmingLevel",
      "pomodoroActive",
      "grayMode",
    ],
    function (data) {
      focusModeToggle.checked = data.focusMode || false;
      filterLevel.value = data.filterLevel || "none";
      workDuration.value = data.workDuration || 25;
      breakDuration.value = data.breakDuration || 5;
      soundscape.value = data.soundscape || "none";
      dimmingLevel.value = data.dimmingLevel || 50;
      pomodoroActive = data.pomodoroActive || false;
      grayModeToggle.checked = data.grayMode || false;

      if (pomodoroActive) {
        startPomodoroBtn.textContent = "Stop";
      }

      if (data.soundscape !== "none") {
        initializeSoundscape(data.soundscape);
      }

      document.getElementById("dimmingValue").textContent = `${
        data.dimmingLevel || 50
      }%`;
    }
  );

  updateStats();

  focusModeToggle.addEventListener("change", function () {
    const isEnabled = this.checked;
    chrome.storage.sync.set({ focusMode: isEnabled });

    setTimeout(() => {
      sendMessageToAllTabs({
        type: "toggleFocusMode",
        enabled: isEnabled,
      });
    }, 100);
  });

  filterLevel.addEventListener("change", function () {
    const level = this.value;
    batchStorageUpdate("filterLevel", level);
    setTimeout(() => {
      sendMessageToActiveTab({
        type: "setFilterLevel",
        level: level,
      });
    }, 100);
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
      chrome.storage.sync.set({ pomodoroActive: true });
    } else {
      chrome.runtime.sendMessage({ type: "stopPomodoro" });
      this.textContent = "Start Focus";
      pomodoroActive = false;
      chrome.storage.sync.set({ pomodoroActive: false });
    }
  });

  soundscape.addEventListener("change", function () {
    chrome.storage.sync.set({ soundscape: this.value });
    initializeSoundscape(this.value);
  });

  dimmingLevel.addEventListener("input", function () {
    const value = this.value;
    document.getElementById("dimmingValue").textContent = `${value}%`;

    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      sendMessageToActiveTab({
        type: "updateDimming",
        level: value,
      });
    }, 16); // roughly one frame at 60fps
  });

  dimmingLevel.addEventListener("change", function () {
    const value = this.value;
    batchStorageUpdate("dimmingLevel", parseInt(value));
  });

  grayModeToggle.addEventListener("change", function () {
    const isEnabled = this.checked;
    chrome.storage.sync.set({ grayMode: isEnabled });

    setTimeout(() => {
      sendMessageToAllTabs({
        type: "toggleGrayMode",
        enabled: isEnabled,
      });
    }, 100);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "pomodoroUpdate":
        updatePomodoroUI(message);
        startTimerUpdate();
        break;
      case "statsUpdate":
        updateStatsUI(message.stats, message.focusScore);
        break;
    }
  });

  function updateStats() {
    chrome.runtime.sendMessage({ type: "getStats" }, function (response) {
      if (response && response.dailyStats) {
        updateStatsUI(response.dailyStats);
      }
    });
  }

  function updateStatsUI(stats) {
    if (!stats) return;

    focusTimeEl.textContent = stats.focusTime || "0";
    tabSwitchesEl.textContent = stats.tabSwitches || "0";

    const score = calculateFocusScore(stats);
    focusScoreEl.textContent = score;
  }

  function calculateFocusScore(stats) {
    if (!stats) return 100;

    const baseScore = 100;
    const tabSwitchPenalty = 2;
    const distractionPenalty = 5;

    let score = baseScore;
    score -= (stats.tabSwitches || 0) * tabSwitchPenalty;
    score -= (stats.distractions || 0) * distractionPenalty;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // Update stats every minute
  setInterval(updateStats, 60000);

  // Update stats when popup opens
  updateStats();

  function updatePomodoroUI(data) {
    const totalSeconds = Math.floor(data.timeRemaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    timerMinutes.textContent = minutes.toString().padStart(2, "0");
    timerSeconds.textContent = seconds.toString().padStart(2, "0");
    timerLabel.textContent = data.isBreak ? "BREAK TIME" : "FOCUS TIME";

    const progress =
      ((data.duration - data.timeRemaining) / data.duration) * 100;
    progressFill.style.width = `${progress}%`;

    startPomodoroBtn.textContent = pomodoroActive ? "Stop" : "Start Focus";
    startPomodoroBtn.classList.toggle("break", data.isBreak);

    const timerDisplay = document.querySelector(".timer-display");
    timerDisplay.classList.add("animate");
    setTimeout(() => timerDisplay.classList.remove("animate"), 300);
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

  function loadBlockedSites() {
    chrome.storage.sync.get(["blockedSites"], (data) => {
      const sites = data.blockedSites || [];
      blockedSitesList.innerHTML = "";
      sites.forEach((site) => {
        const li = document.createElement("li");
        li.innerHTML = `
          ${site}
          <button class="remove-site" data-site="${site}">&times;</button>
        `;
        blockedSitesList.appendChild(li);
      });
    });
  }

  addSiteButton.addEventListener("click", () => {
    const site = newSiteInput.value.trim().toLowerCase();
    if (site) {
      chrome.storage.sync.get(["blockedSites"], (data) => {
        const sites = data.blockedSites || [];
        if (!sites.includes(site)) {
          sites.push(site);
          chrome.storage.sync.set({ blockedSites: sites }, () => {
            loadBlockedSites();
            newSiteInput.value = "";
            chrome.runtime.sendMessage({
              type: "updateBlockedSites",
              sites,
            });
            chrome.runtime.sendMessage({ type: "checkBlockedSites" });
          });
        }
      });
    }
  });

  blockedSitesList.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-site")) {
      const site = e.target.dataset.site;
      chrome.storage.sync.get(["blockedSites"], (data) => {
        const sites = data.blockedSites || [];
        const newSites = sites.filter((s) => s !== site);
        chrome.storage.sync.set({ blockedSites: newSites }, () => {
          loadBlockedSites();
          chrome.runtime.sendMessage({
            type: "updateBlockedSites",
            sites: newSites,
          });
        });
      });
    }
  });

  loadBlockedSites();

  chrome.storage.sync.get(["filterLevel", "pomodoroEndTime"], (data) => {
    if (data.filterLevel) {
      filterLevel.value = data.filterLevel;
    }

    if (data.pomodoroEndTime) {
      const remaining = data.pomodoroEndTime - Date.now();
      if (remaining > 0) {
        pomodoroActive = true;
        startPomodoroBtn.textContent = "Stop";
      }
    }
  });

  const timerMinutes = document.getElementById("timerMinutes");
  const timerSeconds = document.getElementById("timerSeconds");
  const timerLabel = document.getElementById("timerLabel");
  const progressFill = document.getElementById("progressFill");
  const sessionCount = document.getElementById("sessionCount");

  document.querySelectorAll(".number-input button").forEach((button) => {
    button.addEventListener("click", function () {
      const inputId = this.dataset.input;
      const input = document.getElementById(inputId);
      const currentValue = parseInt(input.value);

      if (this.classList.contains("minus")) {
        if (currentValue > parseInt(input.min)) {
          input.value = currentValue - 1;
        }
      } else if (this.classList.contains("plus")) {
        if (currentValue < parseInt(input.max)) {
          input.value = currentValue + 1;
        }
      }

      batchStorageUpdate(inputId, parseInt(input.value));
    });
  });

  function startTimerUpdate() {
    chrome.storage.sync.get(
      ["pomodoroEndTime", "pomodoroActive", "currentSession"],
      (data) => {
        if (data.pomodoroActive && data.pomodoroEndTime) {
          const remaining = data.pomodoroEndTime - Date.now();
          if (remaining > 0) {
            updatePomodoroUI({
              timeRemaining: remaining,
              duration: data.currentSession?.duration || 25 * 60 * 1000,
              isBreak: data.currentSession?.isBreak || false,
            });
            setTimeout(startTimerUpdate, 1000);
          }
        }
      }
    );
  }

  startTimerUpdate();

  chrome.storage.sync.get(["focusMode", "dimmingLevel"], function (data) {
    focusModeToggle.checked = data.focusMode || false;
    dimmingLevel.value = data.dimmingLevel || 50;
    document.getElementById("dimmingValue").textContent = `${
      data.dimmingLevel || 50
    }%`;

    if (data.focusMode) {
      setTimeout(() => {
        sendMessageToAllTabs({
          type: "toggleFocusMode",
          enabled: true,
        });
      }, 100);
    }
  });
});

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

  let pomodoroActive = false;
  let soundPlayer = null;

  function sendMessageToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {
            console.log("Tab not ready for messages");
          });
        } catch (error) {
          console.log("Error sending message to tab:", error);
        }
      }
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
    ],
    function (data) {
      focusModeToggle.checked = data.focusMode || false;
      filterLevel.value = data.filterLevel || "none";
      workDuration.value = data.workDuration || 25;
      breakDuration.value = data.breakDuration || 5;
      soundscape.value = data.soundscape || "none";
      dimmingLevel.value = data.dimmingLevel || 50;
      pomodoroActive = data.pomodoroActive || false;

      if (pomodoroActive) {
        startPomodoroBtn.textContent = "Stop";
      }

      if (data.soundscape !== "none") {
        initializeSoundscape(data.soundscape);
      }
    }
  );

  updateStats();

  focusModeToggle.addEventListener("change", function () {
    chrome.storage.sync.set({ focusMode: this.checked });
    setTimeout(() => {
      sendMessageToActiveTab({
        type: "toggleFocusMode",
        enabled: this.checked,
      });
    }, 100);
  });

  filterLevel.addEventListener("change", function () {
    const level = this.value;
    chrome.storage.sync.set({ filterLevel: level });
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
    chrome.storage.sync.set({ dimmingLevel: this.value });
    sendMessageToActiveTab({
      type: "updateDimming",
      level: this.value,
    });
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
          <button class="remove-site" data-site="${site}">×</button>
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

      chrome.storage.sync.set({ [inputId]: parseInt(input.value) });
    });
  });

  function calculateFocusScore(stats) {
    const baseScore = 100;
    const tabSwitchPenalty = 2;
    const distractionPenalty = 5;

    let score = baseScore;
    score -= stats.tabSwitches * tabSwitchPenalty;
    score -= stats.distractions * distractionPenalty;

    return Math.max(0, Math.min(100, score));
  }

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
});

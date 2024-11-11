let focusStartTime = null;
let pomodoroTimer = null;
let isBreakTime = false;
let blockedSites = [];
let analyticsData = {
  focusHistory: Array(7).fill(0),
  scoreHistory: Array(7).fill(100),
  distractionHistory: Array(7).fill(0),
  blockedSitesHistory: Array(7).fill(0),
  dates: Array(7)
    .fill()
    .map((_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      return date.toLocaleDateString("en-US", { weekday: "short" });
    })
    .reverse(),
};

let dailyStats = {
  focusTime: 0,
  tabSwitches: 0,
  pomodorosCompleted: 0,
  distractions: 0,
  pomodoroActive: false,
  currentSession: null,
  lastTabSwitch: null,
};

let soundPlayer = null;
let currentSoundscape = "none";
let audioContext = null;
let soundSource = null;
let gainNode = null;

chrome.storage.sync.get(
  ["dailyStats", "blockedSites", "analyticsData"],
  (data) => {
    if (data.dailyStats) dailyStats = data.dailyStats;
    if (data.blockedSites) blockedSites = data.blockedSites;
    if (data.analyticsData) analyticsData = data.analyticsData;
  }
);

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    checkIfSiteBlocked(details.url, details.tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "startPomodoro":
      startPomodoroTimer(message.workDuration, message.breakDuration);
      break;
    case "stopPomodoro":
      clearPomodoroTimer();
      break;
    case "tabSwitch":
      handleTabSwitch(message.timestamp);
      break;
    case "getStats":
      sendResponse({ dailyStats, analyticsData });
      break;
    case "updateBlockedSites":
      blockedSites = message.sites;
      updateBlockedSites(message.sites);
      chrome.storage.sync.set({ blockedSites: message.sites });
      break;
    case "checkBlockedSites":
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          checkIfSiteBlocked(tabs[0].url, tabs[0].id);
        }
      });
      break;
    case "updateSoundscape":
      handleSoundscape(message.soundType);
      break;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "filterElement",
    title: "Filter This Element",
    contexts: ["all"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "filterElement") {
    chrome.tabs.sendMessage(tab.id, {
      type: "filterElementAtPoint",
      x: info.x,
      y: info.y,
    });
  }
});

chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case "toggle-focus-mode":
      chrome.storage.sync.get(["focusMode"], (data) => {
        const newState = !data.focusMode;
        chrome.storage.sync.set({ focusMode: newState });
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: "toggleFocusMode",
            enabled: newState,
          });
        });
      });
      break;
    case "start-pomodoro":
      chrome.storage.sync.get(
        ["pomodoroActive", "workDuration", "breakDuration"],
        (data) => {
          if (!data.pomodoroActive) {
            startPomodoroTimer(
              data.workDuration || 25,
              data.breakDuration || 5
            );
          } else {
            clearPomodoroTimer();
          }
        }
      );
      break;
  }
});

function startPomodoroTimer(workDuration, breakDuration) {
  clearPomodoroTimer();

  const duration = workDuration * 60 * 1000;
  const endTime = Date.now() + duration;

  dailyStats.pomodoroActive = true;
  dailyStats.currentSession = {
    startTime: Date.now(),
    duration: duration,
    isBreak: false,
    endTime: endTime,
    workDuration,
    breakDuration,
  };

  chrome.storage.sync.set({
    pomodoroEndTime: endTime,
    pomodoroActive: true,
    currentSession: dailyStats.currentSession,
  });

  pomodoroTimer = setInterval(() => {
    const remaining = endTime - Date.now();
    if (remaining <= 0) {
      handlePomodoroComplete(workDuration, breakDuration);
    } else {
      notifyAllTabs("pomodoroUpdate", {
        isBreak: false,
        timeRemaining: remaining,
        duration: duration,
      });
    }
  }, 1000);

  notifyAllTabs("pomodoroUpdate", {
    isBreak: false,
    timeRemaining: duration,
    duration: duration,
  });
}

function handlePomodoroComplete(workDuration, breakDuration) {
  clearInterval(pomodoroTimer);
  isBreakTime = !isBreakTime;

  const duration = (isBreakTime ? breakDuration : workDuration) * 60 * 1000;
  const endTime = Date.now() + duration;

  if (!isBreakTime) {
    dailyStats.pomodorosCompleted++;
    analyticsData.focusHistory[6] += workDuration;
    updateStats();

    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon.png",
      title: "Pomodoro Complete!",
      message: "Time for a break. Great work!",
    });
  }

  dailyStats.currentSession = {
    startTime: Date.now(),
    duration: duration,
    isBreak: isBreakTime,
    endTime: endTime,
    workDuration,
    breakDuration,
  };

  chrome.storage.sync.set({
    pomodoroEndTime: endTime,
    currentSession: dailyStats.currentSession,
  });

  pomodoroTimer = setInterval(() => {
    const remaining = endTime - Date.now();
    if (remaining <= 0) {
      handlePomodoroComplete(workDuration, breakDuration);
    } else {
      notifyAllTabs("pomodoroUpdate", {
        isBreak: isBreakTime,
        timeRemaining: remaining,
        duration: duration,
      });
    }
  }, 1000);

  notifyAllTabs("pomodoroUpdate", {
    isBreak: isBreakTime,
    timeRemaining: duration,
    duration: duration,
  });
}

function clearPomodoroTimer() {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = null;
  }

  dailyStats.pomodoroActive = false;
  dailyStats.currentSession = null;

  chrome.storage.sync.set({
    pomodoroEndTime: null,
    pomodoroActive: false,
    currentSession: null,
  });

  updateStats();

  notifyAllTabs("pomodoroUpdate", {
    isBreak: false,
    timeRemaining: 25 * 60 * 1000,
    duration: 25 * 60 * 1000,
  });
}

function notifyAllTabs(type, data) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      try {
        chrome.tabs.sendMessage(tab.id, { type, ...data }).catch(() => {
          console.log(`Tab ${tab.id} not ready for messages`);
        });
      } catch (error) {
        console.log(`Error sending message to tab ${tab.id}:`, error);
      }
    });
  });
}

function updateStats() {
  chrome.storage.sync.set({
    dailyStats,
    analyticsData,
  });

  notifyAllTabs("statsUpdate", {
    stats: dailyStats,
    analytics: analyticsData,
  });
}

function handleTabSwitch(timestamp) {
  if (
    !dailyStats.lastTabSwitch ||
    timestamp - dailyStats.lastTabSwitch > 1000
  ) {
    dailyStats.tabSwitches++;
    dailyStats.lastTabSwitch = timestamp;
    updateStats();
  }
}

function calculateFocusScore() {
  const baseScore = 100;
  const tabSwitchPenalty = 2;
  const distractionPenalty = 5;

  let score = baseScore;
  score -= dailyStats.tabSwitches * tabSwitchPenalty;
  score -= dailyStats.distractions * distractionPenalty;

  return Math.max(0, Math.min(100, score));
}

function resetDailyStats() {
  dailyStats = {
    focusTime: 0,
    tabSwitches: 0,
    pomodorosCompleted: 0,
    distractions: 0,
    pomodoroActive: false,
    currentSession: null,
    lastTabSwitch: null,
  };
  updateStats();
}

setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    resetDailyStats();
  }
}, 60000);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkIfSiteBlocked(changeInfo.url, tabId);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url) {
    checkIfSiteBlocked(tab.url, tab.id);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  handleTabSwitch(Date.now());
});

async function updateBlockedSites(sites) {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map((rule) => rule.id);

    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds,
      });
    }

    if (sites && sites.length > 0) {
      const rules = sites.map((site, index) => ({
        id: index + 1,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/blocked.html" },
        },
        condition: {
          urlFilter: `||${site}`,
          resourceTypes: ["main_frame"],
          isUrlFilterCaseSensitive: false,
        },
      }));

      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: rules,
      });
    }
  } catch (error) {
    console.error("Error updating blocking rules:", error);
  }
}

chrome.storage.sync.get(["blockedSites"], (data) => {
  if (data.blockedSites) {
    updateBlockedSites(data.blockedSites);
  }
});

function checkIfSiteBlocked(url, tabId) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    chrome.storage.sync.get(["blockedSites"], (data) => {
      const sites = data.blockedSites || [];
      if (sites.some((site) => hostname.includes(site.toLowerCase()))) {
        try {
          chrome.tabs.update(tabId, {
            url: chrome.runtime.getURL("blocked.html"),
          });
          dailyStats.distractions++;
          updateStats();
        } catch (error) {
          console.log("Error updating tab:", error);
        }
      }
    });
  } catch (e) {
    console.log("Error checking blocked site:", e);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "updateBlockedSites") {
    if (message.sites.length === 0) {
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: Array.from({ length: 1000 }, (_, i) => i + 1),
      });
    }
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  chrome.storage.sync.get(
    ["focusMode", "dimmingLevel", "grayMode", "filterLevel"],
    (data) => {
      if (data.focusMode) {
        const storedDimmingLevel = data.dimmingLevel || 50;
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, {
            type: "toggleFocusMode",
            enabled: true,
          });

          chrome.tabs.sendMessage(tab.id, {
            type: "updateDimming",
            level: storedDimmingLevel,
          });

          if (data.grayMode) {
            chrome.tabs.sendMessage(tab.id, {
              type: "toggleGrayMode",
              enabled: true,
            });
          }

          if (data.filterLevel && data.filterLevel !== "none") {
            chrome.tabs.sendMessage(tab.id, {
              type: "setFilterLevel",
              level: data.filterLevel,
            });
          }
        }, 100);
      }
    }
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    chrome.storage.sync.get(
      ["focusMode", "dimmingLevel", "grayMode", "filterLevel"],
      (data) => {
        if (data.focusMode) {
          const storedDimmingLevel = data.dimmingLevel || 50;
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, {
              type: "toggleFocusMode",
              enabled: true,
            });

            chrome.tabs.sendMessage(tabId, {
              type: "updateDimming",
              level: storedDimmingLevel,
            });

            if (data.grayMode) {
              chrome.tabs.sendMessage(tabId, {
                type: "toggleGrayMode",
                enabled: true,
              });
            }

            if (data.filterLevel && data.filterLevel !== "none") {
              chrome.tabs.sendMessage(tabId, {
                type: "setFilterLevel",
                level: data.filterLevel,
              });
            }
          }, 100);
        }
      }
    );
  }
});

async function handleSoundscape(type) {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });

    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Playing background sounds for focus",
      });
    }

    chrome.runtime.sendMessage({
      type: "handleSound",
      soundType: type,
    });

    currentSoundscape = type;
    chrome.storage.sync.set({ soundscape: type });
  } catch (error) {
    console.error("Error handling soundscape:", error);
    currentSoundscape = "none";
    chrome.storage.sync.set({ soundscape: "none" });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "soundError") {
    console.error("Sound error:", message.error);
    currentSoundscape = "none";
    chrome.storage.sync.set({ soundscape: "none" });
  }
});

chrome.runtime.onSuspend.addListener(() => {
  if (soundSource) {
    soundSource.stop();
  }
  if (audioContext) {
    audioContext.close();
  }
});

function updateExtensionIcon(isEnabled) {
  try {
    const canvas = new OffscreenCanvas(128, 128);
    const ctx = canvas.getContext("2d");

    const loadImage = () => {
      return new Promise((resolve, reject) => {
        fetch(chrome.runtime.getURL("icons/icon.png"))
          .then((response) => response.blob())
          .then((blob) => createImageBitmap(blob))
          .then((imageBitmap) => {
            ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

            if (!isEnabled) {
              const imageData = ctx.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
              );
              const data = imageData.data;

              for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                data[i] = avg;
                data[i + 1] = avg;
                data[i + 2] = avg;
                data[i + 3] = data[i + 3] * 0.5;
              }

              ctx.putImageData(imageData, 0, 0);
            }

            const imageData = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height
            );
            chrome.action.setIcon({ imageData });
            resolve();
          })
          .catch(reject);
      });
    };

    loadImage().catch((error) => {
      console.error("Error loading icon:", error);
    });
  } catch (error) {
    console.error("Failed to update icon:", error);
  }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "sync" && changes.focusMode) {
    updateExtensionIcon(changes.focusMode.newValue);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["focusMode"], (data) => {
    updateExtensionIcon(data.focusMode || false);
  });
});

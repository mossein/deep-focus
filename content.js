let focusOverlay = null;
let filteredElements = new Set();
let observer = null;
let grayModeOverlay = null;

const filterLevels = {
  light: ["ads", "comments"],
  moderate: ["ads", "comments", "social-feeds", "recommendations"],
  extreme: [
    "ads",
    "comments",
    "social-feeds",
    "recommendations",
    "images",
    "sidebars",
  ],
};

const elementSelectors = {
  ads: '[class*="ad"], [id*="ad"], [aria-label*="advertisement"]',
  comments: '#comments, .comments, [class*="comment-"]',
  "social-feeds": '.feed, [class*="feed"], [class*="social"]',
  recommendations: '[class*="recommend"], [class*="suggested"]',
  sidebars: 'aside, [class*="sidebar"]',
  images: 'img:not([class*="logo"])',
};

function isFilterableElement(element) {
  const significantTags = ["div", "section", "article", "aside", "main", "nav"];
  return (
    significantTags.includes(element.tagName.toLowerCase()) ||
    element.classList.length > 0 ||
    element.id
  );
}

function generateUniqueSelector(element) {
  if (element.id) return `#${element.id}`;

  let path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.classList.length) {
      selector += `.${Array.from(current.classList).join(".")}`;
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(" > ");
}

function getElementAtPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  let currentElement = element;
  while (currentElement && currentElement !== document.body) {
    if (isFilterableElement(currentElement)) {
      return currentElement;
    }
    currentElement = currentElement.parentElement;
  }
  return element;
}

function addCustomFilter(element) {
  element.dataset.deepFocusCustomFilter = "true";
  element.style.filter = "grayscale(100%) opacity(0.5)";

  const selector = generateUniqueSelector(element);
  chrome.storage.sync.get(["customFilters"], function (data) {
    const customFilters = data.customFilters || [];
    customFilters.push(selector);
    chrome.storage.sync.set({ customFilters });
  });
}

function createOverlay(dimmingLevel) {
  if (focusOverlay) {
    document.body.removeChild(focusOverlay);
  }

  focusOverlay = document.createElement("div");
  focusOverlay.id = "focus-overlay";
  focusOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(0, 0, 0, ${(dimmingLevel / 100) * 0.7});
    pointer-events: none;
    z-index: 2147483647;
    transition: background-color 0.3s ease;
    position: fixed;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
  `;

  document.documentElement.appendChild(focusOverlay);
}

function applyContentFiltering(level) {
  filteredElements.forEach((element) => {
    if (element && element.style) {
      element.style.filter = "";
      delete element.dataset.deepFocusFiltered;
    }
  });
  filteredElements.clear();

  if (level === "none") return;

  const elementsToFilter = filterLevels[level] || [];
  elementsToFilter.forEach((type) => {
    try {
      const elements = document.querySelectorAll(elementSelectors[type]);
      elements.forEach((element) => {
        element.style.filter = "grayscale(100%) opacity(0.5)";
        element.dataset.deepFocusFiltered = "true";
        filteredElements.add(element);
      });
    } catch (error) {
      console.error(`Error filtering ${type}:`, error);
    }
  });
}

function initializeObserver() {
  if (document.body) {
    observer = new MutationObserver((mutations) => {
      chrome.storage.sync.get(["filterLevel"], (data) => {
        if (data.filterLevel && data.filterLevel !== "none") {
          applyContentFiltering(data.filterLevel);
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    chrome.storage.sync.get(["focusMode", "dimmingLevel"], function (data) {
      if (data.focusMode) {
        createOverlay(data.dimmingLevel || 50);
      }
    });

    chrome.storage.sync.get(["customFilters", "filterLevel"], function (data) {
      if (data.filterLevel) {
        applyContentFiltering(data.filterLevel);
      }

      if (data.customFilters) {
        data.customFilters.forEach((selector) => {
          const element = document.querySelector(selector);
          if (element) addCustomFilter(element);
        });
      }
    });
  } else {
    setTimeout(initializeObserver, 100);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeObserver);
} else {
  initializeObserver();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "toggleFocusMode":
      if (message.enabled) {
        chrome.storage.sync.get(["dimmingLevel"], function (data) {
          createOverlay(data.dimmingLevel || 50);
        });
      } else if (focusOverlay) {
        focusOverlay.remove();
      }
      break;

    case "updateDimming":
      const level = message.level || 50;
      if (focusOverlay) {
        focusOverlay.style.backgroundColor = `rgba(0, 0, 0, ${
          (level / 100) * 0.7
        })`;
      } else {
        chrome.storage.sync.get(["focusMode"], function (data) {
          if (data.focusMode) {
            createOverlay(level);
          }
        });
      }
      break;

    case "setFilterLevel":
      applyContentFiltering(message.level);
      break;

    case "addCustomFilter":
      const element = document.querySelector(message.selector);
      if (element) addCustomFilter(element);
      break;

    case "filterElementAtPoint":
      const elementAtPoint = getElementAtPoint(message.x, message.y);
      if (elementAtPoint) {
        addCustomFilter(elementAtPoint);
      }
      break;

    case "toggleGrayMode":
      if (message.enabled) {
        document.body.style.filter = "grayscale(100%)";
        document.body.style.webkitFilter = "grayscale(100%)";
        createGrayOverlay();
      } else {
        if (grayModeOverlay) {
          grayModeOverlay.remove();
        }
        document.body.style.filter = "";
        document.body.style.webkitFilter = "";
      }
      break;
  }
});

let tabSwitchCount = 0;
let lastActiveTime = Date.now();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    chrome.runtime.sendMessage({
      type: "tabSwitch",
      timestamp: Date.now(),
    });
  } else {
    lastActiveTime = Date.now();
  }
});

function initializeFocusMode() {
  chrome.storage.sync.get(["focusMode", "dimmingLevel"], function (data) {
    if (data.focusMode) {
      createOverlay(data.dimmingLevel || 50);
    }
  });
}

initializeFocusMode();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeFocusMode);
}

function createGrayOverlay() {
  if (grayModeOverlay) {
    grayModeOverlay.remove();
  }
  
  document.body.style.filter = "grayscale(100%)";
  document.body.style.webkitFilter = "grayscale(100%)";

  grayModeOverlay = document.createElement("div");
  grayModeOverlay.id = "gray-overlay";
  grayModeOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 2147483646;
    transition: all 0.3s ease;
  `;

  document.documentElement.appendChild(grayModeOverlay);
}

function initializeModes() {
  chrome.storage.sync.get(
    ["focusMode", "dimmingLevel", "grayMode"],
    function (data) {
      if (data.focusMode) {
        createOverlay(data.dimmingLevel || 50);
      }
      if (data.grayMode) {
        document.body.style.filter = "grayscale(100%)";
        document.body.style.webkitFilter = "grayscale(100%)";
        createGrayOverlay();
      }
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeModes);
} else {
  initializeModes();
}

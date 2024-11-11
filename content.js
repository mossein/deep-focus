const preloadStyles = document.createElement('style');
preloadStyles.textContent = `
  html {
    visibility: hidden !important;
  }
  html.focus-mode-ready {
    visibility: visible !important;
  }
  .focus-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 2147483647;
    transition: background-color 0.3s ease;
  }
`;
document.documentElement.appendChild(preloadStyles);

chrome.storage.sync.get(
  ["focusMode", "dimmingLevel", "grayMode", "filterLevel"],
  function (data) {
    if (data.focusMode) {
      if (data.grayMode) {
        const styleSheet = document.createElement('style');
        styleSheet.textContent = `
          html { filter: grayscale(100%) !important; }
        `;
        document.documentElement.appendChild(styleSheet);
      }
      
      const overlay = document.createElement('div');
      overlay.className = 'focus-overlay';
      overlay.style.backgroundColor = `rgba(0, 0, 0, ${(data.dimmingLevel || 50) / 100 * 0.7})`;
      document.documentElement.appendChild(overlay);
    }
    
    requestAnimationFrame(() => {
      document.documentElement.classList.add('focus-mode-ready');
    });
  }
);

let focusOverlay = null;
let filteredElements = new Set();
let observer = null;
let grayModeOverlay = null;
let isExtensionValid = true;

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
    focusOverlay.remove();
  }

  focusOverlay = document.createElement("div");
  focusOverlay.id = "focus-overlay";
  focusOverlay.className = "focus-overlay";
  focusOverlay.style.backgroundColor = `rgba(0, 0, 0, ${(dimmingLevel / 100) * 0.7})`;

  document.documentElement.appendChild(focusOverlay);
  focusOverlay.offsetHeight;
  focusOverlay.classList.add('active');
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
  if (!isExtensionValid) return;

  if (document.body) {
    observer = new MutationObserver((mutations) => {
      chromeAPIWrapper(() => {
        chrome.storage.sync.get(
          ["filterLevel", "focusMode", "dimmingLevel"],
          (data) => {
            if (data.focusMode) {
              if (data.filterLevel && data.filterLevel !== "none") {
                applyContentFiltering(data.filterLevel);
              }
              if (focusOverlay) {
                focusOverlay.style.backgroundColor = `rgba(0, 0, 0, ${
                  (data.dimmingLevel / 100) * 0.7
                })`;
              }
            }
          }
        );
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    chromeAPIWrapper(() => {
      chrome.storage.sync.get(
        ["focusMode", "dimmingLevel", "grayMode", "filterLevel"],
        function (data) {
          if (data.focusMode) {
            const storedDimmingLevel = data.dimmingLevel || 50;
            createOverlay(storedDimmingLevel);
            if (data.filterLevel && data.filterLevel !== "none") {
              applyContentFiltering(data.filterLevel);
            }
            if (data.grayMode) {
              document.body.style.filter = "grayscale(100%)";
              document.body.style.webkitFilter = "grayscale(100%)";
              createGrayOverlay();
            }
          }
        }
      );
    });
  } else {
    setTimeout(initializeObserver, 100);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    chromeAPIWrapper(initializeObserver);
  });
} else {
  chromeAPIWrapper(initializeObserver);
}

function chromeAPIWrapper(callback) {
  if (!isExtensionValid) return;

  try {
    callback();
  } catch (error) {
    if (error.message.includes("Extension context invalidated")) {
      console.log("Extension reloaded, please refresh the page");
      isExtensionValid = false;
      cleanup();
    }
  }
}

function cleanup() {
  try {
    if (focusOverlay) {
      focusOverlay.classList.remove('active');
      setTimeout(() => {
        focusOverlay.remove();
        focusOverlay = null;
      }, 300);
    }
    document.documentElement.classList.remove('focus-mode-active');
    if (grayModeOverlay) {
      grayModeOverlay.remove();
      grayModeOverlay = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    filteredElements.forEach((element) => {
      if (element && element.style) {
        element.style.filter = "";
        delete element.dataset.deepFocusFiltered;
      }
    });
    filteredElements.clear();
    document.body.style.filter = "";
    document.body.style.webkitFilter = "";
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}

function initializeModes() {
  chromeAPIWrapper(() => {
    chrome.storage.sync.get(
      ["focusMode", "dimmingLevel", "grayMode", "filterLevel"],
      function (data) {
        if (chrome.runtime.lastError) {
          document.documentElement.classList.remove('focus-mode-loading');
          document.documentElement.classList.add('focus-mode-ready');
          console.error(chrome.runtime.lastError);
          return;
        }
        
        if (data.focusMode) {
          document.documentElement.classList.add('focus-mode-active');
          createOverlay(data.dimmingLevel || 50);
          if (data.filterLevel && data.filterLevel !== "none") {
            applyContentFiltering(data.filterLevel);
          }
          if (data.grayMode) {
            document.body.style.filter = "grayscale(100%)";
            document.body.style.webkitFilter = "grayscale(100%)";
            createGrayOverlay();
          }
        }
        
        requestAnimationFrame(() => {
          document.documentElement.classList.remove('focus-mode-loading');
          document.documentElement.classList.add('focus-mode-ready');
        });
      }
    );
  });
}

const messageListener = (message, sender, sendResponse) => {
  if (!isExtensionValid) return;

  chromeAPIWrapper(() => {
    switch (message.type) {
      case "toggleFocusMode":
        if (message.enabled) {
          chrome.storage.sync.get(["dimmingLevel"], function (data) {
            const storedDimmingLevel = data.dimmingLevel || 50;
            createOverlay(storedDimmingLevel);
          });
        } else {
          cleanup();
        }
        break;
      case "updateDimming":
        const level = message.level;
        if (focusOverlay) {
          focusOverlay.style.backgroundColor = `rgba(0, 0, 0, ${
            (level / 100) * 0.7
          })`;
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
};

try {
  chrome.runtime.onMessage.addListener(messageListener);
} catch (error) {
  console.log("Extension context invalid, please refresh the page");
  cleanup();
}

document.addEventListener("visibilitychange", () => {
  chromeAPIWrapper(() => {
    if (document.hidden) {
      chrome.runtime.sendMessage({
        type: "tabSwitch",
        timestamp: Date.now(),
      });
    } else {
      lastActiveTime = Date.now();
    }
  });
});

window.addEventListener("unload", cleanup);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    chromeAPIWrapper(initializeModes);
  });
} else {
  chromeAPIWrapper(initializeModes);
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

window.addEventListener("error", (event) => {
  if (event.message.includes("Extension context invalidated")) {
    isExtensionValid = false;
    cleanup();
  }
});

let focusOverlay = null;

function createOverlay(dimmingLevel) {
  if (focusOverlay) {
    document.body.removeChild(focusOverlay);
  }

  focusOverlay = document.createElement('div');
  focusOverlay.id = 'focus-overlay';
  focusOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, ${dimmingLevel / 100 * 0.7});
    pointer-events: none;
    z-index: 9999;
    transition: background-color 0.3s ease;
  `;

  document.body.appendChild(focusOverlay);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'toggleFocusMode':
      if (message.enabled) {
        chrome.storage.sync.get(['dimmingLevel'], function(data) {
          createOverlay(data.dimmingLevel || 50);
        });
      } else if (focusOverlay) {
        document.body.removeChild(focusOverlay);
      }
      break;

    case 'updateDimming':
      if (focusOverlay) {
        focusOverlay.style.backgroundColor = `rgba(0, 0, 0, ${message.level / 100 * 0.7})`;
      }
      break;

    case 'setFilterLevel':
      applyContentFiltering(message.level);
      break;

    case 'addCustomFilter':
      const element = document.querySelector(message.selector);
      if (element) addCustomFilter(element);
      break;
  }
});

chrome.storage.sync.get(['focusMode', 'dimmingLevel'], function(data) {
  if (data.focusMode) {
    createOverlay(data.dimmingLevel || 50);
  }
});

chrome.storage.sync.get(['customFilters', 'filterLevel'], function(data) {
  if (data.filterLevel) {
    applyContentFiltering(data.filterLevel);
  }
  
  if (data.customFilters) {
    data.customFilters.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) addCustomFilter(element);
    });
  }
});

let tabSwitchCount = 0;
let lastActiveTime = Date.now();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    tabSwitchCount++;
    chrome.runtime.sendMessage({
      type: 'tabSwitch',
      count: tabSwitchCount
    });
  } else {
    lastActiveTime = Date.now();
  }
});

const filterLevels = {
  light: ['ads', 'comments'],
  moderate: ['ads', 'comments', 'social-feeds', 'recommendations'],
  extreme: ['ads', 'comments', 'social-feeds', 'recommendations', 'images', 'sidebars']
};

const elementSelectors = {
  ads: '[class*="ad"], [id*="ad"], [aria-label*="advertisement"]',
  comments: '#comments, .comments, [class*="comment-"]',
  'social-feeds': '.feed, [class*="feed"], [class*="social"]',
  recommendations: '[class*="recommend"], [class*="suggested"]',
  sidebars: 'aside, [class*="sidebar"]',
  images: 'img:not([class*="logo"])'
};

function applyContentFiltering(level) {
  const elementsToFilter = filterLevels[level] || [];
  
  elementsToFilter.forEach(type => {
    const elements = document.querySelectorAll(elementSelectors[type]);
    elements.forEach(element => {
      element.style.filter = 'grayscale(100%) opacity(0.5)';
      element.dataset.deepFocusFiltered = 'true';
    });
  });
}

function addCustomFilter(element) {
  element.dataset.deepFocusCustomFilter = 'true';
  element.style.filter = 'grayscale(100%) opacity(0.5)';
  
  const selector = generateUniqueSelector(element);
  chrome.storage.sync.get(['customFilters'], function(data) {
    const customFilters = data.customFilters || [];
    customFilters.push(selector);
    chrome.storage.sync.set({ customFilters });
  });
} 
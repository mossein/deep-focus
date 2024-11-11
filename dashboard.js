document.addEventListener("DOMContentLoaded", () => {
  loadAnalytics();
  setInterval(loadAnalytics, 60000);
});

function loadAnalytics() {
  chrome.storage.sync.get(["analyticsData", "dailyStats"], (data) => {
    const analytics = data.analyticsData || initializeAnalytics();
    updateStatCards(data.dailyStats, analytics);
    updateCharts(analytics);
  });
}

function initializeAnalytics() {
  return {
    focusHistory: Array(7).fill(0),
    scoreHistory: Array(7).fill(100),
    distractionHistory: Array(7).fill(0),
    blockedSitesHistory: Array(7).fill(0),
    dates: getLast7Days(),
  };
}

function updateStatCards(dailyStats, analytics) {
  const totalFocusTime = analytics.focusHistory.reduce((a, b) => a + b, 0);
  const averageScore = analytics.scoreHistory.reduce((a, b) => a + b, 0) / 7;

  document.getElementById("totalFocusTime").textContent = `${Math.round(
    totalFocusTime / 60
  )}h`;
  document.getElementById("averageFocusScore").textContent = `${Math.round(
    averageScore
  )}%`;
  document.getElementById("totalPomodoros").textContent =
    dailyStats.pomodorosCompleted;
  document.getElementById("distractionsAvoided").textContent =
    analytics.blockedSitesHistory.reduce((a, b) => a + b, 0);
}

function updateCharts(analytics) {
  createLineChart(
    "focusTimeChart",
    "Daily Focus Time",
    analytics.dates,
    analytics.focusHistory,
    "Hours",
    "#2196F3"
  );

  createLineChart(
    "focusScoreChart",
    "Focus Score Trend",
    analytics.dates,
    analytics.scoreHistory,
    "Score",
    "#4CAF50"
  );

  createBarChart(
    "distractionsChart",
    "Daily Distractions",
    analytics.dates,
    analytics.distractionHistory,
    "#FF9800"
  );

  createBarChart(
    "websiteBlocksChart",
    "Blocked Site Attempts",
    analytics.dates,
    analytics.blockedSitesHistory,
    "#F44336"
  );
}

function createLineChart(id, label, labels, data, yLabel, color) {
  const ctx = document.getElementById(id).getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          borderColor: color,
          tension: 0.4,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: yLabel,
          },
        },
      },
    },
  });
}

function createBarChart(id, label, labels, data, color) {
  const ctx = document.getElementById(id).getContext("2d");
  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          backgroundColor: color,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  });
}

function getLast7Days() {
  return Array(7)
    .fill()
    .map((_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      return date.toLocaleDateString("en-US", { weekday: "short" });
    })
    .reverse();
}

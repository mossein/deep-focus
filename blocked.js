document.addEventListener("DOMContentLoaded", () => {
  const timerElement = document.getElementById("timer");
  const overrideButton = document.getElementById("override");

  chrome.storage.sync.get(["pomodoroEndTime"], (data) => {
    if (data.pomodoroEndTime) {
      updateTimer(data.pomodoroEndTime);
    } else {
      timerElement.textContent = "Focus mode active";
    }
  });

  overrideButton.addEventListener("click", () => {
    if (
      confirm(
        "Are you sure you want to override the block? This will affect your focus score."
      )
    ) {
      chrome.runtime.sendMessage({ type: "overrideBlock" });
      window.history.back();
    }
  });

  function updateTimer(endTime) {
    const update = () => {
      const remaining = Math.max(0, endTime - Date.now());
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);

      timerElement.textContent = `${minutes}:${seconds
        .toString()
        .padStart(2, "0")}`;

      if (remaining > 0) {
        requestAnimationFrame(update);
      }
    };

    update();
  }
});

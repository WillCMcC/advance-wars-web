(() => {
  const statusText = document.querySelector("#status-text");
  const statusChip = document.querySelector(".status-chip");
  const housing = document.querySelector("#screen-housing");
  const helpDialog = document.querySelector("#help-dialog");
  const installButton = document.querySelector("#install-button");
  const fullscreenButton = document.querySelector("#fullscreen-button");
  let installPrompt = null;

  function setStatus(label, state) {
    statusText.textContent = label;
    statusChip.dataset.state = state;
    document.documentElement.dataset.emulatorState = state;
  }

  function makeStartButtonAccessible() {
    const startButton = document.querySelector(".ejs_start_button");
    if (!startButton) return;

    // EmulatorJS appends hidden menu controls before its launch control. Moving
    // the launch control first keeps it early in the keyboard tab sequence.
    startButton.parentElement?.prepend(startButton);
    startButton.setAttribute("role", "button");
    startButton.setAttribute("aria-label", "Deploy Advance Wars 2");
    startButton.tabIndex = 0;
    startButton.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key) || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      startButton.click();
    });
  }

  window.EJS_player = "#game";
  window.EJS_core = "gba";
  window.EJS_controlScheme = "gba";
  window.EJS_gameName = "advance-wars-2-black-hole-rising";
  window.EJS_gameID = 573;
  window.EJS_gameUrl = "/roms/advance-wars-2.gba";
  window.EJS_pathtodata = "/emulator/";
  window.EJS_paths = {
    "emulator.min.js": "/emulator/emulator.bundle.js",
    "emulator.min.css": "/assets/emulator-themed.css"
  };
  window.EJS_color = "#e84a25";
  window.EJS_backgroundColor = "#111a19";
  window.EJS_backgroundImage = "/icons/boot-map.svg";
  window.EJS_backgroundBlur = false;
  window.EJS_startButtonName = "DEPLOY";
  window.EJS_alignStartButton = "center";
  window.EJS_startOnLoaded = false;
  window.EJS_fullscreenOnLoaded = false;
  window.EJS_threads = false;
  window.EJS_disableLocalStorage = false;
  window.EJS_disableDatabases = false;
  window.EJS_disableAutoLang = false;
  window.EJS_language = "en-US";
  window.EJS_volume = 0.7;
  window.EJS_defaultOptions = { "save-state-location": "browser" };
  window.EJS_noAutoFocus = false;
  window.EJS_forceLegacyCores = false;
  window.EJS_VirtualGamepadSettings = [
    { type: "button", text: "B", id: "b", location: "right", left: 4, top: 74, bold: true, input_value: 0 },
    { type: "button", text: "A", id: "a", location: "right", left: 80, top: 32, bold: true, input_value: 8 },
    { type: "dpad", id: "dpad", location: "left", left: "50%", top: "50%", joystickInput: false, inputValues: [4, 5, 6, 7] },
    { type: "button", text: "Start", id: "start", location: "center", left: 64, top: 2, fontSize: 13, block: true, input_value: 3 },
    { type: "button", text: "Select", id: "select", location: "center", left: -8, top: 2, fontSize: 13, block: true, input_value: 2 },
    { type: "button", text: "L", id: "l", location: "left", left: 56, top: -26, bold: true, block: true, input_value: 10 },
    { type: "button", text: "R", id: "r", location: "right", right: 56, top: -20, bold: true, block: true, input_value: 11 }
  ];

  window.EJS_ready = () => {
    makeStartButtonAccessible();
    setStatus("Ready to deploy", "ready");
  };
  window.EJS_onGameStart = () => {
    setStatus("Campaign running", "running");
    housing.classList.add("is-running");
  };
  const loader = document.createElement("script");
  loader.src = "/emulator/loader.js";
  loader.addEventListener("error", () => setStatus("Emulator failed to load", "error"));
  document.head.appendChild(loader);

  document.querySelector("#help-button").addEventListener("click", () => helpDialog.showModal());
  if (typeof housing.requestFullscreen !== "function" || typeof document.exitFullscreen !== "function") {
    fullscreenButton.hidden = true;
  } else {
    fullscreenButton.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          return;
        }
        await housing.requestFullscreen({ navigationUI: "hide" });
        try {
          await screen.orientation?.lock?.("landscape");
        } catch {
          // Orientation lock is optional.
        }
      } catch {
        setStatus("Full screen unavailable", "error");
      }
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
    document.documentElement.dataset.installAvailable = "true";
  });
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
    delete document.documentElement.dataset.installAvailable;
  });
  window.addEventListener("appinstalled", () => {
    installButton.hidden = true;
    delete document.documentElement.dataset.installAvailable;
    setStatus("Installed for quick launch", "saved");
  });

  window.addEventListener("keydown", (event) => {
    const interactive = event.target instanceof Element && event.target.closest("button, [role=button], a, input, select, textarea, [contenteditable]");
    if (!interactive && !helpDialog.open && document.documentElement.dataset.emulatorState === "running" &&
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
    }
  }, { passive: false });

  if ("serviceWorker" in navigator && window.isSecureContext && !new URLSearchParams(location.search).has("e2e")) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // The game remains fully playable when installation support is unavailable.
    });
  }
})();

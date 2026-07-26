import { state } from "./state.js";
import { hasOhifStudyData } from "./ohif-state.js";
import { openDialog } from "./dialog.js";

export function installUi() {
  if (state.installed) {
    return;
  }
  state.installed = true;

  ensureButtonMounted();
  installUiObserver();
}

export function installUiObserver() {
  if (state.uiObserver || !window.MutationObserver || !document.body) {
    return;
  }
  state.uiObserver = new MutationObserver(() => {
    scheduleButtonMount();
  });
  state.uiObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleButtonMount);
}

export function scheduleButtonMount() {
  if (state.mountQueued) {
    return;
  }
  state.mountQueued = true;
  const schedule = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
  schedule(() => {
    state.mountQueued = false;
    ensureButtonMounted();
  });
}

export function ensureButtonMounted() {
  const button = getOrCreateButton();
  const logoutButton = getOrCreateLogoutButton();
  const downloadHost = resolveDownloadHost();
  const shouldFloat = !downloadHost;
  button.classList.toggle("aquest-dm-button--floating", shouldFloat);
  logoutButton.classList.toggle("aquest-dm-button--floating", shouldFloat);

  if (downloadHost) {
    mountButtonInHost(button, downloadHost);
    mountButtonInHost(logoutButton, downloadHost);
  } else if (button.parentNode !== document.body) {
    document.body.appendChild(button);
  }
  if (!downloadHost && logoutButton.parentNode !== document.body) {
    document.body.appendChild(logoutButton);
  }

  updateButtonState();
}

export function getOrCreateButton() {
  if (state.button && state.button.isConnected) {
    return state.button;
  }

  let button = document.querySelector(".aquest-dm-download-button");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "aquest-dm-button aquest-dm-download-button";
    button.title = "Download medical images";
    button.setAttribute("aria-label", "Download medical images");
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3Zm-5 16h12v2H6v-2Z"/></svg><span>Download images</span>`;
    button.addEventListener("click", openDialog);
  }

  state.button = button;
  return button;
}

export function getOrCreateLogoutButton() {
  if (state.logoutButton && state.logoutButton.isConnected) {
    return state.logoutButton;
  }

  let button = document.querySelector(".aquest-dm-logout-button");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "aquest-dm-button aquest-dm-logout-button";
    button.title = "Logout / view other exam";
    button.setAttribute("aria-label", "Logout / view other exam");
    button.innerHTML = "<span>Logout / Other exam</span>";
    button.addEventListener("click", () => {
      window.location.href = resolveLogoutUrl();
    });
  }

  state.logoutButton = button;
  return button;
}

export function resolveLogoutUrl() {
  const publicUrl = String(window.PUBLIC_URL || "/");
  if (/\/viewer\/?$/i.test(publicUrl)) {
    return publicUrl.replace(/\/viewer\/?$/i, "/logout");
  }
  return "/logout";
}

export function resolveToolbarHost() {
  const toolbar = findToolbarRoot();
  if (!toolbar) {
    return null;
  }

  const rightGroup = findToolbarRightGroup(toolbar);
  if (rightGroup) {
    return rightGroup;
  }

  const slot = findToolbarSlot();
  if (slot) {
    slot.classList.add("aquest-dm-toolbar-slot");
    return slot;
  }

  return toolbar;
}

export function resolveDownloadHost() {
  const leftGroup = findToolbarLeftGroup();
  if (leftGroup) {
    return leftGroup;
  }
  return findToolbarSlot();
}

export function findToolbarSlot() {
  const divs = document.querySelectorAll("div");
  for (let i = 0; i < divs.length; i++) {
    if (hasClasses(divs[i], ["absolute", "top-1/2", "left-[250px]", "h-8", "-translate-y-1/2"])) {
      return divs[i];
    }
  }
  return null;
}

export function findToolbarRoot() {
  const divs = document.querySelectorAll("div");
  for (let i = 0; i < divs.length; i++) {
    if (hasClasses(divs[i], ["relative", "h-[48px]", "items-center"])) {
      return divs[i];
    }
  }
  return null;
}

export function findToolbarLeftGroup() {
  const divs = document.querySelectorAll("div");
  for (let i = 0; i < divs.length; i++) {
    if (hasClasses(divs[i], ["absolute", "left-0", "top-1/2", "flex", "-translate-y-1/2", "items-center"])) {
      return divs[i];
    }
  }
  return null;
}

export function findToolbarRightGroup(toolbar) {
  if (!toolbar) {
    return null;
  }
  for (let i = 0; i < toolbar.children.length; i++) {
    const child = toolbar.children[i];
    if (hasClasses(child, ["absolute", "right-0", "top-1/2", "flex", "-translate-y-1/2", "items-center"])) {
      return child;
    }
  }
  return null;
}

export function mountButtonInHost(button, host) {
  if (host.classList && host.classList.contains("aquest-dm-toolbar-slot")) {
    if (button.parentNode !== host) {
      host.appendChild(button);
    }
    return;
  }

  if (button.parentNode !== host) {
    host.appendChild(button);
  }
}

export function hasClasses(element, classes) {
  return !!(element && element.classList) && classes.every(className => element.classList.contains(className));
}

export function updateButtonState() {
  const button = state.button || document.querySelector(".aquest-dm-download-button");
  if (!button) {
    return;
  }
  const ready = hasOhifStudyData() && hasVisibleThumbnail();
  button.disabled = !ready;
  button.dataset.ready = ready ? "true" : "false";
  button.classList.toggle("aquest-dm-button--ready", ready);
}

export function hasVisibleThumbnail() {
  const thumbnail = document.querySelector('[data-cy="study-browser-thumbnail"] img[src]');
  if (!thumbnail) {
    return false;
  }
  const style = window.getComputedStyle ? window.getComputedStyle(thumbnail) : null;
  const rect = thumbnail.getBoundingClientRect ? thumbnail.getBoundingClientRect() : { width: 0, height: 0 };
  return (!style || (style.display !== "none" && style.visibility !== "hidden")) && rect.width > 0 && rect.height > 0;
}

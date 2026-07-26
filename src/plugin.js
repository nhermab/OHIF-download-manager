
import { isEnabled } from "./config.js";
import { loadLastDirectoryHandle } from "./state.js";
import { installUi } from "./ui.js";

export function bootstrap() {
  if (!isEnabled()) {
    return;
  }
  loadLastDirectoryHandle();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installUi);
  } else {
    installUi();
  }
}

bootstrap();
